import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

/**
 * Cache Hit Rate — 在 pi footer 显示 Current / Total / Real Hit Rate / Miss 四个缓存指标。
 */

// ──── 配置 ────────────────────────────────────────────────────

const STATUS_KEY = "cache-hit-rate";
const CONFIG_PATH = join(getAgentDir(), "cnife-cache-hit-rate.json");

type ColorRule = {
  low: number;
  high: number;
  color: string;
};

type CacheHitRateConfig = {
  colorRules: ColorRule[];
};

const DEFAULT_CONFIG: CacheHitRateConfig = {
  colorRules: [
    { low: 0, high: 75, color: "error" },
    { low: 75, high: 85, color: "warning" },
    { low: 85, high: 95, color: "default" },
    { low: 95, high: 100, color: "success" },
  ],
};

function saveDefaultConfig(path: string): void {
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(path, JSON.stringify(DEFAULT_CONFIG, null, 2) + "\n", "utf-8");
}

function validateColorRules(rules: ColorRule[]): boolean {
  if (rules.length === 0) return false;

  // 排序并检查覆盖 [0, 100]
  const sorted = [...rules].sort((a, b) => a.low - b.low);
  if (sorted[0].low !== 0) return false;

  for (let i = 0; i < sorted.length; i++) {
    const rule = sorted[i];

    // 检查 high <= 100（最后一条用 ≤ 着色，但仍需 high ≤ 100 声明覆盖）
    if (rule.high > 100) return false;

    // 相邻规则必须连续
    if (i < sorted.length - 1) {
      // 允许 0.001 浮点误差，避免手写 JSON 的微小精度偏差误判
      if (Math.abs(rule.high - sorted[i + 1].low) > 0.001) return false;
      if (rule.low >= rule.high) return false;
    } else {
      // 最后一条必须覆盖到 100（含 ≤ 判断）
      if (rule.high < 100) return false;
    }
  }

  return true;
}

function loadConfig(): CacheHitRateConfig | null {
  if (!existsSync(CONFIG_PATH)) {
    try {
      saveDefaultConfig(CONFIG_PATH);
    } catch {
      return null;
    }
    return { ...DEFAULT_CONFIG };
  }

  let raw: string;
  try {
    raw = readFileSync(CONFIG_PATH, "utf-8");
  } catch {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !Array.isArray((parsed as Record<string, unknown>).colorRules)
  ) {
    return null;
  }

  const obj = parsed as { colorRules: unknown[] };

  const rules: ColorRule[] = [];
  for (const r of obj.colorRules) {
    if (
      typeof r !== "object" ||
      r === null ||
      typeof (r as Record<string, unknown>).low !== "number" ||
      typeof (r as Record<string, unknown>).high !== "number" ||
      typeof (r as Record<string, unknown>).color !== "string"
    ) {
      return null;
    }
    rules.push(r as ColorRule);
  }

  if (!validateColorRules(rules)) return null;

  // 拒绝含 recentN 的旧配置文件（breaking change）
  if ("recentN" in obj) {
    return null;
  }

  return { colorRules: rules };
}

// ──── 核心状态 ────────────────────────────────────────────────

type Sample = {
  cacheRead: number;
  promptTokens: number;
};

type CacheMetrics = {
  current: Sample | null;
  totalCacheReadTokens: number;
  totalPromptTokens: number;
  totalMissTokens: number;
  /** 上一轮（跨用户消息边界）的最后一条 assistant message 的 promptTokens，作为本轮所有 asst msg 的缓存基线 */
  baselinePrompt: number;
  /** 当前轮最后一条 assistant message 的 promptTokens，下轮用户消息来临时成为新的 baselinePrompt */
  pendingPrompt: number;
  /** 上次 buildState 时的 branch 长度。message_end 据此检测 branch 增长（新轮次） */
  branchLength: number;
  /** 上次 buildState 时的用户消息数。message_end 据此检测用户消息增多（轮边界） */
  userMsgCount: number;
};

function createEmptyState(): CacheMetrics {
  return {
    current: null,
    totalCacheReadTokens: 0,
    totalPromptTokens: 0,
    totalMissTokens: 0,
    baselinePrompt: 0,
    pendingPrompt: 0,
    branchLength: 0,
    userMsgCount: 0,
  };
}

// ──── 工具函数 ────────────────────────────────────────────────

/** 紧凑数字格式化：999 → "999", 1234 → "1.2k", 1234567 → "1.2M" */
function fmtCompact(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

function getUsageSample(message: AssistantMessage): Sample | undefined {
  if (message.stopReason === "aborted" || message.stopReason === "error") {
    return undefined;
  }

  const { input, cacheRead, cacheWrite } = message.usage;
  const promptTokens = input + cacheRead + cacheWrite;
  if (promptTokens <= 0) {
    return undefined;
  }

  return { cacheRead, promptTokens };
}

/**
 * 单次遍历 getBranch()，以用户消息边界为「轮」界定缓存基线。
 *
 * - 模型切换/compaction 时重置所有累计状态。
 * - 用户消息处：将 pendingPrompt（上一轮最后一条 asst msg 的 pt）提升为 baselinePrompt。
 * - 同轮内的连续 asst msg 共享同一 baselinePrompt，避免 cacheWrite 虚增 miss。
 * - miss = max(0, baselinePrompt − cacheRead)，仅统计跨轮的缓存失效。
 */
function buildState(ctx: ExtensionContext): CacheMetrics {
  let totalCacheReadTokens = 0;
  let totalPromptTokens = 0;
  let totalMissTokens = 0;
  let baselinePrompt = 0;
  let pendingPrompt = 0;
  let current: Sample | null = null;
  let userMsgCount = 0;

  const branch = ctx.sessionManager.getBranch();
  for (const entry of branch) {
    if (entry.type === "model_change" || entry.type === "compaction") {
      totalCacheReadTokens = 0;
      totalPromptTokens = 0;
      totalMissTokens = 0;
      baselinePrompt = 0;
      pendingPrompt = 0;
      current = null;
      userMsgCount = 0;
      continue;
    }

    // 用户消息 = 轮边界：将上一轮的最后助理消息提升为基线
    if (entry.type === "message" && entry.message.role === "user") {
      userMsgCount++;
      baselinePrompt = pendingPrompt;
      continue;
    }

    if (entry.type !== "message" || entry.message.role !== "assistant") {
      continue;
    }

    const sample = getUsageSample(entry.message as AssistantMessage);
    if (!sample) continue;

    // miss = 跨轮基线 vs 本次 cacheRead，仅统计真正丢失的缓存
    const miss = Math.max(0, baselinePrompt - sample.cacheRead);
    totalMissTokens += miss;

    pendingPrompt = sample.promptTokens;
    totalCacheReadTokens += sample.cacheRead;
    totalPromptTokens += sample.promptTokens;
    current = sample;
  }

  return {
    current,
    totalCacheReadTokens,
    totalPromptTokens,
    totalMissTokens,
    baselinePrompt,
    pendingPrompt,
    branchLength: branch.length,
    userMsgCount,
  };
}

// ──── Footer 格式化 ────────────────────────────────────────────

function calcPercent(cacheRead: number, promptTokens: number): number | null {
  if (promptTokens <= 0) return null;
  return (cacheRead / promptTokens) * 100;
}

/** 根据 colorRules 为百分比应用颜色。 */
function applyColor(
  ctx: ExtensionContext,
  text: string,
  percent: number,
  colorRules: ColorRule[],
): string {
  const sorted = [...colorRules].sort((a, b) => a.low - b.low);

  for (let i = 0; i < sorted.length; i++) {
    const rule = sorted[i];
    const isLast = i === sorted.length - 1;

    const inRange = isLast
      ? percent >= rule.low && percent <= rule.high // 最后一条闭区间，保证 100% 着色
      : percent >= rule.low && percent < rule.high;

    if (inRange) {
      if (rule.color === "default") return text;
      return ctx.ui.theme.fg(
        rule.color as "error" | "warning" | "success" | "dim",
        text,
      );
    }
  }

  // 防御性 fallback：百分比不在任何规则区间时不着色
  return text;
}

function fmtPercent(p: number | null): string {
  if (p === null) return "--.--";
  return p.toFixed(2);
}

function formatStatus(
  ctx: ExtensionContext,
  state: CacheMetrics,
  colorRules: ColorRule[],
): string {
  if (state.totalPromptTokens <= 0) {
    const empty = "Cache C:--.-- T:--.-- R:--.-- M:--";
    return ctx.ui.theme.fg("dim", empty);
  }

  const cPercent = calcPercent(
    state.current?.cacheRead ?? 0,
    state.current?.promptTokens ?? 0,
  );
  const tPercent = calcPercent(
    state.totalCacheReadTokens,
    state.totalPromptTokens,
  );

  // R = (1 − totalMissTokens / totalInputTokens) × 100
  // totalInputTokens = totalPromptTokens − totalCacheReadTokens
  const totalInput = state.totalPromptTokens - state.totalCacheReadTokens;
  const rPercent =
    totalInput > 0
      ? Math.max(0, (1 - state.totalMissTokens / totalInput) * 100)
      : null;

  const cText = applyColor(
    ctx,
    `C:${fmtPercent(cPercent)}`,
    cPercent ?? 0,
    colorRules,
  );
  const tText = applyColor(
    ctx,
    `T:${fmtPercent(tPercent)}`,
    tPercent ?? 0,
    colorRules,
  );
  const rText = applyColor(
    ctx,
    `R:${fmtPercent(rPercent)}`,
    rPercent ?? 0,
    colorRules,
  );
  const mText = `M:${fmtCompact(state.totalMissTokens)}`;

  return `Cache ${cText} ${tText} ${rText} ${mText}`;
}

function publishCacheHitRate(
  ctx: ExtensionContext,
  state: CacheMetrics,
  colorRules: ColorRule[],
): void {
  ctx.ui.setStatus(STATUS_KEY, formatStatus(ctx, state, colorRules));
}

// ──── 入口 ────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  const config = loadConfig();

  if (!config) {
    pi.on("session_start", (_event, ctx) => {
      ctx.ui.setStatus(
        STATUS_KEY,
        ctx.ui.theme.fg("error", "cache config error"),
      );
    });
    return;
  }

  const { colorRules } = config;
  const state = createEmptyState();

  pi.on("session_start", (_event, ctx) => {
    const fresh = buildState(ctx);
    Object.assign(state, fresh);
    publishCacheHitRate(ctx, state, colorRules);
  });

  pi.on("session_tree", (_event, ctx) => {
    const fresh = buildState(ctx);
    Object.assign(state, fresh);
    publishCacheHitRate(ctx, state, colorRules);
  });

  pi.on("session_compact", (_event, ctx) => {
    const fresh = buildState(ctx);
    Object.assign(state, fresh);
    publishCacheHitRate(ctx, state, colorRules);
  });

  pi.on("model_select", (_event, ctx) => {
    const fresh = buildState(ctx);
    Object.assign(state, fresh);
    publishCacheHitRate(ctx, state, colorRules);
  });

  pi.on("message_end", (event, ctx) => {
    if (event.message.role !== "assistant") return;

    const sample = getUsageSample(event.message as AssistantMessage);
    if (!sample) return;

    // 检测轮边界：如果 branch 中的用户消息数增加了，说明进入了新轮
    const branch = ctx.sessionManager.getBranch();
    if (branch.length > state.branchLength) {
      // 重新统计用户消息数以判断是否跨轮
      const currentUserCount = branch.filter(
        (e) => e.type === "message" && e.message.role === "user",
      ).length;
      if (currentUserCount > state.userMsgCount) {
        // 新轮：将上一轮的 pendingPrompt 提升为 baselinePrompt
        state.baselinePrompt = state.pendingPrompt;
        state.userMsgCount = currentUserCount;
      }
      state.branchLength = branch.length;
    }

    // miss = max(0, baselinePrompt - current.cacheRead)
    // baselinePrompt 由 buildState 在轮边界更新，同轮内保持不变
    const miss = Math.max(0, state.baselinePrompt - sample.cacheRead);
    state.totalMissTokens += miss;

    state.pendingPrompt = sample.promptTokens;
    state.current = sample;
    state.totalCacheReadTokens += sample.cacheRead;
    state.totalPromptTokens += sample.promptTokens;

    publishCacheHitRate(ctx, state, colorRules);
  });
}

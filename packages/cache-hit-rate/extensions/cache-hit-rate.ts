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
  prevPromptTokens: number;
};

function createEmptyState(): CacheMetrics {
  return {
    current: null,
    totalCacheReadTokens: 0,
    totalPromptTokens: 0,
    totalMissTokens: 0,
    prevPromptTokens: 0,
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

/** 单次遍历 getBranch()，遇 model_change/compaction entry 重置累计状态。相邻样本逐对比较计算 miss。 */
function buildState(ctx: ExtensionContext): CacheMetrics {
  let totalCacheReadTokens = 0;
  let totalPromptTokens = 0;
  let totalMissTokens = 0;
  let prevPromptTokens = 0;
  let current: Sample | null = null;

  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type === "model_change" || entry.type === "compaction") {
      totalCacheReadTokens = 0;
      totalPromptTokens = 0;
      totalMissTokens = 0;
      prevPromptTokens = 0;
      current = null;
      continue;
    }

    if (entry.type !== "message" || entry.message.role !== "assistant") {
      continue;
    }

    const sample = getUsageSample(entry.message as AssistantMessage);
    if (!sample) continue;

    // miss = 上次请求的非 output token 中，本次未命中缓存的部分
    const miss = Math.max(0, prevPromptTokens - sample.cacheRead);
    totalMissTokens += miss;

    prevPromptTokens = sample.promptTokens;
    totalCacheReadTokens += sample.cacheRead;
    totalPromptTokens += sample.promptTokens;
    current = sample;
  }

  return {
    current,
    totalCacheReadTokens,
    totalPromptTokens,
    totalMissTokens,
    prevPromptTokens,
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

    // miss = max(0, prevPromptTokens - current.cacheRead)
    const miss = Math.max(0, state.prevPromptTokens - sample.cacheRead);
    state.totalMissTokens += miss;

    state.prevPromptTokens = sample.promptTokens;
    state.current = sample;
    state.totalCacheReadTokens += sample.cacheRead;
    state.totalPromptTokens += sample.promptTokens;

    publishCacheHitRate(ctx, state, colorRules);
  });
}

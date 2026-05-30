import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

/**
 * Cache Hit Rate — 在 pi footer 显示 Current / Recent N / Total 三个时间尺度的缓存命中率。
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
  recentN: number;
  colorRules: ColorRule[];
};

const DEFAULT_CONFIG: CacheHitRateConfig = {
  recentN: 10,
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
    typeof (parsed as Record<string, unknown>).recentN !== "number" ||
    !Array.isArray((parsed as Record<string, unknown>).colorRules)
  ) {
    return null;
  }

  const obj = parsed as { recentN: number; colorRules: unknown[] };
  if (obj.recentN < 1) return null;

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

  return { recentN: obj.recentN, colorRules: rules };
}

// ──── 核心状态 ────────────────────────────────────────────────

type Sample = {
  cacheRead: number;
  promptTokens: number;
};

type CacheMetrics = {
  current: Sample | null;
  recentSamples: Sample[];
  totalCacheReadTokens: number;
  totalPromptTokens: number;
};

function createEmptyState(): CacheMetrics {
  return {
    current: null,
    recentSamples: [],
    totalCacheReadTokens: 0,
    totalPromptTokens: 0,
  };
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

function calcWeightedPercent(samples: Sample[]): number | null {
  let totalCacheRead = 0;
  let totalPrompt = 0;
  for (const s of samples) {
    totalCacheRead += s.cacheRead;
    totalPrompt += s.promptTokens;
  }
  if (totalPrompt <= 0) return null;
  return (totalCacheRead / totalPrompt) * 100;
}

/** 单次遍历 getBranch()，遇 model_change/compaction entry 重置累计状态。 */
function buildState(ctx: ExtensionContext, recentN: number): CacheMetrics {
  let totalCacheReadTokens = 0;
  let totalPromptTokens = 0;
  const recentSamples: Sample[] = [];
  let current: Sample | null = null;

  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type === "model_change" || entry.type === "compaction") {
      totalCacheReadTokens = 0;
      totalPromptTokens = 0;
      recentSamples.length = 0;
      current = null;
      continue;
    }

    if (entry.type !== "message" || entry.message.role !== "assistant") {
      continue;
    }

    const sample = getUsageSample(entry.message as AssistantMessage);
    if (!sample) continue;

    totalCacheReadTokens += sample.cacheRead;
    totalPromptTokens += sample.promptTokens;
    current = sample;

    recentSamples.push(sample);
  }

  // 截断 Recent 到最近 N 条
  const trimmedSamples = recentSamples.slice(-recentN);

  return {
    current,
    recentSamples: trimmedSamples,
    totalCacheReadTokens,
    totalPromptTokens,
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
    const empty = "Cache C:--.-- R0:--.-- T:--.--";
    return ctx.ui.theme.fg("dim", empty);
  }

  const cPercent = calcPercent(
    state.current?.cacheRead ?? 0,
    state.current?.promptTokens ?? 0,
  );
  const rPercent = calcWeightedPercent(state.recentSamples);
  const tPercent = calcPercent(
    state.totalCacheReadTokens,
    state.totalPromptTokens,
  );

  const cText = applyColor(
    ctx,
    `C:${fmtPercent(cPercent)}`,
    cPercent ?? 0,
    colorRules,
  );
  const rText = applyColor(
    ctx,
    `R${state.recentSamples.length}:${fmtPercent(rPercent)}`,
    rPercent ?? 0,
    colorRules,
  );
  const tText = applyColor(
    ctx,
    `T:${fmtPercent(tPercent)}`,
    tPercent ?? 0,
    colorRules,
  );

  return `Cache ${cText} ${rText} ${tText}`;
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

  const { recentN, colorRules } = config;
  const state = createEmptyState();

  pi.on("session_start", (_event, ctx) => {
    const fresh = buildState(ctx, recentN);
    Object.assign(state, fresh);
    publishCacheHitRate(ctx, state, colorRules);
  });

  pi.on("session_tree", (_event, ctx) => {
    const fresh = buildState(ctx, recentN);
    Object.assign(state, fresh);
    publishCacheHitRate(ctx, state, colorRules);
  });

  pi.on("session_compact", (_event, ctx) => {
    const fresh = buildState(ctx, recentN);
    Object.assign(state, fresh);
    publishCacheHitRate(ctx, state, colorRules);
  });

  pi.on("model_select", (_event, ctx) => {
    const fresh = buildState(ctx, recentN);
    Object.assign(state, fresh);
    publishCacheHitRate(ctx, state, colorRules);
  });

  pi.on("message_end", (event, ctx) => {
    if (event.message.role !== "assistant") return;

    const sample = getUsageSample(event.message as AssistantMessage);
    if (!sample) return;

    state.current = sample;

    state.recentSamples.push(sample);
    if (state.recentSamples.length > recentN) {
      state.recentSamples.shift();
    }

    state.totalCacheReadTokens += sample.cacheRead;
    state.totalPromptTokens += sample.promptTokens;

    publishCacheHitRate(ctx, state, colorRules);
  });
}

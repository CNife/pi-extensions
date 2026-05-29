import type { AssistantMessage } from "@earendil-works/pi-ai";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";

/**
 * Cache Hit Rate — 在 pi footer 显示当前会话累计缓存命中率，
 * 以及基于 assistant message 的短期缓存趋势。
 */

const STATUS_KEY = "cache-hit-rate";
const EMPTY_TEXT = "Cached --.--%";
const TREND_WINDOW_SIZE = 5;
const MAX_TREND_SAMPLES = TREND_WINDOW_SIZE * 2;
const MIN_TREND_PROMPT_TOKENS = 3000;

type UsageSample = {
  cacheRead: number;
  promptTokens: number;
};

type CacheHitRateState = {
  totalCacheReadTokens: number;
  totalPromptTokens: number;
  trendSamples: UsageSample[];
};

function createEmptyState(): CacheHitRateState {
  return {
    totalCacheReadTokens: 0,
    totalPromptTokens: 0,
    trendSamples: [],
  };
}

function getUsageSample(message: AssistantMessage): UsageSample | undefined {
  if (message.stopReason === "aborted" || message.stopReason === "error") {
    return undefined;
  }

  const { input, cacheRead, cacheWrite } = message.usage;
  const promptTokens = input + cacheRead + cacheWrite;
  if (promptTokens <= 0) {
    return undefined;
  }

  return {
    cacheRead,
    promptTokens,
  };
}

function addToCumulativeTotals(
  state: CacheHitRateState,
  sample: UsageSample,
): void {
  state.totalPromptTokens += sample.promptTokens;
  state.totalCacheReadTokens += sample.cacheRead;
}

function pushTrendSample(state: CacheHitRateState, sample: UsageSample): void {
  if (sample.promptTokens < MIN_TREND_PROMPT_TOKENS) {
    return;
  }

  state.trendSamples.push(sample);
  if (state.trendSamples.length > MAX_TREND_SAMPLES) {
    state.trendSamples.shift();
  }
}

function resetTrendSamples(state: CacheHitRateState): void {
  state.trendSamples = [];
}

function replaceState(
  target: CacheHitRateState,
  next: CacheHitRateState,
): void {
  target.totalPromptTokens = next.totalPromptTokens;
  target.totalCacheReadTokens = next.totalCacheReadTokens;
  target.trendSamples = next.trendSamples;
}

function calculatePercent(samples: UsageSample[]): number | undefined {
  let totalPromptTokens = 0;
  let totalCacheReadTokens = 0;

  for (const sample of samples) {
    totalPromptTokens += sample.promptTokens;
    totalCacheReadTokens += sample.cacheRead;
  }

  if (totalPromptTokens <= 0) {
    return undefined;
  }

  return (totalCacheReadTokens / totalPromptTokens) * 100;
}

function colorizeByCumulativeRate(
  ctx: ExtensionContext,
  text: string,
  percent: number,
): string {
  if (percent < 75) {
    return ctx.ui.theme.fg("error", text);
  }
  if (percent < 85) {
    return ctx.ui.theme.fg("warning", text);
  }
  if (percent < 95) {
    return text;
  }
  return ctx.ui.theme.fg("success", text);
}

function colorizeByDelta(
  ctx: ExtensionContext,
  text: string,
  delta: number,
): string {
  if (delta > 5) {
    return ctx.ui.theme.fg("success", text);
  }
  if (delta < -15) {
    return ctx.ui.theme.fg("error", text);
  }
  if (delta < -5) {
    return ctx.ui.theme.fg("warning", text);
  }
  return text;
}

function formatDelta(delta: number): string {
  const normalizedDelta = Math.abs(delta) < 0.005 ? 0 : delta;
  const sign = normalizedDelta > 0 ? "+" : "";
  return `${sign}${normalizedDelta.toFixed(2)}pt`;
}

function buildState(ctx: ExtensionContext): CacheHitRateState {
  const state = createEmptyState();

  for (const entry of ctx.sessionManager.getEntries()) {
    if (entry.type !== "message" || entry.message.role !== "assistant") {
      continue;
    }

    const sample = getUsageSample(entry.message as AssistantMessage);
    if (sample) {
      addToCumulativeTotals(state, sample);
    }
  }

  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type === "model_change" || entry.type === "compaction") {
      resetTrendSamples(state);
      continue;
    }

    if (entry.type !== "message" || entry.message.role !== "assistant") {
      continue;
    }

    const sample = getUsageSample(entry.message as AssistantMessage);
    if (sample) {
      pushTrendSample(state, sample);
    }
  }

  return state;
}

function formatStatus(ctx: ExtensionContext, state: CacheHitRateState): string {
  if (state.totalPromptTokens <= 0) {
    return ctx.ui.theme.fg("dim", EMPTY_TEXT);
  }

  const cumulativePercent =
    (state.totalCacheReadTokens / state.totalPromptTokens) * 100;
  const cumulativeText = `Cached ${cumulativePercent.toFixed(2)}%`;

  if (state.trendSamples.length < MAX_TREND_SAMPLES) {
    return colorizeByCumulativeRate(ctx, cumulativeText, cumulativePercent);
  }

  const previousPercent = calculatePercent(
    state.trendSamples.slice(0, TREND_WINDOW_SIZE),
  );
  const recentPercent = calculatePercent(
    state.trendSamples.slice(-TREND_WINDOW_SIZE),
  );

  if (previousPercent === undefined || recentPercent === undefined) {
    return colorizeByCumulativeRate(ctx, cumulativeText, cumulativePercent);
  }

  const delta = recentPercent - previousPercent;
  const trendText = `${cumulativeText} | Recent ${recentPercent.toFixed(2)}% | ${formatDelta(delta)}`;
  return colorizeByDelta(ctx, trendText, delta);
}

function publishCacheHitRate(
  ctx: ExtensionContext,
  state: CacheHitRateState,
): void {
  ctx.ui.setStatus(STATUS_KEY, formatStatus(ctx, state));
}

export default function (pi: ExtensionAPI) {
  const state = createEmptyState();

  pi.on("session_start", (_event, ctx) => {
    replaceState(state, buildState(ctx));
    publishCacheHitRate(ctx, state);
  });

  pi.on("session_tree", (_event, ctx) => {
    replaceState(state, buildState(ctx));
    publishCacheHitRate(ctx, state);
  });

  pi.on("session_compact", (_event, ctx) => {
    replaceState(state, buildState(ctx));
    publishCacheHitRate(ctx, state);
  });

  pi.on("model_select", (_event, ctx) => {
    resetTrendSamples(state);
    publishCacheHitRate(ctx, state);
  });

  pi.on("message_end", (event, ctx) => {
    if (event.message.role !== "assistant") {
      return;
    }

    const sample = getUsageSample(event.message as AssistantMessage);
    if (!sample) {
      return;
    }

    addToCumulativeTotals(state, sample);
    pushTrendSample(state, sample);
    publishCacheHitRate(ctx, state);
  });
}

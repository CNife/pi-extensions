import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
  AFTER_SUCCESS_STATE,
  afterCompactionFailure,
  type CompactionState,
  compactionThreshold,
  decideCompaction,
  INITIAL_STATE,
} from "./threshold.ts";

/**
 * 上下文压缩阈值：min(300K 已用 token, 85% 窗口)。
 *
 * 检查点放在 `agent_settled`（Pi 已无剩余自动工作）：`ctx.compact()` 走 pi 的
 * manual 入口，第一件事就是 `abort()`，文档写明「Aborts the current agent
 * operation first. Manual compaction never retries or continues the interrupted
 * agent turn.」。`turn_end` 是 run 中途；`agent_end` 时 `_isAgentRunActive`
 * 仍为 true（要到 `_emitAgentSettled` 才置 false），在那里压缩同样会置 abort
 * 请求，把排队 follow-up、自动重试、溢出/长度恢复一并取消。只有
 * `agent_settled` 里 run 已标记为非活跃，abort 才是空操作。
 *
 * 内建机制保留不动：它在窗口 - 16K（约 98%）触发，晚于这里的阈值，因此退化成
 * 兜底，provider 溢出恢复也仍归 pi 自己处理。
 */

type UsageSnapshot =
  | { known: true; tokens: number; contextWindow: number; threshold: number }
  | { known: false };

function readUsage(ctx: ExtensionContext): UsageSnapshot {
  const usage = ctx.getContextUsage();
  const tokens = usage?.tokens ?? null;
  const contextWindow =
    usage?.contextWindow ?? ctx.model?.contextWindow ?? null;
  const threshold = compactionThreshold(contextWindow);
  if (tokens === null || contextWindow === null || threshold === null) {
    return { known: false };
  }
  return { known: true, tokens, contextWindow, threshold };
}

function formatTokens(tokens: number): string {
  if (tokens >= 1000) {
    return `${Math.round(tokens / 1000)}K`;
  }
  return String(tokens);
}

/** 用户显式关掉内建自动压缩（`compaction.enabled: false`）时不接管。 */
function autoCompactionEnabled(pi: ExtensionAPI): boolean {
  return pi.getSettings().compaction?.enabled ?? true;
}

export default function (pi: ExtensionAPI) {
  let state: CompactionState = INITIAL_STATE;

  // 换会话/切分支后旧的抑制与次数不再有意义。
  pi.on("session_start", () => {
    state = INITIAL_STATE;
  });

  pi.on("session_compact", () => {
    state = AFTER_SUCCESS_STATE;
  });

  pi.on("agent_settled", (_event, ctx) => {
    if (!autoCompactionEnabled(pi)) {
      return;
    }
    const usage = readUsage(ctx);
    if (!usage.known) {
      return;
    }

    const decision = decideCompaction(usage.tokens, usage.threshold, state);
    state = decision.state;
    if (!decision.trigger) {
      return;
    }

    if (ctx.hasUI) {
      ctx.ui.notify(
        `上下文 ${formatTokens(usage.tokens)} 超过阈值 ${formatTokens(usage.threshold)}（窗口 ${formatTokens(usage.contextWindow)}），开始压缩`,
        "info",
      );
    }

    ctx.compact({
      onError: (error) => {
        state = afterCompactionFailure(state);
        if (!ctx.hasUI) {
          return;
        }
        // 用户主动取消（Esc / abortCompaction）与真失败要分开说，别都报成红色失败。
        const cancelled = /cancel/i.test(error.message);
        ctx.ui.notify(
          cancelled ? "压缩被取消" : `压缩失败：${error.message}`,
          cancelled ? "warning" : "error",
        );
      },
    });
  });

  pi.registerCommand("compact-threshold", {
    description: "显示当前上下文占用与压缩阈值",
    handler: async (_args, ctx) => {
      const usage = readUsage(ctx);
      if (!usage.known) {
        ctx.ui.notify("拿不到上下文用量或窗口大小", "warning");
        return;
      }
      const percent = ((usage.tokens / usage.contextWindow) * 100).toFixed(1);
      ctx.ui.notify(
        `已用 ${formatTokens(usage.tokens)} / ${formatTokens(usage.contextWindow)}（${percent}%），阈值 ${formatTokens(usage.threshold)}`,
        "info",
      );
    },
  });
}

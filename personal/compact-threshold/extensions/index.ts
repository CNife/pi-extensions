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
 * 检查点放在 `agent_end`（一次 run 收尾）而不是 `turn_end`（run 中途）：
 * `ctx.compact()` 走 pi 的 manual 入口，文档写明「Aborts the current agent
 * operation first. Manual compaction never retries or continues the interrupted
 * agent turn.」——在 turn_end 调用会把正在跑的 agent 循环打断。agent_end 是
 * pi 内建自动压缩自己的时点，此时 run 已收尾，abort 打空。
 *
 * 内建机制保留不动：它在窗口 - 16K（约 98%）触发，晚于这里的阈值，因此退化成
 * 兜底，provider 溢出恢复也仍归 pi 自己处理。
 */

interface UsageSnapshot {
  tokens: number | null;
  contextWindow: number | null;
  threshold: number | null;
}

function readUsage(ctx: ExtensionContext): UsageSnapshot {
  const usage = ctx.getContextUsage();
  const contextWindow =
    usage?.contextWindow ?? ctx.model?.contextWindow ?? null;
  return {
    tokens: usage?.tokens ?? null,
    contextWindow,
    threshold: compactionThreshold(contextWindow),
  };
}

/** 用户关掉内建自动压缩（`compaction.enabled: false`）时不接管，避免绕过用户的显式关闭。 */
function autoCompactionEnabled(ctx: ExtensionContext): boolean {
  return ctx.getSettings().compaction?.enabled ?? true;
}

function formatTokens(tokens: number): string {
  if (tokens >= 1000) {
    return `${Math.round(tokens / 1000)}K`;
  }
  return String(tokens);
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

  pi.on("agent_end", (_event, ctx) => {
    if (!autoCompactionEnabled(ctx)) {
      return;
    }
    const { tokens, contextWindow, threshold } = readUsage(ctx);
    const decision = decideCompaction(tokens, threshold, state);
    state = decision.state;
    if (!decision.trigger || tokens === null || threshold === null) {
      return;
    }

    if (ctx.hasUI) {
      ctx.ui.notify(
        `上下文 ${formatTokens(tokens)} 超过阈值 ${formatTokens(threshold)}（窗口 ${formatTokens(contextWindow ?? 0)}），开始压缩`,
        "info",
      );
    }

    ctx.compact({
      onError: (error) => {
        state = afterCompactionFailure(state);
        if (ctx.hasUI) {
          ctx.ui.notify(`压缩失败：${error.message}`, "error");
        }
      },
    });
  });

  pi.registerCommand("compact-threshold", {
    description: "显示当前上下文占用与压缩阈值",
    handler: async (_args, ctx) => {
      const { tokens, contextWindow, threshold } = readUsage(ctx);
      if (tokens === null || threshold === null || contextWindow === null) {
        ctx.ui.notify("拿不到上下文用量或窗口大小", "warning");
        return;
      }
      const percent = ((tokens / contextWindow) * 100).toFixed(1);
      ctx.ui.notify(
        `已用 ${formatTokens(tokens)} / ${formatTokens(contextWindow)}（${percent}%），阈值 ${formatTokens(threshold)}`,
        "info",
      );
    },
  });
}

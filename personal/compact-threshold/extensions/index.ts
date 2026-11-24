import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { compactionThreshold, decideCompaction } from "./threshold.ts";

/**
 * 上下文压缩阈值：min(300K 已用 token, 85% 窗口)。
 *
 * pi 内建的自动压缩在 `contextTokens > contextWindow - reserveTokens` 时触发，
 * 而 `reserveTokens` 只能按模型写死常量。这里改成在 `turn_end` 按当前模型的
 * 窗口实时算阈值，超标时调 `ctx.compact()` 触发一次压缩。
 *
 * 内建机制保留不动：它的触发点（窗口 - 16K，约 98%）晚于本扩展的阈值，因此
 * 退化成兜底，provider 溢出恢复也仍归 pi 自己处理。
 */

function formatTokens(tokens: number): string {
  if (tokens >= 1000) {
    return `${Math.round(tokens / 1000)}K`;
  }
  return String(tokens);
}

export default function (pi: ExtensionAPI) {
  let suppressed = false;

  // 换会话/切分支后旧的抑制状态不再有意义。
  pi.on("session_start", () => {
    suppressed = false;
  });

  pi.on("turn_end", (_event, ctx) => {
    const usage = ctx.getContextUsage();
    const tokens = usage?.tokens ?? null;
    const contextWindow =
      usage?.contextWindow ?? ctx.model?.contextWindow ?? null;
    const threshold = compactionThreshold(contextWindow);

    const decision = decideCompaction(tokens, threshold, suppressed);
    suppressed = decision.suppressed;
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
        if (ctx.hasUI) {
          ctx.ui.notify(`压缩失败：${error.message}`, "error");
        }
      },
    });
  });

  pi.registerCommand("compact-threshold", {
    description: "显示当前上下文占用与压缩阈值",
    handler: async (_args, ctx) => {
      const usage = ctx.getContextUsage();
      const tokens = usage?.tokens ?? null;
      const contextWindow =
        usage?.contextWindow ?? ctx.model?.contextWindow ?? null;
      const threshold = compactionThreshold(contextWindow);
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

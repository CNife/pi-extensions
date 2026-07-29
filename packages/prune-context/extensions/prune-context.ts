/**
 * prune-context — 确定性上下文裁剪扩展。
 *
 * - /prune 命令：手动触发确定性裁剪，内部调 ctx.compact()
 * - session_before_compact 钩子：
 *   - /prune 触发（customInstructions 标记）→ 确定性裁剪
 *   - 自动阈值压缩（threshold / overflow）→ 确定性裁剪替代 LLM 摘要
 *   - 手动 /compact → 不干预，保持 pi 原生 LLM 摘要
 *
 * 纯逻辑在 ./prune.ts 和 ./format.ts，本文件只做编排。
 */

import type {
  ExtensionAPI,
  SessionEntry,
} from "@earendil-works/pi-coding-agent";
import { formatSummary } from "./format.ts";
import { type MessageLike, pruneMessages } from "./prune.ts";

/** /prune 命令的 customInstructions 标记，用于在钩子中识别来源。 */
const PRUNE_MARKER = "pi-prune-context:prune";

/**
 * 从 branchEntries 提取活跃消息（orphan-recovery 模式）。
 *
 * 找最后一个 compaction entry：
 * - 若其 firstKeptEntryId 为空（compact-all 哨兵）或指向不存在的 entry
 *   → 从该 compaction 之后收集所有 message entry
 * - 否则从 firstKeptEntryId 开始收集
 * - 无 compaction entry → 收集全部 message entry
 */
function extractLiveMessages(branchEntries: SessionEntry[]): MessageLike[] {
  // 找最后一个 compaction entry
  let lastCompactionIdx = -1;
  let lastKeptId: string | undefined;
  for (let i = branchEntries.length - 1; i >= 0; i--) {
    const e = branchEntries[i];
    if (e.type === "compaction") {
      lastCompactionIdx = i;
      lastKeptId = (e as { firstKeptEntryId?: string }).firstKeptEntryId;
      break;
    }
  }

  const messages: MessageLike[] = [];

  if (lastCompactionIdx < 0) {
    // 无 compaction entry，收集全部
    for (const e of branchEntries) {
      if (e.type === "message") {
        messages.push((e as { message: MessageLike }).message);
      }
    }
    return messages;
  }

  // orphan recovery：firstKeptEntryId 为空或不存在于 branch 中
  const hasValidKeptId =
    !!lastKeptId && branchEntries.some((e) => e.id === lastKeptId);

  if (!hasValidKeptId) {
    // 从 compaction 之后收集
    for (let i = lastCompactionIdx + 1; i < branchEntries.length; i++) {
      const e = branchEntries[i];
      if (e.type === "message") {
        messages.push((e as { message: MessageLike }).message);
      }
    }
    return messages;
  }

  // 从 firstKeptEntryId 开始收集
  let foundKept = false;
  for (const e of branchEntries) {
    if (!foundKept && e.id === lastKeptId) foundKept = true;
    if (!foundKept) continue;
    if (e.type === "message") {
      messages.push((e as { message: MessageLike }).message);
    }
  }
  return messages;
}

export default function (pi: ExtensionAPI) {
  // /prune 命令：手动触发确定性裁剪
  pi.registerCommand("prune", {
    description: "确定性裁剪上下文（零 LLM 开销）",
    handler: async (_args: string, ctx) => {
      ctx.compact({
        customInstructions: PRUNE_MARKER,
        onError: (err) => {
          if (
            err.message === "Compaction cancelled" ||
            err.message === "Already compacted"
          ) {
            ctx.ui.notify("Nothing to prune", "warning");
          } else {
            ctx.ui.notify(`Prune failed: ${err.message}`, "error");
          }
        },
      });
    },
  });

  // session_before_compact 钩子
  pi.on("session_before_compact", (event, _ctx) => {
    const { preparation, branchEntries, customInstructions } = event;
    // reason 在 pi ≥0.76 才有；运行时鸭子类型兼容旧版
    const reason = (event as { reason?: string }).reason;

    // 手动 /compact（非 /prune 标记）→ 不干预，保持 pi 原生行为
    if (reason === "manual" && customInstructions !== PRUNE_MARKER) {
      return;
    }

    // 旧版 pi 无 reason：仅 /prune 标记时介入，其余交给 pi 原生
    if (reason === undefined && customInstructions !== PRUNE_MARKER) {
      return;
    }

    // 提取活跃消息
    const messages = extractLiveMessages(branchEntries);
    if (messages.length === 0) return;

    // prune → format 管线
    const entries = pruneMessages(messages);
    const summary = formatSummary(
      entries,
      messages.length,
      preparation.previousSummary,
    );

    return {
      compaction: {
        summary,
        firstKeptEntryId: "",
        tokensBefore: preparation.tokensBefore,
        details: {
          prunedCount: messages.length,
          keptCount: entries.length,
          filesCount: 0,
        },
      },
    };
  });
}

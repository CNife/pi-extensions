/**
 * format — 将 PrunedEntry[] 渲染为 summary 字符串。
 *
 * 输出格式：
 *   Pruned N messages.
 *   <空行>
 *   [previousSummary 原样透传（如有）]
 *   <空行>
 *   **role**: text
 *   <空行>
 *   **role**: text
 *   ...
 *
 * 纯函数，无副作用，可独立测试。
 */

import type { PrunedEntry } from "./prune.ts";

/**
 * 将裁剪条目渲染为 summary 字符串。
 *
 * @param entries - pruneMessages 输出的 PrunedEntry[]
 * @param totalMessageCount - 裁剪前的消息总数（用于首行统计）
 * @param previousSummary - 迭代压缩时上一轮的 summary，原样透传在顶部
 */
export function formatSummary(
  entries: PrunedEntry[],
  totalMessageCount: number,
  previousSummary?: string,
): string {
  const lines: string[] = [`Pruned ${totalMessageCount} messages.`, ""];

  if (previousSummary) {
    lines.push(previousSummary, "");
  }

  for (const entry of entries) {
    lines.push(`**${entry.role}**: ${entry.text}`, "");
  }

  // 去掉末尾多余空行
  while (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }

  return lines.join("\n");
}

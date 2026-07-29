/**
 * format — 将 PrunedEntry[] 渲染为 summary 字符串。
 *
 * 输出格式：
 *   Pruned N messages. Files: file1, file2, ...
 *   <空行>
 *   [previousSummary 原样透传（如有）]
 *   <空行>
 *   **role**: text
 *   <空行>
 *   - toolName({"arg":"value"}) #行号.索引
 *   <空行>
 *   **toolResult** (toolName, error):
 *   ```
 *   error content
 *   ```
 *   <空行>
 *   **bash**: `command`
 *   ...
 *
 * 纯函数，无副作用，可独立测试。
 */

import type { PrunedEntry } from "./prune.ts";

/** 将 args 对象渲染为紧凑 JSON 字符串。 */
function renderArgs(args: Record<string, unknown>): string {
  const keys = Object.keys(args);
  if (keys.length === 0) return "";
  return JSON.stringify(args);
}

/** 渲染单个 PrunedEntry 为字符串行（可能多行）。 */
function renderEntry(entry: PrunedEntry): string {
  switch (entry.kind) {
    case "text":
      return `**${entry.role}**: ${entry.text}`;

    case "toolCall": {
      const argsStr = renderArgs(entry.args);
      const anchor = entry.anchor ? ` ${entry.anchor}` : "";
      return `- ${entry.name}(${argsStr})${anchor}`;
    }

    case "toolResultFailed":
      return `**toolResult** (${entry.toolName}, error):\n\`\`\`\n${entry.content}\n\`\`\``;

    case "bashSuccess":
      return `**bash**: \`${entry.command}\``;

    case "bashFailed": {
      const status = entry.cancelled
        ? "cancelled"
        : `exit ${entry.exitCode ?? "?"}`;
      let result = `**bash** (${status}): \`${entry.command}\``;
      if (entry.output) {
        result += `\n\`\`\`\n${entry.output}\n\`\`\``;
      }
      return result;
    }
  }
}

/**
 * 将裁剪条目渲染为 summary 字符串。
 *
 * @param entries - pruneMessages 输出的 PrunedEntry[]
 * @param totalMessageCount - 裁剪前的消息总数（用于首行统计）
 * @param files - 文件列表（从 toolCall args 派生）
 * @param previousSummary - 迭代压缩时上一轮的 summary，原样透传在顶部
 */
export function formatSummary(
  entries: PrunedEntry[],
  totalMessageCount: number,
  files?: string[],
  previousSummary?: string,
): string {
  // 首行统计
  let header = `Pruned ${totalMessageCount} messages.`;
  if (files && files.length > 0) {
    header += ` Files: ${files.join(", ")}`;
  }

  const lines: string[] = [header, ""];

  if (previousSummary) {
    lines.push(previousSummary, "");
  }

  for (const entry of entries) {
    lines.push(renderEntry(entry), "");
  }

  // 去掉末尾多余空行
  while (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }

  return lines.join("\n");
}

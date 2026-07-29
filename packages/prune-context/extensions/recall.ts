/**
 * recall — 行号查表恢复被裁细节（纯函数）。
 *
 * 从 JSONL 会话文件中按锚点（行号 + toolCall 索引）定位
 * 完整的 toolCall 参数和 toolResult 结果。
 *
 * 纯函数，无副作用，可独立测试。
 */

import { readFileSync } from "node:fs";

// ============================================================================
// Types
// ============================================================================

export interface ParsedAnchor {
  line: number;
  index: number;
}

// ============================================================================
// Anchor parsing
// ============================================================================

/**
 * 解析锚点字符串为 { line, index }。
 *
 * 兼容三种格式：
 * - `#14.1` → { line: 14, index: 1 }
 * - `14.1`  → { line: 14, index: 1 }
 * - `14`    → { line: 14, index: 1 }（单 toolCall 省略 .1）
 *
 * 无效输入抛出 Error。
 */
export function parseAnchor(id: string): ParsedAnchor {
  const raw = id.startsWith("#") ? id.slice(1) : id;
  if (!raw) {
    throw new Error(`Invalid anchor: "${id}" is empty`);
  }

  const parts = raw.split(".");
  if (parts.length > 2) {
    throw new Error(`Invalid anchor: "${id}" has too many parts`);
  }

  const line = Number(parts[0]);
  const index = parts.length === 2 ? Number(parts[1]) : 1;

  if (!Number.isInteger(line) || line < 1) {
    throw new Error(
      `Invalid anchor: line "${parts[0]}" must be a positive integer`,
    );
  }
  if (!Number.isInteger(index) || index < 1) {
    throw new Error(
      `Invalid anchor: index "${parts[1]}" must be a positive integer`,
    );
  }

  return { line, index };
}

// ============================================================================
// JSONL lookup
// ============================================================================

/** 从 content 中提取文本（string 或 content-part 数组）。 */
function extractResultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const part of content) {
    if (
      part != null &&
      typeof part === "object" &&
      "type" in part &&
      (part as { type: string }).type === "text" &&
      "text" in part &&
      typeof (part as { text: unknown }).text === "string"
    ) {
      parts.push((part as { text: string }).text);
    }
  }
  return parts.join("\n");
}

/**
 * 从 JSONL 文件中按行号 + toolCall 索引恢复完整参数和结果。
 *
 * @param filePath - JSONL 会话文件路径
 * @param line - 1-based 行号
 * @param index - 1-based toolCall 索引
 * @returns 极简 Markdown（toolCall args + toolResult 全文）
 */
export function recallFromJsonl(
  filePath: string,
  line: number,
  index: number,
): string {
  const content = readFileSync(filePath, "utf-8");
  const lines = content.split("\n");

  // 行号越界检查
  if (line < 1 || line > lines.length) {
    throw new Error(
      `Line ${line} out of range (file has ${lines.length} lines)`,
    );
  }

  const lineContent = lines[line - 1].trim();
  if (!lineContent) {
    throw new Error(`Line ${line} is empty`);
  }

  let entry: Record<string, unknown>;
  try {
    entry = JSON.parse(lineContent);
  } catch {
    throw new Error(`Line ${line} is not valid JSON`);
  }

  // 验证 entry 结构
  const message = entry.message as Record<string, unknown> | undefined;
  if (
    entry.type !== "message" ||
    !message ||
    message.role !== "assistant" ||
    !Array.isArray(message.content)
  ) {
    throw new Error(`Line ${line} is not an assistant message entry`);
  }

  // 提取 toolCall parts
  const toolCalls: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  }> = [];
  for (const part of message.content) {
    if (
      part != null &&
      typeof part === "object" &&
      "type" in part &&
      (part as { type: string }).type === "toolCall"
    ) {
      const p = part as {
        id?: string;
        name?: string;
        arguments?: Record<string, unknown>;
      };
      toolCalls.push({
        id: p.id ?? "",
        name: p.name ?? "?",
        arguments: p.arguments ?? {},
      });
    }
  }

  // toolCall 索引越界检查
  if (index < 1 || index > toolCalls.length) {
    throw new Error(
      `toolCall index ${index} out of range (line ${line} has ${toolCalls.length} toolCalls)`,
    );
  }

  const tc = toolCalls[index - 1];

  // 扫描后续行匹配 toolResult
  let resultText: string | undefined;
  for (let i = line; i < lines.length; i++) {
    const l = lines[i].trim();
    if (!l) continue;
    try {
      const e = JSON.parse(l) as Record<string, unknown>;
      if (e.type !== "message") continue;
      const m = e.message as Record<string, unknown> | undefined;
      if (!m || m.role !== "toolResult") continue;
      if (m.toolCallId === tc.id) {
        resultText = extractResultText(m.content);
        break;
      }
    } catch {
      // 跳过无法解析的行
    }
  }

  // 构建返回 Markdown
  const sections: string[] = [];
  sections.push(`## toolCall: ${tc.name}`);
  sections.push("");
  sections.push("```json");
  sections.push(JSON.stringify(tc.arguments, null, 2));
  sections.push("```");
  sections.push("");
  sections.push("## toolResult");
  sections.push("");
  if (resultText !== undefined) {
    sections.push("```");
    sections.push(resultText);
    sections.push("```");
  } else {
    sections.push("No toolResult found for this toolCall.");
  }

  return sections.join("\n");
}

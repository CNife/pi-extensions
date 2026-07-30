/**
 * recall - 行号查表恢复被裁细节（纯函数）。
 *
 * 从 JSONL 会话文件中按锚点（行号 + toolCall 索引）定位
 * 完整的 toolCall 参数和 toolResult 结果。
 *
 * 纯函数，无副作用，可独立测试。提取与呈现分离：本模块只负责
 * 从 JSONL 中提取结构化 `RecallDetails`，不关心它如何被渲染
 * （LLM 文本 / TUI 渲染均在 render.ts）。
 */

import { readFileSync } from "node:fs";
import { extractText } from "./content.ts";

// ============================================================================
// Types
// ============================================================================

export interface ParsedAnchor {
  line: number;
  index: number;
}

/** toolResult 中 image content-part 的元信息（不携带 base64 数据本身）。 */
export interface RecallImage {
  mimeType: string;
  bytes: number;
}

/**
 * recallFromJsonl 的返回结构（spec #138 resolution）。
 *
 * 错误语义由 pi 的 throw 契约承担（execute 抛错 -> context.isError），
 * 故本结构只描述成功定位到的 toolCall 及其结果。
 */
export interface RecallDetails {
  /** 规范化锚点，如 "#14.1"。 */
  anchor: string;
  /** 1-based 行号。 */
  line: number;
  /** 1-based toolCall 索引。 */
  index: number;
  /** 被召回的工具名（始终展示）。 */
  toolName: string;
  /** 完整工具参数（TUI 用 TOON 渲染）。 */
  args: Record<string, unknown>;
  /** toolResult 文本（text part 拼接）；未命中时为 undefined。 */
  resultText?: string;
  /** toolResult 中 image part 的元信息。 */
  images: RecallImage[];
  /** 结果文本行数（无文本时为 0）。 */
  resultLines: number;
  /** 是否命中 toolResult（即便内容为空，只要匹配到 toolResult 即 true）。 */
  hasResult: boolean;
}

// ============================================================================
// Narrowing helpers (parsed JSON is untrusted -> guard, never cast)
// ============================================================================

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ============================================================================
// Anchor parsing
// ============================================================================

/**
 * 解析锚点字符串为 { line, index }。
 *
 * 兼容三种格式：
 * - `#14.1` -> { line: 14, index: 1 }
 * - `14.1`  -> { line: 14, index: 1 }
 * - `14`    -> { line: 14, index: 1 }（单 toolCall 省略 .1）
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

/**
 * 从 toolResult content 中提取 image part 的元信息。
 *
 * image part 形如 `{ type: "image", data: "<base64>", mimeType: "image/png" }`，
 * 只保留 mimeType 与解码后字节数，不携带 base64 数据本身。
 */
function extractImages(content: unknown): RecallImage[] {
  if (!Array.isArray(content)) return [];
  const images: RecallImage[] = [];
  for (const part of content) {
    if (
      isRecord(part) &&
      part.type === "image" &&
      typeof part.mimeType === "string" &&
      typeof part.data === "string"
    ) {
      images.push({
        mimeType: part.mimeType,
        bytes: Buffer.byteLength(part.data, "base64"),
      });
    }
  }
  return images;
}

/**
 * 从 JSONL 文件中按行号 + toolCall 索引恢复完整参数和结果。
 *
 * @param filePath - JSONL 会话文件路径
 * @param line - 1-based 行号
 * @param index - 1-based toolCall 索引
 * @returns 结构化 `RecallDetails`（toolCall 参数 + toolResult 文本/图片元信息）
 * @throws 行号越界、行非 JSON、非 assistant 消息、toolCall 索引越界等
 */
export function recallFromJsonl(
  filePath: string,
  line: number,
  index: number,
): RecallDetails {
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

  let entry: unknown;
  try {
    entry = JSON.parse(lineContent);
  } catch {
    throw new Error(`Line ${line} is not valid JSON`);
  }

  // 验证 entry 结构
  if (
    !isRecord(entry) ||
    entry.type !== "message" ||
    !isRecord(entry.message) ||
    entry.message.role !== "assistant" ||
    !Array.isArray(entry.message.content)
  ) {
    throw new Error(`Line ${line} is not an assistant message entry`);
  }

  const messageContent: unknown[] = entry.message.content;

  // 提取 toolCall parts
  const toolCalls: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  }> = [];
  for (const part of messageContent) {
    if (isRecord(part) && part.type === "toolCall") {
      toolCalls.push({
        id: typeof part.id === "string" ? part.id : "",
        name: typeof part.name === "string" ? part.name : "?",
        arguments: isRecord(part.arguments) ? part.arguments : {},
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
  let images: RecallImage[] = [];
  let hasResult = false;
  for (let i = line; i < lines.length; i++) {
    const l = lines[i].trim();
    if (!l) continue;
    let e: unknown;
    try {
      e = JSON.parse(l);
    } catch {
      continue; // 跳过无法解析的行
    }
    if (!isRecord(e) || e.type !== "message") continue;
    const m = e.message;
    if (!isRecord(m) || m.role !== "toolResult") continue;
    if (m.toolCallId === tc.id) {
      resultText = extractText(m.content);
      images = extractImages(m.content);
      hasResult = true;
      break;
    }
  }

  const resultLines = resultText ? resultText.split("\n").length : 0;

  return {
    anchor: `#${line}.${index}`,
    line,
    index,
    toolName: tc.name,
    args: tc.arguments,
    resultText,
    images,
    resultLines,
    hasResult,
  };
}

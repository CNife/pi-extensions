/**
 * prune — 确定性裁剪纯函数（Plan C 字段级规则）。
 *
 * 输入 AgentMessage[]（结构兼容）+ 可选行号映射，
 * 按 Plan C 规则裁剪：
 *   - thinking：全裁
 *   - toolCall：read/bash/其他保留全参数；write 裁 content；edit 裁 oldText+newText
 *   - toolResult：toolName ∈ {read, write} 全裁；其他成功裁、失败留
 *   - bashExecution：成功裁 output 留 command；失败全留
 *   - user / assistant text：全留
 *   - custom_message：作为 user text 保留
 *
 * 输出窄类型 PrunedEntry[]，供 format 消费。
 * 纯函数，无副作用，可独立测试。
 */

import { extractText } from "./content.ts";

// ============================================================================
// Types
// ============================================================================

/** 裁剪后的窄类型条目（discriminated union）。 */
export type PrunedEntry =
  | { kind: "text"; role: "user" | "assistant"; text: string }
  | {
      kind: "toolCall";
      name: string;
      args: Record<string, unknown>;
      anchor: string;
    }
  | { kind: "toolResultFailed"; toolName: string; content: string }
  | { kind: "bashSuccess"; command: string }
  | {
      kind: "bashFailed";
      command: string;
      output: string;
      exitCode: number | undefined;
      cancelled: boolean;
    };

/**
 * 结构兼容 AgentMessage 的最小输入类型。
 *
 * pi 的 AgentMessage = UserMessage | AssistantMessage | ToolResultMessage
 *   | BashExecutionMessage | CustomMessage | ...
 * 纯函数只需 role + 相关字段，不依赖完整类型。
 */
export interface MessageLike {
  role: string;
  content?: unknown;
  // toolResult fields
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
  // bashExecution fields
  command?: string;
  output?: string;
  exitCode?: number | undefined;
  cancelled?: boolean;
  excludeFromContext?: boolean;
  // custom message fields
  customType?: string;
}

// ============================================================================
// Internal helpers
// ============================================================================

/** write/edit 参数裁剪：移除 payload 键。 */
const PRUNE_ARGS_KEYS: Record<string, string[]> = {
  write: ["content"],
  edit: ["oldText", "newText"],
};

/** 对 toolCall args 执行 Plan C 裁剪（不截断，只删键）。 */
function pruneToolCallArgs(
  toolName: string,
  args: Record<string, unknown>,
): Record<string, unknown> {
  const dropKeys = PRUNE_ARGS_KEYS[toolName];
  if (!dropKeys) return args;
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    if (!dropKeys.includes(k)) {
      result[k] = v;
    }
  }
  return result;
}

/** toolResult 是否应保留（Plan C）。 */
function shouldKeepToolResult(toolName: string, isError: boolean): boolean {
  if (toolName === "read" || toolName === "write") return false;
  return isError;
}

/** 构建锚点字符串。 */
function buildAnchor(
  lineNumber: number | undefined,
  toolCallIndex: number,
  totalToolCalls: number,
): string {
  if (lineNumber === undefined || lineNumber < 1) return "";
  // 单 toolCall 行可省略 .1
  if (totalToolCalls === 1 && toolCallIndex === 1) {
    return `#${lineNumber}`;
  }
  return `#${lineNumber}.${toolCallIndex}`;
}

// ============================================================================
// Main export
// ============================================================================

/**
 * 对消息序列执行 Plan C 确定性裁剪。
 *
 * @param messages - 活跃消息序列
 * @param messageLineNumbers - 可选，与 messages 等长的 JSONL 行号数组（1-based，未映射为 undefined）
 */
export function pruneMessages(
  messages: MessageLike[],
  messageLineNumbers?: (number | undefined)[],
): PrunedEntry[] {
  const entries: PrunedEntry[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const lineNumber = messageLineNumbers?.[i];

    switch (msg.role) {
      case "user": {
        const text = extractText(msg.content);
        if (text) {
          entries.push({ kind: "text", role: "user", text });
        }
        break;
      }

      case "assistant": {
        const content = msg.content;
        if (!Array.isArray(content)) {
          // 纯字符串 content
          if (typeof content === "string" && content) {
            entries.push({ kind: "text", role: "assistant", text: content });
          }
          break;
        }

        // 提取 text parts
        const textParts: string[] = [];
        // 提取 toolCall parts
        const toolCalls: Array<{
          name: string;
          args: Record<string, unknown>;
        }> = [];

        for (const part of content) {
          if (part == null || typeof part !== "object" || !("type" in part)) {
            continue;
          }
          const p = part as { type: string; [k: string]: unknown };
          if (p.type === "text" && typeof p.text === "string" && p.text) {
            textParts.push(p.text);
          } else if (p.type === "toolCall") {
            const name = (p.name as string) || "?";
            const rawArgs = (p.arguments as Record<string, unknown>) ?? {};
            toolCalls.push({ name, args: pruneToolCallArgs(name, rawArgs) });
          }
          // thinking: 全裁（跳过）
        }

        // 输出 text（如有）
        if (textParts.length > 0) {
          entries.push({
            kind: "text",
            role: "assistant",
            text: textParts.join("\n"),
          });
        }

        // 输出 toolCall（如有），不合并连续纯 toolCall 消息
        if (toolCalls.length > 0) {
          for (let tcIdx = 0; tcIdx < toolCalls.length; tcIdx++) {
            const tc = toolCalls[tcIdx];
            const anchor = buildAnchor(lineNumber, tcIdx + 1, toolCalls.length);
            entries.push({
              kind: "toolCall",
              name: tc.name,
              args: tc.args,
              anchor,
            });
          }
        }
        break;
      }

      case "toolResult": {
        const toolName = msg.toolName || "?";
        const isError = msg.isError ?? false;
        if (!shouldKeepToolResult(toolName, isError)) {
          break; // 被裁，直接消失
        }
        // 失败的 toolResult：保留内容
        const text = extractText(msg.content);
        if (text) {
          entries.push({ kind: "toolResultFailed", toolName, content: text });
        }
        break;
      }

      case "bashExecution": {
        if (msg.excludeFromContext) break;
        const command = msg.command || "";
        const output = msg.output || "";
        const exitCode = msg.exitCode;
        const cancelled = msg.cancelled ?? false;
        const isSuccess =
          !cancelled && (exitCode === 0 || exitCode === undefined);

        if (isSuccess) {
          // 成功：裁 output 留 command
          if (command) {
            entries.push({ kind: "bashSuccess", command });
          }
        } else {
          // 失败：全留
          entries.push({
            kind: "bashFailed",
            command,
            output,
            exitCode,
            cancelled,
          });
        }
        break;
      }

      case "custom": {
        // custom_message 作为 user text 保留
        const text = extractText(msg.content);
        if (text) {
          entries.push({ kind: "text", role: "user", text });
        }
        break;
      }

      default:
        // 其他 role（compactionSummary, branchSummary 等）：跳过
        break;
    }
  }

  return entries;
}

/**
 * 从消息序列中提取文件列表（从 toolCall args 的 path/file_path 派生，零正则）。
 */
export function extractFiles(messages: MessageLike[]): string[] {
  const files: string[] = [];
  const seen = new Set<string>();

  for (const msg of messages) {
    if (msg.role !== "assistant") continue;
    const content = msg.content;
    if (!Array.isArray(content)) continue;

    for (const part of content) {
      if (
        part == null ||
        typeof part !== "object" ||
        !("type" in part) ||
        (part as { type: string }).type !== "toolCall"
      ) {
        continue;
      }
      const args = (part as { arguments?: Record<string, unknown> }).arguments;
      if (!args || typeof args !== "object") continue;

      for (const key of ["path", "file_path", "filePath"]) {
        const p = args[key];
        if (typeof p === "string" && p && !seen.has(p)) {
          seen.add(p);
          files.push(p);
        }
      }
    }
  }

  return files;
}

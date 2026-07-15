// ──── PROTOTYPE: first-title timing (#58) ───────────────────────────
//
// 问题：改全量 transcript（删 cursor）后，`message_end` 触发时该消息尚未
// append 到 branch（pi 框架：先发事件给扩展，后 appendMessage 持久化）。
// 首标题路径此时拿不到正在触发的这条消息。方案 A/B/C 待 prototype 定夺。
//
// 本文件是**可移植纯逻辑**：buildFullTranscript / formatMessageEntry 等
// 函数原型验证通过后可直接 lift 进真实 index.ts。TUI 壳（index.ts）是一次性的。

// ──── Entry 模型（pi SessionEntry 的忠实子集）──────────────────────
// 参见 pi packages/coding-agent/src/core/session-manager.ts 的判别联合。
// 只建模本原型需要的形态，但 discrimination 与真实类型一致。

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "toolCall"; toolName: string }
  | { type: "toolResult"; toolName: string }
  | { type: "thinking"; text: string };

export type MessageContent = string | ContentBlock[];

export interface Message {
  role: "user" | "assistant" | "toolResult" | "custom";
  content: MessageContent;
}

export type Entry =
  | { type: "message"; id: string; message: Message }
  | { type: "custom"; id: string; customType: string; data?: unknown }
  | { type: "compaction"; id: string; summary: string }
  | { type: "branch_summary"; id: string; summary: string }
  | {
      type: "custom_message";
      id: string;
      customType: string;
      content: MessageContent;
    };

// ──── 纯函数（可 lift 进真实代码）──────────────────────────────────

/** 从 message.content 提取文本。toolCall / thinking / toolResult 丢弃。 */
export function messageContentToText(content: MessageContent): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((c): c is { type: "text"; text: string } => c.type === "text")
      .map((c) => c.text)
      .join(" ");
  }
  return "";
}

/** 把单条 message 格式化为一行 transcript：`role: text`。无文本返回空串。 */
export function formatMessageEntry(message: Message): string {
  const text = messageContentToText(message.content);
  if (!text) return "";
  return `${message.role}: ${text}`;
}

/**
 * 全量 transcript：遍历整个 branch，收集所有 user/assistant 消息文本。
 * 跳过：custom entry（含 auto-naming-title 自身）、compaction entry、
 * branch_summary entry、custom_message entry，以及任何非 text 内容块。
 *
 * 这是 #58 删 cursor 后的核心 builder。返回 null 表示 branch 无可用文本。
 */
export function buildFullTranscript(branch: Entry[]): string | null {
  const parts: string[] = [];
  for (const entry of branch) {
    if (entry.type !== "message") continue;
    const { role } = entry.message;
    if (role !== "user" && role !== "assistant") continue;
    const line = formatMessageEntry(entry.message);
    if (line) parts.push(line);
  }
  if (parts.length === 0) return null;
  return parts.join("\n\n");
}

/**
 * 方案 B 专用：全量 transcript + 当前正在触发 message_end 但尚未持久化的消息。
 * reload 边界 case（branch 已有历史）下：旧消息 + 新 user 消息，拼接正确。
 * new-session（branch 空）下：退化为单条 user 消息。
 */
export function buildFullTranscriptWithPending(
  branch: Entry[],
  pending: Message,
): string {
  const base = buildFullTranscript(branch);
  const line = formatMessageEntry(pending);
  if (base && line) return `${base}\n\n${line}`;
  if (base) return base;
  return line;
}

/** branch 中是否已存在 auto-naming-title custom entry（用于恢复首标题状态）。 */
export function hasAutoNamingTitle(branch: Entry[]): boolean {
  return branch.some(
    (e) => e.type === "custom" && e.customType === "auto-naming-title",
  );
}

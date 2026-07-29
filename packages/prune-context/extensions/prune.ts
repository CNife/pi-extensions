/**
 * prune — 确定性裁剪纯函数。
 *
 * 输入 AgentMessage[]（结构兼容），user/assistant text 全留，
 * 其他消息类型（toolResult 等）跳过，assistant 内的 thinking /
 * toolCall content-part 跳过。输出窄类型 PrunedEntry[]。
 *
 * 纯函数，无副作用，可独立测试。
 */

/** 裁剪后的窄类型条目：只保留 role + 纯文本。 */
export interface PrunedEntry {
  role: "user" | "assistant";
  text: string;
}

/**
 * 结构兼容 AgentMessage 的最小输入类型。
 *
 * pi 的 AgentMessage = UserMessage | AssistantMessage | ToolResultMessage | CustomAgentMessages。
 * 纯函数只需 role + content，不依赖完整类型。
 */
export interface MessageLike {
  role: string;
  content: unknown;
}

/** 从 content-part 数组中提取所有 text 部分的文本。 */
function extractText(content: unknown): string {
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
 * 对消息序列执行确定性裁剪。
 *
 * - user text：全留
 * - assistant text：全留（thinking / toolCall part 跳过）
 * - toolResult / 其他 role：整条跳过
 * - 裁剪后文本为空的条目不输出
 */
export function pruneMessages(messages: MessageLike[]): PrunedEntry[] {
  const entries: PrunedEntry[] = [];
  for (const msg of messages) {
    if (msg.role !== "user" && msg.role !== "assistant") continue;
    const text = extractText(msg.content);
    if (!text) continue;
    entries.push({ role: msg.role, text });
  }
  return entries;
}

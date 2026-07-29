/**
 * content — content-part 文本提取共享工具。
 *
 * pi 消息的 content 字段可能是 string 或 content-part 数组，
 * 本模块提供统一的文本提取逻辑。
 */

/** 判断 part 是否为 text content-part 并返回其文本。 */
function textPartValue(part: unknown): string | undefined {
  if (part == null || typeof part !== "object") return undefined;
  if (!("type" in part) || part.type !== "text") return undefined;
  if (!("text" in part) || typeof part.text !== "string") return undefined;
  return part.text;
}

/** 从 content（string 或 content-part 数组）中提取所有 text 部分的文本。 */
export function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const part of content) {
    const text = textPartValue(part);
    if (text !== undefined) {
      parts.push(text);
    }
  }
  return parts.join("\n");
}

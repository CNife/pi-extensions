/**
 * Pure transcript & refresh logic for auto-naming-session (#58).
 *
 * Lifted from prototype/first-title-timing/transcript.ts, adapted to the real
 * pi `SessionEntry` type. Contains NO runtime pi imports — only a type-only
 * import of `SessionEntry` — so it is independently testable under `tsx`
 * without the coding-agent runtime (satisfies US12: pure logic separated from
 * pi event orchestration).
 *
 * Orchestration (event handlers, LLM calls, persistence) lives in index.ts.
 */

import type { SessionEntry } from "@earendil-works/pi-coding-agent";

/** Message type carried by `message` entries (derives AgentMessage from SessionEntry). */
export type AgentMessage = Extract<
  SessionEntry,
  { type: "message" }
>["message"];

/** Loose content shape sufficient for text extraction (covers user & assistant content). */
type TextualContent = string | Array<{ type: string; text?: string }>;

/**
 * Extract text from message.content. Drops toolCall / thinking / image blocks
 * (research confirmed all surveyed peers drop toolCall; pi behaviour matches).
 */
function messageContentToText(content: TextualContent): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((c): c is { type: "text"; text: string } => c.type === "text")
      .map((c) => c.text)
      .join(" ");
  }
  return "";
}

/** Format a single message as a transcript line `role: text`. Empty if no text. */
function formatMessageEntry(message: AgentMessage): string {
  if (message.role !== "user" && message.role !== "assistant") return "";
  const text = messageContentToText(message.content as TextualContent);
  if (!text) return "";
  return `${message.role}: ${text}`;
}

/**
 * Full-arc transcript: walk the entire branch, collecting all user/assistant
 * message text. Skips custom entries (including `auto-naming-title` itself),
 * compaction, branch_summary, custom_message, and any non-text content blocks.
 *
 * Core builder after cursor removal (#58). Returns null when the branch has no
 * usable text.
 */
export function buildFullTranscript(branch: SessionEntry[]): string | null {
  const parts: string[] = [];
  for (const entry of branch) {
    if (entry.type !== "message") continue;
    const line = formatMessageEntry(entry.message);
    if (line) parts.push(line);
  }
  if (parts.length === 0) return null;
  return parts.join("\n\n");
}

/**
 * Scheme B: full-arc transcript + the message currently firing `message_end`
 * but not yet persisted (pi emits the extension event before appendMessage).
 * Reload edge case (branch already has history): old messages + new user,
 * concatenated correctly. New-session (empty branch): degrades to the single
 * pending message.
 */
export function buildFullTranscriptWithPending(
  branch: SessionEntry[],
  pending: AgentMessage,
): string {
  const base = buildFullTranscript(branch);
  const line = formatMessageEntry(pending);
  if (base && line) return `${base}\n\n${line}`;
  if (base) return base;
  return line;
}

/** Whether the branch already contains an `auto-naming-title` custom entry. */
export function hasAutoNamingTitle(branch: SessionEntry[]): boolean {
  return branch.some(
    (e) => e.type === "custom" && e.customType === "auto-naming-title",
  );
}

/**
 * Whether the title should be refreshed now. Position-based, no persisted
 * cursor: find the last `auto-naming-title` custom entry, count user+assistant
 * messages after it, compare to the threshold. With no custom entry, count the
 * whole branch. `autoRefreshTurns === null` disables auto-refresh.
 */
export function shouldRefresh(
  branch: SessionEntry[],
  autoRefreshTurns: number | null,
): boolean {
  if (autoRefreshTurns === null) return false;

  // Find the index of the last auto-naming-title custom entry.
  let lastTitleIdx = -1;
  for (let i = branch.length - 1; i >= 0; i--) {
    const e = branch[i];
    if (e.type === "custom" && e.customType === "auto-naming-title") {
      lastTitleIdx = i;
      break;
    }
  }

  // Count user+assistant messages after it (or across the whole branch).
  let count = 0;
  for (let i = lastTitleIdx + 1; i < branch.length; i++) {
    const e = branch[i];
    if (e.type !== "message") continue;
    if (e.message.role === "user" || e.message.role === "assistant") {
      count++;
    }
  }
  return count >= autoRefreshTurns;
}

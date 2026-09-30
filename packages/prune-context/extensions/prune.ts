/**
 * prune — deterministic Plan C edits at the per-message context boundary.
 *
 * The plan is pure: it neither reads session state nor mutates message content.
 * The host applies its decisions with SessionManager.appendContextEdit.
 */

import type {
  ContextEditEntry,
  SessionEntry,
} from "@earendil-works/pi-coding-agent";

export interface MessageLike {
  role: string;
  content?: unknown;
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
  command?: string;
  output?: string;
  exitCode?: number | undefined;
  cancelled?: boolean;
  customType?: string;
}

/** An active, editable message paired with its original JSONL location. */
export interface LiveMessage {
  entryId: string;
  message: MessageLike;
  lineNumber?: number;
}

type OtherBranchEntryType = Exclude<
  SessionEntry["type"],
  "message" | "compaction" | "context_edit" | "custom_message"
>;

/** The official session-entry fields used by compaction/edit handling. */
export type BranchEntryLike = {
  type: SessionEntry["type"];
  id: string;
  parentId?: string | null;
  timestamp?: string;
  message?: unknown;
  content?: unknown;
  customType?: string;
  display?: boolean;
  firstKeptEntryId?: string | null;
  summary?: string;
  targetId?: string;
  replacement?: ContextEditEntry["replacement"];
} & (
  | { type: "message"; message: unknown }
  | { type: "compaction"; firstKeptEntryId: string | null; summary: string }
  | {
      type: "context_edit";
      targetId: string;
      replacement: ContextEditEntry["replacement"];
    }
  | {
      type: "custom_message";
      customType: string;
      content: unknown;
      display: boolean;
    }
  | { type: OtherBranchEntryType }
);

export type ContextEditDecision =
  | { entryId: string; action: "keep" }
  | { entryId: string; action: "omit"; replacement: null }
  | {
      entryId: string;
      action: "replace";
      replacement: NonNullable<ContextEditEntry["replacement"]>;
    };

const PRUNE_ARGS_KEYS: Record<string, string[]> = {
  write: ["content"],
  edit: ["oldText", "newText"],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMessageLike(value: unknown): value is MessageLike {
  return isRecord(value) && typeof value.role === "string";
}

function shouldKeepToolResult(toolName: string, isError: boolean): boolean {
  if (toolName === "read" || toolName === "write") return false;
  return isError;
}

function buildAnchor(
  lineNumber: number | undefined,
  toolCallIndex: number,
  totalToolCalls: number,
): string {
  if (lineNumber === undefined || lineNumber < 1) return "";
  if (totalToolCalls === 1 && toolCallIndex === 1) return "#" + lineNumber;
  return "#" + lineNumber + "." + toolCallIndex;
}

function pruneToolArgs(
  toolName: string,
  args: Record<string, unknown>,
): Record<string, unknown> {
  const dropKeys = PRUNE_ARGS_KEYS[toolName];
  if (!dropKeys || !dropKeys.some((key) => key in args)) return args;
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (!dropKeys.includes(key)) result[key] = value;
  }
  return result;
}

function planAssistantEdit(
  live: LiveMessage,
  prunedToolCallIds: ReadonlySet<string>,
): ContextEditDecision {
  const { entryId, message, lineNumber } = live;
  if (!Array.isArray(message.content)) return { entryId, action: "keep" };

  const content = message.content as unknown[];
  let toolCallCount = 0;
  for (const part of content) {
    if (isRecord(part) && part.type === "toolCall") toolCallCount++;
  }

  const plannedContent: unknown[] = [];
  let toolCallIndex = 0;
  let changed = false;
  for (const part of content) {
    if (!isRecord(part)) {
      plannedContent.push(part);
      continue;
    }
    if (part.type === "thinking") {
      changed = true;
      continue;
    }
    if (part.type !== "toolCall") {
      plannedContent.push(part);
      continue;
    }

    toolCallIndex++;
    const toolName = typeof part.name === "string" ? part.name : "?";
    const args = isRecord(part.arguments) ? part.arguments : {};
    const prunedArgs = pruneToolArgs(toolName, args);
    const argsWerePruned = prunedArgs !== args;
    if (argsWerePruned) {
      plannedContent.push({ ...part, arguments: prunedArgs });
      changed = true;
    } else {
      plannedContent.push(part);
    }

    const callId = typeof part.id === "string" ? part.id : undefined;
    const anchor =
      argsWerePruned || (callId !== undefined && prunedToolCallIds.has(callId))
        ? buildAnchor(lineNumber, toolCallIndex, toolCallCount)
        : "";
    if (anchor) {
      // The original call remains available to recall by JSONL row and index.
      plannedContent.push({ type: "text", text: anchor });
      changed = true;
    }
  }

  if (!changed) return { entryId, action: "keep" };
  if (plannedContent.length === 0) {
    return { entryId, action: "omit", replacement: null };
  }
  return {
    entryId,
    action: "replace",
    replacement: {
      content: plannedContent as NonNullable<
        ContextEditEntry["replacement"]
      >["content"],
    },
  };
}

/** Return one keep/omit/replacement decision for every active message. */
export function planContextEdits(
  liveMessages: readonly LiveMessage[],
): ContextEditDecision[] {
  const prunedToolCallIds = new Set<string>();
  for (const { message } of liveMessages) {
    if (message.role !== "toolResult") continue;
    const toolName = message.toolName || "?";
    if (
      !shouldKeepToolResult(toolName, message.isError ?? false) &&
      typeof message.toolCallId === "string"
    ) {
      prunedToolCallIds.add(message.toolCallId);
    }
  }

  const plan: ContextEditDecision[] = [];
  for (const live of liveMessages) {
    const { entryId, message } = live;
    if (message.role === "assistant") {
      plan.push(planAssistantEdit(live, prunedToolCallIds));
      continue;
    }
    if (message.role === "toolResult") {
      const toolName = message.toolName || "?";
      if (shouldKeepToolResult(toolName, message.isError ?? false)) {
        plan.push({ entryId, action: "keep" });
      } else {
        plan.push({ entryId, action: "omit", replacement: null });
      }
      continue;
    }
    // appendContextEdit does not permit bashExecution; leave that role intact.
    plan.push({ entryId, action: "keep" });
  }
  return plan;
}

/**
 * Select messages covered by the latest compaction. A valid firstKeptEntryId
 * retains its suffix; compact-all and orphaned boundaries recover from after
 * that compaction. Existing context edits are already active decisions and are
 * not planned a second time. Compaction summaries are never rewritten.
 */
export function selectLiveMessages(
  branchEntries: readonly BranchEntryLike[],
): LiveMessage[] {
  const editedEntryIds = new Set(
    branchEntries
      .filter((entry) => entry.type === "context_edit" && entry.targetId)
      .map((entry) => entry.targetId as string),
  );

  let compactionIndex = -1;
  let firstKeptEntryId: string | null | undefined;
  for (let i = branchEntries.length - 1; i >= 0; i--) {
    if (branchEntries[i].type === "compaction") {
      compactionIndex = i;
      firstKeptEntryId = branchEntries[i].firstKeptEntryId;
      break;
    }
  }

  const startIndex =
    compactionIndex < 0
      ? 0
      : firstKeptEntryId &&
          branchEntries.some((entry) => entry.id === firstKeptEntryId)
        ? branchEntries.findIndex((entry) => entry.id === firstKeptEntryId)
        : compactionIndex + 1;
  const liveMessages: LiveMessage[] = [];
  for (let i = startIndex; i < branchEntries.length; i++) {
    const entry = branchEntries[i];
    if (editedEntryIds.has(entry.id)) continue;
    if (entry.type === "message" && isMessageLike(entry.message)) {
      liveMessages.push({
        entryId: entry.id,
        message: entry.message,
      });
    } else if (entry.type === "custom_message") {
      liveMessages.push({
        entryId: entry.id,
        message: {
          role: "custom",
          content: entry.content,
          customType: entry.customType,
        },
      });
    }
  }
  return liveMessages;
}

/**
 * Preserve the active suffix across pi's new compaction entry. Older summary
 * entries are no longer projected once a newer compaction is appended, so
 * carry forward a valid existing boundary; recover orphaned/empty boundaries
 * at the first remaining live entry instead of pointing at the old compaction.
 */
export function contextEditCompactionBoundary(
  branchEntries: readonly BranchEntryLike[],
  plan: readonly ContextEditDecision[],
): string | null {
  for (let i = branchEntries.length - 1; i >= 0; i--) {
    const entry = branchEntries[i];
    if (entry.type !== "compaction") continue;
    const priorBoundary = entry.firstKeptEntryId;
    if (priorBoundary && branchEntries.some((candidate) => candidate.id === priorBoundary)) {
      return priorBoundary;
    }
    return plan.find((decision) => decision.action !== "omit")?.entryId ?? null;
  }
  return plan.find((decision) => decision.action !== "omit")?.entryId ?? null;
}

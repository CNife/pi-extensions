/**
 * prune-context — deterministic per-entry context editing.
 *
 * /prune writes branch-local context edits directly. Automatic threshold and
 * overflow compaction apply the same edits without asking a model for a summary;
 * manual /compact remains pi's native LLM compaction.
 */

import { readFileSync } from "node:fs";
import type {
  ExtensionAPI,
  ExtensionContext,
  SessionEntry,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import {
  contextEditCompactionBoundary,
  type ContextEditDecision,
  type LiveMessage,
  planContextEdits,
  selectLiveMessages,
} from "./prune.ts";
import { recallTool } from "./tool.ts";

/**
 * From JSONL, build an entryId → 1-based line number map. Missing files or
 * entries simply disable recall anchors; raw session entries remain untouched.
 */
function buildLineNumberMap(sessionFile: string): Map<string, number> {
  const map = new Map<string, number>();
  let content: string;
  try {
    content = readFileSync(sessionFile, "utf-8");
  } catch {
    return map;
  }
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    try {
      const entry = JSON.parse(line) as { id?: string };
      if (entry.id) map.set(entry.id, i + 1);
    } catch {
      // Ignore malformed lines; unresolvable entries have no recall anchor.
    }
  }
  return map;
}

function planBranchEdits(
  branchEntries: SessionEntry[],
  sessionFile: string | null | undefined,
): { liveMessages: LiveMessage[]; plan: ContextEditDecision[] } {
  const liveMessages = selectLiveMessages(branchEntries);
  const lineNumbers = sessionFile ? buildLineNumberMap(sessionFile) : undefined;
  const mappedMessages = lineNumbers
    ? liveMessages.map((live) => ({
        ...live,
        lineNumber: lineNumbers.get(live.entryId),
      }))
    : liveMessages;
  return { liveMessages, plan: planContextEdits(mappedMessages) };
}

function applyContextEditPlan(
  sessionManager: Pick<SessionManager, "appendContextEdit">,
  plan: readonly ContextEditDecision[],
): number {
  let editCount = 0;
  for (const decision of plan) {
    if (decision.action === "keep") continue;
    sessionManager.appendContextEdit(decision.entryId, decision.replacement);
    editCount++;
  }
  return editCount;
}

/**
 * Extension contexts expose this object through a read-only Pick, but the
 * runtime object is the full SessionManager. The upstream agent-session.js
 * recovery path also calls appendContextEdit directly; decision meeting #178
 * specified this write surface.
 */
function writableSessionManager(
  sessionManager: ExtensionContext["sessionManager"],
): SessionManager {
  return sessionManager as SessionManager;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default function (pi: ExtensionAPI) {
  pi.registerTool(recallTool);

  pi.registerCommand("prune", {
    description: "Deterministically prune model context without an LLM call",
    handler: async (_args, ctx) => {
      try {
        const branchEntries = ctx.sessionManager.getBranch();
        const { plan } = planBranchEdits(
          branchEntries,
          ctx.sessionManager.getSessionFile(),
        );
        const editCount = applyContextEditPlan(
          writableSessionManager(ctx.sessionManager),
          plan,
        );
        if (editCount === 0) {
          ctx.ui.notify("Nothing to prune", "warning");
        } else {
          ctx.ui.notify("Pruned " + editCount + " context entries", "info");
        }
      } catch (error) {
        ctx.ui.notify("Prune failed: " + errorMessage(error), "error");
      }
    },
  });

  pi.on("session_before_compact", (event, ctx) => {
    // Only automatic compactions are intercepted. /compact stays native; /prune
    // invokes the same edit plan directly instead of passing through compaction.
    const reason = event.reason;
    if (reason !== "threshold" && reason !== "overflow") return;

    const branchEntries = event.branchEntries;
    const { liveMessages, plan } = planBranchEdits(
      branchEntries,
      ctx.sessionManager.getSessionFile(),
    );
    const editCount = applyContextEditPlan(
      writableSessionManager(ctx.sessionManager),
      plan,
    );
    if (editCount === 0) return;

    // Pi projects only the newest summary, so carry the prior summary forward.
    // Hand off at a valid boundary, recovering if it is orphaned. An empty
    // boundary retains no earlier entries when all planned messages are omitted.
    return {
      compaction: {
        summary: event.preparation.previousSummary ?? "",
        firstKeptEntryId:
          contextEditCompactionBoundary(branchEntries, plan) ?? "",
        tokensBefore: event.preparation.tokensBefore,
        details: {
          prunedCount: liveMessages.length,
          editedCount: editCount,
        },
      },
    };
  });
}

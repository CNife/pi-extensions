/**
 * pn — Minimal Plannotator for Pi
 *
 * Three slash commands:
 *   /pnr        — Open browser-based code review for local git changes
 *   /pna <path> — Open browser-based annotation for a markdown file or folder
 *   /pnl        — Annotate the last assistant message
 *
 * Depends on @plannotator/pi-extension for server infrastructure and browser UIs.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
  getLastAssistantMessageText,
  getStartupErrorMessage,
  hasPlanBrowserHtml,
  hasReviewBrowserHtml,
  startCodeReviewBrowserSession,
  startLastMessageAnnotationSession,
  startMarkdownAnnotationSession,
} from "@plannotator/pi-extension/plannotator-browser";

/** Shared result handling for all browser session decisions. */
function handleDecision(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  label: string,
  result: { exit?: boolean; approved?: boolean; feedback?: string },
): void {
  if (result.exit) {
    ctx.ui.notify(`${label} closed.`, "info");
  } else if (result.approved) {
    ctx.ui.notify(`${label} approved.`, "info");
  } else if (result.feedback) {
    pi.sendUserMessage(result.feedback, { deliverAs: "followUp" });
  } else {
    ctx.ui.notify(`${label} closed (no feedback).`, "info");
  }
}

export default function pn(pi: ExtensionAPI): void {
  // ── /pnr: Code Review ────────────────────────────────────────────

  pi.registerCommand("pnr", {
    description: "Open code review for local git changes",
    handler: async (_args, ctx) => {
      if (!hasReviewBrowserHtml()) {
        ctx.ui.notify(
          "Code review UI not available. Rebuild @plannotator/pi-extension.",
          "error",
        );
        return;
      }

      try {
        const session = await startCodeReviewBrowserSession(ctx, {});
        ctx.ui.notify("Code review opened in browser.", "info");

        void session.waitForDecision().then(
          (result) => handleDecision(pi, ctx, "Code review", result),
          (err) =>
            ctx.ui.notify(
              `Code review failed: ${getStartupErrorMessage(err)}`,
              "error",
            ),
        );
      } catch (err) {
        ctx.ui.notify(
          `Failed to start code review: ${getStartupErrorMessage(err)}`,
          "error",
        );
      }
    },
  });

  // ── /pna: Annotate ───────────────────────────────────────────────

  pi.registerCommand("pna", {
    description: "Open annotation UI for a markdown file or folder",
    handler: async (args, ctx) => {
      const normalized = normalizeUserPath(args ?? "");
      if (!normalized) {
        ctx.ui.notify("Usage: /pna <file.md | folder/>", "error");
        return;
      }

      if (!hasPlanBrowserHtml()) {
        ctx.ui.notify(
          "Annotation UI not available. Rebuild @plannotator/pi-extension.",
          "error",
        );
        return;
      }

      const absPath = isAbsolute(normalized)
        ? normalized
        : resolve(ctx.cwd, normalized);

      if (!existsSync(absPath)) {
        ctx.ui.notify(`Not found: ${absPath}`, "error");
        return;
      }

      try {
        const isDir = statSync(absPath).isDirectory();
        let session: Awaited<ReturnType<typeof startMarkdownAnnotationSession>>;

        if (isDir) {
          if (!scanMarkdownFiles(absPath)) {
            ctx.ui.notify(`No markdown files found in ${normalized}`, "error");
            return;
          }
          ctx.ui.notify(
            `Opening annotation UI for folder ${normalized}...`,
            "info",
          );
          session = await startMarkdownAnnotationSession(
            ctx,
            absPath,
            "",
            "annotate-folder",
            absPath,
          );
        } else {
          const content = readFileSync(absPath, "utf-8");
          ctx.ui.notify(`Opening annotation UI for ${normalized}...`, "info");
          session = await startMarkdownAnnotationSession(
            ctx,
            absPath,
            content,
            "annotate",
          );
        }

        void session.waitForDecision().then(
          (result) => handleDecision(pi, ctx, "Annotation", result),
          (err) =>
            ctx.ui.notify(
              `Annotation failed: ${getStartupErrorMessage(err)}`,
              "error",
            ),
        );
      } catch (err) {
        ctx.ui.notify(
          `Failed to open UI: ${getStartupErrorMessage(err)}`,
          "error",
        );
      }
    },
  });

  // ── /pnl: Annotate Last Message ──────────────────────────────

  pi.registerCommand("pnl", {
    description: "Annotate the last assistant message",
    handler: async (_args, ctx) => {
      if (!hasPlanBrowserHtml()) {
        ctx.ui.notify(
          "Annotation UI not available. Rebuild @plannotator/pi-extension.",
          "error",
        );
        return;
      }

      const lastText = getLastAssistantMessageText(ctx);
      if (!lastText) {
        ctx.ui.notify("No assistant message found in session.", "error");
        return;
      }

      try {
        ctx.ui.notify("Opening annotation UI for last message...", "info");
        const session = await startLastMessageAnnotationSession(ctx, lastText);

        void session.waitForDecision().then(
          (result) => handleDecision(pi, ctx, "Annotation", result),
          (err) =>
            ctx.ui.notify(
              `Annotation failed: ${getStartupErrorMessage(err)}`,
              "error",
            ),
        );
      } catch (err) {
        ctx.ui.notify(
          `Failed to open UI: ${getStartupErrorMessage(err)}`,
          "error",
        );
      }
    },
  });
}

/** Normalize a user-provided path: strip @ prefix, quotes, expand ~ to home directory. */
function normalizeUserPath(raw: string): string {
  const trimmed = raw.trim();
  const unquoted = trimmed.replace(/^["']|["']$/g, "");
  // Strip @ prefix from file references (e.g. @file.md -> file.md)
  const stripped = unquoted.startsWith("@") ? unquoted.slice(1) : unquoted;
  return expandHomePath(stripped);
}

function expandHomePath(input: string): string {
  const home = homedir();
  if (input === "~") return home;
  if (input.startsWith("~/") || input.startsWith("~\\")) {
    return home + input.slice(1);
  }
  return input;
}

function scanMarkdownFiles(dirPath: string, depth = 0): boolean {
  if (depth > 8) return false;
  try {
    const entries = readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const fullPath = resolve(dirPath, entry.name);
      if (entry.isDirectory()) {
        if (scanMarkdownFiles(fullPath, depth + 1)) return true;
      } else if (/\.mdx?$/i.test(entry.name)) {
        return true;
      }
    }
  } catch {
    /* permission denied, skip */
  }
  return false;
}

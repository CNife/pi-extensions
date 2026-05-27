/**
 * pn — Minimal Plannotator for Pi
 *
 * Two slash commands:
 *   /pnr        — Open browser-based code review for local git changes
 *   /pna <path> — Open browser-based annotation for a markdown file or folder
 *
 * Depends on @plannotator/pi-extension for server infrastructure and browser UIs.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, isAbsolute } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	startCodeReviewBrowserSession,
	startMarkdownAnnotationSession,
	hasPlanBrowserHtml,
	hasReviewBrowserHtml,
	getStartupErrorMessage,
} from "@plannotator/pi-extension/plannotator-browser";

export default function pn(pi: ExtensionAPI): void {
	// ── /pnr: Code Review ────────────────────────────────────────────

	pi.registerCommand("pnr", {
		description: "Open code review for local git changes",
		handler: async (_args, ctx) => {
			if (!hasReviewBrowserHtml()) {
				ctx.ui.notify("Code review UI not available. Rebuild @plannotator/pi-extension.", "error");
				return;
			}

			try {
				const session = await startCodeReviewBrowserSession(ctx, {});
				ctx.ui.notify("Code review opened in browser.", "info");

				const result = await session.waitForDecision();
				if (result.exit) {
					ctx.ui.notify("Code review closed.", "info");
				} else if (result.approved) {
					ctx.ui.notify("Code review approved.", "info");
				} else if (result.feedback) {
					pi.sendUserMessage(result.feedback, { deliverAs: "followUp" });
				} else {
					ctx.ui.notify("Code review closed (no feedback).", "info");
				}
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
			const inputPath = (args ?? "").trim();
			if (!inputPath) {
				ctx.ui.notify("Usage: /pna <file.md | folder/>", "error");
				return;
			}

			if (!hasPlanBrowserHtml()) {
				ctx.ui.notify("Annotation UI not available. Rebuild @plannotator/pi-extension.", "error");
				return;
			}

			const absPath = isAbsolute(inputPath) ? inputPath : resolve(ctx.cwd, inputPath);

			if (!existsSync(absPath)) {
				ctx.ui.notify(`Not found: ${absPath}`, "error");
				return;
			}

			let session: Awaited<ReturnType<typeof startMarkdownAnnotationSession>>;
			const isDir = statSync(absPath).isDirectory();

			if (isDir) {
				if (!scanMarkdownFiles(absPath)) {
					ctx.ui.notify(`No markdown files found in ${inputPath}`, "error");
					return;
				}
				ctx.ui.notify(`Opening annotation UI for folder ${inputPath}...`, "info");
				session = await startMarkdownAnnotationSession(
					ctx, absPath, "", "annotate-folder", absPath,
				);
			} else {
				const content = readFileSync(absPath, "utf-8");
				ctx.ui.notify(`Opening annotation UI for ${inputPath}...`, "info");
				session = await startMarkdownAnnotationSession(
					ctx, absPath, content, "annotate",
				);
			}

			try {
				const result = await session.waitForDecision();
				if (result.exit) {
					ctx.ui.notify("Annotation closed.", "info");
				} else if (result.approved) {
					ctx.ui.notify("Annotation approved.", "info");
				} else if (result.feedback) {
					pi.sendUserMessage(result.feedback, { deliverAs: "followUp" });
				} else {
					ctx.ui.notify("Annotation closed (no feedback).", "info");
				}
			} catch (err) {
				ctx.ui.notify(
					`Annotation failed: ${getStartupErrorMessage(err)}`,
					"error",
				);
			}
		},
	});
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
	} catch { /* permission denied, skip */ }
	return false;
}

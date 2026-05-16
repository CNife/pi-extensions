/**
 * sh-guard Extension
 *
 * AST-based shell command safety classifier for Pi agent.
 * Uses sh-guard CLI (tree-sitter-bash AST parser + pipeline taint analysis)
 * to assess shell command risk before execution.
 *
 * Risk scoring:
 *   0-60  Safe      → auto-allow
 *   61-100 Caution+ → ask user (Yes / No / Block with reason)
 *
 * When sh-guard is not installed, the command is blocked and a link to
 * https://github.com/aryanbhosale/sh-guard is shown.
 *
 * Requirements:
 *   sh-guard CLI on PATH  (https://github.com/aryanbhosale/sh-guard#install)
 *
 * Installation:
 *   Place this file at ~/.pi/agent/extensions/sh-guard.ts
 *   Run /reload in Pi
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { spawnSync } from "node:child_process";

// ── Types ────────────────────────────────────────────────────────────────

interface ShGuardResult {
	score: number;
	level?: string;
	reason?: string;
	risk_factors?: string[];
}

// ── State ────────────────────────────────────────────────────────────────

const SH_GUARD_INSTALL_URL = "https://github.com/aryanbhosale/sh-guard#install";

let shGuardNotified = false;

// ── Helpers ──────────────────────────────────────────────────────────────

/**
 * Run sh-guard analysis via spawnSync.
 *
 * Error handling strategy:
 *   - ENOENT      → sh-guard not installed → throw (caller notifies + blocks)
 *   - ETIMEDOUT   → command took too long   → return null (fail open)
 *   - other error → unexpected OS error    → return null (fail open)
 *   - status 0,1,2,3 → valid analysis      → parse JSON stdout (exit codes
 *     1/2/3 are valid risk levels, not errors)
 *   - status null   → killed by signal     → return null (fail open)
 *   - status other  → unexpected           → try to parse JSON anyway; if
 *     stdout isn't valid JSON → return null (fail open)
 */
function runShGuard(command: string, cwd: string): ShGuardResult | null {
	const proc = spawnSync("sh-guard", ["--json", "--cwd", cwd, "--", command], {
		timeout: 3000,
		encoding: "utf-8",
		stdio: ["ignore", "pipe", "pipe"],
	});

	// OS-level error: ENOENT, ETIMEDOUT, EACCES, etc.
	if (proc.error) {
		throw proc.error;
	}

	// Try to parse stdout as JSON regardless of exit code.
	// sh-guard --json outputs valid JSON even when exit is 1/2/3
	// (those represent caution/danger/critical, not errors).
	const trimmed = proc.stdout?.trim();
	if (trimmed) {
		try {
			return JSON.parse(trimmed) as ShGuardResult;
		} catch {
			// stdout wasn't valid JSON
		}
	}

	// If we got here, stdout was empty or invalid.
	// Only warn for genuinely unexpected situations.
	if (proc.status !== null && proc.status > 3) {
		console.warn(
			`sh-guard failed (status=${proc.status}): ${proc.stderr?.trim() || "no stderr"}`,
		);
	} else if (proc.status === null) {
		console.warn("sh-guard was killed by a signal");
	}

	return null;
}

// ── Extension ────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	pi.on("tool_call", async (event, ctx) => {
		if (event.toolName !== "bash") return undefined;

		const command = (event.input as { command: string }).command;
		if (!command || typeof command !== "string") return undefined;

		// ── Run analysis ────────────────────────────────────────────
		let result: ShGuardResult | null;
		try {
			result = runShGuard(command, ctx.cwd);
		} catch (err: unknown) {
			const e = err as NodeJS.ErrnoException;

			if (e.code === "ENOENT") {
				// sh-guard not installed → notify once, always block
				if (!shGuardNotified) {
					shGuardNotified = true;
					const msg =
						`sh-guard not found — install it to enable shell command safety checks\n${SH_GUARD_INSTALL_URL}`;
					if (ctx.hasUI) {
						ctx.ui.notify(msg, "error");
					} else {
						console.warn(msg);
					}
				}
				return {
					block: true,
					reason: `sh-guard not installed. Install: ${SH_GUARD_INSTALL_URL}`,
				};
			}

			// Timeout or other OS error → fail open, never cache
			console.warn(
				`sh-guard error (${e.code || "unknown"}): ${e.message}, allowing command`,
			);
			return undefined;
		}

		if (!result) {
			// CLI ran but produced no valid result → fail open
			console.warn("sh-guard returned no valid result, allowing command");
			return undefined;
		}

		// ── Score evaluation ────────────────────────────────────────
		const score = result.score ?? 0;

		// 0-60 Safe → auto-allow
		if (score <= 60) return undefined;

		const reason = result.reason ?? "Unknown risk";

		// 21-100 without UI → block
		if (!ctx.hasUI) {
			return {
				block: true,
				reason: `sh-guard blocked (${score}/100): ${reason}`,
			};
		}

		// 21-100 with UI → ask user with three options
		const choice = await ctx.ui.select(
			[
				`⚠️  sh-guard risk assessment`,
				``,
				`Score: ${score}/100`,
				`Risk:  ${reason}`,
				``,
				`Command:`,
				`  ${command}`,
				``,
				`How do you want to proceed?`,
			].join("\n"),
			["Yes, allow", "No, block", "Block and explain why"],
		);

		if (choice === "Yes, allow") {
			return undefined;
		}

		if (choice === "Block and explain why") {
			const userReason = await ctx.ui.input(
				"Why are you blocking this command? (This will be sent to the agent)",
			);
			const blockReason = userReason
				? `User blocked the command. Reason: ${userReason}`
				: `User blocked the command (${score}/100): ${reason}`;
			return { block: true, reason: blockReason };
		}

		// No, block (or dialog dismissed → treat as block)
		return {
			block: true,
			reason: `User blocked the command (${score}/100): ${reason}`,
		};
	});
}

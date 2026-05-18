/**
 * Dev Workflow Extension
 *
 * 9-step plan → code → test → docs development workflow for pi.
 * Provides:
 *   - resources_discover: contributes prompt templates globally
 *   - /new-change <name>: creates changes/YYYYMMDD-<name>/ + sets active
 *   - /switch-change [dir]: switches active change directory
 *
 * The ".active_change" file bridges extension state into prompt templates —
 * prompts read it to find the current change directory without needing $ARGUMENTS.
 *
 * Prompts are in the sibling directory prompts-dev-workflow/.
 *
 * Install:
 *   Part of git:github.com/CNife/pi-extensions package
 *   /reload after install
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";

// ── Helpers ──────────────────────────────────────────────────────────────

function getChangeDirName(name: string): string {
	const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
	return `${date}-${name}`;
}

async function getActiveChange(cwd: string): Promise<string | null> {
	const activeFile = resolve(cwd, "changes", ".active_change");
	try {
		const content = await readFile(activeFile, "utf-8");
		const dir = content.trim();
		if (dir && existsSync(resolve(cwd, "changes", dir))) return dir;
		return null;
	} catch {
		return null;
	}
}

async function setActiveChange(cwd: string, dirName: string): Promise<void> {
	const changesDir = resolve(cwd, "changes");
	await mkdir(changesDir, { recursive: true });
	await writeFile(resolve(changesDir, ".active_change"), `${dirName}\n`, "utf-8");
}

async function listChangeDirs(cwd: string): Promise<string[]> {
	const changesDir = resolve(cwd, "changes");
	try {
		const entries = await readdir(changesDir, { withFileTypes: true });
		return entries
			.filter((e) => e.isDirectory() && /^\d{8}-/.test(e.name))
			.map((e) => e.name)
			.sort()
			.reverse();
	} catch {
		return [];
	}
}

// ── Extension ────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	// ── Contribute prompt templates ───────────────────────────────
	pi.on("resources_discover", async (_event) => {
		const dir = dirname(fileURLToPath(import.meta.url));
		const promptsDir = resolve(dir, "../prompts-dev-workflow");
		return {
			promptPaths: [promptsDir],
		};
	});

	// ── /new-change ───────────────────────────────────────────────
	pi.registerCommand("new-change", {
		description: "创建新的变更目录并设为 active，用法: /new-change <简写>",
		handler: async (args, ctx) => {
			if (!args || !args.trim()) {
				ctx.ui.notify("用法: /new-change <简写>（如 refactor-auth）", "warning");
				return;
			}
			const name = args.trim();
			const dirName = getChangeDirName(name);
			const dirPath = resolve(ctx.cwd, "changes", dirName);

			await mkdir(dirPath, { recursive: true });
			await setActiveChange(ctx.cwd, dirName);

			ctx.ui.notify(`✅ 已创建 ${dirName}/ 并设为 active`, "success");
		},
	});

	// ── /switch-change ────────────────────────────────────────────
	pi.registerCommand("switch-change", {
		description: "切换 active change 目录，用法: /switch-change [目录名]",
		handler: async (args, ctx) => {
			const dirs = await listChangeDirs(ctx.cwd);

			if (dirs.length === 0) {
				ctx.ui.notify("没有可用的变更目录，先执行 /new-change", "warning");
				return;
			}

			let target: string | null = args?.trim() || null;

			if (!target || !dirs.includes(target)) {
				if (target) {
					ctx.ui.notify(`目录 "${target}" 不存在`, "warning");
				}
				target = (await ctx.ui.select("选择变更目录：", dirs)) ?? null;
			}

			if (target) {
				await setActiveChange(ctx.cwd, target);
				ctx.ui.notify(`已切换到 ${target}`, "info");
			}
		},
	});
}

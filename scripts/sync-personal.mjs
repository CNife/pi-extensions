#!/usr/bin/env node
// Sync personal/ entries into ~/.pi/agent/extensions/ by per-entry symlink.
//
// File-type (top-level *.ts): symlink the file.
// Package-type (subdir with package.json): npm install deps in-place, then
// symlink the directory. Pi auto-discovers package dirs under extensions/
// (skips node_modules), so settings.json does not need to list them.
//
// Never whole-tree replace the extensions dir — local-only files stay put.
// Existing non-symlink targets fail closed (protect herdr etc.).

import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readlinkSync,
  renameSync,
  statSync,
  symlinkSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_PERSONAL_DIR = join(REPO_ROOT, "personal");
const DEFAULT_AGENT_DIR = join(homedir(), ".pi", "agent");

const SKIP_NAMES = new Set(["readme.md", "agents.md"]);

/**
 * Plan sync actions from a personal directory listing.
 * Pure aside from reading the personal tree.
 *
 * @param {string} personalDir
 * @param {string} agentDir
 * @returns {Array<{name: string, type: string, action: string, source?: string, target?: string, reason?: string}>}
 */
export function planSync(personalDir, agentDir) {
  const personalAbs = resolve(personalDir);
  const agentAbs = resolve(agentDir);
  const extensionsDir = join(agentAbs, "extensions");

  if (!existsSync(personalAbs)) {
    throw new Error(`personal directory does not exist: ${personalAbs}`);
  }

  const entries = readdirSync(personalAbs, { withFileTypes: true });
  const plan = [];

  for (const entry of entries) {
    const name = entry.name;
    if (name.startsWith(".")) continue;
    if (SKIP_NAMES.has(name.toLowerCase())) continue;

    const source = join(personalAbs, name);

    if (entry.isFile() || (entry.isSymbolicLink() && statSync(source).isFile())) {
      if (!name.endsWith(".ts")) {
        plan.push({
          name,
          type: "file",
          action: "skip",
          source,
          reason: "non-.ts file",
        });
        continue;
      }
      plan.push({
        name,
        type: "file",
        action: "link",
        source,
        target: join(extensionsDir, name),
      });
      continue;
    }

    if (
      entry.isDirectory() ||
      (entry.isSymbolicLink() && statSync(source).isDirectory())
    ) {
      const pkgJson = join(source, "package.json");
      if (existsSync(pkgJson)) {
        // link the dir; executor runs npm install first
        plan.push({
          name,
          type: "package",
          action: "link",
          source,
          target: join(extensionsDir, name),
          installDeps: true,
        });
      } else {
        plan.push({
          name,
          type: "directory",
          action: "skip",
          source,
          reason: "directory without package.json",
        });
      }
      continue;
    }

    plan.push({
      name,
      type: "unknown",
      action: "skip",
      source,
      reason: "unsupported entry type",
    });
  }

  return plan.sort((a, b) => a.name.localeCompare(b.name));
}

function ensureDir(dir) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function isBrokenSymlink(path) {
  try {
    lstatSync(path);
    return !existsSync(path);
  } catch {
    return false;
  }
}

/**
 * Create or refresh a symlink. Fails on non-symlink conflicts.
 * @param {{source: string, target: string, name: string}} item
 * @param {{dryRun?: boolean}} opts
 */
export function applyLink(item, { dryRun = false } = {}) {
  const { source, target, name } = item;
  ensureDir(dirname(target));

  if (existsSync(target) || isBrokenSymlink(target)) {
    const st = lstatSync(target);
    if (st.isSymbolicLink()) {
      const current = resolve(dirname(target), readlinkSync(target));
      if (current === resolve(source)) {
        return { name, action: "link", status: "unchanged", target };
      }
      if (dryRun) {
        return {
          name,
          action: "link",
          status: "would-replace-symlink",
          from: current,
          target,
        };
      }
      renameSync(target, `${target}.pre-personal.bak`);
    } else {
      throw new Error(
        `Refusing to overwrite non-symlink ${target}. ` +
          `Move or remove the local-only file, then re-run sync.`,
      );
    }
  }

  if (dryRun) {
    return { name, action: "link", status: "would-create", target };
  }

  symlinkSync(source, target);
  return { name, action: "link", status: "created", target };
}

/**
 * Install production deps for a package-type personal entry.
 * @param {string} source package directory
 * @param {{dryRun?: boolean}} opts
 */
export function installPackageDeps(source, { dryRun = false } = {}) {
  if (dryRun) {
    return { status: "would-npm-install", cwd: source };
  }
  const result = spawnSync(
    "npm",
    ["install", "--omit=dev", "--omit=peer", "--no-audit", "--no-fund"],
    {
      cwd: source,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if (result.status !== 0) {
    throw new Error(
      `npm install failed in ${source}:\n${result.stderr || result.stdout || ""}`,
    );
  }
  return { status: "installed", cwd: source };
}

function parseArgs(argv) {
  const opts = {
    dryRun: false,
    personalDir: DEFAULT_PERSONAL_DIR,
    agentDir: DEFAULT_AGENT_DIR,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") opts.dryRun = true;
    else if (a === "--personal-dir") opts.personalDir = resolve(argv[++i]);
    else if (a === "--agent-dir") opts.agentDir = resolve(argv[++i]);
    else if (a === "--help" || a === "-h") opts.help = true;
    else throw new Error(`Unknown argument: ${a}`);
  }
  return opts;
}

function printHelp() {
  console.log(`Usage: node scripts/sync-personal.mjs [options]

Sync personal/ entries into ~/.pi/agent/extensions/ (per-entry symlink).

Options:
  --dry-run              Plan only; do not mutate filesystem
  --personal-dir <path>  Override personal directory (default: <repo>/personal)
  --agent-dir <path>     Override pi agent dir (default: ~/.pi/agent)
  -h, --help             Show help
`);
}

/**
 * @param {{personalDir?: string, agentDir?: string, dryRun?: boolean}} opts
 */
export function runSync({
  personalDir = DEFAULT_PERSONAL_DIR,
  agentDir = DEFAULT_AGENT_DIR,
  dryRun = false,
} = {}) {
  const plan = planSync(personalDir, agentDir);
  const results = [];

  if (!dryRun) {
    ensureDir(join(agentDir, "extensions"));
  }

  for (const item of plan) {
    if (item.action === "skip") {
      results.push({ name: item.name, action: "skip", reason: item.reason });
      continue;
    }
    if (item.action === "link") {
      let install = null;
      if (item.installDeps) {
        install = installPackageDeps(item.source, { dryRun });
      }
      const link = applyLink(item, { dryRun });
      results.push(install ? { ...link, install } : link);
    }
  }

  return { plan, results, dryRun };
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    printHelp();
    return;
  }

  const out = runSync(opts);
  console.log(JSON.stringify(out, null, 2));
  if (out.dryRun) {
    console.error("(dry-run: no changes written)");
  }
}

const isDirect =
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isDirect) {
  try {
    main();
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

#!/usr/bin/env node
// Sync personal/ entries into the local pi agent directory.
//
// File-type (.ts): symlink into ~/.pi/agent/extensions/
// Package-type (dir with package.json): npm install deps + register absolute
// path in settings packages. Never symlink package dirs (prevents dual-load).
//
// Note: pi's local-path install only checks path existence and does NOT run
// npm install. This script owns dependency installation for package entries.

import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_PERSONAL_DIR = join(REPO_ROOT, "personal");
const DEFAULT_AGENT_DIR = join(homedir(), ".pi", "agent");

const SKIP_NAMES = new Set(["readme.md", "agents.md"]);

/** Sources removed from settings when syncing package entries. */
export const DEFAULT_REMOVE_SOURCES = [
  "npm:@juicesharp/rpiv-advisor",
  "npm:@cnife/pi-miscs",
];

/**
 * Plan sync actions from a personal directory listing.
 * Pure: no filesystem side effects beyond reading the personal tree.
 *
 * @param {string} personalDir
 * @param {string} agentDir
 * @returns {Array<{name: string, type: string, action: string, source?: string, target?: string, settingsSource?: string, reason?: string}>}
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

    if (entry.isDirectory() || (entry.isSymbolicLink() && statSync(source).isDirectory())) {
      const pkgJson = join(source, "package.json");
      if (existsSync(pkgJson)) {
        plan.push({
          name,
          type: "package",
          action: "install-local",
          source,
          settingsSource: source,
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

/**
 * Update a settings object packages array.
 * Pure: returns a new settings object.
 *
 * @param {object} settings
 * @param {{ add?: string[], remove?: string[] }} opts
 * @returns {object}
 */
export function updateSettingsPackages(settings, { add = [], remove = [] } = {}) {
  const current = Array.isArray(settings.packages) ? [...settings.packages] : [];
  const removeSet = new Set(remove.map(normalizeSource));

  const kept = current.filter((entry) => {
    const source = packageSource(entry);
    return !removeSet.has(normalizeSource(source));
  });

  const existing = new Set(kept.map((entry) => normalizeSource(packageSource(entry))));
  for (const source of add) {
    const norm = normalizeSource(source);
    if (!existing.has(norm)) {
      kept.push(source);
      existing.add(norm);
    }
  }

  return { ...settings, packages: kept };
}

function packageSource(entry) {
  return typeof entry === "string" ? entry : entry?.source;
}

function normalizeSource(source) {
  if (typeof source !== "string") return String(source);
  // Absolute local paths: resolve for stable comparison
  if (source.startsWith("/") || source.startsWith("./") || source.startsWith("../")) {
    try {
      return resolve(source);
    } catch {
      return source;
    }
  }
  return source;
}

function ensureDir(dir) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/**
 * Link a file entry. Fails on non-symlink conflicts to protect local-only files.
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
        return { name, action: "link", status: "unchanged" };
      }
      if (dryRun) {
        return { name, action: "link", status: "would-replace-symlink", from: current };
      }
      // replace wrong symlink
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

function isBrokenSymlink(path) {
  try {
    lstatSync(path);
    return !existsSync(path);
  } catch {
    return false;
  }
}

/**
 * Install package deps and return settings mutation intent.
 * @param {{source: string, settingsSource: string, name: string}} item
 * @param {{dryRun?: boolean}} opts
 */
export function applyInstallLocal(item, { dryRun = false } = {}) {
  const { source, settingsSource, name } = item;
  const oldStandalone = join(
    dirname(dirname(settingsSource)), // not reliable; check via agent extensions later
    "extensions",
    `${name}.ts`,
  );
  void oldStandalone;

  if (dryRun) {
    return {
      name,
      action: "install-local",
      status: "would-npm-install-and-register",
      settingsSource,
    };
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

  return {
    name,
    action: "install-local",
    status: "installed",
    settingsSource,
  };
}

/**
 * Guard against leftover standalone extension file for a package name.
 * @param {string} agentDir
 * @param {string} packageName
 */
export function assertNoStandalonePackageExtension(agentDir, packageName) {
  const path = join(agentDir, "extensions", `${packageName}.ts`);
  if (!existsSync(path) && !isBrokenSymlink(path)) return;
  try {
    const st = lstatSync(path);
    if (st.isSymbolicLink()) {
      // A leftover symlink to an old location still dual-loads; refuse.
      throw new Error(
        `Found old standalone extension ${path} (symlink). ` +
          `Remove or back it up before syncing the ${packageName} package.`,
      );
    }
    throw new Error(
      `Found old standalone extension ${path}. ` +
        `Remove or back it up before syncing the ${packageName} package.`,
    );
  } catch (err) {
    if (err && err.code === "ENOENT") return;
    throw err;
  }
}

/**
 * Persist settings packages changes with a one-time backup.
 * @param {string} settingsPath
 * @param {{add: string[], remove: string[]}} mutation
 * @param {{dryRun?: boolean}} opts
 */
export function applySettingsMutation(settingsPath, mutation, { dryRun = false } = {}) {
  if (!existsSync(settingsPath)) {
    throw new Error(`settings file not found: ${settingsPath}`);
  }
  const raw = readFileSync(settingsPath, "utf-8");
  const settings = JSON.parse(raw);
  const next = updateSettingsPackages(settings, mutation);
  const nextRaw = `${JSON.stringify(next, null, 2)}\n`;

  if (raw === nextRaw || JSON.stringify(settings.packages) === JSON.stringify(next.packages)) {
    // Still rewrite if key order differs? Prefer content-equality on packages.
    const same =
      JSON.stringify(settings.packages ?? []) === JSON.stringify(next.packages ?? []);
    if (same) {
      return { status: "unchanged", packages: next.packages };
    }
  }

  if (dryRun) {
    return { status: "would-update", packages: next.packages };
  }

  const bak = `${settingsPath}.bak-sync`;
  if (!existsSync(bak)) {
    writeFileSync(bak, raw, "utf-8");
  }
  writeFileSync(settingsPath, nextRaw, "utf-8");
  return { status: "updated", packages: next.packages };
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

Sync personal/ entries into the local pi agent directory.

Options:
  --dry-run              Plan only; do not mutate filesystem or settings
  --personal-dir <path>  Override personal directory (default: <repo>/personal)
  --agent-dir <path>     Override pi agent dir (default: ~/.pi/agent)
  -h, --help             Show help
`);
}

export function runSync({
  personalDir = DEFAULT_PERSONAL_DIR,
  agentDir = DEFAULT_AGENT_DIR,
  dryRun = false,
  removeSources = DEFAULT_REMOVE_SOURCES,
} = {}) {
  const plan = planSync(personalDir, agentDir);
  const results = [];
  const addSources = [];
  const blockers = [];

  // Phase 1: validate package entries (fail closed before mutating)
  for (const item of plan) {
    if (item.action !== "install-local") continue;
    try {
      assertNoStandalonePackageExtension(agentDir, item.name);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      blockers.push({ name: item.name, reason });
    }
  }

  if (blockers.length > 0) {
    if (dryRun) {
      for (const b of blockers) {
        results.push({
          name: b.name,
          action: "install-local",
          status: "blocked",
          reason: b.reason,
        });
      }
      for (const item of plan) {
        if (item.action === "skip") {
          results.push({ name: item.name, action: "skip", reason: item.reason });
        } else if (item.action === "link") {
          results.push(applyLink(item, { dryRun: true }));
        } else if (
          item.action === "install-local" &&
          !blockers.some((b) => b.name === item.name)
        ) {
          results.push(applyInstallLocal(item, { dryRun: true }));
          addSources.push(item.settingsSource);
        }
      }
      return {
        plan,
        results,
        settingsResult: {
          status: "blocked",
          reason: "package entry blocked; settings not changed",
          blockers,
          wouldAdd: addSources,
          wouldRemove: removeSources,
        },
        dryRun,
      };
    }
    throw new Error(blockers.map((b) => b.reason).join("\n"));
  }

  // Phase 2: apply
  ensureDir(join(agentDir, "extensions"));

  for (const item of plan) {
    if (item.action === "skip") {
      results.push({ name: item.name, action: "skip", reason: item.reason });
      continue;
    }
    if (item.action === "link") {
      results.push(applyLink(item, { dryRun }));
      continue;
    }
    if (item.action === "install-local") {
      results.push(applyInstallLocal(item, { dryRun }));
      addSources.push(item.settingsSource);
    }
  }

  let settingsResult = null;
  // Always reconcile settings when we have package installs or known replacements.
  // File-only sync still drops miscs/original-advisor so personal becomes source of truth.
  if (addSources.length > 0 || removeSources.length > 0) {
    const settingsPath = join(agentDir, "settings.json");
    if (existsSync(settingsPath)) {
      settingsResult = applySettingsMutation(
        settingsPath,
        { add: addSources, remove: removeSources },
        { dryRun },
      );
    } else if (dryRun) {
      settingsResult = {
        status: "would-update-if-settings-exist",
        add: addSources,
        remove: removeSources,
      };
    } else {
      throw new Error(`settings file not found: ${settingsPath}`);
    }
  }

  return { plan, results, settingsResult, dryRun };
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

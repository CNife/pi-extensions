#!/usr/bin/env node
// Pre-commit check: ensure every package's npm `files` whitelist covers all
// local .ts files reachable from its pi extension entrypoints.
//
// Background: `@cnife/pi-nmem@0.3.0` shipped with `extensions/nmem.ts` importing
// `../render.ts` and `../toon.ts`, but `package.json` `files` omitted both, so
// `npm pack` excluded them and `pi -e npm:@cnife/pi-nmem` failed with
// `Cannot find module '../render.ts'`. This script prevents recurrence.
//
// npm `files` semantics (verified): when `files` is set, ONLY listed entries
// (dirs recursed) + npm-forced files (package.json/README*/LICENSE*/CHANGELOG*)
// are packed. Everything else is excluded. So any local import target not in
// the whitelist is a ship-time bomb.
//
// Scope: build the import graph from `pi.extensions` entrypoints only. Files
// outside the reachable graph (tests, prototypes) need not be packed. `files`
// empty -> npm defaults pack everything locally present -> always safe, skip.
//
// Exit non-zero on any violation. Run via lint-staged on package.json changes.

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname, normalize, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const packagesDir = join(repoRoot, "packages");

// npm always-forced files regardless of `files` whitelist.
const FORCED = /^(package\.json|readme(\..*)?|license(\..*)?|changelog(\..*)?)$/i;

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

// Resolve a relative import spec like "../render" or "./client.ts" against the
// importing file, returning the canonical .ts path if it's a local file, or
// null if it's a bare specifier (package import).
function resolveLocal(importerPath, spec) {
  if (!spec.startsWith(".")) return null; // bare module import, e.g. "@earendil-works/pi-ai"
  // pi loads extensions as .ts via a require stack that accepts the .ts suffix
  // literally (the original bug was `Cannot find module '../render.ts'`), so we
  // honor the spec as written: with .ts use it directly, without try .ts.
  const candidates = spec.endsWith(".ts")
    ? [spec]
    : [`${spec}.ts`, `${spec}/index.ts`];
  for (const c of candidates) {
    const full = normalize(join(dirname(importerPath), c));
    if (existsSync(full)) return full;
  }
  return null;
}

// Collect all local .ts files reachable from the entrypoints via relative
// imports. Bare imports (node_modules) are ignored.
function reachableGraph(entryPaths) {
  const seen = new Set();
  const stack = [...entryPaths];
  while (stack.length) {
    const file = stack.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    if (!file.endsWith(".ts")) continue;
    let src;
    try {
      src = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    // match `import ... from "..."` and `import("...")`, static + dynamic.
    for (const m of src.matchAll(/from\s+['"](\.{1,2}\/[^'"]+)['"]/g)) {
      const t = resolveLocal(file, m[1]);
      if (t) stack.push(t);
    }
    for (const m of src.matchAll(/import\s*\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g)) {
      const t = resolveLocal(file, m[1]);
      if (t) stack.push(t);
    }
  }
  return seen;
}

// Files actually packed given the `files` whitelist (dirs recursed into .ts).
// Returns a Set of repo-relative paths. Empty `files` -> null (defaults, skip).
function packedFiles(pkgRoot, files) {
  if (!files || files.length === 0) return null;
  const packed = new Set();
  for (const entry of files) {
    const full = join(pkgRoot, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue; // listed but missing - npm would warn, not our concern here
    }
    if (st.isDirectory()) {
      for (const f of walkTs(full)) packed.add(relative(repoRoot, f));
    } else {
      packed.add(relative(repoRoot, full));
    }
  }
  return packed;
}

function walkTs(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules") continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walkTs(full));
    else if (name.endsWith(".ts")) out.push(full);
  }
  return out;
}

function main() {
  const pkgs = readdirSync(packagesDir).filter((n) =>
    statSync(join(packagesDir, n)).isDirectory(),
  );

  const violations = [];
  const checked = [];

  for (const name of pkgs) {
    const pkgRoot = join(packagesDir, name);
    const pjPath = join(pkgRoot, "package.json");
    if (!existsSync(pjPath)) continue;
    const pj = readJson(pjPath);

    const entryDirs = pj?.pi?.extensions ?? [];
    const files = pj?.files ?? [];
    if (entryDirs.length === 0) continue; // no pi extension entry, skip
    if (files.length === 0) {
      checked.push(`${name} (files empty -> npm defaults, safe)`);
      continue; // empty files = npm packs everything present, nothing to check
    }

    const entryPaths = entryDirs
      .map((d) => join(pkgRoot, d))
      .filter((p) => existsSync(p))
      .flatMap((d) => walkTs(d));

    const reachable = reachableGraph(entryPaths);
    const packed = packedFiles(pkgRoot, files);

    for (const file of reachable) {
      const rel = relative(repoRoot, file);
      const base = rel.split("/").pop();
      if (FORCED.test(base)) continue;
      if (!packed.has(rel)) {
        violations.push(
          `${name}: "${rel}" is imported by an extension but not in package.json \`files\` (npm pack would exclude it)`,
        );
      }
    }
    checked.push(
      `${name} (${reachable.size} reachable files, ${packed.size} packed)`,
    );
  }

  console.log("check-package-files:");
  for (const c of checked) console.log(`  ok  ${c}`);

  if (violations.length > 0) {
    console.error("\n✗ files whitelist gaps found:");
    for (const v of violations) console.error(`  - ${v}`);
    console.error(
      "\nFix: add the missing file(s) to package.json `files`, or remove the import.",
    );
    process.exit(1);
  }
  console.log("\n✓ all extension imports are covered by `files`");
}

main();

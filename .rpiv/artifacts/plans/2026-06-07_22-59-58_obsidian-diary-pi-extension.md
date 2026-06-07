---
date: 2026-06-07T22:59:58+0800
author: CNife
commit: 5d0ee13
branch: feat/obsidian-diary
repository: pi-extensions
topic: "Obsidian Diary Pi Extension"
tags: [plan, blueprint, obsidian-diary, pi-extension, cli]
status: ready
parent: .rpiv/artifacts/research/2026-06-07_22-32-07_obsidian-diary-pi-extension.md
phase_count: 4
unresolved_phase_count: 0
last_updated: 2026-06-07T22:59:58+0800
last_updated_by: CNife
---

# Obsidian Diary Pi Extension Implementation Plan

## Overview

Build `@cnife/pi-obsidian-diary` as a new pi extension package with an independent TypeScript CLI. The extension owns `/diary` argument parsing and clean-session launch; the clean subagent invokes `pi-obsidian-diary` for deterministic JSON context and directly patches the Obsidian diary file under fail-closed rules.

## Requirements

- Add a new npm workspace package named `@cnife/pi-obsidian-diary` under `packages/obsidian-diary`.
- Register a `/diary` slash command.
- Support `/diary`, `/diary <session-id>`, `/diary --work [session-id]`, and `/diary --personal [session-id]`.
- Expose an independent TypeScript CLI named `pi-obsidian-diary`.
- Keep the extension/subagent/CLI boundary: extension passes session id and variant intent; subagent invokes CLI; subagent performs semantic summarization, duplicate detection, style self-check, and diary patch.
- Use JSON as the CLI primary output contract.
- Put vault configuration in the pi agent directory: `<getAgentDir()>/cnife-obsidian-diary.json`.
- Include today diary full content in CLI JSON so duplicate detection and patch planning have complete context.
- Fail closed: invalid session/config/path/CLI/subagent failures must leave diary files unchanged.
- Verify CLI fixtures, extension E2E behavior, duplicate-content behavior, and failure-no-write behavior.

## Current State Analysis

### Key Discoveries

- Root `package.json:4-7` uses npm workspaces over `packages/*` and `npm run check` runs Biome over `./packages`.
- `packages/AGENTS.md:3-18` defines the extension package layout and `@cnife/pi-<name>` naming convention.
- `packages/AGENTS.md:39` documents slash command registration through `pi.registerCommand(name, opts)`.
- `packages/auto-naming-session/package.json:1-30` is the package metadata template for public pi extension packages.
- `packages/auto-naming-session/extensions/index.ts:27` uses `getAgentDir()` for pi-agent-dir scoped extension config.
- `packages/simple-plannotator/extensions/index.ts:50-74` is the best local slash-command handler lifecycle template: validate, notify, try/catch, report user-facing errors.
- `packages/simple-plannotator/extensions/index.ts:200-213` shows path-like command parsing is fragile; `/diary` keeps a deliberately small grammar even with `--work|--personal`.
- `tests/sh-guard.test.sh:1-350` is the repo's bash CLI test harness precedent.
- `tsconfig.json:3-11` sets ES2022 TypeScript assumptions but the repo currently has no package build pipeline for bins.
- `biome.json:10-25` enforces `packages/**`, two-space indentation, and double quotes.
- `node_modules/@earendil-works/pi-coding-agent/package.json:5-10` provides the closest bin precedent: ESM package, `bin` points to `dist/cli.js`.
- `node_modules/@earendil-works/pi-coding-agent/dist/cli.js:1` confirms a Node shebang for CLI entry points.
- `node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts:241-250` exposes `waitForIdle()` and `newSession()` on command contexts.
- `node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts:282-289` exposes fresh `ReplacedSessionContext.sendUserMessage()` for replacement sessions.
- `node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/runner.js:289` warns not to use stale command contexts after `newSession`; post-replacement work belongs in `withSession`.
- `node_modules/@earendil-works/pi-coding-agent/dist/index.d.ts:16` re-exports `SessionManager`, `parseSessionEntries`, and `buildSessionContext`.
- `node_modules/@earendil-works/pi-coding-agent/dist/core/session-manager.d.ts:120-129` defines `SessionInfo` with `id`, `path`, `cwd`, `name`, and message summary fields.
- `node_modules/@earendil-works/pi-coding-agent/dist/core/session-manager.d.ts:140-147` exposes `parseSessionEntries()` and `buildSessionContext()`.
- `node_modules/@earendil-works/pi-coding-agent/dist/core/session-manager.d.ts:190-191` exposes current session id/file on the active session manager.
- `node_modules/@earendil-works/pi-coding-agent/dist/core/session-manager.d.ts:303-331` exposes `SessionManager.open()`, `SessionManager.list()`, and `SessionManager.listAll()`.
- `/home/cnife/code/skills/knowledge/obsidian-diary/scripts/obsidian-helper.py:76-90` is the path/date computation source to replace in TypeScript.
- `/home/cnife/code/skills/knowledge/obsidian-diary/scripts/obsidian-helper.py:223-371` defines the old todos/recent/rules/today-context behavior to port into JSON.
- `/home/cnife/code/skills/knowledge/obsidian-diary/SKILL.md:140-199` defines topic aggregation, outline matching, direct patch, and merge/update behavior.
- `/home/cnife/code/skills/knowledge/obsidian-diary/SKILL.md:229-295` defines style self-check and AI-noise filtering.
- `/home/cnife/code/skills/knowledge/obsidian-diary/references/personal-diary.md:6` and `/home/cnife/code/skills/knowledge/obsidian-diary/references/work-log.md:6` confirm `YYYY/MM` numeric directory layout.

## Desired End State

Slash command usage:

```text
/diary
/diary 2026-06-07_abc123
/diary --personal
/diary --work 2026-06-07_abc123
```

CLI usage from a clean subagent after variant resolution:

```bash
pi-obsidian-diary --session 2026-06-07_abc123 --variant work --json
pi-obsidian-diary --session 2026-06-07_abc123 --variant personal --json
```

CLI fixture usage with test isolation:

```bash
PI_CODING_AGENT_DIR=/tmp/pi-diary-agent \
  node packages/obsidian-diary/dist/cli.js \
  --session-file /tmp/session.jsonl \
  --variant personal \
  --date 2026-06-07 \
  --json
```

Configuration file:

```json
{
  "vaults": {
    "work": {
      "base": "/path/to/obsidian/work-vault",
      "diary_dir": "工作日志",
      "template": "日志模板.md",
      "exclude_meta": ["AGENTS.md", "任务.md", "日志模板.md"]
    },
    "personal": {
      "base": "/path/to/obsidian/personal-vault",
      "diary_dir": "个人日记",
      "template": "日记模板.md",
      "exclude_meta": ["AGENTS.md"]
    }
  }
}
```

Primary JSON shape:

```json
{
  "schemaVersion": 1,
  "session": {
    "id": "2026-06-07_abc123",
    "path": "/tmp/session.jsonl",
    "cwd": "/home/cnife/code/pi-extensions",
    "name": "optional session name",
    "messages": []
  },
  "variant": {
    "resolved": "personal"
  },
  "diary": {
    "path": "/path/to/个人日记/2026/06/2026年6月7日星期日.md",
    "exists": true,
    "created": false,
    "content": "# 待办事项\n...",
    "outline": []
  },
  "context": {
    "rules": "...",
    "todos": [],
    "recent": []
  }
}
```

## What We're NOT Doing

- Not building a multi-action CLI that mirrors old `locate/create/todos/recent/read/context` actions.
- Not reusing the old Python helper as runtime code.
- Not supporting multi-session diary merge in v1.
- Not adding proactive event-triggered diary writing.
- Not writing session id markers into diary files.
- Not letting the extension summarize or patch diary files directly.
- Not storing vault configuration under the old `~/.config/cnife-skills/obsidian-diary.json` path.
- Not auto-migrating old helper configuration.

## Decisions

### Decision 1: Three-layer responsibility boundary

The extension parses command arguments and starts a clean session; the subagent invokes the CLI; the subagent directly patches the diary. This follows inherited discover decisions and avoids making the extension perform semantic diary work.

### Decision 2: `/diary` supports variant override in v1

Ambiguity: research inherited both “auto 判断，可覆盖” and minimal empty-or-one-session-id parsing.

Explored:

- Defer override: keeps `/diary` grammar smallest and follows the simple-plannotator lesson at `packages/simple-plannotator/extensions/index.ts:200-213`, but drops an inherited requirement.
- Include `--work|--personal`: expands parsing and tests, but satisfies the developer correction and keeps the grammar still bounded.

Decision: include `--work|--personal` in v1. Accepted grammar is zero or one session id plus at most one variant flag. No variant flag means `auto`, which the clean subagent resolves semantically before invoking the deterministic CLI.

### Decision 3: CLI is a single command without subcommands

Ambiguity: old helper has multiple actions at `/home/cnife/code/skills/knowledge/obsidian-diary/scripts/obsidian-helper.py:403-410`, while research selected JSON primary.

Decision: no subcommands. The CLI accepts flags on one command and emits the context JSON directly. The CLI only accepts concrete `work|personal` variants; `auto` belongs to the subagent's semantic preflight.

### Decision 4: JSON includes today diary full content

Ambiguity: old helper prints today outline/summary at `/home/cnife/code/skills/knowledge/obsidian-diary/scripts/obsidian-helper.py:330-371`, but semantic duplicate handling requires reading existing diary content.

Decision: include full today diary content in JSON, along with outline, todos, recent files, rules, and session messages.

### Decision 5: Configuration lives in the pi agent directory

Ambiguity: research recorded old helper config under `~/.config/cnife-skills/obsidian-diary.json`, while existing pi extensions use `getAgentDir()`.

Decision: use `<getAgentDir()>/cnife-obsidian-diary.json` only, following `packages/AGENTS.md:53` and `packages/auto-naming-session/extensions/index.ts:27`. Do not read, fallback to, or migrate the old helper path.

### Decision 6: Add a real TypeScript build for the CLI bin

Ambiguity: existing packages are loaded as TypeScript extensions by jiti, but npm `bin` needs executable JavaScript.

Explored:

- Add TypeScript build: root devDependency + package `tsconfig.json` + `dist/cli.js`, matching pi's own `node_modules/@earendil-works/pi-coding-agent/package.json:9` precedent.
- Runtime TS loader: smaller build setup but adds runtime dependency and uncertain publishing behavior.
- Handwritten JS bin: simple but conflicts with the TypeScript CLI requirement.

Decision: add `typescript` as a root devDependency, package-local build scripts, and `bin` pointing to `dist/cli.js`.

### Decision 7: CLI fixture tests use isolated temp inputs

Tests use `PI_CODING_AGENT_DIR`, `--config`, `--date`, and `--session-file` so they do not touch real pi sessions or real Obsidian vaults. Production subagent use still passes `--session <id>`.

## Phase 1: Package And Build Foundation

### Overview

Creates the new package scaffold, TypeScript build foundation, shared JSON/config types, and README skeleton. Depends on nothing.

### Changes Required

#### 1. package.json

**File**: `package.json`
**Changes**: MODIFY — add root TypeScript devDependency for package-local CLI builds

```json
{
  "name": "cnife-pi-extensions",
  "version": "1.0.0",
  "private": true,
  "workspaces": ["packages/*"],
  "scripts": {
    "check": "npx biome check ./packages",
    "check:fix": "npx biome check --write ./packages",
    "format": "npx biome format --write ./packages",
    "check:unsafe": "npx biome check --write --unsafe ./packages",
    "prepare": "husky || true"
  },
  "lint-staged": {
    "packages/**/*.ts": [
      "biome check --write"
    ],
    "**/*.md": [
      "rumdl fmt"
    ],
    "**/package.json": [
      "bash -c 'npm install --package-lock-only'"
    ]
  },
  "devDependencies": {
    "@biomejs/biome": "^2.4.15",
    "@earendil-works/pi-ai": "^0.75.5",
    "@earendil-works/pi-coding-agent": "^0.75.5",
    "@earendil-works/pi-tui": "^0.75.5",
    "@types/node": "^25.9.1",
    "husky": "^9.1.7",
    "lint-staged": "^17.0.5",
    "typescript": "^5.9.3"
  }
}
```

#### 2. packages/obsidian-diary/package.json

**File**: `packages/obsidian-diary/package.json`
**Changes**: NEW — public pi package metadata with extension registration and CLI bin

```json
{
  "name": "@cnife/pi-obsidian-diary",
  "version": "0.1.0",
  "private": false,
  "keywords": [
    "pi-package"
  ],
  "description": "Write Pi sessions into Obsidian diaries through a slash command and JSON CLI",
  "homepage": "https://github.com/CNife/pi-extensions#readme",
  "bugs": {
    "url": "https://github.com/CNife/pi-extensions/issues"
  },
  "license": "MIT",
  "author": "CNife <CNife@vip.qq.com>",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/CNife/pi-extensions.git"
  },
  "publishConfig": {
    "access": "public",
    "provenance": true
  },
  "type": "module",
  "bin": {
    "pi-obsidian-diary": "./dist/cli.js"
  },
  "files": [
    "dist",
    "extensions",
    "src",
    "README.md"
  ],
  "scripts": {
    "build": "tsc -p tsconfig.json && node -e \"require('node:fs').chmodSync('dist/cli.js', 0o755)\"",
    "prepack": "npm run build"
  },
  "pi": {
    "extensions": [
      "./extensions"
    ]
  },
  "peerDependencies": {
    "@earendil-works/pi-coding-agent": "*"
  }
}
```

#### 3. packages/obsidian-diary/tsconfig.json

**File**: `packages/obsidian-diary/tsconfig.json`
**Changes**: NEW — package-local TypeScript build config for `src/**/*.ts` to `dist/`

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "declaration": true,
    "sourceMap": true,
    "noEmit": false
  },
  "include": ["src/**/*.ts"]
}
```

#### 4. packages/obsidian-diary/src/types.ts

**File**: `packages/obsidian-diary/src/types.ts`
**Changes**: NEW — shared variant, config, session, diary, and JSON output types

```typescript
export const VARIANTS = ["auto", "work", "personal"] as const;
export const RESOLVED_VARIANTS = ["work", "personal"] as const;

export type Variant = (typeof VARIANTS)[number];
export type ResolvedVariant = (typeof RESOLVED_VARIANTS)[number];

export type VaultConfig = {
  base: string;
  diary_dir: string;
  template: string;
  exclude_meta: string[];
};

export type ObsidianDiaryConfig = {
  vaults: Record<ResolvedVariant, VaultConfig>;
};

export type ParsedCliArgs = {
  help: boolean;
  json: boolean;
  sessionId?: string;
  sessionFile?: string;
  variant?: ResolvedVariant;
  configPath?: string;
  date?: string;
  errors: string[];
};

export type ParsedDiaryCommandArgs = {
  sessionId?: string;
  variant: Variant;
};

export type SessionMessageJson = {
  role: string;
  content: unknown;
  timestamp?: number;
};

export type SessionJson = {
  id: string;
  path: string;
  cwd: string;
  name?: string;
  messages: SessionMessageJson[];
  model: {
    provider: string;
    modelId: string;
  } | null;
  thinkingLevel: string;
};

export type VariantJson = {
  resolved: ResolvedVariant;
};

export type OutlineItem = {
  line: number;
  level: number;
  text: string;
};

export type TodoItem = {
  file: string;
  line: number;
  content: string;
};

export type RecentDiary = {
  path: string;
  modified: string;
  preview: string;
};

export type DiaryJson = {
  path: string;
  monthDir: string;
  templatePath: string;
  exists: boolean;
  created: boolean;
  date: string;
  content: string;
  outline: OutlineItem[];
};

export type ContextJson = {
  rules: string;
  todos: TodoItem[];
  recent: RecentDiary[];
};

export type DiaryContextJson = {
  schemaVersion: 1;
  ok: true;
  generatedAt: string;
  session: SessionJson;
  variant: VariantJson;
  diary: DiaryJson;
  context: ContextJson;
};

export type DiaryErrorJson = {
  schemaVersion: 1;
  ok: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
};

export type DiaryCliJson = DiaryContextJson | DiaryErrorJson;
```

#### 5. packages/obsidian-diary/README.md

**File**: `packages/obsidian-diary/README.md`
**Changes**: NEW — package usage, config path, CLI contract, and command examples

````markdown
# @cnife/pi-obsidian-diary

Pi extension and CLI for recording a Pi session into an Obsidian daily note.

## Usage

```text
/diary
/diary <session-id>
/diary --work [session-id]
/diary --personal [session-id]
```

The slash command starts a clean session and sends it a diary-writing prompt. If the command does not specify `--work` or `--personal`, the clean subagent first decides the diary variant from the session content. The subagent then calls `pi-obsidian-diary` for deterministic context and patches the diary file directly.

## CLI

The CLI requires a concrete variant. `auto` is resolved by the subagent before the CLI is invoked.

```bash
pi-obsidian-diary --session <session-id> --variant work --json
pi-obsidian-diary --session <session-id> --variant personal --json
```

Fixture and debugging options:

```bash
pi-obsidian-diary \
  --session-file /tmp/session.jsonl \
  --variant personal \
  --config /tmp/pi-agent/cnife-obsidian-diary.json \
  --date 2026-06-07 \
  --json
```

The primary output is JSON on stdout. Errors are written to stderr and exit non-zero. Failure paths must not patch diary files.

## Configuration

The config file lives in the pi agent directory:

```text
<getAgentDir()>/cnife-obsidian-diary.json
```

`getAgentDir()` respects `PI_CODING_AGENT_DIR`, which allows isolated tests:

```bash
PI_CODING_AGENT_DIR=/tmp/pi-diary-test pi-obsidian-diary --session <id> --variant personal --json
```

Config shape:

```json
{
  "vaults": {
    "work": {
      "base": "/path/to/obsidian/work-vault",
      "diary_dir": "工作日志",
      "template": "日志模板.md",
      "exclude_meta": ["AGENTS.md", "任务.md", "日志模板.md"]
    },
    "personal": {
      "base": "/path/to/obsidian/personal-vault",
      "diary_dir": "个人日记",
      "template": "日记模板.md",
      "exclude_meta": ["AGENTS.md"]
    }
  }
}
```

The old helper config at `~/.config/cnife-skills/obsidian-diary.json` is not read or migrated.
````

### Success Criteria

#### Automated Verification

- [ ] New package metadata and tsconfig are valid JSON: `node -e "const fs=require('node:fs'); for (const f of ['packages/obsidian-diary/package.json','packages/obsidian-diary/tsconfig.json']) JSON.parse(fs.readFileSync(f,'utf8'))"`
- [ ] Root lockfile can be regenerated after adding the workspace package and TypeScript devDependency: `npm install --package-lock-only`
- [ ] Biome accepts the Phase 1 TypeScript and package files: `npm run check`

#### Manual Verification

- [ ] `package-lock.json` includes the new `packages/obsidian-diary` workspace after lockfile regeneration.
- [ ] `package-lock.json` includes `typescript` after lockfile regeneration.
- [ ] README documents `<getAgentDir()>/cnife-obsidian-diary.json` as the only config path and states that the old helper config is not read or migrated.
- [ ] README states that the CLI requires `--variant work|personal` and that `auto` is resolved by the subagent before CLI invocation.

## Phase 2: Deterministic CLI Context

### Overview

Implements the single-command CLI and deterministic session/diary context engine. Depends on Phase 1.

### Changes Required

#### 1. packages/obsidian-diary/src/config.ts

**File**: `packages/obsidian-diary/src/config.ts`
**Changes**: NEW — load and validate `<getAgentDir()>/cnife-obsidian-diary.json`, with optional test override

```typescript
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type {
  ObsidianDiaryConfig,
  ResolvedVariant,
  VaultConfig,
} from "./types.js";

export const CONFIG_FILE_NAME = "cnife-obsidian-diary.json";

const SAMPLE_CONFIG: ObsidianDiaryConfig = {
  vaults: {
    work: {
      base: "/path/to/obsidian/work-vault",
      diary_dir: "工作日志",
      template: "日志模板.md",
      exclude_meta: ["AGENTS.md", "任务.md", "日志模板.md"],
    },
    personal: {
      base: "/path/to/obsidian/personal-vault",
      diary_dir: "个人日记",
      template: "日记模板.md",
      exclude_meta: ["AGENTS.md"],
    },
  },
};

export class DiaryCliError extends Error {
  readonly code: string;
  readonly details?: unknown;

  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = "DiaryCliError";
    this.code = code;
    this.details = details;
  }
}

export function getConfigPath(overridePath?: string): string {
  return overridePath ?? join(getAgentDir(), CONFIG_FILE_NAME);
}

export function writeSampleConfig(configPath: string): void {
  const dir = dirname(configPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(
    configPath,
    `${JSON.stringify(SAMPLE_CONFIG, null, 2)}\n`,
    "utf-8",
  );
}

export function loadConfig(overridePath?: string): ObsidianDiaryConfig {
  const configPath = getConfigPath(overridePath);

  if (!existsSync(configPath)) {
    try {
      writeSampleConfig(configPath);
    } catch (error) {
      throw new DiaryCliError(
        "CONFIG_WRITE_FAILED",
        `Failed to create sample config at ${configPath}`,
        { cause: getErrorMessage(error), configPath },
      );
    }

    throw new DiaryCliError(
      "CONFIG_MISSING",
      `Config not found. A sample config was created at ${configPath}. Edit it and retry.`,
      { configPath },
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(configPath, "utf-8"));
  } catch (error) {
    throw new DiaryCliError(
      "CONFIG_INVALID_JSON",
      `Invalid JSON in config file: ${configPath}`,
      { cause: getErrorMessage(error), configPath },
    );
  }

  return parseConfig(parsed, configPath);
}

function parseConfig(value: unknown, configPath: string): ObsidianDiaryConfig {
  const root = asRecord(value, "config", configPath);
  const vaults = asRecord(root.vaults, "config.vaults", configPath);

  return {
    vaults: {
      work: parseVaultConfig("work", vaults.work, configPath),
      personal: parseVaultConfig("personal", vaults.personal, configPath),
    },
  };
}

function parseVaultConfig(
  variant: ResolvedVariant,
  value: unknown,
  configPath: string,
): VaultConfig {
  const vault = asRecord(value, `config.vaults.${variant}`, configPath);

  return {
    base: readRequiredString(vault, "base", variant, configPath),
    diary_dir: readRequiredString(vault, "diary_dir", variant, configPath),
    template: readRequiredString(vault, "template", variant, configPath),
    exclude_meta: readStringArray(vault.exclude_meta, variant, configPath),
  };
}

function asRecord(
  value: unknown,
  label: string,
  configPath: string,
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new DiaryCliError(
      "CONFIG_INVALID_SHAPE",
      `${label} must be an object in ${configPath}`,
      { configPath, label },
    );
  }
  return value as Record<string, unknown>;
}

function readRequiredString(
  vault: Record<string, unknown>,
  key: keyof VaultConfig,
  variant: ResolvedVariant,
  configPath: string,
): string {
  const value = vault[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new DiaryCliError(
      "CONFIG_INVALID_SHAPE",
      `config.vaults.${variant}.${key} must be a non-empty string in ${configPath}`,
      { configPath, key, variant },
    );
  }
  return value;
}

function readStringArray(
  value: unknown,
  variant: ResolvedVariant,
  configPath: string,
): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new DiaryCliError(
      "CONFIG_INVALID_SHAPE",
      `config.vaults.${variant}.exclude_meta must be an array of strings in ${configPath}`,
      { configPath, variant },
    );
  }
  return [...value];
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
```

#### 2. packages/obsidian-diary/src/session.ts

**File**: `packages/obsidian-diary/src/session.ts`
**Changes**: NEW — resolve session id or fixture file and build compaction-aware session context

```typescript
import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import {
  buildSessionContext,
  parseSessionEntries,
  SessionManager,
  type FileEntry,
  type SessionContext,
  type SessionEntry,
  type SessionHeader,
  type SessionInfo,
} from "@earendil-works/pi-coding-agent";
import { DiaryCliError } from "./config.js";
import type { SessionJson, SessionMessageJson } from "./types.js";

export type ResolveSessionOptions = {
  sessionId?: string;
  sessionFile?: string;
};

export async function resolveSessionContext(
  options: ResolveSessionOptions,
): Promise<SessionJson> {
  if (options.sessionFile) {
    return readSessionFile(options.sessionFile, options.sessionId);
  }

  if (!options.sessionId) {
    throw new DiaryCliError(
      "SESSION_REQUIRED",
      "Pass --session <id> or --session-file <path>.",
    );
  }

  const sessions = await SessionManager.listAll();
  const session = sessions.find((item) => item.id === options.sessionId);
  if (!session) {
    throw new DiaryCliError(
      "SESSION_NOT_FOUND",
      `Session not found: ${options.sessionId}`,
      { sessionId: options.sessionId },
    );
  }

  return readSessionFile(session.path, session.id, session);
}

function readSessionFile(
  sessionFile: string,
  fallbackId?: string,
  info?: SessionInfo,
): SessionJson {
  if (!existsSync(sessionFile)) {
    throw new DiaryCliError(
      "SESSION_FILE_NOT_FOUND",
      `Session file not found: ${sessionFile}`,
      { sessionFile },
    );
  }

  const fileEntries = parseSessionEntries(readFileSync(sessionFile, "utf-8"));
  const header = fileEntries.find(isSessionHeader);
  const entries = fileEntries.filter(isSessionEntry);

  if (entries.length === 0) {
    throw new DiaryCliError(
      "SESSION_EMPTY",
      `Session file has no session entries: ${sessionFile}`,
      { sessionFile },
    );
  }

  const context = buildSessionContext(entries);
  const id = fallbackId ?? header?.id ?? stripJsonlExtension(basename(sessionFile));

  return {
    id,
    path: sessionFile,
    cwd: info?.cwd ?? header?.cwd ?? "",
    name: info?.name ?? findLatestSessionName(entries),
    messages: normalizeMessages(context),
    model: context.model,
    thinkingLevel: context.thinkingLevel,
  };
}

function isSessionHeader(entry: FileEntry): entry is SessionHeader {
  return entry.type === "session";
}

function isSessionEntry(entry: FileEntry): entry is SessionEntry {
  return entry.type !== "session";
}

function normalizeMessages(context: SessionContext): SessionMessageJson[] {
  return context.messages.map((message) => {
    const item = message as {
      role?: unknown;
      content?: unknown;
      timestamp?: unknown;
    };
    const normalized: SessionMessageJson = {
      role: typeof item.role === "string" ? item.role : "unknown",
      content: item.content ?? "",
    };
    if (typeof item.timestamp === "number") {
      normalized.timestamp = item.timestamp;
    }
    return normalized;
  });
}

function findLatestSessionName(entries: SessionEntry[]): string | undefined {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry.type !== "session_info") continue;
    const name = (entry as { name?: unknown }).name;
    if (typeof name === "string" && name.trim() !== "") {
      return name;
    }
  }
  return undefined;
}

function stripJsonlExtension(fileName: string): string {
  return fileName.endsWith(".jsonl") ? fileName.slice(0, -6) : fileName;
}
```

#### 3. packages/obsidian-diary/src/diary.ts

**File**: `packages/obsidian-diary/src/diary.ts`
**Changes**: NEW — compute diary paths, ensure template-based today file exists, read full content, todos, recent, rules, and outline

```typescript
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { DiaryCliError } from "./config.js";
import type {
  ContextJson,
  DiaryJson,
  ObsidianDiaryConfig,
  OutlineItem,
  RecentDiary,
  ResolvedVariant,
  TodoItem,
  VaultConfig,
} from "./types.js";

const WEEKDAYS = [
  "星期日",
  "星期一",
  "星期二",
  "星期三",
  "星期四",
  "星期五",
  "星期六",
] as const;

const TODO_PATTERN = /^\s*-\s*\[([ ^>!/?~br])\]\s+(.+)$/;
const HEADING_PATTERN = /^(#{1,6})\s+(.*)$/;

const RULES_BY_VARIANT: Record<ResolvedVariant, string> = {
  work: `工作日志规则：按子系统组织一级标题，按具体交付物组织二级标题；每个交付物 1-2 行，只写结果、决策和关键状态。不要记录 Git 操作、验证轮次、agent 内部阶段或低价值配置细节。`,
  personal: `个人日记规则：按主题域聚合，不按时间流水账平铺；保留个人判断和感受，技术内容只写关键结论与为什么。不要记录 Git 操作、验证轮次、agent 内部阶段或低价值配置细节。`,
};

export type BuildDiaryContextOptions = {
  date?: string;
  now?: Date;
};

export type BuiltDiaryContext = {
  diary: DiaryJson;
  context: ContextJson;
};

type DiaryPaths = {
  diaryPath: string;
  monthDir: string;
  templatePath: string;
  date: Date;
};

export function buildDiaryContext(
  config: ObsidianDiaryConfig,
  variant: ResolvedVariant,
  options: BuildDiaryContextOptions = {},
): BuiltDiaryContext {
  const vault = config.vaults[variant];
  validateVaultPaths(vault, variant);

  const paths = computeDiaryPaths(vault, parseDate(options.date, options.now));
  assertInside(vault.base, paths.monthDir, "DIARY_PATH_OUTSIDE_VAULT");
  assertInside(vault.base, paths.diaryPath, "DIARY_PATH_OUTSIDE_VAULT");
  assertInside(vault.base, paths.templatePath, "TEMPLATE_PATH_OUTSIDE_VAULT");

  const existedBefore = existsSync(paths.diaryPath);
  let created = false;
  if (!existedBefore) {
    ensureTodayDiary(paths);
    created = true;
  }

  const content = readFileSync(paths.diaryPath, "utf-8");

  return {
    diary: {
      path: paths.diaryPath,
      monthDir: paths.monthDir,
      templatePath: paths.templatePath,
      exists: true,
      created,
      date: toDateOnly(paths.date),
      content,
      outline: extractOutline(content),
    },
    context: {
      rules: RULES_BY_VARIANT[variant],
      todos: scanTodos(vault, 14),
      recent: scanRecent(vault, paths.diaryPath, 10, 3),
    },
  };
}

function validateVaultPaths(vault: VaultConfig, variant: ResolvedVariant): void {
  if (!isAbsolute(vault.base)) {
    throw new DiaryCliError(
      "VAULT_BASE_NOT_ABSOLUTE",
      `config.vaults.${variant}.base must be an absolute path: ${vault.base}`,
      { variant, base: vault.base },
    );
  }

  if (!existsSync(vault.base)) {
    throw new DiaryCliError(
      "VAULT_BASE_NOT_FOUND",
      `Vault base does not exist: ${vault.base}`,
      { variant, base: vault.base },
    );
  }
}

function computeDiaryPaths(vault: VaultConfig, date: Date): DiaryPaths {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const monthDir = join(vault.base, vault.diary_dir, String(year), pad2(month));
  const filename = `${year}年${month}月${day}日${WEEKDAYS[date.getDay()]}.md`;

  return {
    diaryPath: join(monthDir, filename),
    monthDir,
    templatePath: join(vault.base, vault.diary_dir, vault.template),
    date,
  };
}

function ensureTodayDiary(paths: DiaryPaths): void {
  if (!existsSync(paths.templatePath)) {
    throw new DiaryCliError(
      "TEMPLATE_NOT_FOUND",
      `Diary template not found: ${paths.templatePath}`,
      { templatePath: paths.templatePath },
    );
  }

  mkdirSync(paths.monthDir, { recursive: true });
  copyFileSync(paths.templatePath, paths.diaryPath);
}

function scanTodos(vault: VaultConfig, days: number): TodoItem[] {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const files = listMarkdownFiles(join(vault.base, vault.diary_dir), vault);
  const todos: TodoItem[] = [];

  for (const filePath of files) {
    const stat = statSync(filePath);
    if (stat.mtimeMs < cutoff) continue;

    const lines = readFileSync(filePath, "utf-8").split("\n");
    lines.forEach((line, index) => {
      const match = TODO_PATTERN.exec(line);
      if (!match || match[1] !== " ") return;
      todos.push({
        file: relative(vault.base, filePath),
        line: index + 1,
        content: match[2].trim(),
      });
    });
  }

  return todos;
}

function scanRecent(
  vault: VaultConfig,
  todayPath: string,
  days: number,
  limit: number,
): RecentDiary[] {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const today = resolve(todayPath);
  const files = listMarkdownFiles(join(vault.base, vault.diary_dir), vault)
    .filter((filePath) => resolve(filePath) !== today)
    .map((filePath) => ({ filePath, stat: statSync(filePath) }))
    .filter((item) => item.stat.mtimeMs >= cutoff)
    .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)
    .slice(0, limit);

  return files.map(({ filePath, stat }) => ({
    path: relative(vault.base, filePath),
    modified: stat.mtime.toISOString(),
    preview: readFileSync(filePath, "utf-8").split("\n").slice(0, 30).join("\n"),
  }));
}

function listMarkdownFiles(root: string, vault: VaultConfig): string[] {
  if (!existsSync(root)) return [];

  const files: string[] = [];
  const entries = readdirSync(root, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(root, entry.name);
    if (entry.name.startsWith(".")) continue;
    if (entry.isDirectory()) {
      files.push(...listMarkdownFiles(fullPath, vault));
      continue;
    }
    if (!entry.name.endsWith(".md")) continue;
    if (entry.name.endsWith("模板.md")) continue;
    if (vault.exclude_meta.includes(entry.name)) continue;
    files.push(fullPath);
  }
  return files;
}

function extractOutline(content: string): OutlineItem[] {
  return content.split("\n").flatMap((line, index) => {
    const match = HEADING_PATTERN.exec(line);
    if (!match) return [];
    return [
      {
        line: index + 1,
        level: match[1].length,
        text: match[2].trim(),
      },
    ];
  });
}

function parseDate(value: string | undefined, now = new Date()): Date {
  if (!value) return now;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    throw new DiaryCliError(
      "INVALID_DATE",
      `Date must use YYYY-MM-DD format: ${value}`,
      { date: value },
    );
  }

  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (
    date.getFullYear() !== Number(match[1]) ||
    date.getMonth() !== Number(match[2]) - 1 ||
    date.getDate() !== Number(match[3])
  ) {
    throw new DiaryCliError("INVALID_DATE", `Invalid date: ${value}`, {
      date: value,
    });
  }
  return date;
}

function assertInside(base: string, target: string, code: string): void {
  const resolvedBase = resolve(base);
  const resolvedTarget = resolve(target);
  const rel = relative(resolvedBase, resolvedTarget);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new DiaryCliError(
      code,
      `Resolved path escapes vault base: ${resolvedTarget}`,
      { base: resolvedBase, target: resolvedTarget },
    );
  }
}

function toDateOnly(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}
```

#### 4. packages/obsidian-diary/src/cli.ts

**File**: `packages/obsidian-diary/src/cli.ts`
**Changes**: NEW — shebang CLI entrypoint, argument parser, JSON output, and fail-closed error output

```typescript
#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { DiaryCliError, loadConfig } from "./config.js";
import { buildDiaryContext } from "./diary.js";
import { resolveSessionContext } from "./session.js";
import type {
  DiaryCliJson,
  DiaryContextJson,
  ParsedCliArgs,
  ResolvedVariant,
} from "./types.js";

const HELP = `Usage:
  pi-obsidian-diary --session <id> --variant <work|personal> --json
  pi-obsidian-diary --session-file <path> --variant <work|personal> --json

Options:
  --session <id>       Pi session id to read via SessionManager.listAll()
  --session-file <p>   Session JSONL file for fixtures/debugging
  --variant <variant>  Concrete diary variant: work or personal
  --config <path>      Override config path for fixtures/debugging
  --date <YYYY-MM-DD>  Override diary date for fixtures/debugging
  --json               Emit JSON (the only supported output format)
  -h, --help           Show help
`;

export function parseArgs(argv: string[]): ParsedCliArgs {
  const result: ParsedCliArgs = {
    help: false,
    json: false,
    variant: undefined,
    errors: [],
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      result.help = true;
    } else if (arg === "--json") {
      result.json = true;
    } else if (arg === "--session") {
      result.sessionId = readValue(argv, ++i, arg, result.errors);
    } else if (arg === "--session-file") {
      result.sessionFile = readValue(argv, ++i, arg, result.errors);
    } else if (arg === "--variant") {
      const value = readValue(argv, ++i, arg, result.errors);
      if (value === "work" || value === "personal") {
        result.variant = value;
      } else if (value) {
        result.errors.push(
          `--variant must be work or personal; auto is resolved by the subagent before CLI invocation. Got: ${value}`,
        );
      }
    } else if (arg === "--config") {
      result.configPath = readValue(argv, ++i, arg, result.errors);
    } else if (arg === "--date") {
      result.date = readValue(argv, ++i, arg, result.errors);
    } else {
      result.errors.push(`Unknown argument: ${arg}`);
    }
  }

  if (result.sessionId && result.sessionFile) {
    result.errors.push("Use only one of --session or --session-file.");
  }
  if (!result.sessionId && !result.sessionFile && !result.help) {
    result.errors.push("Pass --session <id> or --session-file <path>.");
  }
  if (!result.variant && !result.help && !hasVariantError(result.errors)) {
    result.errors.push("Pass --variant work or --variant personal.");
  }

  return result;
}

function hasVariantError(errors: string[]): boolean {
  return errors.some((error) => error.startsWith("--variant"));
}

export async function run(argv: string[]): Promise<number> {
  const args = parseArgs(argv);

  if (args.help) {
    console.log(HELP);
    return 0;
  }

  try {
    if (args.errors.length > 0) {
      throw new DiaryCliError("INVALID_ARGS", args.errors.join("\n"), {
        errors: args.errors,
      });
    }

    const variant = requireVariant(args.variant);
    const config = loadConfig(args.configPath);
    const session = await resolveSessionContext({
      sessionId: args.sessionId,
      sessionFile: args.sessionFile,
    });
    const { diary, context } = buildDiaryContext(config, variant, {
      date: args.date,
    });

    const output: DiaryContextJson = {
      schemaVersion: 1,
      ok: true,
      generatedAt: new Date().toISOString(),
      session,
      variant: { resolved: variant },
      diary,
      context,
    };

    writeJson(output, "stdout");
    return 0;
  } catch (error) {
    writeJson(toErrorJson(error), "stderr");
    return 1;
  }
}

function readValue(
  argv: string[],
  index: number,
  flag: string,
  errors: string[],
): string | undefined {
  const value = argv[index];
  if (!value || value.startsWith("--")) {
    errors.push(`Missing value for ${flag}.`);
    return undefined;
  }
  return value;
}

function requireVariant(value: ResolvedVariant | undefined): ResolvedVariant {
  if (!value) {
    throw new DiaryCliError(
      "INVALID_ARGS",
      "Pass --variant work or --variant personal.",
    );
  }
  return value;
}

function toErrorJson(error: unknown): DiaryCliJson {
  if (error instanceof DiaryCliError) {
    return {
      schemaVersion: 1,
      ok: false,
      error: {
        code: error.code,
        message: error.message,
        details: error.details,
      },
    };
  }

  return {
    schemaVersion: 1,
    ok: false,
    error: {
      code: "UNEXPECTED_ERROR",
      message: error instanceof Error ? error.message : String(error),
    },
  };
}

function writeJson(value: DiaryCliJson, stream: "stdout" | "stderr"): void {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  if (stream === "stdout") {
    process.stdout.write(text);
  } else {
    process.stderr.write(text);
  }
}

async function main(): Promise<void> {
  const code = await run(process.argv.slice(2));
  process.exitCode = code;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
```

### Success Criteria

#### Automated Verification

- [ ] TypeScript CLI build passes and emits `dist/cli.js`: `npm --workspace @cnife/pi-obsidian-diary run build`
- [ ] Built CLI has executable bit: `test -x packages/obsidian-diary/dist/cli.js`
- [ ] Help output works without config/session files: `node packages/obsidian-diary/dist/cli.js --help`
- [ ] CLI rejects unresolved auto variant before touching diary config: `node packages/obsidian-diary/dist/cli.js --session-file /tmp/missing.jsonl --variant auto --json >/tmp/diary.out 2>/tmp/diary.err; test $? -ne 0 && grep -q 'auto is resolved by the subagent' /tmp/diary.err`
- [ ] Repository check passes with the new CLI sources: `npm run check`

#### Manual Verification

- [ ] Missing config creates a sample `<PI_CODING_AGENT_DIR>/cnife-obsidian-diary.json`, exits non-zero, and does not create or modify diary files.
- [ ] CLI session loading uses `buildSessionContext()` on parsed JSONL entries rather than raw message scanning.
- [ ] Missing today diary is created only after config, vault base, template path, and session validation succeed.
- [ ] Computed diary path uses numeric `YYYY/MM` directories and a Chinese-date filename.

## Phase 3: CLI Fixture Tests

### Overview

Adds a bash test harness modeled after `tests/sh-guard.test.sh`, using temp pi agent dir, temp vaults, temp config, and temp session JSONL. Depends on Phase 2.

### Changes Required

#### 1. tests/obsidian-diary.test.sh

**File**: `tests/obsidian-diary.test.sh`
**Changes**: NEW — CLI fixture tests for JSON schema, variant override, config/session failures, and no unintended diary writes

````bash
#!/usr/bin/env bash
# =========================================================================
# obsidian-diary CLI test suite
# =========================================================================
#
# Usage:
#   bash tests/obsidian-diary.test.sh
#   bash tests/obsidian-diary.test.sh --verbose
#   bash tests/obsidian-diary.test.sh --list
#   bash tests/obsidian-diary.test.sh <test_name>

set -uo pipefail

CLI="${CLI:-node packages/obsidian-diary/dist/cli.js}"
PASS=0
FAIL=0
VERBOSE=false
LAST_STDOUT=""
LAST_STDERR=""
LAST_EXIT=0
TMP_DIRS=()

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BOLD='\033[1m'; NC='\033[0m'

info()   { printf "${BOLD}%s${NC}\n" "$*"; }
pass()   { printf "  ${GREEN}✓${NC} %s\n" "$*"; ((PASS++)); }
fail()   { printf "  ${RED}✗${NC} %s\n" "$*"; ((FAIL++)); }
skip()   { printf "  ${YELLOW}~${NC} %s\n" "$*"; }
detail() { $VERBOSE && printf "    %s\n" "$*"; }

make_tmp() {
  local dir
  dir=$(mktemp -d) || exit 1
  TMP_DIRS+=("$dir")
  echo "$dir"
}

cleanup() {
  for dir in "${TMP_DIRS[@]}"; do
    rm -rf "$dir"
  done
}
trap cleanup EXIT

run_cli() {
  local agent_dir="$1"
  shift
  local tmp
  tmp=$(make_tmp)
  LAST_STDOUT="$tmp/stdout.json"
  LAST_STDERR="$tmp/stderr.json"

  detail "PI_CODING_AGENT_DIR=$agent_dir $CLI $*"
  PI_CODING_AGENT_DIR="$agent_dir" $CLI "$@" >"$LAST_STDOUT" 2>"$LAST_STDERR"
  LAST_EXIT=$?
  detail "exit: $LAST_EXIT"
  detail "stdout: $(tr '\n' ' ' <"$LAST_STDOUT")"
  detail "stderr: $(tr '\n' ' ' <"$LAST_STDERR")"
}

assert_exit() {
  local expected="$1"
  local name="$2"
  if [ "$LAST_EXIT" -eq "$expected" ]; then
    pass "$name"
  else
    fail "$name — exit $LAST_EXIT, expected $expected"
  fi
}

assert_file_exists() {
  local path="$1"
  local name="$2"
  if [ -f "$path" ]; then
    pass "$name"
  else
    fail "$name — missing file: $path"
  fi
}

assert_no_file() {
  local path="$1"
  local name="$2"
  if [ ! -e "$path" ]; then
    pass "$name"
  else
    fail "$name — unexpected path exists: $path"
  fi
}

assert_contains() {
  local path="$1"
  local expected="$2"
  local name="$3"
  if grep -q "$expected" "$path"; then
    pass "$name"
  else
    fail "$name — missing '$expected' in $path"
  fi
}

assert_jq_equals() {
  local path="$1"
  local filter="$2"
  local expected="$3"
  local name="$4"
  local actual
  actual=$(jq -r "$filter" "$path" 2>/dev/null) || actual=""
  if [ "$actual" = "$expected" ]; then
    pass "$name"
  else
    fail "$name — expected '$expected', got '$actual' using $filter"
  fi
}

check_prereqs() {
  local ok=true

  if ! command -v node &>/dev/null; then
    echo "${RED}node not found${NC}"
    ok=false
  fi

  if ! command -v jq &>/dev/null; then
    echo "${RED}jq not found${NC}"
    ok=false
  fi

  if ! $CLI --help >/dev/null 2>&1; then
    echo "${RED}obsidian diary CLI is not runnable${NC}"
    echo "Run: npm --workspace @cnife/pi-obsidian-diary run build"
    ok=false
  fi

  $ok
}

make_session() {
  local dir="$1"
  local id="$2"
  local file="$dir/$id.jsonl"
  cat >"$file" <<JSONL
{"type":"session","version":3,"id":"$id","timestamp":"2026-06-07T00:00:00.000Z","cwd":"/home/cnife/code/pi-extensions"}
{"type":"message","id":"u1","parentId":null,"timestamp":"2026-06-07T00:00:01.000Z","message":{"role":"user","content":"把 pi-extensions 的 obsidian diary 功能记录一下"}}
{"type":"message","id":"a1","parentId":"u1","timestamp":"2026-06-07T00:00:02.000Z","message":{"role":"assistant","content":"已经完成 CLI 上下文设计。"}}
JSONL
  echo "$file"
}

make_templates() {
  local vault_root="$1"
  mkdir -p "$vault_root/work/工作日志" "$vault_root/personal/个人日记"
  cat >"$vault_root/work/工作日志/日志模板.md" <<'MD'
# 待办事项
```tasks
not done
```
MD
  cat >"$vault_root/personal/个人日记/日记模板.md" <<'MD'
# 待办事项
```tasks
not done
```
MD
}

make_vault_with_recent() {
  local vault_root="$1"
  make_templates "$vault_root"
  mkdir -p "$vault_root/personal/个人日记/2026/06"
  cat >"$vault_root/personal/个人日记/2026/06/2026年6月6日星期六.md" <<'MD'
# 待办事项
- [ ] 补一条旧待办

# Pi 扩展
- 昨天继续整理 pi 扩展思路。
MD
}

write_config() {
  local agent_dir="$1"
  local vault_root="$2"
  mkdir -p "$agent_dir"
  cat >"$agent_dir/cnife-obsidian-diary.json" <<JSON
{
  "vaults": {
    "work": {
      "base": "$vault_root/work",
      "diary_dir": "工作日志",
      "template": "日志模板.md",
      "exclude_meta": ["AGENTS.md", "任务.md", "日志模板.md"]
    },
    "personal": {
      "base": "$vault_root/personal",
      "diary_dir": "个人日记",
      "template": "日记模板.md",
      "exclude_meta": ["AGENTS.md"]
    }
  }
}
JSON
}

personal_today_path() {
  local vault_root="$1"
  echo "$vault_root/personal/个人日记/2026/06/2026年6月7日星期日.md"
}

work_today_path() {
  local vault_root="$1"
  echo "$vault_root/work/工作日志/2026/06/2026年6月7日星期日.md"
}

test_rejects_auto_before_config() {
  info "rejects unresolved auto variant before config/session work"
  local tmp agent_dir
  tmp=$(make_tmp)
  agent_dir="$tmp/agent"

  run_cli "$agent_dir" --session-file "$tmp/missing.jsonl" --variant auto --json

  assert_exit 1 "auto variant exits non-zero"
  assert_contains "$LAST_STDERR" "auto is resolved by the subagent" "stderr explains subagent owns auto"
  assert_no_file "$agent_dir/cnife-obsidian-diary.json" "auto rejection does not create sample config"
  echo ""
}

test_missing_config_creates_sample_and_fails() {
  info "missing config creates sample and fails closed"
  local tmp agent_dir session_file
  tmp=$(make_tmp)
  agent_dir="$tmp/agent"
  session_file=$(make_session "$tmp" "missing-config-session")

  run_cli "$agent_dir" --session-file "$session_file" --variant personal --date 2026-06-07 --json

  assert_exit 1 "missing config exits non-zero"
  assert_file_exists "$agent_dir/cnife-obsidian-diary.json" "sample config created in PI_CODING_AGENT_DIR"
  assert_jq_equals "$LAST_STDERR" ".ok" "false" "error JSON has ok=false"
  assert_jq_equals "$LAST_STDERR" ".error.code" "CONFIG_MISSING" "error code is CONFIG_MISSING"
  echo ""
}

test_personal_json_context() {
  info "personal variant emits JSON context and creates today from template"
  local tmp agent_dir vault_root session_file today
  tmp=$(make_tmp)
  agent_dir="$tmp/agent"
  vault_root="$tmp/vault"
  make_vault_with_recent "$vault_root"
  write_config "$agent_dir" "$vault_root"
  session_file=$(make_session "$tmp" "personal-session")
  today=$(personal_today_path "$vault_root")

  run_cli "$agent_dir" --session-file "$session_file" --variant personal --date 2026-06-07 --json

  assert_exit 0 "personal context exits zero"
  assert_jq_equals "$LAST_STDOUT" ".ok" "true" "success JSON has ok=true"
  assert_jq_equals "$LAST_STDOUT" ".variant.resolved" "personal" "variant resolved is personal"
  assert_jq_equals "$LAST_STDOUT" ".diary.created" "true" "today diary created"
  assert_jq_equals "$LAST_STDOUT" ".context.todos[0].content" "补一条旧待办" "todos collected from recent diary"
  assert_file_exists "$today" "today personal diary exists"
  assert_contains "$today" "# 待办事项" "today diary copied from template"
  assert_contains "$LAST_STDOUT" "个人日记/2026/06/2026年6月7日星期日.md" "JSON path uses numeric YYYY/MM dirs"
  echo ""
}

test_existing_diary_not_overwritten() {
  info "existing diary is read, not overwritten"
  local tmp agent_dir vault_root session_file today
  tmp=$(make_tmp)
  agent_dir="$tmp/agent"
  vault_root="$tmp/vault"
  make_templates "$vault_root"
  write_config "$agent_dir" "$vault_root"
  session_file=$(make_session "$tmp" "existing-diary-session")
  today=$(personal_today_path "$vault_root")
  mkdir -p "$(dirname "$today")"
  cat >"$today" <<'MD'
# 待办事项
```tasks
not done
```

# 已有主题
- 原有内容不能被覆盖。
MD

  run_cli "$agent_dir" --session-file "$session_file" --variant personal --date 2026-06-07 --json

  assert_exit 0 "existing diary context exits zero"
  assert_jq_equals "$LAST_STDOUT" ".diary.created" "false" "existing diary not recreated"
  assert_contains "$today" "原有内容不能被覆盖" "existing diary content preserved"
  assert_contains "$LAST_STDOUT" "原有内容不能被覆盖" "JSON includes full existing diary content"
  echo ""
}

test_invalid_session_does_not_create_diary() {
  info "invalid session fails before diary creation"
  local tmp agent_dir vault_root today
  tmp=$(make_tmp)
  agent_dir="$tmp/agent"
  vault_root="$tmp/vault"
  make_templates "$vault_root"
  write_config "$agent_dir" "$vault_root"
  today=$(personal_today_path "$vault_root")

  run_cli "$agent_dir" --session-file "$tmp/missing.jsonl" --variant personal --date 2026-06-07 --json

  assert_exit 1 "missing session exits non-zero"
  assert_jq_equals "$LAST_STDERR" ".error.code" "SESSION_FILE_NOT_FOUND" "error code is SESSION_FILE_NOT_FOUND"
  assert_no_file "$today" "missing session does not create today diary"
  echo ""
}

test_missing_template_does_not_create_diary() {
  info "missing template fails before diary creation"
  local tmp agent_dir vault_root session_file today
  tmp=$(make_tmp)
  agent_dir="$tmp/agent"
  vault_root="$tmp/vault"
  mkdir -p "$vault_root/personal" "$vault_root/work"
  write_config "$agent_dir" "$vault_root"
  session_file=$(make_session "$tmp" "missing-template-session")
  today=$(personal_today_path "$vault_root")

  run_cli "$agent_dir" --session-file "$session_file" --variant personal --date 2026-06-07 --json

  assert_exit 1 "missing template exits non-zero"
  assert_jq_equals "$LAST_STDERR" ".error.code" "TEMPLATE_NOT_FOUND" "error code is TEMPLATE_NOT_FOUND"
  assert_no_file "$today" "missing template does not create today diary"
  echo ""
}

test_work_variant_path() {
  info "work variant uses work diary path"
  local tmp agent_dir vault_root session_file today
  tmp=$(make_tmp)
  agent_dir="$tmp/agent"
  vault_root="$tmp/vault"
  make_templates "$vault_root"
  write_config "$agent_dir" "$vault_root"
  session_file=$(make_session "$tmp" "work-session")
  today=$(work_today_path "$vault_root")

  run_cli "$agent_dir" --session-file "$session_file" --variant work --date 2026-06-07 --json

  assert_exit 0 "work context exits zero"
  assert_jq_equals "$LAST_STDOUT" ".variant.resolved" "work" "variant resolved is work"
  assert_file_exists "$today" "today work diary exists"
  assert_contains "$LAST_STDOUT" "工作日志/2026/06/2026年6月7日星期日.md" "JSON path uses work diary directory"
  echo ""
}

main() {
  local tests=()
  local list_only=false

  for arg in "$@"; do
    case "$arg" in
      --verbose|-v) VERBOSE=true ;;
      --list|-l) list_only=true ;;
      --help|-h)
        echo "Usage: $0 [--verbose|--list|<test_name>]"
        echo "Tests:"
        declare -F | sed -n 's/^declare -f //p' | grep '^test_' || true
        exit 0
        ;;
      *) tests+=("$arg") ;;
    esac
  done

  if $list_only; then
    echo "Available tests:"
    declare -F | sed -n 's/^declare -f //p' | grep '^test_' | sed 's/^/  /' || true
    exit 0
  fi

  echo "${BOLD}obsidian-diary CLI test suite${NC}"
  echo "CLI: $CLI"
  echo ""

  if ! check_prereqs; then
    exit 1
  fi

  if [ ${#tests[@]} -eq 0 ]; then
    while IFS= read -r fn; do
      "$fn"
    done < <(declare -F | sed -n 's/^declare -f //p' | grep '^test_' || true)
  else
    for name in "${tests[@]}"; do
      if declare -F "test_$name" &>/dev/null; then
        "test_$name"
      else
        echo "${RED}Unknown test: $name${NC}"
        declare -F | sed -n 's/^declare -f //p' | grep '^test_' | sed 's/^/  /' || true
        exit 1
      fi
    done
  fi

  echo "══════════════════════════════════════════"
  printf "${GREEN}%d passed${NC}" "$PASS"; echo -n ", "
  printf "${RED}%d failed${NC}" "$FAIL"; echo ""
  echo "══════════════════════════════════════════"

  [ "$FAIL" -eq 0 ]
}

main "$@"
````

### Success Criteria

#### Automated Verification

- [ ] CLI build still passes before running fixtures: `npm --workspace @cnife/pi-obsidian-diary run build`
- [ ] Fixture test script is syntactically valid: `bash -n tests/obsidian-diary.test.sh`
- [ ] Fixture test harness lists tests: `bash tests/obsidian-diary.test.sh --list`
- [ ] CLI fixture suite passes: `bash tests/obsidian-diary.test.sh`
- [ ] A single fixture can be targeted by name: `bash tests/obsidian-diary.test.sh personal_json_context`
- [ ] Repository check passes with the new bash fixture file: `npm run check`

#### Manual Verification

- [ ] Fixture tests set `PI_CODING_AGENT_DIR` to a temp directory and do not read or write the real pi agent dir.
- [ ] Fixture tests use temp Obsidian vault roots and do not read or write real Obsidian vaults.
- [ ] Failure-path fixtures assert the target today diary file does not exist after CLI failure.

## Phase 4: `/diary` Extension And Subagent Prompt

### Overview

Registers `/diary`, parses the approved argument grammar, starts a clean replacement session, and sends a subagent prompt that invokes the CLI and patches the diary. Depends on Phases 1-3.

### Changes Required

#### 1. packages/obsidian-diary/src/args.ts

**File**: `packages/obsidian-diary/src/args.ts`
**Changes**: NEW — shared parser for `/diary` command arguments

```typescript
import type { ParsedDiaryCommandArgs, Variant } from "./types.js";

export type ParseDiaryCommandArgsResult =
  | { ok: true; value: ParsedDiaryCommandArgs }
  | { ok: false; error: string };

const VARIANT_FLAGS: Record<string, Variant> = {
  "--work": "work",
  "--personal": "personal",
};

export function parseDiaryCommandArgs(
  rawArgs: string,
): ParseDiaryCommandArgsResult {
  const tokens = tokenize(rawArgs);
  let variant: Variant = "auto";
  let sessionId: string | undefined;

  for (const token of tokens) {
    const flagVariant = VARIANT_FLAGS[token];
    if (flagVariant) {
      if (variant !== "auto") {
        return { ok: false, error: "Use at most one variant flag: --work or --personal." };
      }
      variant = flagVariant;
      continue;
    }

    if (token.startsWith("--")) {
      return { ok: false, error: `Unknown /diary option: ${token}` };
    }

    if (sessionId) {
      return {
        ok: false,
        error: "Usage: /diary [--work|--personal] [session-id]",
      };
    }
    sessionId = token;
  }

  return {
    ok: true,
    value: { sessionId, variant },
  };
}

function tokenize(rawArgs: string): string[] {
  const trimmed = rawArgs.trim();
  if (!trimmed) return [];
  return trimmed.split(/\s+/).map(stripWrappingQuotes).filter(Boolean);
}

function stripWrappingQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}
```

#### 2. packages/obsidian-diary/src/prompt.ts

**File**: `packages/obsidian-diary/src/prompt.ts`
**Changes**: NEW — clean-subagent instruction builder with old diary semantic rules and CLI invocation contract

```typescript
import type { ParsedDiaryCommandArgs } from "./types.js";

export type DiaryPromptRequest = ParsedDiaryCommandArgs & {
  sessionId: string;
};

export function buildDiarySubagentPrompt(request: DiaryPromptRequest): string {
  const variantInstruction = buildVariantInstruction(request.variant);
  const command = buildCliCommand(request.sessionId, request.variant);

  return [
    "你是 Obsidian diary subagent。你的任务是把指定 Pi session 记录到 Obsidian 日记，且只在所有确定性检查成功后写入。",
    "",
    "固定边界：",
    "- 不要总结当前这条新 session；只处理下面指定的 source session id。",
    "- 不要询问用户确认；/diary 命令本身就是写入授权。",
    "- 不要在日记正文写 session id marker。重复判断依赖语义内容。",
    "- 不要调用旧 Python helper；必须使用 pi-obsidian-diary CLI。",
    "- CLI 只接受 --variant work 或 --variant personal；auto 必须由你先判断。",
    "",
    `Source session id: ${request.sessionId}`,
    `Variant intent: ${request.variant}`,
    variantInstruction,
    "",
    "先运行 CLI 获取确定性上下文：",
    command,
    "",
    "如果 CLI 退出非 0，或 JSON 的 ok 不是 true：停止，不要编辑任何日记文件；只向用户报告清晰错误。",
    "",
    "写入规则：",
    "1. 从 CLI JSON 的 session.messages 中列出 distinct topics。不要按对话时间流水账。",
    "2. 把相近 topics 聚合成主题域；个人项目、个人开源、学习和投资默认 personal，公司交付、部署运维、正式会议默认 work。",
    "3. 读取 CLI JSON 的 diary.content、outline、context.rules、todos、recent。能塞进已有章节就更新已有章节；没对应章节才新建。",
    "4. 直接 patch diary.path。已有内容语义重复时更新原 bullet，不追加重复 bullet。",
    "5. 失败不写入：如果无法判断安全插入位置、路径异常、内容重复且无需更新，停止并说明。",
    "6. 写完做风格自检：按主题聚合、保留有价值判断、删除 agent 操作噪音、不要写验证轮次/Git 操作/阶段标签。",
    "7. 最后回复用户：记录了哪些主题，更新了哪些待办；如果没有写入，也说明原因。",
  ].join("\n");
}

function buildVariantInstruction(variant: ParsedDiaryCommandArgs["variant"]): string {
  if (variant !== "auto") {
    return `Variant is explicitly ${variant}. Use that variant; do not override it.`;
  }

  return [
    "Variant is auto. Before running the CLI, inspect the source session content and choose exactly one concrete variant:",
    "- work: company projects, production deployment/ops, formal meetings, team deliverables.",
    "- personal: personal tech exploration, learning notes, investments, life, personal open-source or independent repos such as pi-extensions.",
    "After choosing, replace <resolved-variant> in the CLI command with work or personal.",
  ].join("\n");
}

function buildCliCommand(
  sessionId: string,
  variant: ParsedDiaryCommandArgs["variant"],
): string {
  const resolvedVariant = variant === "auto" ? "<resolved-variant>" : variant;
  return `pi-obsidian-diary --session ${shellQuote(sessionId)} --variant ${resolvedVariant} --json`;
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:=@+-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, "'\\''")}'`;
}
```

#### 3. packages/obsidian-diary/extensions/index.ts

**File**: `packages/obsidian-diary/extensions/index.ts`
**Changes**: NEW — extension factory registering `/diary` and launching `newSession({ withSession })`

```typescript
import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { parseDiaryCommandArgs } from "../src/args.js";
import { buildDiarySubagentPrompt } from "../src/prompt.js";

const COMMAND_NAME = "diary";

export default function obsidianDiary(pi: ExtensionAPI): void {
  pi.registerCommand(COMMAND_NAME, {
    description: "Record a Pi session into the Obsidian diary",
    handler: async (args, ctx) => handleDiaryCommand(args, ctx),
  });
}

async function handleDiaryCommand(
  rawArgs: string,
  ctx: ExtensionCommandContext,
): Promise<void> {
  const parsed = parseDiaryCommandArgs(rawArgs ?? "");
  if (!parsed.ok) {
    ctx.ui.notify(parsed.error, "error");
    return;
  }

  const sessionId = parsed.value.sessionId ?? ctx.sessionManager.getSessionId();
  if (!sessionId) {
    ctx.ui.notify("No current session id. Usage: /diary [--work|--personal] [session-id]", "error");
    return;
  }

  const prompt = buildDiarySubagentPrompt({
    ...parsed.value,
    sessionId,
  });

  try {
    await ctx.waitForIdle();
    ctx.ui.notify(`Starting diary subagent for ${sessionId}...`, "info");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ctx.ui.notify(`Diary command failed before session start: ${message}`, "error");
    return;
  }

  try {
    const result = await ctx.newSession({
      withSession: async (freshCtx) => {
        freshCtx.ui.notify("Diary subagent started.", "info");
        await freshCtx.sendUserMessage(prompt);
      },
    });

    if (result.cancelled) {
      console.warn("[obsidian-diary] Diary session cancelled.");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[obsidian-diary] Diary subagent launch failed: ${message}`);
  }
}
```

#### 4. packages/obsidian-diary/README.md

**File**: `packages/obsidian-diary/README.md`
**Changes**: MODIFY — add extension E2E verification and duplicate/failure scenarios

````markdown
## Verification

Build the CLI before testing the extension:

```bash
npm --workspace @cnife/pi-obsidian-diary run build
bash tests/obsidian-diary.test.sh
```

Run the extension in isolation:

```bash
PI_CODING_AGENT_DIR=/tmp/pi-diary-agent \
  pi --no-extensions --no-skills \
  -e packages/obsidian-diary/extensions/index.ts
```

Manual E2E scenarios:

- `/diary --personal` starts a clean diary subagent for the current session.
- `/diary --work <session-id>` starts a clean diary subagent for the explicit session id.
- `/diary` with no variant asks the subagent to choose work or personal before invoking the CLI.
- Missing config reports a clear CLI error and leaves diary files unchanged.
- Re-running `/diary --personal <session-id>` on already-recorded content updates or skips semantically duplicate content instead of appending another copy.
````

### Success Criteria

#### Automated Verification

- [ ] CLI build still passes after adding prompt and arg modules: `npm --workspace @cnife/pi-obsidian-diary run build`
- [ ] CLI fixture suite still passes after adding extension imports: `bash tests/obsidian-diary.test.sh`
- [ ] Repository check passes with extension source: `npm run check`
- [ ] `/diary` command is registered: `rg 'registerCommand\(COMMAND_NAME' packages/obsidian-diary/extensions/index.ts`
- [ ] Extension uses clean-session handoff: `rg 'newSession' packages/obsidian-diary/extensions/index.ts && rg 'withSession' packages/obsidian-diary/extensions/index.ts && rg 'sendUserMessage' packages/obsidian-diary/extensions/index.ts`
- [ ] Prompt states CLI auto resolution contract: `rg 'auto must be resolved by the subagent|auto 必须由你先判断' packages/obsidian-diary/src/prompt.ts`

#### Manual Verification

- [ ] Local extension E2E starts with isolated loading: `PI_CODING_AGENT_DIR=/tmp/pi-diary-agent pi --no-extensions --no-skills -e packages/obsidian-diary/extensions/index.ts`
- [ ] `/diary --personal` launches a clean replacement session and the new session receives the generated diary prompt.
- [ ] `/diary --work <session-id>` passes the explicit session id into the prompt.
- [ ] `/diary` with no variant instructs the subagent to choose work or personal before calling the CLI.
- [ ] Missing config and invalid session E2E paths report clear errors and leave diary files unchanged.
- [ ] Re-running the same session does not append duplicate diary bullets; it updates or skips semantically duplicate content.

## Ordering Constraints

- Phase 1 must run first because all later phases depend on package metadata, TypeScript build configuration, and shared types.
- Phase 2 depends on Phase 1 and must land before CLI fixture tests or extension prompt wiring.
- Phase 3 depends on Phase 2 because it builds and invokes the CLI.
- Phase 4 depends on Phases 1-3 because `/diary` prompt text references the stable CLI contract and E2E should run after CLI fixtures pass.
- No phases are parallelized; each slice is intentionally sequential to keep the generated plan directly implementable.

## Verification Notes

- Verify root workspace picks up the new package and Biome scans it: `npm run check`.
- Verify TypeScript CLI build: `npm --workspace @cnife/pi-obsidian-diary run build`.
- Verify `package-lock.json` is regenerated after package metadata and root devDependency changes: `npm install --package-lock-only`.
- Verify CLI JSON schema with isolated fixture tests: `bash tests/obsidian-diary.test.sh`.
- Verify CLI does not write diary files when config/session/variant/path validation fails.
- Verify CLI creates a missing today diary only from the configured template and only after config/path validation succeeds.
- Verify path layout is `YYYY/MM/YYYY年M月D日星期X.md`, never Chinese date characters in directories.
- Verify explicit `/diary <session-id>` can target non-current sessions through `SessionManager.listAll()`.
- Verify compaction-aware session reconstruction uses `buildSessionContext()` rather than raw message scanning.
- Verify `/diary` post-replacement work stays inside `withSession` and uses fresh `ReplacedSessionContext`.
- Verify E2E with local extension loading: `pi -ne -ns -e packages/obsidian-diary/extensions/index.ts`.
- Verify duplicate-content rerun does not append duplicate diary bullets.
- Verify missing config and invalid session E2E flows report clear errors and leave diary files unchanged.

## Performance Considerations

- `SessionManager.listAll()` can scan all project session directories. Production `/diary` uses it only when the subagent CLI receives `--session <id>`; fixture tests use `--session-file` to avoid global scans.
- Recent diary scanning is bounded by days and limit, mirroring the old helper's small recent-context window.
- Full today content is intentionally included for semantic duplicate detection; this may increase prompt size for large diary files but avoids unsafe partial-context patching.
- Todos/recent scans should skip configured meta/template files to avoid unnecessary reads.

## Migration Notes

- No persisted schema migration.
- Old helper config at `~/.config/cnife-skills/obsidian-diary.json` is not read or migrated.
- New config location is `<getAgentDir()>/cnife-obsidian-diary.json`, affected by `PI_CODING_AGENT_DIR` for isolated tests.
- `package-lock.json` must be regenerated because this plan adds a new workspace package and a TypeScript build dependency.

## Pattern References

- `packages/auto-naming-session/package.json:1-30` — package metadata and pi extension registration.
- `packages/auto-naming-session/extensions/index.ts:27-112` — pi-agent-dir config and validation style.
- `packages/simple-plannotator/extensions/index.ts:50-74` — slash-command lifecycle and user-facing notification pattern.
- `packages/simple-plannotator/extensions/index.ts:200-213` — command argument parsing fragility lesson.
- `tests/sh-guard.test.sh:1-350` — bash CLI harness shape.
- `node_modules/@earendil-works/pi-coding-agent/package.json:5-10` — ESM package and bin-to-dist precedent.
- `node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts:241-250` — `waitForIdle()` and `newSession()` command APIs.
- `node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts:282-289` — fresh replacement-session `sendUserMessage()` API.
- `node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/runner.js:289` — stale context warning after session replacement.
- `node_modules/@earendil-works/pi-coding-agent/dist/core/session-manager.d.ts:120-147` — session info and context builder APIs.
- `/home/cnife/code/skills/knowledge/obsidian-diary/scripts/obsidian-helper.py:76-90` — date/path computation behavior to port.
- `/home/cnife/code/skills/knowledge/obsidian-diary/scripts/obsidian-helper.py:223-371` — deterministic context behavior to port.
- `/home/cnife/code/skills/knowledge/obsidian-diary/SKILL.md:140-199` — semantic topic aggregation and patch rules.
- `/home/cnife/code/skills/knowledge/obsidian-diary/SKILL.md:229-295` — style self-check and noise filtering.

## Developer Context

- Inherited discover decision: beneficiary is CNife personally.
- Inherited discover decision: old diary rules remain the semantic baseline.
- Inherited discover decision: old Python helper is replaced, not reused.
- Inherited discover decision: `/diary` gets current id by default and can accept an explicit session id.
- Inherited discover decision: extension passes id to a clean subagent.
- Inherited discover decision: command trigger authorizes write.
- Inherited discover decision: subagent directly patches diary files.
- Inherited discover decision: duplicate detection is semantic because diary files do not contain session id markers.
- Inherited discover decision: failures leave diary files unchanged.
- Blueprint checkpoint: variant override is included in v1 as `--work|--personal`.
- Blueprint checkpoint: CLI is a single command without subcommands.
- Blueprint checkpoint: `auto` variant is resolved by the clean subagent before CLI invocation; CLI accepts only concrete `work|personal` variants.
- Blueprint checkpoint: CLI JSON includes today diary full content.
- Blueprint checkpoint: TypeScript CLI uses a real build with `dist/cli.js` bin output.
- Blueprint correction: vault config belongs in the pi agent directory, following existing plugin config patterns.
- Blueprint checkpoint: old helper config path is not used as fallback and is not auto-migrated.
- Blueprint checkpoint: four-slice decomposition approved after the config-path correction.

## Plan History

- Phase 1: Package And Build Foundation — approved as generated; revised after variant-owner checkpoint so CLI requires resolved `work|personal` and subagent owns `auto`
- Phase 2: Deterministic CLI Context — approved as generated; reviewer revision applied to suppress duplicate generic variant errors
- Phase 3: CLI Fixture Tests — approved as generated
- Phase 4: `/diary` Extension And Subagent Prompt — approved as generated

## Plan Review (Step 8)

_Independent post-finalization review by artifact-code-reviewer and artifact-coverage-reviewer subagents. Findings triaged at Step 9._

_Coverage reviewer returned no findings; all Verification Notes are covered._

| source | plan-loc | codebase-loc | severity | dimension | finding | recommendation | resolution |
| --- | --- | --- | --- | --- | --- | --- | --- |
| code | Phase 1 §2 (package.json) | <n/a> | blocker | actionability | Build script `"tsc -p tsconfig.json && node -e \"require('node:fs').chmodSync('dist/cli.js', 0o755)\""` uses `require` but `packages/obsidian-diary/package.json` declares `"type": "module"`; reviewer claims Node evaluates `-e` code as ESM, where `require` is undefined and build fails. | Change to `node --input-type=commonjs -e "require('node:fs').chmodSync('dist/cli.js', 0o755)"` or use ESM syntax `node -e "import {chmodSync} from 'node:fs'; chmodSync('dist/cli.js', 0o755)"`. | dismissed: empirically falsified; `node -e "console.log(typeof require)"` inside a temp package with `{"type":"module"}` prints `function`, so current script is valid. |
| code | Phase 4 §3 (extensions/index.ts) | <n/a> | concern | code-quality | `newSession` failure in outer `try/catch` only logs to `console.warn` without notifying the user via `ctx.ui.notify`; after the preceding `waitForIdle` success shows "Starting diary subagent...", a silent `newSession` failure leaves the user with no feedback. | Add a `ctx.ui.notify` error message inside the `newSession` catch block. | dismissed: old `ctx` must not be used after `ctx.newSession`; keeping console-only reporting after replacement preserves the runner stale-context contract, while user-facing notifications happen before replacement or through `freshCtx`. |
| code | Phase 2 §4 (cli.ts) | <n/a> | concern | code-quality | `writeJson` calls `process.stdout.write` / `process.stderr.write` synchronously without waiting for drain or calling `process.exit`; on large JSON payloads the process may exit before the stream flushes, truncating output. | After the `write` call, add drain handling or another explicit flush/exit strategy for the relevant stream. | dismissed: the CLI sets `process.exitCode` and does not call `process.exit()`, allowing Node to drain stdio normally before exit. |
| code | Phase 2 §1 (config.ts) | <n/a> | concern | code-quality | `DiaryCliError` stores `getErrorMessage(error)` as a `details.cause` string property instead of preserving the original error object, losing the original error's stack trace. | Pass the original error in details, e.g. `{ configPath, cause: error }`; optionally add standard `Error` cause support in the constructor. | dismissed: the CLI emits JSON, and serializable string details are more useful to the caller than embedding an Error object that stringifies poorly. |
| code | Phase 2 §4 (cli.ts) | <n/a> | concern | code-quality | `parseArgs` pushes a specific error for `--variant auto` then the post-loop check pushes a second generic `"Pass --variant work or --variant personal."`; the user sees duplicate variant feedback. | Gate the post-loop missing-variant check so it does not add the generic message when a variant-specific error already exists. | applied: added `hasVariantError(result.errors)` and gated the generic missing-variant error so `--variant auto` keeps only the specific subagent-resolution message. |

## References

- `.rpiv/artifacts/research/2026-06-07_22-32-07_obsidian-diary-pi-extension.md`
- `.rpiv/artifacts/discover/2026-06-07_22-03-51_obsidian-diary-pi-extension.md`
- `.rpiv/artifacts/research/2026-06-01_21-46-35_pi-extension-api-patterns.md`
- `.rpiv/artifacts/research/2026-06-03_22-09-51_cache-miss-token-count.md`

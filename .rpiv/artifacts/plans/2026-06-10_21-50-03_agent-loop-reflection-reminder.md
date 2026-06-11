---
date: 2026-06-10T21:50:03+0800
author: CNife
commit: 114c554
branch: feat/obsidian-diary
repository: pi-extensions
topic: "Agent Loop Reflection Reminder"
tags: [plan, implementation, pi-extension, agent-loop, steer, advisor]
status: ready
parent: .rpiv/artifacts/research/2026-06-10_21-21-52_agent-loop-reflection-reminder.md
phase_count: 2
phases:
  - { n: 1, title: Extension Package Implementation }
  - { n: 2, title: Documentation And Workspace Metadata }
unresolved_phase_count: 0
last_updated: 2026-06-11T14:00:21+0800
last_updated_by: 蔡涛
last_updated_note: "简化：单计数器取代双计数器+多字段状态，input 事件取代分支扫描"
---

# Agent Loop Reflection Reminder Implementation Plan

## Overview

Build a new workspace package, `@cnife/pi-agent-loop-reflection`, that watches completed pi agent turns and injects a visible `steer` user message when a run has continued past the configured cadence. The implementation follows the existing event-driven extension package pattern, uses resilient JSON config loading with defaults, and keeps only run-local in-memory cadence state.

The reminder text is Chinese by default and doubles as the marker used to distinguish plugin-injected reminders from ordinary user steering messages. The runtime hook is `turn_end`; each assistant `turn_end` advances effective cadence, and `pi.sendUserMessage(reminderText, { deliverAs: "steer" })` performs visible injection.

## Requirements

- Add a new pi extension workspace package under `packages/agent-loop-reflection/`.
- Register the package through `package.json` with `pi.extensions: ["./extensions"]` and a peer dependency on `@earendil-works/pi-coding-agent`.
- Load JSON config from `<agent-dir>/cnife-agent-loop-reflection.json` with defaults for `enabled`, `thresholdTurns`, `repeatEveryTurns`, and `reminderText`.
- Missing config creates the default file; read, parse, or type failures warn and fall back to defaults where possible.
- Count completed turns from `turn_end`; default first trigger after 10 effective completed turns and repeat every 10 effective completed turns.
- Inject reminders as visible user messages with `steer`, not `followUp`, `context`, or system-prompt-only changes.
- Reminder content must ask the LLM to check original goal, current evidence/direction, and blocked/uncertain/off-track status; conditional `advisor` call is required when appropriate.
- Reset cadence at agent run boundaries and when a non-plugin user message becomes the latest user message.
- Exclude the automatic reflection turn caused by the plugin reminder from repeat cadence.
- Do not add notify, footer status, widget, modal, model allowlist, persistent state, or forced advisor invocation.
- Sync `package-lock.json` after adding the workspace package.

## Current State Analysis

The repository is an npm workspace monorepo, and root `package.json` already includes `"workspaces": ["packages/*"]`, so a new directory under `packages/` is discovered by npm workspace tooling. Existing extension packages use `package.json`, `README.md`, and an `extensions/` entrypoint.

The runtime extension API already exposes all needed hooks. `turn_end` is emitted before `_turnIndex` increments, so a handler should interpret `event.turnIndex + 1` as completed turns. `sendUserMessage()` maps to `prompt()` with `source: "extension"` and the caller's `deliverAs`; while streaming, `prompt()` routes `"steer"` to `_queueSteer()`.

### Key Discoveries

- `packages/AGENTS.md:3-15` defines the package layout and `pi.extensions` registration convention.
- `packages/AGENTS.md:55-61` requires config under `getAgentDir()` with three-level validation and fallback.
- `packages/auto-naming-session/extensions/index.ts:37-115` shows the preferred warn-and-default config loader.
- `packages/cache-hit-rate/extensions/cache-hit-rate.ts:138-163` shows compact module-scope state with a factory initializer.
- `packages/cache-hit-rate/extensions/cache-hit-rate.ts:373-395` rebuilds state on session lifecycle events instead of trusting stale module state.
- `node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js:365-373` emits `turn_end` and increments `_turnIndex` afterward.
- `node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js:717-727` queues `steer` during streaming.
- `node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js:905-917` stores and sends queued steering user messages.
- `node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js:994-1022` maps `sendUserMessage()` to `prompt()` with `source: "extension"`.
- `node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts:564-575` shows `InputEvent` has `source` but not `streamingBehavior` in the installed runtime.
- `node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/runner.js:793-822` constructs input events without `streamingBehavior`.
- `package-lock.json:678-700` stores workspace package link entries under `node_modules/@cnife/...`.
- `package-lock.json:4483-4528` stores package metadata entries under `packages/...`.

## Desired End State

A user can install or locally load the new extension package and let it operate automatically:

```bash
pi install npm:@cnife/pi-agent-loop-reflection
```

```bash
pi --no-extensions --no-skills -e packages/agent-loop-reflection/extensions/index.ts --no-session
```

On first run, the extension creates the default config:

```json
{
  "enabled": true,
  "thresholdTurns": 10,
  "repeatEveryTurns": 10,
  "reminderText": "请先暂停继续推进,做一次 agent loop 反思:\n\n1. 回到用户的原始目标:现在正在做的事是否仍然直接服务于这个目标?\n2. 检查当前证据和方向:已经验证了什么,哪些只是猜测,下一步是否仍然是最小有效动作?\n3. 判断是否卡住、不确定或可能跑偏:如果是,请先调用 `advisor` 获取建议,再继续。\n\n如果一切仍然清晰,请用一两句话说明判断依据,然后继续执行。"
}
```

When a run reaches the configured cadence, the conversation receives a visible user message equivalent to:

```typescript
pi.sendUserMessage(config.reminderText, { deliverAs: "steer" });
```

## What We're NOT Doing

- No footer/status/widget/modal or extra notification on normal reminder triggers.
- No model-specific allowlist or DeepSeek-only behavior; defaults apply to all models.
- No forced `advisor` tool call on every reminder; the reminder text asks the model to call `advisor` conditionally.
- No persistent custom entries for run-local cadence state.
- No reliance on `event.streamingBehavior`, because installed runtime/types do not expose it.
- No source edits outside the new package files and `package-lock.json`.
- No new runtime dependencies beyond the peer dependency on `@earendil-works/pi-coding-agent`.

## Decisions

### Package Name

Ambiguity: the FRD suggested names around `agent-loop-reflection` or `agent-loop-guard`, but the package name becomes both filesystem and npm API surface.

Explored:

- `agent-loop-reflection` - concise and directly tied to the reminder/reflection behavior; fits `packages/<name>/` and `@cnife/pi-<name>` conventions from `packages/AGENTS.md:3-15`.
- `agent-loop-guard` - broader guardrail framing, but less precise for the FRD's reflection-reminder goal.
- `agent-loop-reflection-reminder` - most literal but long for package, config, and install usage.

Decision: use `agent-loop-reflection`, producing `packages/agent-loop-reflection`, `@cnife/pi-agent-loop-reflection`, and `cnife-agent-loop-reflection.json`.

### Default Reminder Language

Ambiguity: the reminder is visible to the LLM and user, and its exact default text also acts as the plugin-injected marker.

Explored:

- Chinese three-step prompt - matches the developer's workflow and FRD wording.
- English three-step prompt - more neutral for English tasks but less aligned with this repository/session.
- Bilingual prompt - maximally explicit but wastes repeated context.

Decision: use Chinese by default, with a concise three-step structure and conditional `advisor` instruction.

### Turn Hook And Count Semantics

Decision: use `turn_end` as the completed-turn boundary. `agent-session.js:365-373` emits `turn_end` with the current `_turnIndex` before incrementing it, so the event belongs to the turn that just completed. The implementation advances effective cadence once per assistant `turn_end` instead of storing an unused raw completed-turn mirror.

### Steer Delivery

Decision: inject via `pi.sendUserMessage(config.reminderText, { deliverAs: "steer" })`. `agent-session.js:994-1022` maps `sendUserMessage()` to `prompt()` with `source: "extension"`; `agent-session.js:717-727` routes streaming `"steer"` into `_queueSteer()`; `agent-session.js:905-917` sends the queued message as a user message.

### User Message Detection And Reflection Exclusion

Decision: detect user messages via `pi.on("input")` filtering on `event.source !== "extension"`. All non-extension inputs (interactive TUI, RPC) are treated as user messages and reset the countdown. After sending an automatic reminder, add 1 to the countdown value to offset the reflection turn that follows.

The `input` event fires synchronously when any message enters `prompt()`, before the agent processes it (`agent-session.js:697-701`). Extension-injected messages carry `source: "extension"` (`agent-session.js:994-1022`); user messages carry `"interactive"` or `"rpc"` (`interactive-mode.js:2118-2124`, `rpc-mode.js:290-296`).

### Config Failure Behavior

Decision: model `packages/auto-naming-session/extensions/index.ts:37-115`: missing file creates defaults; read, parse, and type failures log `console.warn` and use defaults. Only unrecoverable default-file creation failure returns `null`, and the extension then registers a minimal config-error status on `session_start`.

### Lockfile Handling

Decision: include `package-lock.json` in the implementation scope and use `npm install --package-lock-only` during implementation to regenerate exact workspace link/package entries. The plan will show the expected new entry shapes from `package-lock.json:678-700` and `package-lock.json:4483-4528`, but implementation should prefer npm generation over hand-editing the full lockfile.

## Phase 1: Extension Package Implementation

### Overview

Create the new package metadata and complete extension runtime implementation. Foundation phase; Phase 2 depends on it.

### Changes Required

#### 1. packages/agent-loop-reflection/package.json

**File**: packages/agent-loop-reflection/package.json
**Changes**: NEW - workspace package manifest for `@cnife/pi-agent-loop-reflection`

```json
{
  "name": "@cnife/pi-agent-loop-reflection",
  "version": "0.1.0",
  "private": false,
  "keywords": [
    "pi-package"
  ],
  "description": "Inject reflection reminders into long-running pi agent loops",
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

#### 2. packages/agent-loop-reflection/extensions/index.ts

**File**: packages/agent-loop-reflection/extensions/index.ts
**Changes**: NEW - config loader, cadence state, branch helpers, event wiring, and steer injection

```typescript
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  type ExtensionAPI,
  type ExtensionContext,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";

// ──── Config ────────────────────────────────────────────────────

export type AgentLoopReflectionConfig = {
  enabled: boolean;
  thresholdTurns: number;
  repeatEveryTurns: number;
  reminderText: string;
};

const DEFAULT_REMINDER_TEXT = [
  "请先暂停继续推进,做一次 agent loop 反思:",
  "",
  "1. 回到用户的原始目标:现在正在做的事是否仍然直接服务于这个目标?",
  "2. 检查当前证据和方向:已经验证了什么,哪些只是猜测,下一步是否仍然是最小有效动作?",
  "3. 判断是否卡住、不确定或可能跑偏:如果是,请先调用 `advisor` 获取建议,再继续。",
  "",
  "如果一切仍然清晰,请用一两句话说明判断依据,然后继续执行。",
].join("\n");

const DEFAULT_CONFIG: AgentLoopReflectionConfig = {
  enabled: true,
  thresholdTurns: 10,
  repeatEveryTurns: 10,
  reminderText: DEFAULT_REMINDER_TEXT,
};

const CONFIG_PATH = join(getAgentDir(), "cnife-agent-loop-reflection.json");
const STATUS_KEY = "agent-loop-reflection";

function warnConfig(message: string): void {
  console.warn(`[agent-loop-reflection] ${message}`);
}

function saveDefaultConfig(path: string): void {
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(path, `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`, "utf-8");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function loadConfig(): AgentLoopReflectionConfig | null {
  if (!existsSync(CONFIG_PATH)) {
    try {
      saveDefaultConfig(CONFIG_PATH);
    } catch {
      warnConfig("Failed to create default config file");
      return null;
    }
    return { ...DEFAULT_CONFIG };
  }

  let raw: string;
  try {
    raw = readFileSync(CONFIG_PATH, "utf-8");
  } catch {
    warnConfig("Failed to read config file, using defaults");
    return { ...DEFAULT_CONFIG };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    warnConfig("Invalid JSON in config file, using defaults");
    return { ...DEFAULT_CONFIG };
  }

  if (!isRecord(parsed)) {
    warnConfig("Config is not an object, using defaults");
    return { ...DEFAULT_CONFIG };
  }

  if (parsed.enabled !== undefined && typeof parsed.enabled !== "boolean") {
    warnConfig("enabled must be a boolean, using defaults");
    return { ...DEFAULT_CONFIG };
  }

  if (
    parsed.thresholdTurns !== undefined &&
    !isPositiveInteger(parsed.thresholdTurns)
  ) {
    warnConfig("thresholdTurns must be a positive integer, using defaults");
    return { ...DEFAULT_CONFIG };
  }

  if (
    parsed.repeatEveryTurns !== undefined &&
    !isPositiveInteger(parsed.repeatEveryTurns)
  ) {
    warnConfig("repeatEveryTurns must be a positive integer, using defaults");
    return { ...DEFAULT_CONFIG };
  }

  if (
    parsed.reminderText !== undefined &&
    (typeof parsed.reminderText !== "string" ||
      parsed.reminderText.trim().length === 0)
  ) {
    warnConfig("reminderText must be a non-empty string, using defaults");
    return { ...DEFAULT_CONFIG };
  }

  return {
    enabled:
      parsed.enabled !== undefined
        ? (parsed.enabled as boolean)
        : DEFAULT_CONFIG.enabled,
    thresholdTurns:
      parsed.thresholdTurns !== undefined
        ? (parsed.thresholdTurns as number)
        : DEFAULT_CONFIG.thresholdTurns,
    repeatEveryTurns:
      parsed.repeatEveryTurns !== undefined
        ? (parsed.repeatEveryTurns as number)
        : DEFAULT_CONFIG.repeatEveryTurns,
    reminderText:
      parsed.reminderText !== undefined
        ? (parsed.reminderText as string)
        : DEFAULT_CONFIG.reminderText,
  };
}

// ──── State ────────────────────────────────────────────────────

// Single countdown: how many more assistant turns before the next reminder.
let turnsUntilNextReminder = 0;

function resetCadence(value: number): void {
  turnsUntilNextReminder = value;
}

function setConfigErrorStatus(ctx: ExtensionContext): void {
  ctx.ui.setStatus(
    STATUS_KEY,
    ctx.ui.theme.fg("error", "agent-loop-reflection config error"),
  );
}

// ──── Entry Point ──────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  const config = loadConfig();
  if (!config) {
    pi.on("session_start", (_event, ctx) => {
      setConfigErrorStatus(ctx);
    });
    return;
  }

  resetCadence(config.thresholdTurns);

  pi.on("session_start", () => resetCadence(config.thresholdTurns));
  pi.on("session_tree", () => resetCadence(config.thresholdTurns));
  pi.on("session_compact", () => resetCadence(config.thresholdTurns));
  pi.on("agent_start", () => resetCadence(config.thresholdTurns));
  pi.on("agent_end", () => resetCadence(config.thresholdTurns));

  pi.on("input", (event) => {
    if (event.source === "extension") return;
    resetCadence(config.thresholdTurns);
  });

  pi.on("turn_end", (event) => {
    if (!config.enabled) return;
    if (event.message.role !== "assistant") return;

    turnsUntilNextReminder--;

    if (event.message.stopReason !== "toolUse") return;
    if (turnsUntilNextReminder > 0) return;

    pi.sendUserMessage(config.reminderText, { deliverAs: "steer" });
    turnsUntilNextReminder = config.repeatEveryTurns + 1;
  });
}
```

### Success Criteria

#### Automated Verification

- [ ] Package manifest parses as JSON: `node -e 'JSON.parse(require("fs").readFileSync("packages/agent-loop-reflection/package.json", "utf8"))'`
- [ ] New package passes Biome checks: `npx biome check packages/agent-loop-reflection`
- [ ] No branch scanning APIs used: `! rg 'getBranch|findLatestNonPluginUserMessage|syncAnchorFromBranch' packages/agent-loop-reflection/extensions/index.ts`

#### Manual Verification

- [ ] Default config path is `join(getAgentDir(), "cnife-agent-loop-reflection.json")` and the missing-file path writes defaults.
- [ ] Default reminder text includes original-goal, evidence/direction, blocked/uncertain/off-track, and conditional `advisor` checks.
- [ ] Normal trigger path does not call `ctx.ui.notify`, `ctx.ui.setStatus`, `ctx.ui.setWidget`, or modal UI APIs; only unrecoverable config creation failure sets an error status.
- [ ] `turn_end` sends a reminder only when the latest assistant message has `stopReason === "toolUse"`, preserving "if the agent still has another useful continuation" semantics.
- [ ] After a reminder, the countdown resets to `repeatEveryTurns + 1`, offsetting the reflection turn by one countdown decrement.

## Phase 2: Documentation And Workspace Metadata

### Overview

Document install/config/runtime behavior and sync workspace lockfile metadata. Depends on Phase 1.

### Changes Required

#### 1. packages/agent-loop-reflection/README.md

**File**: packages/agent-loop-reflection/README.md
**Changes**: NEW - feature, configuration, install, usage, and verification notes

````markdown
# @cnife/pi-agent-loop-reflection

在长时间运行的 pi agent loop 中自动插入一次可见的反思提醒,要求模型暂停确认目标、证据和阻塞状态;如果它卡住、不确定或可能跑偏,就先调用 `advisor` 再继续。

## 功能

- 以 completed turn 为计数单位,在默认 10 个有效 turn 后触发首次提醒。
- 同一个 agent run 内默认每 10 个有效 turn 再提醒一次。
- 使用 `steer` 作为可见用户消息插入当前 agent 流程。
- 自动提醒后的反思 turn 不计入下一次 repeat cadence。
- 用户手动发送新的非插件消息后重置自动提醒节拍。
- 正常触发时不显示额外 footer、status、widget、modal 或 notify。

## 安装

```bash
pi install npm:@cnife/pi-agent-loop-reflection
```

## 本地测试

```bash
pi --no-extensions --no-skills -e packages/agent-loop-reflection/extensions/index.ts --no-session
```

需要隔离配置时,设置 `PI_CODING_AGENT_DIR`:

```bash
PI_CODING_AGENT_DIR=/tmp/pi-agent-loop-reflection-test \
  pi --no-extensions --no-skills -e packages/agent-loop-reflection/extensions/index.ts --no-session
```

## 配置

配置文件路径为 `<agent-dir>/cnife-agent-loop-reflection.json`。`<agent-dir>` 由 `PI_CODING_AGENT_DIR` 环境变量决定,默认是 `~/.pi/agent`。

首次启动时会自动写入默认配置:

```json
{
  "enabled": true,
  "thresholdTurns": 10,
  "repeatEveryTurns": 10,
  "reminderText": "请先暂停继续推进,做一次 agent loop 反思:\n\n1. 回到用户的原始目标:现在正在做的事是否仍然直接服务于这个目标?\n2. 检查当前证据和方向:已经验证了什么,哪些只是猜测,下一步是否仍然是最小有效动作?\n3. 判断是否卡住、不确定或可能跑偏:如果是,请先调用 `advisor` 获取建议,再继续。\n\n如果一切仍然清晰,请用一两句话说明判断依据,然后继续执行。"
}
```

| 字段 | 默认值 | 说明 |
|------|--------|------|
| `enabled` | `true` | 是否启用自动提醒。 |
| `thresholdTurns` | `10` | 首次提醒前需要完成的有效 turn 数,必须是正整数。 |
| `repeatEveryTurns` | `10` | 后续提醒间隔的有效 turn 数,必须是正整数。 |
| `reminderText` | 中文三步提示 | 插入给模型的可见 `steer` 用户消息,也作为插件自注入消息的识别 marker。 |

缺失配置会自动创建默认文件;读取失败、JSON 非法或字段类型非法时会输出 warning 并使用默认配置。修改配置后需要重启 pi 生效。

## 行为说明

插件在 `turn_end` 事件中递减一个倒计数器。只有当最近一条 assistant message 的 `stopReason` 是 `toolUse` 时，插件才会发送提醒，避免模型已经正常结束时额外开启一轮。

插件通过 `input` 事件监听所有用户消息（包括 mid-stream steer 和新 round 消息），遇到 `source` 不是 `"extension"` 的消息时重置倒计数器。插件自己通过 `sendUserMessage` 发送的消息标记为 `"extension"`，自动跳过。

## 故障排查

| 现象 | 原因 | 处理 |
|------|------|------|
| 启动后没有提醒 | 未达到 `thresholdTurns`,或 agent 已经正常结束,没有下一轮 continuation | 降低阈值做测试,或观察长工具链任务。 |
| 修改配置后没生效 | 配置只在扩展加载时读取 | 重启 pi。 |
| 非法 JSON 后仍然继续运行 | 这是预期行为;插件会 warning 并使用默认配置 | 修正配置后重启。 |
| 用户手动输入与默认提醒完全相同 | 插件用 `reminderText` 作为 marker,完全相同文本会被视作插件消息 | 改写手动输入或自定义 `reminderText`。 |
````

#### 2. package-lock.json:678-700,4483-4528

**File**: package-lock.json
**Changes**: MODIFY - npm-generated workspace link and package entries for the new package

```json
{
  "packages": {
    "node_modules/@cnife/pi-agent-loop-reflection": {
      "resolved": "packages/agent-loop-reflection",
      "link": true
    },
    "packages/agent-loop-reflection": {
      "name": "@cnife/pi-agent-loop-reflection",
      "version": "0.1.0",
      "license": "MIT",
      "peerDependencies": {
        "@earendil-works/pi-coding-agent": "*"
      }
    }
  }
}
```

### Success Criteria

#### Automated Verification

- [ ] Workspace lockfile regenerated: `npm install --package-lock-only`
- [ ] Lockfile contains new workspace link and package entries: `node -e 'const pkgs=require("./package-lock.json").packages; for (const key of ["node_modules/@cnife/pi-agent-loop-reflection","packages/agent-loop-reflection"]) if (!pkgs[key]) throw new Error(key + " missing");'`
- [ ] Root package checks pass: `npm run check`
- [ ] TypeScript project compiles: `npx tsc --noEmit`
- [ ] Normal trigger path has no extra UI calls: `node -e 'const s=require("fs").readFileSync("packages/agent-loop-reflection/extensions/index.ts","utf8"); if (/ctx\.ui\.(notify|setWidget|custom|setFooter|setWorkingMessage|setWorkingVisible|setWorkingIndicator)/.test(s)) throw new Error("extra UI call");'`

#### Manual Verification

- [ ] README documents install, local test command, config path, defaults, behavior, and troubleshooting.
- [ ] With a temporary `PI_CODING_AGENT_DIR`, local extension startup creates `cnife-agent-loop-reflection.json` with defaults.
- [ ] With invalid JSON config, local startup continues and warns instead of crashing.
- [ ] With `thresholdTurns: 2` and `repeatEveryTurns: 2`, a long-running local e2e run shows the first reminder after two effective completed turns.
- [ ] In the same low-threshold e2e run, the automatic reflection response is excluded and the second reminder waits for two additional effective turns.
- [ ] A manual user steer during an active run resets cadence before the next automatic reminder.
- [ ] Trigger visibility is only the inserted user message; no footer/status/widget/modal/notify appears during normal reminders.

## Ordering Constraints

- Phase 1 must run before Phase 2 because README and lockfile describe/register the package created in Phase 1.
- Phase 2 lockfile changes must be generated after the new `packages/agent-loop-reflection/package.json` exists.
- No phases are parallelizable after the two-slice merge requested during the decomposition checkpoint.

## Verification Notes

- Verify TypeScript and Biome across packages: `npm run check`.
- Verify workspace lockfile sync after adding the package: `npm install --package-lock-only` should produce/retain link entries for `@cnife/pi-agent-loop-reflection`.
- Verify local extension startup with default config creation: `PI_CODING_AGENT_DIR=/tmp/pi-agent-loop-reflection-test pi --no-extensions --no-skills -e packages/agent-loop-reflection/extensions/index.ts --no-session`.
- Verify invalid JSON fallback: write invalid JSON to `$PI_CODING_AGENT_DIR/cnife-agent-loop-reflection.json`, restart local load, and confirm startup continues with a warning/default behavior.
- Verify low-threshold e2e behavior with `thresholdTurns: 2` and `repeatEveryTurns: 2`: first reminder appears after two effective completed turns.
- Verify repeat cadence excludes the automatic reflection turn: the next reminder waits for two additional effective turns, not immediately after the reflection response.
- Verify a manual user steer resets cadence: after manual intervention, the `input` event fires with `source: "interactive"` and resets the countdown.
- Verify an RPC user message resets cadence: the `input` event fires with `source: "rpc"` and resets the countdown.
- Verify the plugin's own reminder does not reset cadence: `sendUserMessage` triggers `input` with `source: "extension"`, which the handler skips.
- Verify trigger visibility: normal reminders produce only the visible user message, with no footer/status/widget/modal/notify.

## Precedents & Lessons

- `auto-naming-session` shows the resilient config loader and package shape; follow its fallback behavior instead of disabling on ordinary JSON errors.
- `cache-hit-rate` shows branch-aware state rebuilds and cautions against absolute branch-length assumptions after compaction/tree navigation.
- `simple-plannotator` shows local `sendUserMessage(content, { deliverAs })` usage; this feature uses `steer` instead of its `followUp` path.
- Past new-package changes had CI drift from missing lockfile updates; include `package-lock.json` and validate with npm.
- Prior cache-counting fixes show that session-derived counting should use explicit anchors and deltas instead of raw branch length alone.

## Performance Considerations

The extension stores a single integer and performs no per-turn branch scans. Agent turns are comparatively expensive, and the only per-turn work is a counter decrement and an integer comparison. The extension performs no model calls and does no filesystem work after startup config loading.

## Migration Notes

No persisted schema or user data migration is required. Adding the package changes workspace metadata only; rollback is removing `packages/agent-loop-reflection/` and regenerating `package-lock.json`.

## Pattern References

- `packages/AGENTS.md:3-15` - package structure and `pi.extensions` registration.
- `packages/AGENTS.md:55-61` - config path and fallback policy.
- `packages/auto-naming-session/extensions/index.ts:21-115` - default config, save default file, warn-and-default loader.
- `packages/auto-naming-session/extensions/index.ts:258-285` - default export with config guard and event registration.
- `packages/cache-hit-rate/extensions/cache-hit-rate.ts:138-163` - state type and initializer pattern.
- `packages/cache-hit-rate/extensions/cache-hit-rate.ts:373-405` - lifecycle rebuild plus incremental event handler pattern.
- `packages/simple-plannotator/extensions/index.ts:25-42` - local `sendUserMessage(..., { deliverAs })` precedent.
- `packages/miscs/extensions/exit.ts:1-11` - minimal `input` event pass-through pattern.
- `package-lock.json:678-700` - workspace link entries.
- `package-lock.json:4483-4528` - workspace package metadata entries.

## Developer Context

**Q (discover: Problem Owner): 这个提醒机制主要是为了解决谁在使用 agent loop 时遇到的什么问题?成功时,对那个人来说今天的体验会怎样变好?**
A: 我自己;背景是 deepseek-v4-flash 容易闷头做事、方向错了也不反馈,继续尝试新方向并消耗大量时间和上下文。

**Q (discover: Trigger Unit): 按概念区分后,希望插件用哪个触发点来判断"agent loop 已经跑太久,需要反思"?**
A: 必须以 turn 为标志点;用户想要的是"在两个 turn 中间插入"。

**Q (discover: Trigger Semantics): 那我们把触发语义定为"完成 N 个 turn 后,如果 agent 还要进入下一轮,就在下一轮开始前插入提醒",可以吗?**
A: 按这个语义。

**Q (discover: Delivery Mode): 提醒消息的调度方式是否定为 `steer`,并明确排除 `followUp/context/只改 system prompt`?**
A: 定为 `steer`。

**Q (discover: Model Scope): 这个插件默认应该作用在哪些模型上?**
A: 所有模型。

**Q (discover: Default Threshold): 首次提醒的默认阈值应该是多少个已完成 turn?**
A: 10 个 turn。

**Q (discover: Repeat Cadence): 首次提醒后,如果 agent 继续运行很多 turn,后续应该怎么处理?**
A: 每 10 个 turn 再提醒。

**Q (discover: Advisor Strength): 提醒消息里对 `advisor` 的要求应该有多强?**
A: 条件调用 `advisor`。

**Q (discover: Configuration): 这个插件需要哪些可配置能力?**
A: JSON 配置。

**Q (discover: Reminder Copy Structure): 插入给 LLM 的提醒消息应该采用什么结构?**
A: 三步检查。

**Q (discover: Reset Rules): turn 计数应该在什么时候重置?**
A: agent run 结束时重置;用户手动发送 steer 消息时重置。

**Q (discover: Trigger Visibility): 自动提醒触发时,除了插入那条 steer 用户消息,还需要额外 UI 提示吗?**
A: 只保留用户消息。

**Q (`node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js:365-373`): 自动提醒后的模型反思回复要不要计入下一次提醒的 repeat cadence?**
A: 排除反思 turn。

**Q (`node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/runner.js:793-822`): "用户手动 steer 后重置节拍"需要按 input source 区分 TUI/RPC 吗?**
A: 不用这么复杂。该插件注入的消息都是一样的,只需要检测上一条不是插件注入消息的用户消息,计算当前 turn 距离就好。

**Q (`packages/AGENTS.md:3-15`): 新包会按 `packages/<name>/` + `@cnife/pi-<name>` 约定落地。包名选哪一个?**
A: `agent-loop-reflection`。

**Q: 默认 `reminderText` 会写进 JSON 默认配置并作为插件注入消息的固定 marker。默认提醒文案用哪种语言?**
A: 中文三步提示。

**Q: 设计摘要准备进入分解:新增 `agent-loop-reflection` 扩展包,中文三步 steer 提醒,turn_end 计数,配置 fallback,排除额外 UI。Ready to proceed to decomposition?**
A: Proceed.

**Q: 4 slices for Agent Loop Reflection Reminder. Slice 1: Package And Config Foundation. Slices 2-4: cadence helpers, runtime event wiring, docs/lockfile. Approve decomposition?**
A: 合并下,不需要这么slices。

**Q: 调整为 2 slices:Slice 1 完整扩展包实现(package.json + extensions/index.ts),Slice 2 README + package-lock workspace 同步。这样可以吗?**
A: Approve.

**Micro-checkpoint (Phase 1): Slice 1/2: Extension Package Implementation - `package.json` + `extensions/index.ts`。完整新包实现、配置 loader、有效 turn cadence、`steer` 注入都在这一片。Approve?**
A: Approve. Slice verifier reported Decisions: OK; Cross-slice: OK; Research: OK.

**Micro-checkpoint (Phase 2): Cross-slice: OK. Slice 2/2: Documentation And Workspace Metadata - README + package-lock expected entries + terminal verification criteria. Approve?**
A: Approve. Slice verifier reported Decisions: OK; Cross-slice: OK; Research: OK.

## Plan History

- Phase 1: Extension Package Implementation - approved as generated; Step 8 suggestion applied by removing dead `completedTurns` state
- Phase 2: Documentation And Workspace Metadata - approved as generated

## Plan Review (Step 8)

_Independent post-finalization review by artifact-code-reviewer and artifact-coverage-reviewer subagents. Findings triaged at Step 9._

| source | plan-loc | codebase-loc | severity | dimension | finding | recommendation | resolution |
| --- | --- | --- | --- | --- | --- | --- | --- |
| code | Phase 1 §2 (index.ts) | <n/a> | suggestion | code-quality | `CadenceState.completedTurns` is assigned in the `turn_end` handler but never read by any function; all cadence logic operates on other fields. | Remove `completedTurns` from the `CadenceState` type, `createInitialState`, and the `turn_end` handler assignment to eliminate dead state. | applied: removed the dead `completedTurns` state and updated prose to describe effective cadence advancement per assistant `turn_end`. |

## Follow-ups

### 2026-06-11T14:00:21+0800 — Simplified: single counter + input event

**Driven by**: developer feedback during resume-handoff — "两个计数器为什么" → 简化为一个倒计时计数器。

**Changes**:

- State: 4-field `CadenceState` → single `turnsUntilNextReminder` integer
- User message detection: `findLatestNonPluginUserMessage` + `syncAnchorFromBranch` branch scanning → `pi.on("input")` with `event.source !== "extension"` filter
- Reflection turn exclusion: `pendingReflectionTurnsToSkip` queue → `repeatEveryTurns + 1` offset (extra decrement absorbs the reflection turn)
- Removed entire Branch Helpers section: -60 lines of code
- Simplified `turn_end` handler: 5 sequential guard calls → 3 inline checks + 1 action
- All user messages (steer, new round, RPC) treated identically; plugin-injected messages skipped via `source: "extension"`

## References

- `.rpiv/artifacts/discover/2026-06-10_20-56-11_agent-loop-reflection-reminder.md`
- `.rpiv/artifacts/research/2026-06-10_21-21-52_agent-loop-reflection-reminder.md`
- `.rpiv/artifacts/research/2026-06-01_21-46-35_pi-extension-api-patterns.md`
- `.rpiv/artifacts/research/2026-06-03_22-09-51_cache-miss-token-count.md`
- `.rpiv/artifacts/research/2026-06-07_22-32-07_obsidian-diary-pi-extension.md`
- `packages/AGENTS.md`
- `packages/auto-naming-session/extensions/index.ts`
- `packages/cache-hit-rate/extensions/cache-hit-rate.ts`
- `packages/simple-plannotator/extensions/index.ts`
- `node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts`
- `node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/runner.js`
- `node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js`
- `/home/cnife/.local/lib/node_modules/@earendil-works/pi-coding-agent/docs/extensions.md`
- `/home/cnife/.local/lib/node_modules/@earendil-works/pi-coding-agent/docs/session-format.md`

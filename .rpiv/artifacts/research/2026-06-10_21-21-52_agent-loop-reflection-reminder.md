---
date: 2026-06-10T21:21:52+0800
author: CNife
commit: 114c554
branch: feat/obsidian-diary
repository: pi-extensions
topic: "Agent Loop Reflection Reminder"
tags: [research, codebase, pi-extension, agent-loop, steer, advisor]
status: ready
last_updated: 2026-06-10T21:21:52+0800
last_updated_by: CNife
---

# Research: Agent Loop Reflection Reminder

## Research Question

Create a new pi extension workspace package for an agent-loop reflection reminder. The extension should count completed agent turns, inject a visible `steer` user message after the configured threshold, repeat on the configured cadence, ask the LLM to reflect on goal/evidence/blockers, and conditionally call `advisor` when stuck, uncertain, or possibly off-track. This research validates the exact runtime hook, turn-count semantics, steer delivery path, state boundary, config pattern, and existing package precedents for the behavior described in `.rpiv/artifacts/discover/2026-06-10_20-56-11_agent-loop-reflection-reminder.md`.

## Summary

The correct runtime surface is an event-driven extension using `turn_end`, `agent_start`, `agent_end`, and session branch inspection. `turn_end` is the right observation point for completed turns because `AgentSession` emits `turn_end` with the current zero-based `_turnIndex` before incrementing it (`node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js:365-373`), so `completedTurns = event.turnIndex + 1`.

Visible reminder injection should use `pi.sendUserMessage(reminderText, { deliverAs: "steer" })`. The public API supports this (`node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts:837-843`), and runtime maps it to `prompt(..., { streamingBehavior: "steer", source: "extension" })` (`node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js:994-1022`). When called from a `turn_end` handler the agent is still streaming, so `prompt()` queues through `_queueSteer()` rather than starting a separate run (`node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js:682-727`, `node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js:905-917`).

The key product decision from checkpoint is that the auto-reflection turn must not count toward the repeat cadence. The planner should treat the fixed plugin-injected reminder message as a marker and compute reminder distance from the most recent non-plugin-injected user message, rather than relying on `InputEvent.streamingBehavior`. Runtime `InputEvent` only includes `source`; the docs mention `event.streamingBehavior`, but `runner.js` does not attach it (`node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/runner.js:793-822`, `/home/cnife/.local/lib/node_modules/@earendil-works/pi-coding-agent/docs/extensions.md:837-844`).

Config should model `auto-naming-session` rather than `cache-hit-rate`: missing config creates defaults; read/parse/type failures warn and fall back to defaults instead of disabling the extension (`packages/AGENTS.md:55-61`, `packages/auto-naming-session/extensions/index.ts:37-115`, `packages/cache-hit-rate/extensions/cache-hit-rate.ts:73-128`). New package work must also include lockfile regeneration because this repo has repeated historical CI failures from package metadata and lockfile drift.

## Detailed Findings

### Turn Lifecycle And Completed-Turn Semantics

- `AgentSession` stores `_turnIndex` as an in-memory counter initialized to `0` (`node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js:88`).
- On every `agent_start`, `_turnIndex` is reset to `0` before the extension sees the `agent_start` event (`node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js:350-352`). This matches the FRD requirement that cadence resets per agent run.
- `turn_start` emits the current `_turnIndex` but does not increment it (`node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js:357-363`). This is not the right place to check “N completed turns” because the turn has not completed yet.
- `turn_end` emits `turnIndex: this._turnIndex`, awaits all extension handlers, and only then increments `_turnIndex` (`node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js:365-373`). Therefore the event's zero-based index belongs to the turn that just completed.
- The correct raw conversion is `completedTurns = event.turnIndex + 1`. For `thresholdTurns: 2`, the eligible `turn_end` event is `turnIndex: 1`.

### Steer Delivery Path

- `ExtensionAPI.sendUserMessage()` is typed as a user-message API that always triggers a turn and accepts `deliverAs: "steer" | "followUp"` (`node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts:837-843`).
- Runtime `sendUserMessage()` normalizes text/image content and calls `this.prompt()` with `expandPromptTemplates: false`, `streamingBehavior: options?.deliverAs`, and `source: "extension"` (`node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js:994-1022`).
- `prompt()` emits the `input` event before template expansion and queueing, defaulting source to `"interactive"` unless the caller supplies another source (`node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js:697-701`).
- If `this.isStreaming` is true, `prompt()` requires `streamingBehavior` and routes `"steer"` into `_queueSteer()` (`node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js:717-727`). A `turn_end` handler runs before the agent run has finished, so this path queues into the active run instead of spawning a separate prompt flow.
- `_queueSteer()` pushes text into the session-side `_steeringMessages` display queue and calls `this.agent.steer()` with a user message (`node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js:905-917`).

### Input Event Mismatch

- Installed types define `InputEvent` with `text`, optional `images`, and `source` only (`node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts:564-575`).
- Runtime `ExtensionRunner.emitInput()` constructs exactly `{ type: "input", text, images, source }` (`node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/runner.js:793-822`). No runtime field for `streamingBehavior` is attached.
- Pi docs currently show `event.streamingBehavior` in the input-event example (`/home/cnife/.local/lib/node_modules/@earendil-works/pi-coding-agent/docs/extensions.md:837-844`). This is a documentation/runtime mismatch in the installed version.
- Interactive mid-stream input uses `session.prompt(text, { streamingBehavior: "steer" })` and relies on the default source `"interactive"` (`node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/interactive-mode.js:2118-2124`). RPC input passes `source: "rpc"` plus the command's `streamingBehavior` (`node_modules/@earendil-works/pi-coding-agent/dist/modes/rpc/rpc-mode.js:290-296`).
- Because the product decision now keys cadence from the most recent non-plugin user message, implementation does not need to depend on the missing `event.streamingBehavior` field.

### Reminder Cadence And Self-Triggered Turns

- A `steer` reminder inserted by the extension is still a visible user message and will cause the agent to continue, producing another turn. Runtime does not tag that downstream turn as “extension-created” beyond the original `input` source at injection time.
- If reminder cadence counted all turns mechanically, an automatic reflection reply would consume one repeat slot. The developer checkpoint rejected that behavior: the repeat distance must exclude the automatic reflection turn.
- The stable discriminator available at planning time is content identity: the plugin-injected reminder text is fixed by configuration. The planner should treat a previous user message matching the plugin reminder as plugin-injected and compute distance from the previous non-plugin user message. This matches the developer instruction and avoids overfitting to `interactive` vs `rpc` source.
- Fixed-text matching is compatible with the session-side queue, but repeated identical messages are inherently less precise than an explicit entry marker. `_queueSteer()` stores only text strings in `_steeringMessages` (`node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js:905-917`), and `_handleAgentEvent()` removes delivered steering messages by `indexOf(messageText)` before extension events are emitted (`node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js:239-261`).

### State Boundary

- `AgentStartEvent` carries only `{ type: "agent_start" }`; `AgentEndEvent` carries `messages` but no `sessionId` (`node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts:480-487`).
- `TurnStartEvent` and `TurnEndEvent` carry the runtime `turnIndex` needed for run-local counting (`node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts:488-500`).
- Extension handlers receive an `ExtensionContext`; the context exposes `sessionManager` and `isIdle()` (`node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js:1748-1764`). For simple per-run state, module-scope state is enough because cadence is meant to reset on `agent_end`.
- `auto-naming-session` demonstrates module-scope state initialized in `session_start` and used in `agent_end` (`packages/auto-naming-session/extensions/index.ts:258-285`). It persists only cross-run metadata via `pi.appendEntry()` later in the handler, not transient event counters.
- For this extension, durable persistence is unnecessary unless implementation later decides to survive hot reload mid-run. The FRD requires reset at run end, not cross-process recovery.

### Config And Package Convention

- New extension packages should follow `packages/<name>/package.json`, `README.md`, and `extensions/<name>.ts` (`packages/AGENTS.md:3-15`).
- Package registration uses `"pi": { "extensions": ["./extensions"] }` in the package manifest (`packages/AGENTS.md:13-16`).
- Config path convention is `join(getAgentDir(), "cnife-<name>.json")` (`packages/AGENTS.md:55-59`).
- The repository-level convention says three-level validation and failure fallback: file I/O, JSON parse, type check; missing file creates defaults; failures warn and use defaults (`packages/AGENTS.md:55-61`).
- `auto-naming-session` implements the resilient fallback model for read/parse/type errors and merges partial config over defaults (`packages/auto-naming-session/extensions/index.ts:37-115`).
- `cache-hit-rate` returns `null` on read/parse/type/validation failures and then short-circuits all functional handlers (`packages/cache-hit-rate/extensions/cache-hit-rate.ts:73-128`, `packages/cache-hit-rate/extensions/cache-hit-rate.ts:358-405`). This is the pattern to avoid for this FRD.

## Code References

- `.rpiv/artifacts/discover/2026-06-10_20-56-11_agent-loop-reflection-reminder.md:1` — Source FRD with goals, non-goals, decisions, and acceptance criteria.
- `packages/AGENTS.md:3-15` — New extension package layout and `pi.extensions` registration convention.
- `packages/AGENTS.md:33-45` — Extension API surface list including event handlers, `appendEntry`, and branch access.
- `packages/AGENTS.md:55-69` — Config path, fallback rule, formatting, and local testing command.
- `packages/auto-naming-session/extensions/index.ts:21-37` — Default config and `getAgentDir()` config path template.
- `packages/auto-naming-session/extensions/index.ts:37-115` — Resilient config loader with warn-and-default behavior.
- `packages/auto-naming-session/extensions/index.ts:258-285` — Extension entrypoint using `session_start` and `agent_end` with module-scope state.
- `packages/cache-hit-rate/extensions/cache-hit-rate.ts:73-128` — Fragile config loader returning `null` for parse/type errors.
- `packages/cache-hit-rate/extensions/cache-hit-rate.ts:358-405` — `null` config disables functional handlers after setting an error status.
- `node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts:480-500` — `agent_start`, `agent_end`, `turn_start`, and `turn_end` event shapes.
- `node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts:564-575` — `InputEvent` type contains `source` but not `streamingBehavior`.
- `node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts:837-843` — `sendUserMessage()` public API with `deliverAs: "steer" | "followUp"`.
- `node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/runner.js:793-822` — Runtime `InputEvent` construction; no `streamingBehavior` field.
- `node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js:88` — `_turnIndex` initialization.
- `node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js:348-374` — Runtime mapping of agent events to extension events and `turn_end` increment order.
- `node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js:682-727` — `prompt()` input handling and streaming queue branch.
- `node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js:905-917` — `_queueSteer()` session display queue plus agent steering queue call.
- `node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js:994-1022` — `sendUserMessage()` mapping to `prompt()` with `source: "extension"`.
- `node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/interactive-mode.js:2118-2124` — Interactive mid-stream user input queues as `steer`.
- `node_modules/@earendil-works/pi-coding-agent/dist/modes/rpc/rpc-mode.js:290-296` — RPC prompt passes `source: "rpc"` and `streamingBehavior`.
- `/home/cnife/.local/lib/node_modules/@earendil-works/pi-coding-agent/docs/extensions.md:837-844` — Docs currently mention `event.streamingBehavior`, diverging from runtime/types.

## Integration Points

### Inbound References

- `node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js:348-374` — Converts core agent lifecycle events into extension events consumed by `pi.on("agent_start")`, `pi.on("turn_end")`, and `pi.on("agent_end")`.
- `node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/runner.js:793-822` — Dispatches `input` handlers, allowing the extension to observe prompt text and source before prompt/template expansion.
- `node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/interactive-mode.js:2118-2124` — TUI mid-stream text becomes a steer prompt.
- `node_modules/@earendil-works/pi-coding-agent/dist/modes/rpc/rpc-mode.js:290-296` — RPC prompt source and streaming behavior enter the same `prompt()` path.
- `packages/AGENTS.md:37` — Repository guidance explicitly lists `session_start`, `turn_end`, `message_end`, and `input` as event registration points.

### Outbound Dependencies

- `node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts:837-843` — Public API dependency for visible user-message injection.
- `node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js:994-1022` — Runtime dependency for `sendUserMessage(..., { deliverAs: "steer" })` mapping to active-run steering.
- `node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js:905-917` — Runtime dependency for the actual steer queue insertion.
- `packages/AGENTS.md:55-61` — Config dependency on `getAgentDir()` and JSON fallback behavior.
- `packages/auto-naming-session/extensions/index.ts:37-115` — Local template for resilient config parsing and partial defaults.

### Infrastructure Wiring

- `packages/AGENTS.md:3-15` — The package must be under `packages/<name>/` with an `extensions/` entrypoint.
- `packages/AGENTS.md:47-52` — The package should use a peer dependency on `@earendil-works/pi-coding-agent`.
- `package.json:4-6` — Root npm workspace includes `packages/*`, so a new package under `packages/` is picked up by workspace tooling.
- `package.json:7` — `npm run check` runs `npx biome check ./packages`, so the new package must satisfy repository formatting/lint rules.

## Architecture Insights

- `turn_end` is appropriate for this feature because the product requirement is explicitly based on completed agent turns. The auto-naming precedent shows `turn_end` can be wrong when the feature really wants run-level semantics, but here the user intentionally chose turn-level semantics.
- `completedTurns = event.turnIndex + 1` is the only safe interpretation of `turn_end` for threshold logic because `_turnIndex` increments after extension handlers complete.
- `steer` delivery is correct for “before the next useful model continuation”; `followUp` is intentionally too late because it waits until steering/tool quiescence.
- The runtime has no durable marker linking an assistant response back to an extension-injected `sendUserMessage`. With the current product decision, planner should reason from session messages and the fixed plugin reminder text, not from `event.streamingBehavior`.
- The fixed reminder text can act as a practical marker, but it creates one known edge case: if a user manually types exactly the configured reminder text, content-based detection would classify it as plugin-injected. This is a low-probability test/UX caveat rather than a current open product question.
- Config resilience matters more here than UI error signaling. Normal trigger must produce no notify/footer/widget; invalid config should warn and keep defaults.
- Per-run counters do not need persistence. `pi.appendEntry()` is for durable metadata; the FRD wants cadence reset on run end.

## Precedents & Lessons

5 similar past changes analyzed.

### Precedent: auto-naming-session event-driven extension

**Commit(s)**: `f5e90bd` — "实现 auto-naming-session 扩展" (2026-06-01); `c48b635` — "auto-naming-session: 优化触发时机和 prompt，首次消息立即生成标题" (2026-06-04); `fd52eef` — "抽取 STATUS_KEY 常量和 config 错误状态函数" (2026-06-01)

**Blast radius**: 1-3 files across extension code and rpiv artifacts.

**Follow-up fixes**:

- `fd52eef` — Extracted config error status helpers after review.
- `c48b635` — Switched an earlier `turn_end` choice to `agent_end` + `message_end` because auto naming wanted a different lifecycle boundary.

**Lessons from docs**:

- `.rpiv/artifacts/discover/2026-06-04_21-42-53_auto-naming-optimization.md`
- `.rpiv/artifacts/reviews/2026-06-01_23-10-00_auto-naming-session-code-review.md`
- `.rpiv/artifacts/plans/2026-06-01_21-59-51_auto-naming-session.md`
- `.rpiv/artifacts/research/2026-06-01_21-46-35_pi-extension-api-patterns.md`

**Takeaway**: Hook choice must match product semantics. `turn_end` was wrong for auto naming, but is appropriate here because the requirement is explicitly turn-based.

### Precedent: cache-hit-rate state counting fixes

**Commit(s)**: `7c026c7` — "新增缓存命中率扩展" (2026-05-30); `27f9ee9` — "三均线指标体系：重写cache-hit-rate插件" (2026-05-30); `3984b07` — "修复缓存失效计算：跨轮边界基线替代逐消息对比" (2026-06-04); `a970b9e` — "修复Q1: message_end 用户计数改用 delta 避免 compaction 后误触发轮边界" (2026-06-04)

**Blast radius**: 2-3 files across extension state and README.

**Follow-up fixes**:

- `3984b07` — Replaced fragile per-message cache comparison with cross-turn baseline logic.
- `a970b9e` — Fixed branch-length/user-count assumptions after compaction by using delta counting.

**Lessons from docs**:

- `.rpiv/artifacts/discover/2026-06-03_21-46-17_cache-miss-token-count.md`
- `.rpiv/artifacts/reviews/2026-06-04_11-05-31_fix-cache-miss-turn-boundary.md`
- `.rpiv/artifacts/research/2026-06-03_22-09-51_cache-miss-token-count.md`

**Takeaway**: Avoid absolute branch-length assumptions when deriving state from session entries. Count from an explicit checkpoint or local run state.

### Precedent: simple-plannotator sendUserMessage delivery

**Commit(s)**: `e0d5e2e` — "拆分为 monorepo：4 个独立 npm 包" (2026-05-28); `918532f` — "simple-plannotator: 去掉 @ 前缀，修复 /pna 命令路径解析" (2026-05-29)

**Blast radius**: 1 file across extension code.

**Follow-up fixes**:

- `b746846` — Quote stripping bug in path parsing.
- `fff9d0a` — Missing `~` expansion for home directory.
- `d4cce41` — Handler variable typo.
- `918532f` — `@` prefix handling broke absolute path detection.

**Lessons from docs**:

- `.rpiv/artifacts/research/2026-06-07_22-32-07_obsidian-diary-pi-extension.md`

**Takeaway**: `sendUserMessage(content, { deliverAs })` is already a known local API pattern. This feature should use `steer`, not the `followUp` variant used for deferred feedback.

### Precedent: monorepo new-package metadata

**Commit(s)**: `e0d5e2e` — "拆分为 monorepo" (2026-05-28); `66e0bb4` — "修复CI：重建lockfile包含cache-hit-rate" (2026-05-30); `c299280` — "修复package.json非法JSON导致npm ci失败" (2026-06-01); `b1ab3e9` — "pre-commit增加JSON校验和lockfile同步" (2026-06-04)

**Blast radius**: 25 files across root config, package manifests, lockfile, and individual packages.

**Follow-up fixes**:

- `66e0bb4` — New package was missing from lockfile.
- `c299280` — Invalid `package.json` broke `npm ci`.
- `b1ab3e9` — Added pre-commit JSON/lockfile validation after repeated failures.
- `7a8ce39` — Lockfile sync needed another follow-up.

**Lessons from docs**:

- `.rpiv/artifacts/reviews/2026-06-01_23-10-00_auto-naming-session-code-review.md`

**Takeaway**: New extension package implementation must update `package-lock.json` and validate `package.json` syntax.

### Precedent: execute-python failure UX

**Commit(s)**: `ebbde39` — "executePython: 修复错误展示，添加提示词和bash钩子" (2026-06-05)

**Blast radius**: 2 files across extension code and README.

**Follow-up fixes**:

- None identified.

**Lessons from docs**:

- `.rpiv/artifacts/plans/2026-06-04_23-24-52_executePython-tool-improvements.md`
- `.rpiv/artifacts/validation/2026-06-05_00-35-40_validation-of-executePython-tool-improvements.md`

**Takeaway**: Failure modes should be visible enough to diagnose, but normal operation should avoid extra UI noise. For this feature, config warnings belong in logs/default fallback; reminder triggers should only insert the visible user message.

### Composite Lessons

- Event hook choice is load-bearing; validate lifecycle facts against runtime code before implementing. Relevant commits: `c48b635`, `f5e90bd`.
- Session-derived counting is fragile around compaction and branch changes; prefer explicit run-local counters or anchored branch scans. Relevant commits: `3984b07`, `a970b9e`.
- New package work must include lockfile/package metadata validation. Relevant commits: `66e0bb4`, `c299280`, `b1ab3e9`.
- Config failure should degrade to defaults with a warning whenever possible. Local template: `packages/auto-naming-session/extensions/index.ts:37-115`.

## Historical Context (from `.rpiv/artifacts/`)

- `.rpiv/artifacts/discover/2026-06-10_20-56-11_agent-loop-reflection-reminder.md` — Source FRD for this feature.
- `.rpiv/artifacts/research/2026-06-01_21-46-35_pi-extension-api-patterns.md` — Earlier pi extension API research.
- `.rpiv/artifacts/plans/2026-06-01_21-59-51_auto-naming-session.md` — Auto-naming implementation plan.
- `.rpiv/artifacts/reviews/2026-06-01_23-10-00_auto-naming-session-code-review.md` — Auto-naming review and package lessons.
- `.rpiv/artifacts/discover/2026-06-04_21-42-53_auto-naming-optimization.md` — Auto-naming trigger timing reconsideration.
- `.rpiv/artifacts/discover/2026-06-03_21-46-17_cache-miss-token-count.md` — Cache hit/miss counting requirements.
- `.rpiv/artifacts/research/2026-06-03_22-09-51_cache-miss-token-count.md` — Cache state and turn-boundary research.
- `.rpiv/artifacts/reviews/2026-06-04_11-05-31_fix-cache-miss-turn-boundary.md` — Review of cache turn-boundary fix.
- `.rpiv/artifacts/research/2026-06-07_22-32-07_obsidian-diary-pi-extension.md` — Recent extension API and `sendUserMessage` context.
- `.rpiv/artifacts/plans/2026-06-04_23-24-52_executePython-tool-improvements.md` — Extension failure UX precedent.
- `.rpiv/artifacts/validation/2026-06-05_00-35-40_validation-of-executePython-tool-improvements.md` — Validation precedent for visible error handling.

## Developer Context

**Q (discover: Problem Owner): 这个提醒机制主要是为了解决谁在使用 agent loop 时遇到的什么问题？成功时，对那个人来说今天的体验会怎样变好？**
A: 我自己；背景是 deepseek-v4-flash 容易闷头做事、方向错了也不反馈，继续尝试新方向并消耗大量时间和上下文。

**Q (discover: Trigger Unit): 按概念区分后，希望插件用哪个触发点来判断“agent loop 已经跑太久，需要反思”？**
A: 必须以 turn 为标志点；用户想要的是“在两个 turn 中间插入”。

**Q (discover: Trigger Semantics): 那我们把触发语义定为“完成 N 个 turn 后，如果 agent 还要进入下一轮，就在下一轮开始前插入提醒”，可以吗？**
A: 按这个语义。

**Q (discover: Delivery Mode): 提醒消息的调度方式是否定为 `steer`，并明确排除 `followUp/context/只改 system prompt`？**
A: 定为 `steer`。

**Q (discover: Model Scope): 这个插件默认应该作用在哪些模型上？**
A: 所有模型。

**Q (discover: Default Threshold): 首次提醒的默认阈值应该是多少个已完成 turn？**
A: 10 个 turn。

**Q (discover: Repeat Cadence): 首次提醒后，如果 agent 继续运行很多 turn，后续应该怎么处理？**
A: 每 10 个 turn 再提醒。

**Q (discover: Advisor Strength): 提醒消息里对 `advisor` 的要求应该有多强？**
A: 条件调用 `advisor`。

**Q (discover: Configuration): 这个插件需要哪些可配置能力？**
A: JSON 配置。

**Q (discover: Reminder Copy Structure): 插入给 LLM 的提醒消息应该采用什么结构？**
A: 三步检查。

**Q (discover: Reset Rules): turn 计数应该在什么时候重置？**
A: agent run 结束时重置；用户手动发送 steer 消息时重置。

**Q (discover: Trigger Visibility): 自动提醒触发时，除了插入那条 steer 用户消息，还需要额外 UI 提示吗？**
A: 只保留用户消息。

**Q (`node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js:365-373`): 自动提醒后的模型反思回复要不要计入下一次提醒的 repeat cadence？**
A: 排除反思 turn。

**Q (`node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/runner.js:793-822`): “用户手动 steer 后重置节拍”需要按 input source 区分 TUI/RPC 吗？**
A: 不用这么复杂。该插件注入的消息都是一样的，只需要检测上一条不是插件注入消息的用户消息，计算当前 turn 距离就好。

## Related Research

- `.rpiv/artifacts/research/2026-06-01_21-46-35_pi-extension-api-patterns.md`
- `.rpiv/artifacts/research/2026-06-03_22-09-51_cache-miss-token-count.md`
- `.rpiv/artifacts/research/2026-06-07_22-32-07_obsidian-diary-pi-extension.md`

## Open Questions

None. Implementation must still verify the final cadence behavior with a low-threshold local e2e test, especially that an automatic reflection response is excluded from repeat cadence.

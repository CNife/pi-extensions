---
date: 2026-06-10T20:56:11+0800
author: CNife
commit: 114c554
branch: feat/obsidian-diary
repository: pi-extensions
topic: "Agent Loop Reflection Reminder"
tags: [intent, frd, pi-extension, agent-loop, advisor]
status: ready
last_updated: 2026-06-10T20:56:11+0800
last_updated_by: CNife
---

# FRD: Agent Loop Reflection Reminder

## Summary

构建一个 pi 扩展：当 agent loop 已经完成默认 10 个 turn 且还要继续运行时，自动插入一条可见的 `steer` 用户消息，要求 LLM 暂停并做三步反思；如果它不确定、遇到困难或判断自己可能跑偏，则调用 `advisor` 工具咨询。这个插件面向个人日常使用，但默认作用于所有模型，作为 agent 层的通用约束机制。

## Problem & Intent

用户选择的首要受益者是：“我自己”。

用户补充的背景原话：

> 我喜欢用 deepseek-v4-flash，但它存在喜欢自己闷头做事的问题，预想的方向有问题之后也不反馈，自顾自地尝试新的方向，花费了大量的时间和上下文我想在agent层面尝试更多地约束它

原始功能描述：希望做一个插件，在 LLM 的 agent loop 执行一定次数还没有结束时，额外插入一条消息，提醒 LLM 反思是不是跑偏了；如果遇到了困难，就调用 `advisor` 工具寻求咨询。

## Goals

- 在 agent 层检测长时间未结束的 agent loop，而不是依赖模型自觉停下来。
- 默认对所有模型生效，解决 deepseek-v4-flash 这类“闷头做事、不反馈方向问题”的体验，但不把插件做成 DeepSeek 专用补丁。
- 默认每完成 10 个 turn 后，如果 agent 仍要继续下一轮，就插入一次提醒；同一个 agent run 内每 10 个 turn 重复一次。
- 提醒消息使用 `steer` 调度，尽量进入当前 agent 流程，而不是等流程结束后再追加。
- 提醒内容要求 LLM 做三步检查：原始目标、当前证据/方向、是否卡住；遇到不确定或困难时调用 `advisor`。
- 提供 JSON 配置，允许后续调整启用开关、turn 阈值、重复间隔和提醒文案。
- 用户手动发送 steer 消息后，重置自动提醒节拍，避免用户刚介入后插件立刻再次插话。

## Non-Goals

- 不只通过修改 system prompt 实现；静态系统提示不能满足按 turn 次数动态触发的需求。
- 不使用 `context` 静默注入作为产品语义；用户希望提醒是可见的用户消息。
- 不使用 `followUp` 作为提醒调度；它会等 agent 没有更多工具调用或 steering 消息后才送达，对“闷头自转”太晚。
- 不强制每次提醒都调用 `advisor`；`advisor` 是遇到困难、不确定或疑似跑偏时的条件动作。
- 不增加额外 notify、footer/status 或 widget；触发时只保留插入的可见用户消息。
- 不把 turn 数跨 agent run 累计到整个会话。

## Functional Requirements

1. The system SHALL provide a pi extension package following this repository's package convention under `packages/<name>/`, with `package.json` declaring `pi.extensions` and an `extensions/` entrypoint.
2. The system SHALL treat `turn` as the loop-counting unit, not `message` count and not raw provider request count.
3. The system SHALL use a user-facing threshold meaning “N completed turns”; with the default threshold `10`, the reminder is eligible after 10 completed turns if the agent is still continuing.
4. The system SHALL repeat reminders every `10` additional completed turns by default within the same agent run: 10, 20, 30, and so on.
5. The system SHALL inject reminders as visible user messages using `steer` delivery semantics, not `followUp`, not system-prompt-only changes, and not silent `context` insertion.
6. The system SHALL phrase the reminder as a three-step check: review the original goal, review current evidence and direction, and decide whether it is blocked or uncertain enough to call `advisor`.
7. The system SHALL include a clear conditional instruction in the reminder: if the agent is stuck, uncertain, or may be pursuing the wrong direction, it should call the `advisor` tool before continuing.
8. The system SHALL apply to all models by default.
9. The system SHALL load JSON configuration with defaults for at least `enabled`, `thresholdTurns`, `repeatEveryTurns`, and reminder message/template.
10. The system SHALL reset its automatic reminder cadence when an agent run ends, so a later user prompt starts fresh.
11. The system SHALL reset its automatic reminder cadence when the user manually sends a steering message during an active run.
12. The system SHALL avoid extra UI noise on trigger: no additional notify, footer status, widget, or modal is required.
13. The system SHALL avoid immediate self-triggering loops from its own injected reminder; after an automatic reminder, the next reminder should wait for the configured repeat interval.
14. The system SHALL leave the exact runtime hook selection to implementation research, while preserving the product behavior: after N completed turns and before the next useful model continuation, insert a steering reminder.

## Non-Functional Requirements

- **Performance**: The extension should keep only small in-memory counters/state per active run and should not perform model calls, filesystem scans, or expensive session walks on every turn.
- **Security**: The extension should not send data to external services. Configuration should be local and should not expose secrets. The reminder may instruct the model to call the existing `advisor` tool, but should not invoke external APIs directly.
- **UX / Accessibility**: The only visible trigger artifact should be the inserted user message. The text should be concise enough not to waste excessive context, but explicit enough to steer the model.
- **Reliability**: Invalid or missing JSON configuration should fall back to defaults with a warning rather than breaking the agent. Extension errors must not crash the agent loop. Manual steer reset behavior should be tested because docs/examples expose `streamingBehavior`, while the installed type definition needs verification.

## Constraints & Assumptions

- pi exposes `turn_start` / `turn_end` extension events with `turnIndex` (`node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts:489-500`) and registers those events on `ExtensionAPI` (`node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts:799-803`).
- pi exposes `sendUserMessage(content, { deliverAs })` for user-message injection (`node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts:841-843`).
- pi documents `steer` as queued while the agent is busy and delivered after the current assistant turn/tool batch, before the next LLM call; `followUp` waits until the agent has no more tool calls or steering messages (`node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js:868-928`).
- Existing docs/examples mention `event.streamingBehavior === "steer"` for input handling (`/home/cnife/.local/lib/node_modules/@earendil-works/pi-coding-agent/examples/extensions/input-transform-streaming.ts:16-23`), but the installed `InputEvent` type excerpt only explicitly exposes `source` (`node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts:567-575`). Implementation research must verify the safest way to detect user-initiated steer messages.
- Repository package guidance expects extension packages under `packages/<name>/` with peer dependency on `@earendil-works/pi-coding-agent`, JSON config under `getAgentDir()`, and local testing via `pi -ne -ns -e packages/<pkg>/extensions/<file>.ts` (`packages/AGENTS.md`).
- The FRD locks product behavior, not the exact implementation hook. The next research step should validate whether `turn_end`, `turn_start`, queue state, or another runtime seam best realizes “after N completed turns and before the next useful model continuation.”

## Acceptance Criteria

- [ ] Running `npm run check` exits 0 after the extension package is implemented.
- [ ] Running `pi -ne -ns -e packages/<pkg>/extensions/<file>.ts` with default configuration starts without a configuration error and defaults to all models, `thresholdTurns: 10`, and `repeatEveryTurns: 10`.
- [ ] In a local test configuration with `thresholdTurns: 2` and `repeatEveryTurns: 2`, a run that continues past 2 completed turns produces exactly one visible inserted user message containing the three-step reflection prompt and conditional `advisor` instruction.
- [ ] In the same local test configuration, a run that continues past 4 completed turns produces a second reminder only after two additional completed turns, not immediately after the first reminder.
- [ ] If an agent run ends before the configured threshold, no automatic reminder message appears.
- [ ] If the user manually sends a steer message during an active run, the next automatic reminder does not fire until the configured number of additional completed turns has elapsed.
- [ ] Triggering an automatic reminder does not create an extra notify, footer/status line, widget, or modal; the visible user message is the only user-facing artifact.
- [ ] The same reminder behavior applies regardless of the active model provider/model, unless a future configuration explicitly disables the extension.
- [ ] With invalid JSON configuration, local startup continues with defaults and emits a warning instead of crashing the session.

## Recommended Approach

Create a new pi extension workspace package, likely named around `agent-loop-reflection` or `agent-loop-guard`, using the repository's existing extension package conventions. Implement an event-driven turn monitor with JSON configuration, use `sendUserMessage(..., { deliverAs: "steer" })` for visible reminders, and let research verify the exact hook/queue seam that best satisfies “after N completed turns, before the next useful model continuation.”

## Decisions

### Problem Owner

**Question**: 这个提醒机制主要是为了解决谁在使用 agent loop 时遇到的什么问题？成功时，对那个人来说今天的体验会怎样变好？
**Recommended**: n/a — intent question
**Chosen**: 我自己；背景是 deepseek-v4-flash 容易闷头做事、方向错了也不反馈，继续尝试新方向并消耗大量时间和上下文。
**Rationale**: 这是用户自己的日常 agent 使用痛点，FRD 应优先优化个人使用体验和约束力度。

### Trigger Unit

**Question**: 按概念区分后，希望插件用哪个触发点来判断“agent loop 已经跑太久，需要反思”？
**Recommended**: turn-based semantics; exact hook to be verified by research
**Chosen**: 必须以 turn 为标志点；用户想要的是“在两个 turn 中间插入”。
**Rationale**: `turn` 是 pi 暴露的 agent loop 单位，比 `message_end` 更精确地表达 loop 次数；evidence: `types.d.ts:489-500` + confirmed. Exact hook remains a research/implementation detail.

### Trigger Semantics

**Question**: 那我们把触发语义定为“完成 N 个 turn 后，如果 agent 还要进入下一轮，就在下一轮开始前插入提醒”，可以吗？
**Recommended**: 按这个语义
**Chosen**: 按这个语义。
**Rationale**: 这避免把提醒放在任务已经结束之后，也贴近用户的“两个 turn 中间”表达；exact hook 留给 research 验证。

### Delivery Mode

**Question**: 提醒消息的调度方式是否定为 `steer`，并明确排除 `followUp/context/只改 system prompt`？
**Recommended**: 定为 `steer`
**Chosen**: 定为 `steer`。
**Rationale**: `steer` 比 `followUp` 更早介入正在运行的 agent 流程；`context` 和 system-prompt-only 已被用户排除。

### Model Scope

**Question**: 这个插件默认应该作用在哪些模型上？
**Recommended**: 配置匹配，默认针对 deepseek-v4-flash
**Chosen**: 所有模型。
**Rationale**: 用户希望在 agent 层做通用约束，而不是只修补 deepseek-v4-flash。

### Default Threshold

**Question**: 首次提醒的默认阈值应该是多少个已完成 turn？
**Recommended**: 3 个 turn
**Chosen**: 10 个 turn。
**Rationale**: 用户偏向减少过早打断，让插件只在 agent 明显长时间未结束时介入。

### Repeat Cadence

**Question**: 首次提醒后，如果 agent 继续运行很多 turn，后续应该怎么处理？
**Recommended**: 每 10 个 turn 再提醒
**Chosen**: 每 10 个 turn 再提醒。
**Rationale**: 持续长循环需要持续约束；重复间隔与默认首次阈值保持一致，心智负担低。

### Advisor Strength

**Question**: 提醒消息里对 `advisor` 的要求应该有多强？
**Recommended**: 条件调用 `advisor`
**Chosen**: 条件调用 `advisor`。
**Rationale**: 只在困难、不确定或疑似跑偏时升级到外部咨询，避免每次提醒都增加工具调用成本。

### Configuration

**Question**: 这个插件需要哪些可配置能力？
**Recommended**: JSON 配置
**Chosen**: JSON 配置。
**Rationale**: 阈值、重复间隔和提醒文案后续需要调参；仓库扩展规范已有 JSON config 模式。

### Reminder Copy Structure

**Question**: 插入给 LLM 的提醒消息应该采用什么结构？
**Recommended**: 三步检查
**Chosen**: 三步检查。
**Rationale**: 三步结构能把“别闷头继续”转化成可执行检查：目标、证据/方向、阻塞/advisor。

### Reset Rules

**Question**: turn 计数应该在什么时候重置？
**Recommended**: 每个 agent run 重置
**Chosen**: agent run 结束时重置；用户手动发送 steer 消息时重置。
**Rationale**: run 结束重置避免跨请求误触发；手动 steer 重置避免用户刚介入后自动提醒马上追上来。

### Trigger Visibility

**Question**: 自动提醒触发时，除了插入那条 steer 用户消息，还需要额外 UI 提示吗？
**Recommended**: 只保留用户消息
**Chosen**: 只保留用户消息。
**Rationale**: 插入消息本身已经可见，额外 notify/footer 会增加噪音。

## Open Questions

None. Implementation research must still verify the exact runtime hook, but no product decision was explicitly deferred by the user.

## References

- User-provided feature description in `/skill:discover` input.
- User-provided background about deepseek-v4-flash behavior in this interview.
- `node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts`
- `node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js`
- `/home/cnife/.local/lib/node_modules/@earendil-works/pi-coding-agent/docs/extensions.md`
- `/home/cnife/.local/lib/node_modules/@earendil-works/pi-coding-agent/examples/extensions/send-user-message.ts`
- `/home/cnife/.local/lib/node_modules/@earendil-works/pi-coding-agent/examples/extensions/input-transform-streaming.ts`
- `packages/AGENTS.md`

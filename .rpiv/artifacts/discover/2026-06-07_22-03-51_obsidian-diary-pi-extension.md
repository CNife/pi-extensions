---
date: 2026-06-07T22:03:51+0800
author: CNife
commit: 8eef477
branch: main
repository: pi-extensions
topic: "Obsidian Diary Pi Extension"
tags: [intent, frd, obsidian-diary, pi-extension]
status: complete
last_updated: 2026-06-07T22:03:51+0800
last_updated_by: CNife
---

# FRD: Obsidian Diary Pi Extension

## Summary

把现有 `obsidian-diary` 技能重构为新的 pi 扩展包 `@cnife/pi-obsidian-diary`。首版提供 `/diary` 命令：无参数时总结当前 pi session，传入 session id 时总结指定 session，并把更新日记的语义工作交给干净上下文的 subagent。

新架构中，扩展只负责获取/传递 session id 和启动流程；TypeScript CLI `pi-obsidian-diary` 负责确定性的会话/日记上下文读取与校验；subagent 负责总结、主题聚合、重复内容判断、风格自检，并直接 patch 日记文件。

## Problem & Intent

基础意图回答：`我本人`。

原始问题描述中，开发者明确希望解决自己在 pi 会话结束后沉淀 Obsidian 日记时的稳定性问题：

> 现有架构的问题：让主 agent 直接读写工作日志文件，总是出现不执行脚本、不按流程来、流水账、不遵循语言风格、写错文件、覆盖已有内容的问题
>
> 为啥用subagent：subagent有干净的上下文，读取 pi 的 jsonl 文件知道会话做了什么，能更加好地避免上面的问题；当前的工作目录可以在任意位置，subagent只访问日记文件夹，跟当前工作目录解耦；
>
> 为啥做个插件：传递当前会话id需要插件完成，后续还可以添加更多功能，比如总结今天所有会话、整理日记等

## Goals

- 首版支持把当前或指定 pi session 的内容总结到 Obsidian 今日个人/工作日记。
- 主 agent 不再直接读取、写入或维护日记文件，只传递 session id 并触发隔离流程。
- subagent 在干净上下文中读取 pi session JSONL，按旧 `obsidian-diary` 的写作规则总结和维护日记。
- 当前工作目录可以是任意项目；日记流程依赖 session id、pi session 数据和 Obsidian vault 配置，而不是依赖当前仓库目录。
- 新 TypeScript CLI 承接确定性操作，替换旧 Python helper 的运行时职责。
- 日记内容保持主题聚合、非流水账、符合 work/personal 风格，并避免重复记录相同内容。

## Non-Goals

- 首版不做“总结今天所有 pi 会话”。该能力作为后续扩展方向保留。
- 首版不做完整日记整理/维护套件，例如全库清理、历史日记重组或周期回顾。
- 首版不做 session/turn/message 事件自动触发写日记；入口以用户主动执行 `/diary` 为准。
- 首版不复用旧 `scripts/obsidian-helper.py` 作为运行时路径。
- 日记正文中不写入 session id 标记；重复检测应基于日记内容语义判断。
- CLI 不负责端到端语义总结，不在 CLI 内嵌完整 LLM 写作逻辑。

## Functional Requirements

1. The system SHALL provide a new pi package named `@cnife/pi-obsidian-diary` under the repository workspace, with pi extension registration compatible with the existing package conventions.
2. The extension SHALL register a slash command named `/diary`.
3. When `/diary` is invoked without arguments, the extension SHALL obtain the current session id from `ctx.sessionManager.getSessionId()` and pass it to the diary workflow.
4. When `/diary <session-id>` is invoked, the extension SHALL use the explicit session id instead of the current session id.
5. The extension SHALL delegate diary recording to a dedicated subagent/workflow instead of asking the current main agent to read or write diary files.
6. The package SHALL expose an independent TypeScript CLI named `pi-obsidian-diary`.
7. The CLI SHALL provide deterministic operations for locating/reading pi session data, loading Obsidian diary configuration, reading current diary context, validating target paths, and supporting safe failure behavior.
8. The CLI SHALL replace the old Python helper as the runtime diary access layer; the old helper may be used only as migration reference.
9. The subagent SHALL read the target session JSONL content and summarize the human-relevant work, decisions, conclusions, and follow-up tasks.
10. The subagent SHALL choose work/personal automatically using the existing variant rules, while allowing command-level override.
11. The subagent SHALL preserve the old style rules: work logs stay subsystem/result oriented; personal diaries stay theme grouped, less report-like, and may include personal judgment or feeling.
12. The subagent SHALL detect whether the same or substantially overlapping content is already present in today's diary and SHALL avoid recording duplicate content.
13. The subagent SHALL directly patch the diary file when writing is authorized by the command, because it needs semantic control over insertion location and merging with existing sections.
14. The subagent SHALL first read diary context before patching and SHALL NOT overwrite the whole diary file.
15. On invalid session id, missing configuration, unreadable session data, invalid target diary path, or CLI/subagent failure, the system SHALL leave diary files unchanged and report a clear error.

## Non-Functional Requirements

- **Performance**: No specific latency target. The workflow should be acceptable for interactive manual use after a session, with deterministic CLI operations kept fast enough for local vault/session files.
- **Security**: Diary writes must be constrained to configured Obsidian diary locations. The subagent should not use the current working directory as an authority for diary paths.
- **UX / Accessibility**: `/diary` should be short and explicit. Command execution means write authorization; no extra confirmation prompt is required in the default flow. The command should report what was written, skipped, or failed.
- **Reliability**: Failure is fail-closed: no partial diary write on critical precondition failure. Re-running on already-recorded content should not duplicate entries.

## Constraints & Assumptions

- The repository is an npm workspace monorepo; new code should follow existing pi package conventions under `packages/`.
- Existing extension conventions use `"pi": {"extensions": ["./extensions"]}` and `export default function (pi: ExtensionAPI)`.
- Existing pi extension context exposes `ctx.sessionManager`; research/design must verify the best runtime method for launching the dedicated subagent.
- Existing `obsidian-diary` skill rules are the behavioral baseline, especially work/personal variant selection, path rules, theme grouping, and style self-check.
- The old Python helper is a reference for behavior but not a runtime dependency for the new package.
- The configured Obsidian vault may live outside the current repository and outside the current shell working directory.
- The exact subagent launch mechanism is left for research/design to validate against pi APIs and local extension testing.

## Acceptance Criteria

- [ ] Running `npm run check` after implementation exits 0.
- [ ] Running `npm test --workspace @cnife/pi-obsidian-diary` exits 0 and includes fixture coverage for CLI context loading, duplicate-content handling, and fail-closed behavior.
- [ ] Loading the extension locally with `pi -ne -ns -e packages/obsidian-diary/extensions/index.ts` makes `/diary` available as a slash command.
- [ ] In a local extension E2E session, running `/diary` without arguments passes the current value of `ctx.sessionManager.getSessionId()` into the diary workflow; the visible status/notification includes the session id or a traceable job id.
- [ ] In a local extension E2E session, running `/diary <session-id>` uses the explicit id and does not substitute the current session id.
- [ ] A CLI fixture using sample pi session data and a temporary Obsidian vault produces diary context/output for the correct work or personal variant.
- [ ] A duplicate-content fixture re-runs the same or semantically overlapping session input and does not append duplicate diary material.
- [ ] After duplicate-content handling, `rg "<fixture-session-id>" <temporary-vault>/个人日记 <temporary-vault>/工作日志` returns no diary-body session marker match.
- [ ] Invalid session id, missing vault config, and simulated CLI/subagent failure leave the target diary file byte-for-byte unchanged and emit a clear error.
- [ ] A successful write reports a grouped summary of added/updated/skipped diary content.

## Recommended Approach

Create `packages/obsidian-diary` as `@cnife/pi-obsidian-diary`, exposing both a pi extension and a TypeScript CLI `pi-obsidian-diary`. Implement `/diary` as the first user-facing entry: the extension resolves current or explicit session id, launches the dedicated subagent/workflow, and the subagent uses the CLI for deterministic context while directly patching the diary file under strict path and fail-closed constraints.

## Decisions

### Beneficiary And Intent

**Question**: 这次把 obsidian-diary 做成 pi 扩展，最核心是在解决谁现在遇到的痛点？成功时，那个人的体验应该变成什么样？
**Recommended**: n/a — intent question
**Chosen**: 我本人
**Rationale**: The feature is optimized for the developer's own recurring diary-recording workflow and the concrete failures described in the original request.

### Preserve Diary Rules

**Question**: 从旧技能看，我推断 work/personal 变体、先读后写、主题聚合、风格自检应继续作为新功能的日记规则来源（SKILL.md:98-99,120,136,229；personal-diary.md:31,42；work-log.md:31,47）。这次保留还是改掉？
**Recommended**: 保留为基线
**Chosen**: 保留为基线
**Rationale**: evidence: `/home/cnife/code/skills/knowledge/obsidian-diary/SKILL.md:98-99`, `/home/cnife/code/skills/knowledge/obsidian-diary/SKILL.md:120`, `/home/cnife/code/skills/knowledge/obsidian-diary/SKILL.md:136`, `/home/cnife/code/skills/knowledge/obsidian-diary/SKILL.md:229` + confirmed.

### Replace Old Helper

**Question**: 从旧 helper 看，我推断路径计算和 context 收集能力应继续复用（obsidian-helper.py:79,330-337），避免重新实现日记路径和规则读取。保留还是替换？
**Recommended**: 保留 helper
**Chosen**: 替换 helper
**Rationale**: Developer corrected the evidence-based pre-resolution: old helper behavior is useful as reference, but runtime should become a new deterministic CLI rather than continuing the Python helper path.

### Initial Extension Entry

**Question**: 从扩展代码看，slash command 能拿到 ExtensionCommandContext，ctx.sessionManager 暴露会话信息，getSessionId() 可用（packages/AGENTS.md:39；types.d.ts:215；session-manager.d.ts:136,190）。首个入口按这个方向做吗？
**Recommended**: slash 命令取 id
**Chosen**: slash 命令取 id
**Rationale**: evidence: `packages/AGENTS.md:39`, `node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts:215`, `node_modules/@earendil-works/pi-coding-agent/dist/core/session-manager.d.ts:136`, `node_modules/@earendil-works/pi-coding-agent/dist/core/session-manager.d.ts:190` + confirmed.

### Version One Scope

**Question**: 第一版功能边界应该收在哪里？
**Recommended**: 单会话写日记
**Chosen**: 单会话写日记
**Rationale**: This directly satisfies the specified-session/current-session use case while leaving today-all-sessions and diary organization for later.

### Responsibility Boundary

**Question**: 执行责任放在哪一层？取舍轴是“隔离可靠性” vs “实现简单度”。
**Recommended**: 扩展递 id 给 subagent
**Chosen**: 扩展递 id 给 subagent
**Rationale**: This addresses the original failure mode by keeping the current main agent out of diary file maintenance and using a clean subagent context.

### Session Id Source

**Question**: `/diary` 这类命令获取会话 id 的规则怎么定？
**Recommended**: 默认当前，可传 id
**Chosen**: 默认当前，可传 id
**Rationale**: The default current-session path makes daily use convenient, while explicit id support satisfies the requested ability to summarize a specified pi session.

### Write Authorization

**Question**: 命令触发后，subagent 应该怎么处理写入？
**Recommended**: 命令即授权写入
**Chosen**: 命令即授权写入
**Rationale**: `/diary` is an explicit user command; extra confirmation would add friction without addressing the core reliability problem.

### Variant Selection

**Question**: work / personal 变体由谁决定？
**Recommended**: 自动判断，可覆盖
**Chosen**: 自动判断，可覆盖
**Rationale**: Existing variant rules remain the baseline, but command-level override is needed for edge cases and user control.

### CLI Shape

**Question**: 把“独立 CLI 程序”记成哪种实现语言？取舍轴是“随扩展发布的一体化” vs “脚本开发速度”。
**Recommended**: TypeScript CLI
**Chosen**: TypeScript CLI
**Rationale**: The repo is an npm workspace for pi extensions; a TypeScript CLI can ship with the package and share configuration/types with the extension.

### Duplicate Handling

**Question**: 同一个 session 被记录多次时应该怎么处理？
**Recommended**: 合并更新已有条目
**Chosen**: 理论上无法识别，因为日记里没有session信息，需要subagent通过日记内容检测重复，决策不记录重复内容
**Rationale**: The diary should stay human-facing and should not accumulate hidden session metadata or repeated entries.

### Failure Strategy

**Question**: session id 无法解析、配置缺失、或 subagent/CLI 中途失败时应该怎样？
**Recommended**: 失败不写入
**Chosen**: 失败不写入
**Rationale**: Protecting diary files from partial or wrong writes is more important than preserving partial progress.

### Required Verification

**Question**: 首版必须纳入哪些验收项？
**Recommended**: CLI fixture 测试；扩展 E2E 测试；重复内容测试；失败不写测试
**Chosen**: CLI fixture 测试；扩展 E2E 测试；重复内容测试；失败不写测试
**Rationale**: These directly cover the command surface, deterministic CLI behavior, idempotence-by-content, and fail-closed reliability requirement.

### CLI And Subagent Split

**Question**: CLI 和 subagent 具体怎么分工？取舍轴是“确定性文件操作” vs “端到端封装”。
**Recommended**: CLI 做 IO，subagent 做语义
**Chosen**: 整体上需要CLI负责确定性的操作，subagent做语义；有个细节是文件让谁写入，我倾向于让subagent直接写入，因为可能不是追加到结尾，而是放到中间某个位置
**Rationale**: Deterministic operations and semantic writing need different ownership; insertion location is semantic, so final patching belongs with the subagent.

### Final Write Actor

**Question**: 最终修改日记文件的动作由谁执行？取舍轴是“灵活插入位置” vs “确定性写入控制”。
**Recommended**: subagent 直接 patch
**Chosen**: subagent 直接 patch
**Rationale**: The subagent needs semantic control over placement, merging, and duplicate avoidance, while CLI constrains paths and context.

### Naming

**Question**: 首版的包名、CLI 和命令名用哪组？
**Recommended**: pi-obsidian-diary + /diary
**Chosen**: pi-obsidian-diary + /diary
**Rationale**: The names directly inherit the old skill identity while matching existing `@cnife/pi-*` package conventions.

## Open Questions

无。本次访谈没有显式延期的问题；具体 subagent 启动机制留给 research/design 在代码库现实中验证，而不是作为产品需求悬而未决。

## Suggested Follow-ups

- Add a command for summarizing all sessions from today; this was mentioned as future scope in the original request but excluded from v1.
- Add diary organization/cleanup commands after single-session recording is stable.
- Consider optional dry-run/preview mode if command-authorized direct writes feel too aggressive in real usage.
- Consider event-based proactive prompts after the slash-command path is reliable; existing pi extension APIs expose event hooks such as `pi.on(...)` (`packages/AGENTS.md:37`).

## References

- `/home/cnife/code/skills/knowledge/obsidian-diary/SKILL.md`
- `/home/cnife/code/skills/knowledge/obsidian-diary/references/personal-diary.md`
- `/home/cnife/code/skills/knowledge/obsidian-diary/references/work-log.md`
- `/home/cnife/code/skills/knowledge/obsidian-diary/scripts/obsidian-helper.py`
- `/home/cnife/code/skills/knowledge/obsidian-diary/evals/evals.json`
- `packages/AGENTS.md`
- `packages/simple-plannotator/extensions/index.ts`
- `packages/execute-python/extensions/execute-python.ts`
- `packages/auto-naming-session/extensions/index.ts`
- `node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts`
- `node_modules/@earendil-works/pi-coding-agent/dist/core/session-manager.d.ts`

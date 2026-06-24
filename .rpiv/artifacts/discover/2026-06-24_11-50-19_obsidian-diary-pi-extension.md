---
date: 2026-06-24T11:50:19+0800
author: CNife
commit: 2dc0b48
branch: feat/obsidian-diary
repository: pi-extensions
topic: "Obsidian Diary Pi Extension"
tags: [intent, frd, obsidian-diary]
status: ready
last_updated: 2026-06-24T11:50:19+0800
last_updated_by: CNife
---

# FRD: Obsidian Diary Pi Extension

## Summary

一个极简的 Pi 扩展 `@cnife/pi-obsidian-diary`，注册 `/diary` 命令。扩展代码做所有机械操作（读 session JSONL、读今日日记、校验路径、组装 prompt），调一次 LLM 获得结构化日记草稿，然后发到当前会话由主 Agent 与用户确认后写入。没有独立的 CLI 程序、没有 subagent、没有 newSession、没有构建步骤。

## Problem & Intent

旧 `obsidian-diary` skill 有两个结构性缺陷：**AI 不遵守指令**（要求它读 session 文件后再写，它经常跳过直接覆盖日记文件）和**写入噪音**（AI 把 Git 操作、验证轮次、agent 内部步骤写进日记）。加更多规则约束 AI 没有用（已经在 SKILL.md 里写了 300 行规则），问题出在架构上——AI 同时拥有读和写的权限。

解决思路不是靠限制 AI 行为，而是从架构上让 AI 无法绕过控制：机械操作（读文件、算路径、校验）由代码完成；语义工作（理解内容、提炼要点）交给一次 LLM 调用，不涉及工具访问；写入审批由主 Agent 和用户完成，代码层和 LLM 调用层都不碰文件写入。

## Goals

- 注册 `/diary` 命令作为唯一入口
- 扩展代码做所有机械操作：读 session JSONL、读今日日记、最近待办/最近日记、校验配置和路径
- 扩展调一次 `completeSimple()` 完成语义总结，输出结构化 JSON（日记路径 + 总结内容 + 主 Agent 操作指令）
- 扩展通过 `pi.sendUserMessage()` 把结构化结果发到当前会话
- 主 Agent 按照结果中嵌入的指令，展示给用户确认后写入日记文件
- 用户确认前，没有任何代码路径写入或修改日记文件

## Non-Goals

- 不做独立 CLI 程序。扩展直接用 `node:fs` 读写文件
- 不做 subagent / newSession / 多轮 agent 交互。语义工作一次 LLM 调用完成
- 不做自动触发（如 turn_end 事件）。入口只有 `/diary` 命令
- 不做批量多 session 合并
- 不做历史日记整理或全库维护
- 不兼容旧 `~/.config/cnife-skills/obsidian-diary.json` 配置路径

## Functional Requirements

1. 扩展必须注册 `/diary` slash command。
2. `/diary` 无参数时使用当前 session id；`/diary <session-id>` 使用指定的 session id。
3. `/diary --work`、`/diary --personal` 显式指定变体；无参数时由 LLM 在 prompt 中自动判断。
4. 扩展必须读取并校验配置，配置不存在时创建模板并报错退出。
5. 扩展必须从 session JSONL 文件读取消息内容。
6. 扩展必须读取今日日记的完整内容（如已存在），用于去重和合并。
7. 扩展必须调用 `completeSimple()` 完成语义总结，不启动 subagent。
8. LLM 调用必须返回结构化 JSON，包含日记路径、总结内容、主 Agent 操作指令。
9. 扩展必须通过 `pi.sendUserMessage()` 将结果发到当前会话。
10. 扩展不得直接写入或修改任何日记文件。
11. 主 Agent 必须展示日记草稿给用户，确认后才写入。
12. session id 无效、配置缺失、路径异常必须在写入前报错，不修改日记文件。

## Non-Functional Requirements

- **Performance**: LLM 调用在 `/diary` 命令生命周期内完成，用户可见等待时间可接受即可。
- **Security**: 写入权完全不在扩展代码侧。扩展只读文件、调 LLM、发消息。日记文件只能由主 Agent 在用户确认后写入。
- **UX**: 主 Agent 收到的消息包含清晰的操作指令，不需要 agent 猜测如何处理。结果消息中明确告知要展示给用户确认。
- **Reliability**: 失败不写入。任何前置条件失败（无效 session、缺失配置、路径越界）都阻止写入路径。

## Constraints & Assumptions

- 扩展运行在 pi agent 进程中，可使用 `node:fs` 直接读写本地文件。
- 扩展可使用 `@earendil-works/pi-ai` 的 `completeSimple()` 进行 LLM 调用（`auto-naming-session` 已使用同一 API）。
- 扩展可通过 `pi.sendUserMessage()` 向当前会话的主 Agent 发送消息（types.d.ts:875）。
- Obsidian vault 路径在本地文件系统上，扩展可直接访问。
- session JSONL 文件路径通过 `ctx.sessionManager` 可获取。
- 假设 `completeSimple()` 可以处理含 session 消息和日记内容的长 prompt；消息量过大时需要截断策略。

## Acceptance Criteria

- [ ] 加载扩展后 `/diary` 可用：`pi -ne -ns -e packages/obsidian-diary/extensions/index.ts`
- [ ] `/diary`（无参数）触发 handler，扩展读取当前 session 数据并调 LLM，不报错退出
- [ ] `/diary <session-id>` 使用显式 session id，不报错退出
- [ ] `/diary --work` 以 work 变体运行，prompt 中包含 work 风格指南
- [ ] `/diary --personal` 以 personal 变体运行，prompt 中包含 personal 风格指南
- [ ] LLM 返回的结构化 JSON 包含 `diaryPath`、`summary`、`instructions` 三个字段
- [ ] 扩展调用 `pi.sendUserMessage()` 后，主 Agent 收到包含日记草稿和操作指令的消息
- [ ] 配置不存在时创建模板文件并报错，不修改任何日记文件
- [ ] session 文件不存在时报错，不修改任何日记文件
- [ ] 计算的日记路径超出 vault 范围时报错，不修改任何日记文件
- [ ] 用户确认前，没有任何代码路径写入日记文件
- [ ] `npm run check` 通过

## Recommended Approach

创建 `packages/obsidian-diary/` 为一个源文件扩展。`extensions/index.ts` 中实现 `/diary` handler，handler 内依次完成：参数解析 → 读取 session JSONL → 读取配置并校验 → 计算日记路径 → 读取今日日记内容 → 调用 `completeSimple()` 做语义总结 → 通过 `pi.sendUserMessage()` 将结构化结果发到当前会话。不需要独立的 CLI、subagent、构建步骤或额外的 npm 依赖。

## Decisions

### Architect: Subagent vs One-Call

**Question**: 语义总结工作应该交给一个完整 subagent（多步推理、文件访问），还是一次 LLM 调用？

**Recommended**: 一次 LLM 调用

**Chosen**: 一次 LLM 调用

**Rationale**: 语义总结不需要工具调用或多步推理。`completeSimple()` 已有现成使用证据（`packages/auto-naming-session/extensions/index.ts:275`）。一次调用比 subagent 更简单可靠。

### Boundary: Write Authority

**Question**: 写入日记文件的权限应该放在哪一层？

**Recommended**: 主 Agent 在用户确认后写入

**Chosen**: 主 Agent 在用户确认后写入

**Rationale**: 旧架构的核心问题是 AI 有写权限。把写入权完全从扩展代码移出，由主 Agent + 用户确认后执行，从架构上消除 AI 绕过写入控制的可能性。

### CLI: Standalone Binary vs No Build

**Question**: 是否需要独立的 CLI 程序来保证确定性操作？

**Recommended**: 不独立 CLI，扩展直接用 `node:fs`

**Chosen**: 不独立 CLI，扩展直接用 `node:fs`

**Rationale**: 确定性的读文件操作不需要独立进程隔离。扩展在 pi 进程内用 `node:fs` 即可完成。移除 CLI 意味着移除 build 步骤、bin 配置、tsconfig 等全部复杂度。

### Variant: Auto vs Explicit

**Question**: work/personal 变体如何选择？

**Recommended**: 无参数自动判断，可 `--work|--personal` 覆盖

**Chosen**: 无参数自动判断，可 `--work|--personal` 覆盖

**Rationale**: 大部分场景 LLM 能从会话内容判断变体；显式参数提供用户控制能力。

### Config: Location and Migration

**Question**: 配置存在哪个路径？是否需要兼容旧路径？

**Recommended**: `getAgentDir()/cnife-obsidian-diary.json`，不兼容旧路径

**Chosen**: `getAgentDir()/cnife-obsidian-diary.json`，不兼容旧路径

**Rationale**: 遵循现有扩展配置习惯（`packages/auto-naming-session/extensions/index.ts:27`）。旧路径是 skill 时代的产物，新扩展不应耦合。

### Scope: Single File vs Multi-File

**Question**: 包结构应该是一个还是多个源文件？

**Recommended**: 一个源文件

**Chosen**: 一个源文件

**Rationale**: 整个 handler 逻辑是线性的——参数解析、文件读取、LLM 调用、发送消息。不需要复杂划分，单个 `extensions/index.ts` 即可。jiti 直接加载，无需构建。

## Open Questions

- LLM 调用的模型如何确定？用当前会话模型还是固定预设模型？需要权衡质量与成本。
- prompt 中 session 消息量应如何控制？完整消息可能很长，需考虑截断或压缩策略。
- 主 Agent 收到结构化消息后执行写入的可靠性如何保证？依赖于 prompt 中的 instructions 字段 compliance。

## Suggested Follow-ups

- 后续可考虑 `/diary today` 总结今日所有 session，首版只处理单 session。

## References

- `packages/auto-naming-session/extensions/index.ts:275` — `completeSimple()` 使用证据
- `node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts:875` — `pi.sendUserMessage()` API
- `node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts:220` — `modelRegistry` 在 ExtensionContext 上可用
- 旧 skill 规则：`/home/cnife/code/skills/knowledge/obsidian-diary/SKILL.md`
- 旧 helper 路径计算：`/home/cnife/code/skills/knowledge/obsidian-diary/scripts/obsidian-helper.py:76-90`

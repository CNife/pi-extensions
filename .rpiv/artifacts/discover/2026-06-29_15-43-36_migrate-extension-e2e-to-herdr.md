---
date: 2026-06-29T15:43:36+0800
author: 蔡涛
commit: ce9dc08
branch: main
repository: pi-extensions
topic: "Migrate extension-e2e-test from tmux to herdr"
tags: [intent, frd, extension-e2e-test, herdr]
status: ready
last_updated: 2026-06-29T15:43:36+0800
last_updated_by: 蔡涛
---

# FRD: Migrate extension-e2e-test from tmux to herdr

## Summary

把 `.agents/skills/extension-e2e-test/SKILL.md` 从 tmux 工作流重写为 herdr 工作流（terminal-native agent multiplexer）。核心变化：用 herdr 的 workspace/pane API 替代 tmux socket/session 命令来跑 pi 隔离加载、发消息、读 footer、等模型回复。同步更新 `docs/troubleshooting.md` 中已被技能整合的 tmux 章节，沉淀 herdr 全屏 TUI 测试的踩坑经验（`--source visible` 读 TUI、`wait output` 精度等）。

## Problem & Intent

用户原话：**herdr 比 tmux 更简单、更适合用来做 TUI 的端到端测试**。

当前技能基于 tmux，但用户日常在 herdr 中工作。tmux 工作流有三个明显缺陷：(1) 需要手动管理 socket 和 session 生命周期；(2) pi 全屏 TUI 在 pipe 模式下（`2>&1 | tee`）不渲染、必须去掉 tee 或靠 tmux PTY；(3) 靠 `sleep` + `capture-pane` 轮询，不够精准。herdr 的 workspace/pane API + agent_status 检测 + 真 PTY 天然解决了这些问题。

## Goals

- 用 herdr 的 workspace/pane 模型重写完整 E2E 测试工作流
- 沉淀刚才实战踩到的坑：TUI scrollback 行为、`--source visible` 读写、`wait output` 精确匹配
- 同步更新 `docs/troubleshooting.md`（删除已被技能整合的 tmux 章节、改引向技能）
- frontmatter description 和触发关键词同步为 herdr 版本

## Non-Goals

- 不保留任何 tmux 命令/流程（用户明确选了"完全替换"）
- 不改 `.agents/skills/extension-e2e-test/` 外的其他技能文件
- 不改 packages/ 下的任何代码
- 不破坏 `docs/troubleshooting.md` 非 E2E 部分（隔离加载、npm 冲突、配置测试、编译检查继续保留）

## Functional Requirements

1. SKILL.md SHALL 在开头检查 `HERDR_ENV=1`，非 herdr 环境时停止执行并给出提示（参考 herdr 技能的 guard 模式）。
2. SKILL.md SHALL 提供完整的 herdr 工作流：创建隔离 workspace → 在其 root pane 跑 pi 隔离加载 → 等待 pi 就绪（`wait agent-status --status idle`）→ 读 baseline footer → 发消息 → 验证回复后 footer 更新 → 清理 workspace。
3. SKILL.md SHALL 在 Pitfalls 节记录最少 3 条实战经验：`--source visible` 是 TUI 的唯一可靠来源、`pane read --lines N` 必须显式指定、`send-keys` 不支持 `C-d`（清理用 `workspace close`）。
4. SKILL.md SHALL 更新 frontmatter：description 从 `"End-to-end test pi extensions using tmux"` 改为 herdr 版本；when_to_use 更新触发关键词（去 tmux、加 herdr）。
5. SKILL.md SHALL 保留现有技能的结构骨架（Prerequisites → Workflow → Key Patterns → Pitfalls → Startup Options），只替换命令和示例。
6. 系统 SHALL 同步更新 `docs/troubleshooting.md`：删除 `### tmux 交互式测试` 小节（L66-86），改为指向 extension-e2e-test 技能的引用行。

## Non-Functional Requirements

- **Performance**: 无影响（纯文档改写）。
- **Security**: 无影响。
- **UX / Readability**: SKILL.md 的 herdr 命令示例保持可复制性（含完整参数、注释解释每个 flag 的作用）；Pitfalls 用表格呈现，和现有格式一致。
- **Maintainability**: 单轨维护（不再保留 tmux 版本），技能名字保持 `extension-e2e-test`（不改文件名，不破坏已有引用）。

## Constraints & Assumptions

- 依赖 herdr 运行时——技能第一条就是 `HERDR_ENV=1` 检查，不符合时 stop（不 graceful degradation 回 tmux）。
- `send-keys` 不支持 `C-d` 等组合键名——清理固定用 `workspace close`。
- 假设技能读者已经熟悉基础的 herdr 概念（workspace/pane/tab），不重新解释 herdr 的基础语义（可以引用 herdr skill 或文档）。
- SKILL.md 是唯一需改写的文件（probe 确认目录下只有 SKILL.md）。
- `docs/troubleshooting.md` 的改动只限那一个 tmux 小节。

## Acceptance Criteria

- [ ] `.agents/skills/extension-e2e-test/SKILL.md` 全文已改写，无 tmux 命令残留
- [ ] Frontmatter description 和 when_to_use 已更新为 herdr 版本
- [ ] 开头有 `HERDR_ENV=1` 检查 guard
- [ ] 工作流包含：workspace create --no-focus → pane run pi → wait agent-status idle → pane read visible baseline → pane send-text + send-keys Enter → wait output --source visible 匹配 footer → workspace close
- [ ] Pitfalls 表包含至少 3 条 herdr 相关条目（TUI visible、lines N、send-keys C-d）
- [ ] `docs/troubleshooting.md` 中 `### tmux 交互式测试` 小节已删除，改为指向 skills 的引用
- [ ] 改完后在 herdr 环境加载技能能跑通一次 E2E 验证（不一定要完整跑 message，至少起 workspace 跑 pi 看到 footer 后清理）

## Recommended Approach

改 `.agents/skills/extension-e2e-test/SKILL.md` 一个文件（保留文件名），工作流骨架复用现有 skill 结构（Prerequisites → Workflow → Key Patterns → Pitfalls → Startup Options），将每节的 tmux 命令替换为等价的 herdr 命令。同步改 `docs/troubleshooting.md` 一节。

靶点清单：

- SKILL.md — 全文重写（替换 tmux 命令为 herdr，更新 frontmatter，新增 herdr Pitfalls，删除 Log Analysis 中 tee 日志相关内容）
- docs/troubleshooting.md:66-86 — 删除 tmux 小节，改为指向技能

## Decisions

### 改写动机 (intent)

**Question**: 把 extension-e2e-test 从 tmux 改成 herdr，你最想解决什么？
**Recommended**: n/a — `intent` question
**Chosen**: herdr 比 tmux 更简单、更适合用来做 TUI 的端到端测试
**Rationale**: 用户原话；决定了完全替换（不保留 tmux fallback）、工作流重点放在 herdr 的 workspace/pane API 和 agent_status 精准判定上。

### tmux 内容处理 (scope)

**Question**: 改成 herdr 后，原来的 tmux 内容怎么处理？
**Recommended**: 完全替换为 herdr
**Chosen**: 完全替换为 herdr
**Rationale**: 用户选了"完全替换"，SKILL.md 中不留任何 tmux 命令/描述。技能触发关键词也同步清掉 tmux 相关词。

### docs/troubleshooting.md 同步 (pre-resolution)

**Question**: probe 发现 docs/troubleshooting.md:66-86 有 tmux 交互测试章节，SKILL.md 注释也说整合自那里。改成 herdr 后怎么处理？
**Recommended**: 保留，只删 tmux 改引用
**Chosen**: 保留，只删 tmux 改引用
**Rationale**: 文件 80% 内容（隔离加载、npm 冲突、配置测试、编译检查、命令查找）仍有独立价值。只删除已被技能整合的 tmux 小节，改为一行指向 skill 的引用。

### 沉淀经验 (detail)

**Question**: 刚才 herdr 测试踩到的几个坑，哪些最值得写进 Pitfalls？
**Recommended**: 全部都要
**Chosen**: 全部都要
**Rationale**: 三条经验各有独立价值：(1) `--source visible` 读 TUI；(2) `--lines N` 必须显式指定；(3) `send-keys` 不支持 `C-d`。每条对应一个读者容易踩的坑。

## Open Questions

无。

## Suggested Follow-ups

无（所有面试中浮现的分支都已解决，无超出 scope 的观察）。

## References

- 源技能文件：`.agents/skills/extension-e2e-test/SKILL.md`
- 需同步文档：`docs/troubleshooting.md:66-86`
- 参考技能：`~/.agents/skills/herdr/SKILL.md`（herdr API 参考）
- 参考技能：`~/.agents/skills/tmux/SKILL.md`（被替代的技能）
- 实战记录：`.rpiv/artifacts/discover/2026-06-29_15-14-46_simplify-inference-speed-footer.md`（上次 herdr E2E 验证的语境）

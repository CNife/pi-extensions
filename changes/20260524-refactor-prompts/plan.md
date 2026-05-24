# 变更方案

## 目标

重构 prompt template 体系，从"大技能+prompt"转向"多个小技能"架构，解决吞参数问题。

## 问题背景

### 当前问题

5 个 prompt template 有 `argument-hint` 但未使用 `$ARGUMENTS` 占位符，导致用户输入被吞掉：

| 命令 | 问题 |
|------|------|
| `/grill-me` | 有 `argument-hint: "[话题]"` 但无占位符 |
| `/handoff` | 有 `argument-hint: "[下次会话的重点]"` 但无占位符 |
| `/improve-architecture` | 有 `argument-hint: "[项目目录]"` 但无占位符 |
| `/prototype` | 有 `argument-hint: "[验证目标]"` 但无占位符 |
| `/zoom-out` | 有 `argument-hint: "[模块/文件路径]"` 但无占位符 |

### 根因分析

prompt template 机制存在根本矛盾：

> prompt 是"精简指令"，但精简的代价是丢失上下文；skill 是"完整说明"，但完整的代价是无法直接触发。

这导致了：
- 两层维护（prompt + skill）
- 参数处理需要 `$ARGUMENTS` 占位符
- 职责模糊（prompt 引用 skill，skill 引用 references）

## 方案选择

**采用方案 C：架构重构 — 多个小技能**

理由：
1. 从根本上解决 prompt/skill 分层矛盾
2. 消除吞参数问题（skill 直接处理参数）
3. 符合 mattpocock-skills 已验证的模式
4. 提升可组合性和可复用性

## 澄清结论

| # | 问题 | 结论 |
|---|------|------|
| 1 | 流水线顺序如何表达 | 做成独立技能 `cnife-pi-workflow`，纯文档，描述流水线全景 |
| 2 | `cnife-pi-workflow` 的职责 | 纯文档：流水线全景、辅助技能清单、技能依赖关系、变更目录结构、快速开始指南 |
| 3 | 现有 `prompts/` 目录如何处理 | 全部删除，所有技能通过 SKILL.md 触发 |
| 4 | 现有 `extensions/dev-workflow.ts` 如何处理 | 迁移到 `/manage-change` 技能，包含 new、switch、status、list 功能 |
| 5 | 阶段技能的目录结构 | 全部单文件 SKILL.md |
| 6 | 现有 `references/` 目录如何处理 | 合并到对应 SKILL.md，彻底消除 references 目录 |
| 7 | 删除和创建的执行顺序 | 顺序不重要，git 保底 |
| 8 | 测试如何处理 | 删除旧测试，后续按需补充 |
| 9 | 项目文档如何更新 | 全部更新（AGENTS.md、README.md、CONTEXT.md） |
| 10 | 用户如何知道有哪些技能 | README.md 和 cnife-pi-workflow 都列出所有技能 |

## 最终技能清单

| 技能 | 类型 | 文件 | 说明 |
|------|------|------|------|
| `cnife-pi-workflow` | 文档 | `skills/cnife-pi-workflow/SKILL.md` | 流水线全景、技能关系、使用顺序 |
| `manage-change` | 操作 | `skills/manage-change/SKILL.md` | new、switch、status、list |
| `grill` | 阶段 | `skills/grill/SKILL.md` | 追问 + 领域对齐 |
| `plan` | 阶段 | `skills/plan/SKILL.md` | 写 plan.md |
| `plan-to-tasks` | 阶段 | `skills/plan-to-tasks/SKILL.md` | 垂直切片拆解 |
| `write-code` | 阶段 | `skills/write-code/SKILL.md` | TDD 红绿重构 |
| `review-code` | 阶段 | `skills/review-code/SKILL.md` | AI 审 + plannotator 人类审 |
| `improve-architecture` | 独立 | `skills/improve-architecture/SKILL.md` | 扫描架构改进机会 |
| `prototype` | 辅助 | `skills/prototype/SKILL.md` | 可丢弃原型 |
| `zoom-out` | 辅助 | `skills/zoom-out/SKILL.md` | 提升抽象层级 |
| `grill-me` | 辅助 | `skills/grill-me/SKILL.md` | 纯追问，不写文件 |
| `handoff` | 辅助 | `skills/handoff/SKILL.md` | 会话交接 |
| `hunt` | 诊断 | `skills/hunt/SKILL.md` | 根因诊断 |

## 执行步骤

### 第 1 步：创建新技能文件

创建 13 个技能文件（单文件 SKILL.md）：
- `skills/cnife-pi-workflow/SKILL.md`
- `skills/manage-change/SKILL.md`
- `skills/grill/SKILL.md`
- `skills/plan/SKILL.md`
- `skills/plan-to-tasks/SKILL.md`
- `skills/write-code/SKILL.md`
- `skills/review-code/SKILL.md`
- `skills/improve-architecture/SKILL.md`
- `skills/prototype/SKILL.md`
- `skills/zoom-out/SKILL.md`
- `skills/grill-me/SKILL.md`
- `skills/handoff/SKILL.md`
- `skills/hunt/SKILL.md`

每个 SKILL.md 包含：
- frontmatter（name、description）
- 完整操作说明（合并自 references/*.md）

### 第 2 步：删除旧文件

删除：
- `prompts/` 目录（10 个文件）
- `skills/development-workflow/` 目录（SKILL.md + references/）
- `extensions/dev-workflow.ts`
- `tests/dev-workflow.test.sh`

### 第 3 步：更新项目文档

更新：
- `AGENTS.md`：更新目录约定、命令清单
- `README.md`：更新功能说明、技能清单
- `CONTEXT.md`：更新项目用语

## 验证方式

手动验证：
1. 检查所有技能文件存在且非空
2. 检查旧文件已删除
3. 测试 `/grill-me test` 是否正确接收参数
4. 测试 `/manage-change new test` 是否创建变更目录

## 关键决策

| # | 决策 | 理由 |
|---|------|------|
| 1 | 采用多个小技能架构 | 消除 prompt/skill 分层矛盾，解决吞参数问题 |
| 2 | cnife-pi-workflow 作为纯文档技能 | 符合单一职责原则，不执行操作 |
| 3 | 所有阶段技能单文件 | 保持一致性，简化维护 |
| 4 | 删除 prompts/ 目录 | 彻底消除两层维护 |
| 5 | 迁移 extension 到 manage-change 技能 | 统一入口，消除 extension 和 skills 并存 |

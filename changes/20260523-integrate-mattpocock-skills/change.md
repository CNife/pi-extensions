---
状态: 完成
---

# 变更 v1：方案确立

## 变更目标

将 Matt Pocock engineering 技能（grill-with-docs、tdd、prototype、improve-codebase-architecture、zoom-out）融入现有 `changes/` 文件驱动工作流，用文件替代 GitHub Issue 作为计划—任务—状态追踪载体。

## 关键决策

| # | 决策 | 理由 |
|---|------|------|
| 1 | 状态标签从 Matt 的 5 个精简为 5 个中文标签（构思/就绪/进行中/完成/搁置） | 个人本地 + AI 协作不需要多人协作状态 |
| 2 | 不使用 Matt 的 diagnose | /hunt 已覆盖其核心能力且更丰富 |
| 3 | /write-code 替换为 TDD 红绿重构 | 测试和实现在同一循环中产出 |
| 4 | /review-code 保留，改为 AI 审→fix→plannotator 人类审 | AI 过滤低级问题，人类看关键判断 |
| 5 | /grill 和 /plan 拆分为两个命令 | 职责不同：先追问想清楚，再写方案 |
| 6 | 引入 changes/<name>/adr/ 目录 | 变更中产出决策，完成后同步 docs/adr/ |
| 7 | 去掉 /review-plan /fix-code /write-test /review-test /write-docs | 被 tdd、/review-code、grill 覆盖或不再需要 |

---

# 变更 v2：grill 细化

> 使用 grill-with-docs 对照 CONTEXT.md 逐条追问，澄清 plan.md 中的模糊表述。

## 澄清结论

| # | 问题 | 结论 |
|---|------|------|
| 1 | changes/<name>/adr/ 和 docs/adr/ 的同步时机 | 变更完成后一次性同步；搁置的不同步 |
| 2 | adrs/ vs adr/ 命名 | 统一用 adr/ |
| 3 | pi-extensions 是否有 CONTEXT.md | 创建，记录工作流领域术语 |
| 4 | /grill 和 /plan 的职责边界 | 拆为两个命令：/grill 追问+领域对齐，/plan 写方案 |
| 5 | /improve-architecture 触发方式 | 手动触发；扫描后先给列表，用户选择后再创建变更 |
| 6 | task 依赖引用方式 | 使用完整 slug，更新时同步检查 |
| 7 | /zoom-out 行为 | 照搬 Matt：提升抽象层级，给出模块全景地图 |
| 8 | /review-code 审查范围 | 参考 check（偏差/阻断/模式补全/文档债/autofix）+ diagnose（根因追问） |
| 9 | /prototype 定位 | 独立辅助技能，不入流水线，随时调用 |
| 10 | 入口类型（quick/feature/arch） | 去掉，所有变更走相同流程 |

## 产出

- `plan.md`（更新）：10 处修改
- `CONTEXT.md`（新建）：11 个术语、示例对话
- `change.md`（本文件）：v1 → v2 追加

## 关键决策（最终版）

| # | 决策 | 理由 |
|---|------|------|
| 1 | 状态标签全中文，精简为构思/就绪/进行中/完成/搁置 | 个人本地 + AI 协作，不需要 Matt 的多人协作标签 |
| 2 | 不使用 Matt 的 diagnose | /hunt 已覆盖且更丰富（Scope Blast、Gotchas） |
| 3 | /write-code = tdd 红绿重构 | 测试和实现同循环产出，去掉独立的 write-test / review-test |
| 4 | /review-code：AI 审 + autofix + plannotator 人类审 | 参考 check（偏差/阻断/模式补全/文档债）+ diagnose（根因追问→/improve-architecture） |
| 5 | /grill 和 /plan 拆分为两个命令 | grill 追问+领域对齐，plan 写方案 |
| 6 | 引入 changes/<name>/adr/ | 变更完成后一次性同步到 docs/adr/；搁置的不同步 |
| 7 | /prototype 为独立辅助技能，不入流水线 | 随时调用，验证代码层不确定性 |
| 8 | /improve-architecture 手动触发 | 扫描→列表→用户选择→创建变更 |
| 9 | 去掉入口类型（quick/feature/arch） | 所有变更走相同流程 |
| 10 | 引入 `/grill-me` 作为独立辅助技能 | 对应 Matt 的 grill-me：纯追问，不写文件，不绑定变更 |

---

# 变更 v3：任务拆解

## 产出文件

`tasks.md`

## 变更概述

将 plan.md 拆解为 15 个可独立验证的子任务，按 2 个并行层排列。

## 关键决策

| # | 决策 | 说明 |
|---|------|------|
| 1 | 每个阶段合并 reference + prompt 为一个子任务 | 二者操作同一阶段源材料，同生同灭，合并便于原子验证 |
| 2 | SKILL.md 单独作为一个子任务 | 入口文档被所有其他 reference 引用，先完成后便于对齐 |
| 3 | 删除操作单独拆为两个子任务 | references 5 个删除 + prompts 6 个删除，操作简单但独立验证 |

## 任务摘要

| ID | 子任务 | 涉及文件 |
|----|--------|---------|
| T1 | 更新 SKILL.md | `skills/development-workflow/SKILL.md` |
| T2 | /grill | `references/grill.md`, `prompts/grill.md` |
| T3 | /plan | `references/plan.md`, `prompts/plan.md` |
| T4 | /grill-me | `references/grill-me.md`, `prompts/grill-me.md` |
| T5 | /plan-to-tasks | `references/plan-to-tasks.md` |
| T6 | /write-code → TDD | `references/write-code.md`, `prompts/write-code.md` |
| T7 | /review-code | `references/review-code.md`, `prompts/review-code.md` |
| T8 | /improve-architecture | `references/improve-architecture.md`, `prompts/improve-architecture.md` |
| T9 | /prototype | `references/prototype.md`, `prompts/prototype.md` |
| T10 | /zoom-out | `references/zoom-out.md`, `prompts/zoom-out.md` |
| T11 | 删除旧 reference | 5 个文件 |
| T12 | 删除旧 prompt | 6 个文件 |
| T13 | 更新 extension | `extensions/dev-workflow.ts` |
| T14 | 更新测试 | `tests/dev-workflow.test.sh` |
| T15 | 更新项目文档 | `AGENTS.md`, `README.md` |

## 并行分层

| 层 | 包含任务 | 依赖 |
|----|---------|------|
| 1 | T1-T12 | 无 |
| 2 | T13-T15 | 第 1 层 |

---

# 变更 v4：编码完成

## 产出文件

**新建（12）：**
- `skills/development-workflow/references/grill.md`
- `skills/development-workflow/references/plan.md`
- `skills/development-workflow/references/grill-me.md`
- `skills/development-workflow/references/improve-architecture.md`
- `skills/development-workflow/references/prototype.md`
- `skills/development-workflow/references/zoom-out.md`
- `prompts/grill.md`
- `prompts/plan.md`
- `prompts/grill-me.md`
- `prompts/improve-architecture.md`
- `prompts/prototype.md`
- `prompts/zoom-out.md`

**修改（8）：**
- `skills/development-workflow/SKILL.md`
- `skills/development-workflow/references/plan-to-tasks.md`
- `skills/development-workflow/references/write-code.md`
- `skills/development-workflow/references/review-code.md`
- `prompts/write-code.md`
- `prompts/review-code.md`
- `extensions/dev-workflow.ts`
- `tests/dev-workflow.test.sh`

**删除（11）：**
- `skills/development-workflow/references/write-plan.md`
- `skills/development-workflow/references/review-plan.md`
- `skills/development-workflow/references/fix-code.md`
- `skills/development-workflow/references/write-test.md`
- `skills/development-workflow/references/review-test.md`
- `skills/development-workflow/references/write-docs.md`
- `prompts/write-plan.md`
- `prompts/review-plan.md`
- `prompts/fix-code.md`
- `prompts/write-test.md`
- `prompts/review-test.md`
- `prompts/write-docs.md`

**更新文档（3）：**
- `AGENTS.md`
- `README.md`
- `CONTEXT.md`

## 执行摘要

| 层 | 任务数 | 完成 | 失败 |
|----|--------|------|------|
| 1 | 12 | 12 | 0 |
| 2 | 3 | 3 | 0 |

## 验证结果

`tests/dev-workflow.test.sh`：119 项全部通过（0 失败）。

---

# 变更 v5：代码审阅（第 1 轮）

## 审查信息

- 审阅轮次：第 1 / 3 轮
- 变更文件数：35

## 范围偏差

无。所有变更与 tasks.md 清单一致，无超出范围的文件或未声明的改动。

## 硬性阻断

无。无注入漏洞、凭证泄露、依赖变更、破坏性操作。

## 模式补全

不适用——本次为文档重构，非 bug 修复。

## 文档债

无。AGENTS.md、CONTEXT.md、README.md 均已同步更新。

## Autofix

| # | 级别 | 文件 | 修复 | 状态 |
|---|------|------|------|------|
| 1 | 安全自动 | SKILL.md Plannotator 节 | review-plan/review-test 改为 plan/test | ✅ |

## 根因追问

- 问题：什么可以防止工作流命令名和文档不同步？
- 建议：test 脚本的旧命令检查已经覆盖了这个问题（检查无旧命令引用，检查新命令全部存在）。但可以考虑在 prompt 模板中统一引用格式，减少手工对齐。

## 总体结论

- **可交付判定**：是
- 阻断项：0 项

---

# 变更 v6：代码审阅（第 2 轮）

## 审查信息

- 审阅轮次：第 2 / 3 轮
- 变更文件数：35
- 审查范围：第 1 轮修复后 + handoff 相关新增

## 范围偏差

无。所有变更与 tasks.md 清单一致。handoff.md 和相关文件是后续独立提交（63bde68），不属于本次变更范围，但已纳入测试覆盖。

## 硬性阻断

无。无注入漏洞、凭证泄露、依赖变更、破坏性操作。

## 模式补全

不适用——本次为文档重构，非 bug 修复。

## 文档债

无。测试脚本已更新以覆盖 handoff 相关文件。

## Autofix

| # | 级别 | 文件 | 修复 | 状态 |
|---|------|------|------|------|
| 1 | 安全自动 | tests/dev-workflow.test.sh | 更新 NEW_PROMPTS/NEW_REFS/NEW_CMDS 数组包含 handoff；prompts 文件数从 9 更新为 10 | ✅ |

## 根因追问

- 问题：如何避免新增命令后测试脚本滞后？
- 建议：测试脚本中的文件列表应与 SKILL.md 中的命令清单保持同步。可以考虑从 SKILL.md 自动提取命令列表，或在添加新命令时强制更新测试。

## 总体结论

- **可交付判定**：是
- 阻断项：0 项

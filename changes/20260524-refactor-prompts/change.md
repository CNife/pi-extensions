---
状态: 完成
---

# 变更 v1：方案确立

## 变更目标

重构 prompt template 体系，从"大技能+prompt"转向"多个小技能"架构，解决吞参数问题。

## 关键决策

| # | 决策 | 理由 |
|---|------|------|
| 1 | 采用多个小技能架构 | 消除 prompt/skill 分层矛盾，解决吞参数问题 |
| 2 | cnife-pi-workflow 作为纯文档技能 | 符合单一职责原则，不执行操作 |
| 3 | 所有阶段技能单文件 | 保持一致性，简化维护 |
| 4 | 删除 prompts/ 目录 | 彻底消除两层维护 |
| 5 | 迁移 extension 到 manage-change 技能 | 统一入口，消除 extension 和 skills 并存 |

---

# 变更 v2：任务拆解

## 产出文件

tasks.md, tasks/T01-cnife-pi-workflow.md, tasks/T02-manage-change.md, tasks/T03-stage-skills.md, tasks/T04-independent-aux-skills.md, tasks/T05-delete-old-files.md, tasks/T06-update-agents-md.md, tasks/T07-update-readme-md.md, tasks/T08-update-context-md.md

## 变更概述

将 plan.md 拆解为 8 个可独立验证的子任务，按 2 个并行层排列。

## 任务摘要

| ID | 子任务 | 涉及文件 |
|----|--------|---------|
| T1 | 创建 cnife-pi-workflow 技能 | skills/cnife-pi-workflow/SKILL.md |
| T2 | 创建 manage-change 技能 | skills/manage-change/SKILL.md |
| T3 | 创建阶段技能（5个） | skills/grill/SKILL.md 等 |
| T4 | 创建独立/辅助技能（6个） | skills/improve-architecture/SKILL.md 等 |
| T5 | 删除旧文件 | prompts/、skills/development-workflow/、extensions/、tests/ |
| T6 | 更新 AGENTS.md | AGENTS.md |
| T7 | 更新 README.md | README.md |
| T8 | 更新 CONTEXT.md | CONTEXT.md |

## 并行分层

| 层 | 包含任务 | 依赖 |
|----|---------|------|
| 1 | T1, T2, T3, T4 | 无 |
| 2 | T5, T6, T7, T8 | T1-T4 |

---

# 变更 v3：编码完成

## 产出文件

**新建（13）：**
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

**删除（4）：**
- `prompts/` 目录（10 个文件）
- `skills/development-workflow/` 目录（SKILL.md + references/）
- `extensions/dev-workflow.ts`
- `tests/dev-workflow.test.sh`

**更新（3）：**
- `AGENTS.md`
- `README.md`
- `CONTEXT.md`

## 执行摘要

| task | 状态 |
|------|------|
| T01 | 完成 |
| T02 | 完成 |
| T03 | 完成 |
| T04 | 完成 |
| T05 | 完成 |
| T06 | 完成 |
| T07 | 完成 |
| T08 | 完成 |

---

# 变更 v4：代码审阅（第 1 轮）

## 审查信息

- 审阅轮次：第 1 / 3 轮
- 变更文件数：20

## 范围偏差

无。所有变更与 tasks.md 清单一致，无超出范围的文件或未声明的改动。

## 硬性阻断

无。无注入漏洞、凭证泄露、依赖变更、破坏性操作。

## 模式补全

不适用——本次为架构重构，非 bug 修复。

## 文档债

无。AGENTS.md、CONTEXT.md、README.md 均已同步更新。

## Autofix

无。

## 根因追问

不适用。

## 总体结论

- **可交付判定**：是
- 阻断项：0 项

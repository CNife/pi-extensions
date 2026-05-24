# 任务拆解

> 基于：plan.md
> 生成时间：2026-05-23
> 总子任务数：15 / 并行层数：2

## 子任务清单

| ID | 子任务 | 涉及文件 | 验证方式 |
|----|--------|---------|---------|
| T1 | 更新 SKILL.md 入口文档 | `skills/development-workflow/SKILL.md` | 包含 grill/plan/plan-to-tasks/write-code/review-code/improve-architecture/hunt/prototype/zoom-out/grill-me 命令跳转索引；流水线图无旧命令；文件结构含 CONTEXT.md 和 adr/ |
| T2 | /grill（reference + prompt） | `skills/development-workflow/references/grill.md`, `prompts/grill.md` | reference 含追问规则、CONTEXT.md 更新规则、ADR 创建条件；prompt ~100-150 字 |
| T3 | /plan（reference + prompt） | `skills/development-workflow/references/plan.md`, `prompts/plan.md` | reference 含 plan.md 写作模板、基于 grilled 结论的写入规则；prompt ~100-150 字 |
| T4 | /grill-me（reference + prompt） | `skills/development-workflow/references/grill-me.md`, `prompts/grill-me.md` | reference 含追问规则，明确不写文件不绑变更；prompt ~100-150 字 |
| T5 | /plan-to-tasks（更新 reference，prompt 不动） | `skills/development-workflow/references/plan-to-tasks.md` | reference 加入新 task 文件模板（frontmatter + 目标 + 涉及文件 + 验证方式）、完整 slug 依赖引用规则 |
| T6 | /write-code 替换为 TDD（reference + prompt） | `skills/development-workflow/references/write-code.md`, `prompts/write-code.md` | reference 替换为红绿重构完整说明（RED/GREEN/REFACTOR/task 状态更新）；prompt ~100-150 字 |
| T7 | /review-code 更新流程（reference + prompt） | `skills/development-workflow/references/review-code.md`, `prompts/review-code.md` | reference 替换为 AI 审→fix→plannotator 人类审流程；prompt 加入 plannotator review 步骤 |
| T8 | /improve-architecture（reference + prompt） | `skills/development-workflow/references/improve-architecture.md`, `prompts/improve-architecture.md` | reference 含扫描流程、改进列表输出格式、用户选择后创建变更的逻辑；prompt ~100-150 字 |
| T9 | /prototype（reference + prompt） | `skills/development-workflow/references/prototype.md`, `prompts/prototype.md` | reference 说明两种原型形态、可丢弃原则、结论写入 plan.md；prompt ~100-150 字 |
| T10 | /zoom-out（reference + prompt） | `skills/development-workflow/references/zoom-out.md`, `prompts/zoom-out.md` | reference 含提升抽象层级的操作指引、使用项目用语；prompt ~100-150 字 |
| T11 | 删除旧 reference 文件 | 5 个文件 | `review-plan.md`, `fix-code.md`, `write-test.md`, `review-test.md`, `write-docs.md` 全部不存在 |
| T12 | 删除旧 prompt 文件 | 6 个文件 | `write-plan.md`, `review-plan.md`, `fix-code.md`, `write-test.md`, `review-test.md`, `write-docs.md` 全部不存在 |
| T13 | 更新 extension | `extensions/dev-workflow.ts` | 注册新命令（grill/plan/grill-me/improve-architecture/prototype/zoom-out），移除旧命令（write-plan/review-plan/fix-code/write-test/review-test/write-docs）；更新变更目录解析以支持 tasks/ 和 adr/；/review-code 加入 plannotator review 引导 |
| T14 | 更新测试 | `tests/dev-workflow.test.sh` | 适配新命令清单和文件结构：检查新 reference/prompt 文件存在性 + 旧文件已删除 |
| T15 | 更新项目文档 | `AGENTS.md`, `README.md` | AGENTS.md 更新命令清单和目录约定（CONTEXT.md 和 adr/ 的结构）；README.md 更新功能说明 |

## 并行分层计划

### 第 1 层（无依赖，可并行）

所有 12 个子任务修改不同文件，无接口依赖：

- T1: 更新 SKILL.md
- T2: /grill
- T3: /plan
- T4: /grill-me
- T5: /plan-to-tasks
- T6: /write-code → TDD
- T7: /review-code
- T8: /improve-architecture
- T9: /prototype
- T10: /zoom-out
- T11: 删除旧 reference
- T12: 删除旧 prompt

### 第 2 层（依赖第 1 层）

- T13: 更新 extension（依赖 T2-T12 完成后文件结构确定；依赖 T1 SKILL.md 确定命令清单）
- T14: 更新测试（依赖全部第 1 层完成后验证文件结构）
- T15: 更新项目文档（依赖 T1 SKILL.md 确定命令清单和结构）

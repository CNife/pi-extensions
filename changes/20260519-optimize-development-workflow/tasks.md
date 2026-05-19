# 任务拆解

> 基于：plan.md
> 生成时间：2026-05-19
> 总子任务数：13 / 并行层数：1

## 子任务清单

| ID | 子任务 | 涉及文件 | 验证方式 |
|----|--------|---------|---------|
| T1 | 创建 AGENTS.md，描述项目结构、目录约定、扩展/技能/prompt 分工关系 | `AGENTS.md` | `test -f AGENTS.md && grep -q "分工" AGENTS.md` |
| T2 | 将 SKILL.md 重构为入口文档：保留流水线全景表、变更目录解析、核心文件约定、Plannotator 入口、各阶段跳转索引（指向 references/） | `skills/development-workflow/SKILL.md` | `grep -q "流水线全景" skills/development-workflow/SKILL.md && grep -q "变更目录解析" skills/development-workflow/SKILL.md && grep -q "Plannotator" skills/development-workflow/SKILL.md && grep -q "references/" skills/development-workflow/SKILL.md` |
| T3 | 提取 write-plan 阶段操作详情到 references/write-plan.md + 精简 prompts/write-plan.md 至 ~100-150 字 | `skills/development-workflow/references/write-plan.md`, `prompts/write-plan.md` | `test -f skills/development-workflow/references/write-plan.md && grep -q "development-workflow skill" prompts/write-plan.md` |
| T4 | 提取 review-plan 阶段操作详情到 references/review-plan.md（含"审核后同步更新 plan.md"步骤） + 精简 prompts/review-plan.md 至 ~100-150 字 | `skills/development-workflow/references/review-plan.md`, `prompts/review-plan.md` | `test -f skills/development-workflow/references/review-plan.md && grep -q "同步更新.*plan.md" skills/development-workflow/references/review-plan.md && grep -q "development-workflow skill" prompts/review-plan.md` |
| T5 | 提取 plan-to-tasks 阶段操作详情到 references/plan-to-tasks.md + 精简 prompts/plan-to-tasks.md 至 ~100-150 字 | `skills/development-workflow/references/plan-to-tasks.md`, `prompts/plan-to-tasks.md` | `test -f skills/development-workflow/references/plan-to-tasks.md && grep -q "development-workflow skill" prompts/plan-to-tasks.md` |
| T6 | 提取 write-code 阶段操作详情到 references/write-code.md + 精简 prompts/write-code.md 至 ~100-150 字 | `skills/development-workflow/references/write-code.md`, `prompts/write-code.md` | `test -f skills/development-workflow/references/write-code.md && grep -q "development-workflow skill" prompts/write-code.md` |
| T7 | 提取 review-code 阶段操作详情到 references/review-code.md + 精简 prompts/review-code.md 至 ~100-150 字 | `skills/development-workflow/references/review-code.md`, `prompts/review-code.md` | `test -f skills/development-workflow/references/review-code.md && grep -q "development-workflow skill" prompts/review-code.md` |
| T8 | 提取 fix-code 阶段操作详情到 references/fix-code.md + 精简 prompts/fix-code.md 至 ~100-150 字 | `skills/development-workflow/references/fix-code.md`, `prompts/fix-code.md` | `test -f skills/development-workflow/references/fix-code.md && grep -q "development-workflow skill" prompts/fix-code.md` |
| T9 | 提取 write-test 阶段操作详情到 references/write-test.md + 精简 prompts/write-test.md 至 ~100-150 字 | `skills/development-workflow/references/write-test.md`, `prompts/write-test.md` | `test -f skills/development-workflow/references/write-test.md && grep -q "development-workflow skill" prompts/write-test.md` |
| T10 | 提取 review-test 阶段操作详情到 references/review-test.md + 精简 prompts/review-test.md 至 ~100-150 字 | `skills/development-workflow/references/review-test.md`, `prompts/review-test.md` | `test -f skills/development-workflow/references/review-test.md && grep -q "development-workflow skill" prompts/review-test.md` |
| T11 | 提取 write-docs 阶段操作详情到 references/write-docs.md + 精简 prompts/write-docs.md 至 ~100-150 字 | `skills/development-workflow/references/write-docs.md`, `prompts/write-docs.md` | `test -f skills/development-workflow/references/write-docs.md && grep -q "development-workflow skill" prompts/write-docs.md` |
| T12 | 更新 README.md，添加 AGENTS.md 引用，更新 SKILL.md 描述以反映入口文档角色 | `README.md` | `grep -q "AGENTS" README.md` |
| T13 | 更新 tests/dev-workflow.test.sh，新增 3 项检查：AGENTS.md 存在性、AGENTS.md 内容（分工说明）、README 引用 AGENTS.md | `tests/dev-workflow.test.sh` | `grep -q "AGENTS.md" tests/dev-workflow.test.sh && grep -q "分工" tests/dev-workflow.test.sh` |

## 并行分层计划

### 第 1 层（无依赖，可并行）

所有 13 个子任务修改不同文件、无接口依赖，按 ID 顺序执行：

- T1: 创建 AGENTS.md
- T2: 重构 SKILL.md 为入口文档
- T3: write-plan 阶段（reference + 精简 prompt）
- T4: review-plan 阶段（reference + 精简 prompt，含"同步更新 plan.md"规则）
- T5: plan-to-tasks 阶段（reference + 精简 prompt）
- T6: write-code 阶段（reference + 精简 prompt）
- T7: review-code 阶段（reference + 精简 prompt）
- T8: fix-code 阶段（reference + 精简 prompt）
- T9: write-test 阶段（reference + 精简 prompt）
- T10: review-test 阶段（reference + 精简 prompt）
- T11: write-docs 阶段（reference + 精简 prompt）
- T12: 更新 README.md
- T13: 更新 tests/dev-workflow.test.sh

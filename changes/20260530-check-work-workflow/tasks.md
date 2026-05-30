# 任务拆解

> 基于：plan.md
> 生成时间：2026-05-31
> 总子任务数：3 / 并行层数：2

## 子任务清单

| ID | 子任务 | 涉及文件 | 验证方式 |
|----|--------|---------|---------|
| T1 | 创建 check-work 技能 | skills/check-work/SKILL.md | 文件存在 + 审查阶段表完整 |
| T2 | 创建 init-builder / init-checker 技能 | skills/init-builder/SKILL.md, skills/init-checker/SKILL.md | 文件存在 + frontmatter 正确 |
| T3 | 更新现有技能和文档 | cnife-pi-workflow, handoff, review-code, README, docs/ | review-code 已删 + 无引用残留 + README 一致 |

## 并行分层计划

### 第 1 层（无依赖，可并行）

- T1: 创建 check-work 技能
- T2: 创建 init-builder / init-checker 技能

### 第 2 层（依赖第 1 层）

- T3: 更新现有技能和文档（依赖 T1, T2）

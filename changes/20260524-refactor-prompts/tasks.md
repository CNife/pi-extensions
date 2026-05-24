# 任务拆解

> 基于：plan.md
> 生成时间：2026-05-24
> 总子任务数：8 / 并行层数：2

## 子任务清单

| ID | 子任务 | 涉及文件 | 验证方式 |
|----|--------|---------|---------|
| T1 | 创建 cnife-pi-workflow 技能 | skills/cnife-pi-workflow/SKILL.md | 文件存在、包含 frontmatter、引用所有技能 |
| T2 | 创建 manage-change 技能 | skills/manage-change/SKILL.md | 文件存在、包含 frontmatter、4 个子命令 |
| T3 | 创建阶段技能（5个） | skills/grill/SKILL.md 等 | 5 个文件存在、包含 frontmatter |
| T4 | 创建独立/辅助技能（6个） | skills/improve-architecture/SKILL.md 等 | 6 个文件存在、包含 frontmatter |
| T5 | 删除旧文件 | prompts/、skills/development-workflow/、extensions/、tests/ | 4 个目录/文件不存在 |
| T6 | 更新 AGENTS.md | AGENTS.md | 包含新技能清单、不再引用 prompts/ |
| T7 | 更新 README.md | README.md | 包含 13 个技能引用、不再引用 prompts/ |
| T8 | 更新 CONTEXT.md | CONTEXT.md | 包含新架构用语、不再引用 prompt template |

## 并行分层计划

### 第 1 层（无依赖，可并行）

- T1: 创建 cnife-pi-workflow 技能
- T2: 创建 manage-change 技能
- T3: 创建阶段技能（5个）
- T4: 创建独立/辅助技能（6个）

### 第 2 层（依赖第 1 层）

- T5: 删除旧文件（依赖 T1-T4）
- T6: 更新 AGENTS.md（依赖 T5）
- T7: 更新 README.md（依赖 T5）
- T8: 更新 CONTEXT.md（依赖 T5）

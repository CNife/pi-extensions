---
status: 完成
priority: 高
depends_on: []
---
# T03: 创建阶段技能（5个）

**目标**：创建流水线核心阶段技能，合并 references 内容

**涉及文件**：
- `skills/grill/SKILL.md`（新建，合并 references/grill.md）
- `skills/plan/SKILL.md`（新建，合并 references/plan.md）
- `skills/plan-to-tasks/SKILL.md`（新建，合并 references/plan-to-tasks.md）
- `skills/write-code/SKILL.md`（新建，合并 references/write-code.md）
- `skills/review-code/SKILL.md`（新建，合并 references/review-code.md）

**内容要求**：
- 每个 SKILL.md 包含 frontmatter（name、description、argument-hint）
- 合并原 references/*.md 的完整操作说明
- 包含变更目录解析规则
- 包含停止条件

**验证方式**：
- 5 个文件都存在且非空
- 每个文件包含 frontmatter
- 每个文件包含完整的操作说明

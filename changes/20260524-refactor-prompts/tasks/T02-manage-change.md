---
status: 完成
priority: 高
depends_on: []
---
# T02: 创建 manage-change 技能

**目标**：创建变更管理技能，替代 extensions/dev-workflow.ts 的功能

**涉及文件**：
- `skills/manage-change/SKILL.md`（新建）

**内容要求**：
- frontmatter：name、description、argument-hint
- 子命令说明：new、switch、status、list
- 变更目录解析规则
- 文件系统操作说明（创建目录、读写 .active_change）

**验证方式**：
- 文件存在且非空
- 包含 frontmatter（name、description）
- 包含 4 个子命令的说明

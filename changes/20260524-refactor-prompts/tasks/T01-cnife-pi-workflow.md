---
status: 完成
priority: 高
depends_on: []
---
# T01: 创建 cnife-pi-workflow 技能

**目标**：创建工作流全景文档技能，描述流水线顺序、技能关系、使用指南

**涉及文件**：
- `skills/cnife-pi-workflow/SKILL.md`（新建）

**内容要求**：
- frontmatter：name、description
- 流水线全景图：grill → plan → plan-to-tasks → write-code → review-code
- 辅助技能清单：prototype、zoom-out、grill-me、handoff、hunt
- 技能依赖关系：哪些技能有前后置依赖
- 变更目录结构：changes/YYYYMMDD-<简写>/ 的文件约定
- 快速开始指南：新用户如何开始第一个变更
- 所有技能清单（与 README.md 同步）

**验证方式**：
- 文件存在且非空
- 包含 frontmatter（name、description）
- 包含所有 13 个技能的引用

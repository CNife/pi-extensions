---
status: 完成
priority: 中
depends_on: [T05-delete-old-files]
---
# T06: 更新 AGENTS.md

**目标**：更新 AI 协作规范，反映新的技能结构

**涉及文件**：
- `AGENTS.md`

**更新内容**：
- 项目结构：删除 prompts/、extensions/、tests/ 目录，更新 skills/ 结构
- 目录约定：删除 prompts/ 和 extensions/ 的说明
- 扩展/技能/Prompt 的分工：删除 Prompt 部分，更新技能说明
- 协作流程：更新为技能触发方式

**验证方式**：
- 文件存在且非空
- 不再引用 prompts/ 目录
- 包含新的技能清单
- 包含 cnife-pi-workflow 和 manage-change 的说明

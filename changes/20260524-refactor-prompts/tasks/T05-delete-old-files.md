---
status: 完成
priority: 高
depends_on: [T01-cnife-pi-workflow, T02-manage-change, T03-stage-skills, T04-independent-aux-skills]
---
# T05: 删除旧文件

**目标**：删除不再需要的旧文件，清理项目结构

**涉及文件**：
- `prompts/` 目录（10 个文件）：grill.md、plan.md、grill-me.md、plan-to-tasks.md、write-code.md、review-code.md、improve-architecture.md、prototype.md、zoom-out.md、handoff.md
- `skills/development-workflow/` 目录：SKILL.md、references/（10 个文件）
- `extensions/dev-workflow.ts`
- `tests/dev-workflow.test.sh`

**验证方式**：
- `prompts/` 目录不存在
- `skills/development-workflow/` 目录不存在
- `extensions/dev-workflow.ts` 不存在
- `tests/dev-workflow.test.sh` 不存在

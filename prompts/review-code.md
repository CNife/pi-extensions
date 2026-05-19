---
description: 审阅代码变更是否符合tasks.md计划范围，检查代码质量，追加报告到change.md
argument-hint: "[变更目录]"
---

按 development-workflow skill 中的变更目录解析规则确定 `$CHANGE_DIR`。

读取 `change.md` 最新变更摘要，对照 `tasks.md` 和 `plan.md`，审阅代码变更的目标完成度、范围符合性、代码质量，追加审阅报告。每次变更最多 3 轮。

### 最少操作规则

- 逐文件对照 tasks.md 检查范围符合性
- Hard Stops 有一条即判不可交付
- Format/lint 自动修复最多 2 轮
- 仅运行命令和写报告，不做 AI 代码编辑

完整审阅流程、输出格式请参见 SKILL.md → [references/review-code.md](../skills/development-workflow/references/review-code.md)。

### 停止条件

所有检查完成、报告追加完毕 → 输出下一步指引并停止。

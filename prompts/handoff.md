---
description: 压缩当前对话为交接文档，供下一个会话继续
argument-hint: "[下次会话的重点]"
---

独立辅助技能。将当前对话总结为交接文档，保存到系统临时目录（非工作区）。

### 最少操作规则

- 引用已有产物（plan.md、ADR、commit、diff）而非重复内容
- 脱敏：移除 API key、密码、个人信息
- 包含「建议技能」节，提示下一个会话应调用的命令

完整说明请参见 development-workflow skill → [references/handoff.md](../skills/development-workflow/references/handoff.md)。

### 停止条件

交接文档写入完成 → 停止。

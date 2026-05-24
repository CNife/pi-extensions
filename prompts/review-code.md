---
description: AI审查代码变更后启动plannotator人类审查
argument-hint: "[变更目录]"
---

按 development-workflow skill 中的变更目录解析规则确定 `$CHANGE_DIR`。

对照 `$CHANGE_DIR/tasks.md` 和 `$CHANGE_DIR/plan.md`，AI 审查代码变更：范围偏差、🔴 硬性阻断、模式补全、文档债。安全自动修复直接改，需确认的列出等判断。

审查完成后启动 Plannotator 人类审查：

```bash
plannotator review
```

### 最少操作规则

- 硬性阻断有一条即不可交付
- 安全自动修复直接改，需确认的列出
- 架构问题留给 Plannotator 人类审
- 最后追问根因 → 推荐 /improve-architecture

完整审阅流程请参见 SKILL.md → [references/review-code.md](../skills/development-workflow/references/review-code.md)。

### 停止条件

Plannotator 反馈处理完毕 → 追加 change.md，停止。

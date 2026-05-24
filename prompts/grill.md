---
description: 逐条追问澄清变更范围和用语，对照项目文档消除歧义
argument-hint: "[变更目录]"
---

按 development-workflow skill 中的变更目录解析规则确定 `$CHANGE_DIR`。

逐条追问用户以澄清变更范围和用语。对照根 `CONTEXT.md` 和 `docs/adr/` 发现冲突，用语确定即时更新 `$CHANGE_DIR/CONTEXT.md`，值得记录的决策创建 `$CHANGE_DIR/adr/`。

### 最少操作规则

- 每次只问一个问题，附带推荐选项和理由
- 用语确定立即写入 CONTEXT.md，不攒批
- ADR 仅在三条件满足时创建（难以逆转 + 无上下文看不懂 + 有真实取舍）
- 用户用语和已有 CONTEXT.md 冲突立即指出

完整追问规则、用语管理、ADR 模板请参见 SKILL.md → [references/grill.md](../skills/development-workflow/references/grill.md)。

### 停止条件

所有决策分支理清 → 追加 change.md，停止并提示进入 `/plan`。

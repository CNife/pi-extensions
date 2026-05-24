---
description: 基于 grill 结论一次性写入变更方案
argument-hint: "[变更目录]"
---

按 development-workflow skill 中的变更目录解析规则确定 `$CHANGE_DIR`。

基于 `$CHANGE_DIR/change.md` 中最新 grill 节的澄清结论，一次性写入 `$CHANGE_DIR/plan.md`。不再追问用户。

### 最少操作规则

- 覆盖写入 plan.md，使用模板（目标/背景/最终方案/关键决策/用语/假设）
- 用语与 `$CHANGE_DIR/CONTEXT.md` 保持一致
- 不引入 grill 未讨论的新概念
- 未澄清点以假设声明

完整模板和规则请参见 SKILL.md → [references/plan.md](../skills/development-workflow/references/plan.md)。

### 停止条件

plan.md 写入完毕 → 停止，提示进入 `/plan-to-tasks`。

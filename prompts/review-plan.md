---
description: 审核plan.md，排查模糊、矛盾、疏漏，追加结论到change.md
argument-hint: "[变更目录]"
---

按 development-workflow skill 中的变更目录解析规则确定 `$CHANGE_DIR`。

审核 `plan.md`，排查四类问题（范围偏差、表述模糊、逻辑矛盾、内容疏漏），与用户确认后将修改结论追加到 `change.md`，**同步更新 plan.md**。

### 最少操作规则

- 仅以 plan.md 原始内容为依据，不引入外部信息
- 每条问题标注位置、严重程度（🔴 阻断 / 🟡 建议）、详细描述
- 修改结论在用户确认后再写入

完整审核规则、输出格式请参见 SKILL.md → [references/review-plan.md](../skills/development-workflow/references/review-plan.md)。

### 停止条件

所有问题已确认、修改结论已追加到 change.md 且 plan.md 已同步更新 → 停止。

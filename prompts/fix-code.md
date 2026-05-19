---
description: 根据review-code审阅报告与用户讨论确定修复范围，修改代码并更新change.md
argument-hint: "[变更目录]"
---

按 development-workflow skill 中的变更目录解析规则确定 `$CHANGE_DIR`。

读取 `change.md` 最新「代码审阅」报告的未通过项，与用户讨论确定修复范围，执行修复并追加修复记录。

### 最少操作规则

- 阻断项必须先处理，建议项用户可选择跳过
- 修复限于用户确认的清单，不扩大范围
- 修复后必须重新运行 format/lint 检查

完整修复流程、输出格式请参见 SKILL.md → [references/fix-code.md](../skills/development-workflow/references/fix-code.md)。

### 停止条件

所有修复完成并追加记录 → 输出「进入 review-code」指引并停止。

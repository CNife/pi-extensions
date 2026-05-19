---
description: 根据变更内容更新项目文档，包括README、AGENTS、docs/等
argument-hint: "[变更目录]"
---

按 development-workflow skill 中的变更目录解析规则确定 `$CHANGE_DIR`。

读取 `change.md` 完整变更历程，评估本次变更对项目文档的影响，更新相关文档并追加记录。

### 最少操作规则

- 只修改与本次变更直接相关的内容，不动无关章节
- 删除过时信息，保留历史引用
- 新增内容保持与现有文档一致的风格

完整文档更新流程请参见 SKILL.md → [references/write-docs.md](../skills/development-workflow/references/write-docs.md)。

### 停止条件

所有需要更新的文档已更新且记录追加完毕 → 停止。

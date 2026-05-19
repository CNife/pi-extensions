---
description: 读取tasks.md分层计划，按层顺序逐个执行编码任务并验证
argument-hint: "[变更目录]"
---

按 development-workflow skill 中的变更目录解析规则确定 `$CHANGE_DIR`。

读取 `tasks.md` 和 `plan.md`，按并行分层计划逐层推进：每层内逐个执行编码任务，完成后运行验证命令，全部通过则进入下一层。

### 最少操作规则

- 每个任务只修改「涉及文件」列指定的文件
- 验证命令来自 tasks.md 的「验证方式」列，每完成一个任务立即验证
- 验证失败最多修复 3 次

完整编码与验证规则、change.md 追加格式请参见 SKILL.md → [references/write-code.md](../skills/development-workflow/references/write-code.md)。

### 停止条件

所有层完成 → 更新 change.md，输出完成总结并停止。

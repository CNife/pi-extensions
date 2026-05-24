---
description: 按task文件执行TDD红绿重构，逐任务推进
argument-hint: "[变更目录]"
---

按 development-workflow skill 中的变更目录解析规则确定 `$CHANGE_DIR`。

读取 `$CHANGE_DIR/tasks/` 下 task 文件，按依赖顺序逐 task 执行 TDD 红绿重构：

1. **RED**：为该 task 写集成测试 → 确认失败
2. **GREEN**：写最小实现让测试通过（最多重试 3 次）
3. **REFACTOR**：重构代码，保持测试通过
4. 更新 task frontmatter `status: 完成`，进入下一个 task

### 最少操作规则

- 每个 task 只修改其「涉及文件」列指定的文件
- 测试通过公共接口验证行为，不测实现细节
- 红绿重构逐 task 执行，不跨 task
- 3 次修复不通过则停止

完整 TDD 规则请参见 SKILL.md → [references/write-code.md](../skills/development-workflow/references/write-code.md)。

### 停止条件

所有 task 完成 → 追加 change.md，输出完成总结并停止。

---
status: 完成
priority: 高
depends_on: []
---

# T01: 添加 promptSnippet 和 promptGuidelines 字段

**目标**：为 executePython 工具添加 promptSnippet 和 promptGuidelines 字段，明确工具定位和使用场景

**涉及文件**：
- extensions/execute-python.ts

**验证方式**：
1. 检查代码中是否添加了 `promptSnippet` 和 `promptGuidelines` 字段
2. 验证 `promptGuidelines` 包含四个使用指南：
   - 复杂任务场景（计算、数据处理、heredoc）
   - packages 参数强调
   - bash 边界说明
   - 无转义优势

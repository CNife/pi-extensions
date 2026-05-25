# 任务拆解

> 基于：plan.md
> 生成时间：2026-05-25
> 总子任务数：2 / 并行层数：1

## 子任务清单

| ID | 子任务 | 涉及文件 | 验证方式 |
|----|--------|---------|---------|
| T01 | 添加 promptSnippet 和 promptGuidelines 字段 | extensions/execute-python.ts | 检查代码中是否添加了这两个字段，验证 promptGuidelines 包含四个使用指南 | ✅ |
| T02 | 优化 description 和 packages 参数描述 | extensions/execute-python.ts | 检查 description 和 packages 参数描述是否符合 pi 官方模式 | ✅ |

## 并行分层计划

### 第 1 层（无依赖，可并行）

- T01: 添加 promptSnippet 和 promptGuidelines 字段
- T02: 优化 description 和 packages 参数描述

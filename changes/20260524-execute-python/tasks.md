# 任务拆解

> 基于：plan.md
> 生成时间：2026-05-24
> 总子任务数：2 / 并行层数：2

## 子任务清单

| ID | 子任务 | 涉及文件 | 验证方式 |
|----|--------|---------|---------|
| T01 | 重写 execute-python.ts | extensions/execute-python.ts | 编译通过 + pi 加载成功 + 手动测试 |
| T02 | 更新测试脚本 | tests/execute-python.test.sh, tests/execute-python.e2e.sh | 运行测试脚本 |

## 并行分层计划

### 第 1 层（无依赖，可并行）

- T01: 重写 execute-python.ts

### 第 2 层（依赖第 1 层）

- T02: 更新测试脚本（依赖 T01）

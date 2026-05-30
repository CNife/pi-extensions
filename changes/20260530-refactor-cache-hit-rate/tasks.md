# 任务拆解

> 基于：plan.md v3
> 生成时间：2026-05-30
> 总子任务数：5 / 并行层数：3

## 子任务清单

| ID | 子任务 | 涉及文件 | 验证方式 |
|----|--------|---------|---------|
| T1 | 配置文件加载与验证 | cache-hit-rate.ts | 删除/损坏配置文件，验证自动创建和错误提示 |
| T2 | 核心状态与采样逻辑 | cache-hit-rate.ts | 构造模拟 sessionManager 验证 buildState 和加权计算 |
| T3 | Footer 格式化与颜色 | cache-hit-rate.ts | 构造不同状态验证输出字符串和颜色规则 |
| T4 | 事件处理重写 | cache-hit-rate.ts | 模拟 message/model/compact 事件验证 footer 更新 |
| T5 | 更新 README 文档 | README.md | 阅读验证文档无旧描述残留 |

## 并行分层计划

### 第 1 层（无依赖，可并行）

- T1: 配置文件加载与验证

### 第 2 层（依赖 T1）

- T2: 核心状态与采样逻辑（依赖 T1 — 需要 recentN）

### 第 3 层（依赖 T1 + T2）

- T3: Footer 格式化与颜色（依赖 T1, T2）

### 第 4 层（依赖 T2 + T3）

- T4: 事件处理重写（依赖 T2, T3）

### 第 5 层（依赖 T4）

- T5: 更新 README 文档（依赖 T4）

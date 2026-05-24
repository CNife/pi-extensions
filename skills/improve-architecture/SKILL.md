---
name: improve-architecture
description: 扫描代码库发现架构改进机会，产出列表供选择
argument-hint: "[项目目录]"
---

# Improve-Architecture — 架构改进扫描

手动触发。读取根 `CONTEXT.md` 和 `docs/adr/`，扫描源码目录识别架构改进机会。

## 触发方式

手动触发——你觉得项目某处架构有问题，运行 `/improve-architecture`。

## 扫描流程

1. 读取根 `CONTEXT.md` 和 `docs/adr/`，理解项目用语和已有决策
2. 扫描 `src/` 目录（或其他项目源码目录），识别：
   - 模块边界模糊（耦合过紧）
   - 抽象层不完整（深层模块可提取）
   - 决策违背（代码和 ADR 不一致）
   - 模式重复（多处同类实现）
3. 输出改进列表

## 改进列表格式

```markdown
# 架构改进机会

| # | 问题 | 位置 | 严重程度 | 建议 |
|---|------|------|---------|------|
| 1 | 订单和账单通过同步 HTTP 耦合 | src/ordering/*.ts, src/billing/*.ts | 高 | 引入领域事件解耦 |
| 2 | 三个模块各自实现了相似的缓存逻辑 | src/a/cache.ts, src/b/cache.ts, src/c/cache.ts | 中 | 提取深层缓存模块 |
```

## 用户选择

等待用户决定哪些改进要执行、哪些忽略。确认后，为每个选中的改进创建 `changes/<name>/plan.md`。

## 停止条件

- 无改进发现 → 停止
- 用户确认选择 → 创建变更，停止

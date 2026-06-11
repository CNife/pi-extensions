---
date: 2026-06-11T16:05:28+0800
author: 蔡涛
commit: ddcabd8
branch: main
repository: pi-extensions
topic: "optimize-agent-loop-reflection-config"
tags: [intent, frd, agent-loop-reflection]
status: ready
last_updated: 2026-06-11T16:05:28+0800
last_updated_by: 蔡涛
---

# FRD: optimize-agent-loop-reflection-config

## Summary

精简 `@cnife/pi-agent-loop-reflection` 的配置，将 `AgentLoopReflectionConfig` 从 4 个字段缩减为 2 个字段，同时清理相关的不必要代码逻辑。版本升至 0.2.0。

## Problem & Intent

作为维护者，觉得当前配置结构冗余——`thresholdTurns` 和 `repeatEveryTurns` 功能高度相似（默认值都是 10），`enabled` 字段可通过卸载扩展替代。需要精简配置以降低维护成本。

## Goals

- 将配置字段从 4 个精简到 2 个
- 去掉因被精简字段而产生的多余代码逻辑
- 版本升至 0.2.0

## Non-Goals

- 不改变提醒功能的运行时行为（提醒时机、频率、内容语义不变）
- 不添加新功能或新配置项
- 不做旧配置文件的自动迁移

## Functional Requirements

1. 配置类型 `AgentLoopReflectionConfig` 只包含两个字段：`reminderTurnsInterval`（number）和 `reminderText`（string）
2. `reminderTurnsInterval` 的默认值为 `10`，等价于原来 `thresholdTurns` 和 `repeatEveryTurns` 的默认值
3. `reminderText` 的默认值不变
4. 运行时逻辑统一使用 `reminderTurnsInterval` 作为首次提醒等待轮次和后续提醒间隔轮次
5. 移除 `enabled` 相关的所有检查逻辑（`turn_end` 中的 `if (!config.enabled) return;`）
6. `loadConfig()` 的验证逻辑更新为只验证两个字段
7. 保留 `STATUS_KEY` 常量和 `setConfigErrorStatus()` 函数不变（命名常量防止 magic string，不属于不必要的逻辑）

## Non-Functional Requirements

- **Performance**: 无影响，配置加载和验证路径不变
- **Security**: 无影响
- **UX / Accessibility**: 用户需要手动更新配置文件使用新格式（旧配置不再兼容）
- **Reliability**: 加载配置时，如果 JSON 文件包含旧字段，不会报错但会被忽略（未知字段被 JSON.parse 忽略），回退到默认值

## Constraints & Assumptions

- 假设用户升级后能手动更新配置文件，或接受配置回退到默认值
- 假设无其他包或工具依赖 `AgentLoopReflectionConfig` 类型的完整 4 字段结构
- 包版本升至 0.2.0（minor 版本，向后不兼容的配置变更）

## Acceptance Criteria

- [ ] `AgentLoopReflectionConfig` 类型定义只包含 `reminderTurnsInterval` 和 `reminderText` 两个字段
- [ ] `DEFAULT_CONFIG` 对象只包含 `reminderTurnsInterval: 10` 和 `reminderText`（默认文本不变）
- [ ] `loadConfig()` 中不再校验 `enabled`、`thresholdTurns`、`repeatEveryTurns`
- [ ] `turn_end` 处理器中不再有 `enabled` 条件判断
- [ ] `resetCadence()` 使用 `reminderTurnsInterval` 作为单参数
- [ ] 旧配置文件 `cnife-agent-loop-reflection.json` 中有 `enabled`/`thresholdTurns`/`repeatEveryTurns` 时，加载后使用默认值（字段被忽略），无报错
- [ ] `package.json` 中 version 字段为 `0.2.0`
- [ ] `README.md` 中的配置表格已更新为新字段

## Recommended Approach

在 `packages/agent-loop-reflection/extensions/index.ts` 中进行原地修改：修改类型定义、默认值、验证逻辑和运行时逻辑，删除 `enabled` 相关的所有代码路径，合并两个轮次字段为一个。同步更新 `README.md` 和 `package.json` 版本号。不写迁移脚本。

## Decisions

### 合并 thresholdTurns 和 repeatEveryTurns

**Question**: `thresholdTurns`（首条提醒前等待轮次）和 `repeatEveryTurns`（后续提醒间隔轮次）默认值都是 10，功能上非常相似——区别仅在于第一个触发时机 vs 后续间隔。你是否有意图将它们合并成一个字段？
**Recommended**: 合并为一个字段
**Chosen**: 合并为一个字段 `reminderTurnsInterval`
**Rationale**: 两个字段语义高度重叠，默认值相同，合并后减少维护点

### 移除 enabled 字段

**Question**: `enabled` (boolean, 默认 true) 字段——用户可以通过从 package.json 移除扩展来完全禁用功能。保留这个字段作为快捷开关是否有必要？
**Recommended**: 移除 enabled
**Chosen**: 移除
**Rationale**: 功能可由卸载扩展替代，移除后减少配置复杂度

### 保留 reminderText

**Question**: `reminderText` 是实际发送给 LLM 的提醒内容——这是功能的核心，但它是 9 行中文长文本，是否也在「不必要」之列？
**Recommended**: 保留 reminderText
**Chosen**: 保留
**Rationale**: 这是功能的核心负载内容，用户需要自定义能力

### 合并字段命名

**Question**: 合并后的间隔字段应该叫什么名字？
**Recommended**: intervalTurns
**Chosen**: `reminderTurnsInterval`
**Rationale**: 开发者自定义命名，强调字段在提醒场景中的语义——reminder + turns + interval

### 向后兼容策略

**Question**: 如何处理已有的配置文件兼容性？
**Recommended**: 自动迁移+警告
**Chosen**: 直接断舍离（不兼容旧配置）
**Rationale**: 用户量小，手动更新配置文件成本低；避免迁移代码带来的维护负担

### 代码精简范围

**Question**: 除了精简配置字段，还需要对代码做其他优化吗？
**Recommended**: 仅精简配置字段
**Chosen**: 同时精简代码（去掉不必要的逻辑）
**Rationale**: 精简配置字段后，`enabled` 检查、验证逻辑、`resetCadence` 参数等都可以同步简化

## Open Questions

无。所有问题在面试中已解决。

## Suggested Follow-ups

（无）

## References

- `packages/agent-loop-reflection/extensions/index.ts` — 唯一源文件（192行），包含类型定义、配置加载、验证和运行时逻辑
- `packages/agent-loop-reflection/README.md` — 需要更新配置文档
- `packages/agent-loop-reflection/package.json` — 需要更新版本号

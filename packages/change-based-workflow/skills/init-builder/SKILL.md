---
name: init-builder
description: 执行 Agent 初始化——定位变更目录、了解进度、检查待处理审查文件
---

# Init-Builder — 执行 Agent 初始化

双 Agent 模式下，执行 Agent 会话的就位入口。

## 工作流程

1. 读取 `changes/.active_change` 定位当前变更目录
2. 读取 `change.md` 了解当前进度（最近几条记录及其 `[执行]/[审查]` 标记）
3. 输出当前状态：
   - 当前变更目录名
   - 变更当前阶段（plan / tasks / code 进行中）
   - 产物列表（plan.md、tasks/、代码文件）
4. 检查 `checkpoints/` 下是否有最近一次审查的结论：
   - 如果有，读取审查结论，列出待修正项
   - 如果没有，提示直接进入当前阶段

## 下一步

输出当前阶段和推荐操作：

| 当前阶段 | 推荐命令 |
|---------|---------|
| 无产物 | `/grill` |
| plan.md 已存在 | `/plan-to-tasks` |
| tasks/ 已存在 | `/write-code` |
| 有审查结论待修正 | 优先修正后继续 |

## 停止条件

- `.active_change` 不存在 → 停止，提示用户先用 `/manage-change new`
- 状态输出完毕 → 停止

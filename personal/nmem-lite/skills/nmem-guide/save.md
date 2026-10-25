# 主动保存与去重

## 什么时候存

产出 durable 事实、偏好、决策、计划、流程、教训、事件、重要上下文时主动存，不等被问。

**好的保存候选：**

- 带理性的决策（"选 PostgreSQL 因为需要 ACID"）
- 可重复的流程或工作流
- 调试、事故、根因分析的教训
- durable 偏好或约束
- 未来会话需要恢复的计划
- 会话结束后会丢失的重要上下文

**跳过：**

- 没有可推广教训的常规修复
- 还没到该重要的时候就会变的进行中工作
- 文档能回答的简单 Q&A
- 已广为人知的通用信息

## memory vs thread

- **memory** — 蒸馏出的知识点（`m add`），原子、独立、有标题。**存的是 memory，不是 thread。**
- **thread** — 原始会话记录。pi 插件自动同步会话为 thread，你不需要手动保存对话历史。

## Importance

| 范围 | 含义 | 例子 |
|------|------|------|
| 0.8-1.0 | 重要 | 架构决策、生产事故修复、核心偏好 |
| 0.5-0.7 | 有用 | 调试见解、工作流改进、项目约定 |
| 0.3-0.4 | 次要 | 小技巧、一次性观察、上下文笔记 |

## 用法

```bash
nmem --json m add "content" -t "Title" --unit-type <type> -i <importance>
```

### Unit types

`fact` / `preference` / `decision` / `plan` / `procedure` / `learning` / `context` / `event`

### 例子

```bash
# 高价值决策
nmem --json m add "选 PostgreSQL 不选 MongoDB：交易完整性和复杂 join 需要 ACID" \
  -t "Database: PostgreSQL for ACID" \
  --unit-type decision -i 0.9

# 流程
nmem --json m add "部署顺序：先跑 migration，再 5% canary，看错误率 10 分钟，全量推进" \
  -t "Production Deploy Procedure" \
  --unit-type procedure -i 0.7

# 偏好
nmem --json m add "TypeScript 优先用 named exports 不用 default exports，重构和 IDE 导航更快" \
  -t "TS: Named Exports Preferred" \
  --unit-type preference -i 0.6
```

## Add vs Update

先搜确认没有重复。如果已有 memory 捕获了同一概念、新信息只是细化它，**更新而不是新建**：

```bash
nmem --json m update <memory_id> -c "updated content"
```

一条强 memory 胜过三条弱的。不确定时先搜。

```bash
nmem --json m search "related query"
```

有匹配且只是细化 → `m update`；没有匹配 → `m add`。

## 质量标准

**好（原子、可操作）：** "React hooks cleanup 必须返回函数，曾导致事件监听器内存泄漏"
**差：** 模糊的"修了些 bug"、对话转储、过于宽泛的总结

不蒸馏常规工作。如果用户不会在它消失时想念它，它就不该存在。质量优先于数量：一个会话 1-3 条 distilled memory 是典型的。

---
name: cnife-pi-workflow
description: AI 开发工作流全景——流水线顺序、技能关系、使用指南。受 Matt Pocock skills 启发。
---

# CNife Pi Workflow — 工作流全景

受 [Matt Pocock skills](https://github.com/mattpocock/skills) 启发，采用多个小技能架构，每个技能专注于单一职责，可自由组合。

## 流水线

```text
/grill → /plan → /plan-to-tasks → /write-code → /review-code
```

### 核心阶段

| 命令 | 说明 |
|------|------|
| `/grill` | 追问 + 领域对齐，澄清变更范围和用语 |
| `/plan` | 基于 grill 结论一次性写入 plan.md |
| `/plan-to-tasks` | 垂直切片拆解为可独立验证的子任务 |
| `/write-code` | TDD 红绿重构，逐 task 执行 |
| `/review-code` | AI 审查 + plannotator 人类审查 |

### 独立功能

| 命令 | 说明 |
|------|------|
| `/manage-change` | 变更目录管理：new、switch、status、list |
| `/improve-architecture` | 手动触发，扫描代码库发现架构改进机会 |

### 辅助技能（不入流水线，随时调用）

| 命令 | 说明 |
|------|------|
| `/prototype` | 可丢弃原型，验证代码层不确定性 |
| `/zoom-out` | 提升抽象层级，给出模块全景地图 |
| `/grill-me` | 纯追问，不写文件，不绑定变更 |
| `/handoff` | 会话交接，压缩对话为交接文档 |

### 诊断入口（按需触发，需安装 waza）

| 命令 | 说明 | 安装方式 |
|------|------|----------|
| `/hunt` | 根因诊断，出问题时调用 | `bunx skills add -g tw93/Waza` |

## 技能依赖关系

```text
/manage-change（创建变更目录）
    │
    ├─ /grill（追问 + 领域对齐）
    │
    ├─ /plan（写 plan.md）
    │
    ├─ /plan-to-tasks（拆解任务）
    │
    ├─ /write-code（TDD 实现）
    │
    └─ /review-code（审查）
        │
        └─ plannotator review（人类审查）

独立入口：
    /improve-architecture → 创建新变更

辅助技能（随时调用）：
    /prototype、/zoom-out、/grill-me、/handoff

外部技能（需安装 waza）：
    /hunt → `bunx skills add -g tw93/Waza`
```

## 变更目录结构

```text
changes/YYYYMMDD-<简写>/
├── plan.md              # 变更方案（目标、关键决策、用语）
├── CONTEXT.md           # 本次变更新增/修改的项目用语
├── tasks/               # 可执行任务切片
│   ├── T01-xxx.md       # status: 待开始
│   └── T02-xxx.md       # status: 待开始, depends_on: [T01-xxx]
├── adr/                 # 架构决策记录
│   └── xxx.md
└── change.md            # 全流程日志（追加写入，v1→v2→...）
```

### 核心文件约定

| 文件 | 角色 | 写入方式 |
|------|------|---------|
| `plan.md` | 变更方案 | `/plan` 覆盖写入 |
| `CONTEXT.md` | 项目用语 | `/grill` 追加/修改 |
| `tasks/T01-xxx.md` | 单个任务 | `/plan-to-tasks` 新建 |
| `adr/xxx.md` | 架构决策 | `/grill` 创建 |
| `change.md` | 变更日志 | 各阶段追加写入 |

### 变更级别状态

| 状态 | 含义 | 判定方式 |
|------|------|---------|
| 构思 | 方案还在写 | 只有 plan.md，无 tasks/ |
| 就绪 | 方案定了，可以开干 | plan.md + tasks/ 都有 |
| 进行中 | 正在实现 | 有 task 为「进行中」 |
| 完成 | 全部做完 | 所有 task 为「完成」 |
| 搁置 | 暂不推进 | 主动标记 |

## 快速开始

1. 创建变更目录：`/manage-change new <简写>`
2. 追问澄清：`/grill`
3. 写方案：`/plan`
4. 拆解任务：`/plan-to-tasks`
5. 实现：`/write-code`
6. 审查：`/review-code`

## 操作约束

| 约束 | 适用范围 | 说明 |
|------|---------|------|
| 每次只问一个问题 | grill, grill-me | 附带推荐选项和理由 |
| 用语确定即时更新 | grill | 写入 CONTEXT.md，不攒批 |
| ADR 仅满足三条件才创建 | grill | 难以逆转 + 无上下文看不懂 + 有真实取舍 |
| 优先垂直切片 | plan-to-tasks | 每片端到端穿透，非按技术层水平拆 |
| 红→绿→重构 | write-code | 先测试→最小实现→重构，不跨 task |
| 审查最多 3 轮 | review-code | 含修复来回，第 3 轮最终审阅 |
| 修复最多 3 次 | write-code | 验证失败后最多重试 3 次 |
| 根因断言后才能修复 | hunt（需安装 waza） | Root cause: 文件:行号 |

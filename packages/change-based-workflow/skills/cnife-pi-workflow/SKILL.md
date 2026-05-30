---
name: cnife-pi-workflow
description: AI 开发工作流全景——流水线顺序、技能关系、使用指南。受 Matt Pocock skills 启发。
---

# CNife Pi Workflow — 工作流全景

受 [Matt Pocock skills](https://github.com/mattpocock/skills) 启发，采用多个小技能架构，每个技能专注于单一职责，可自由组合。

## 双 Agent 模型

采用执行 Agent + 审查 Agent 交替工作模式。两个独立 pi 会话（如两个终端窗口），通过审查文件交互。

```text
执行 Agent（Builder）                   审查 Agent（Checker）
─────────────────                      ─────────────────
/init-builder                          /init-checker
/grill → /plan
写 checkpoints/plan.md 上半
                                       /check-work（审查 plan）
                                       追加下半部分
修正 plan.md
/plan-to-tasks
写 checkpoints/tasks.md 上半
                                       /check-work（审查 tasks）
                                       追加下半部分
修正 tasks
/write-code
写 checkpoints/code.md 上半
                                       /check-work（审查 code）
                                       追加下半部分
修正代码
完成
```

两个 Agent 通过 `changes/<变更>/checkpoints/<stage>.md` 和 `change.md` 同步状态，需要频繁读取最新文件。

## 核心阶段（执行 Agent）

| 命令 | 说明 |
|------|------|
| `/grill` | 追问 + 领域对齐，澄清变更范围和用语 |
| `/plan` | 基于 grill 结论一次性写入 plan.md |
| `/plan-to-tasks` | 垂直切片拆解为可独立验证的子任务 |
| `/write-code` | TDD 红绿重构，逐 task 执行 |

## 审查阶段（审查 Agent）

| 命令 | 说明 |
|------|------|
| `/check-work` | 审查 Agent 入口——对照基线审查产物，输出审查结论 |

## 独立功能

| 命令 | 说明 |
|------|------|
| `/manage-change` | 变更目录管理：new、switch、status、list |
| `/improve-architecture` | 手动触发，扫描代码库发现架构改进机会 |

## 辅助技能（不入流水线，随时调用）

| 命令 | 说明 |
|------|------|
| `/init-builder` | 执行 Agent 初始化——定位变更、了解进度、检查审查文件 |
| `/init-checker` | 审查 Agent 初始化——自动推断待审查阶段、加载 /check |
| `/prototype` | 可丢弃原型，验证代码层不确定性 |
| `/zoom-out` | 提升抽象层级，给出模块全景地图 |
| `/grill-me` | 纯追问，不写文件，不绑定变更 |
| `/handoff` | 会话交接，压缩对话为交接文档 |

## 诊断入口（按需触发，需安装 waza）

| 命令 | 说明 | 安装方式 |
|------|------|----------|
| `/hunt` | 根因诊断，出问题时调用 | `bunx skills add -g tw93/Waza` |

审查 Agent 使用 Waza 的 `/check` 技能执行审查，安装方式同上。

## 技能依赖关系

```text
/manage-change（创建变更目录）
    │
    ├─ /init-builder（执行 Agent 初始化）
    │
    ├─ /grill（追问 + 领域对齐）
    │
    ├─ /plan（写 plan.md）
    │
    ├─ /plan-to-tasks（拆解任务）
    │
    ├─ /write-code（TDD 实现）
    │
    └─ → 审查文件 → /init-checker → /check-work（审查 Agent 侧）

独立入口：
    /improve-architecture → 创建新变更

辅助技能（随时调用）：
    /prototype、/zoom-out、/grill-me、/handoff

外部技能（需安装 waza）：
    /hunt、/check → `bunx skills add -g tw93/Waza`
```

## 变更目录结构

```text
changes/YYYYMMDD-<简写>/
├── plan.md              # 变更方案（目标、关键决策、用语）
├── CONTEXT.md           # 本次变更新增/修改的项目用语
├── tasks/               # 可执行任务切片
│   ├── T01-xxx.md       # status: 待开始
│   └── T02-xxx.md       # status: 待开始, depends_on: [T01-xxx]
├── checkpoints/         # 双 Agent 审查文件
│   ├── plan.md          # plan 阶段审查（执行→审查共写）
│   ├── tasks.md         # tasks 阶段审查
│   └── code.md          # code 阶段审查
├── adr/                 # 架构决策记录
│   └── xxx.md
└── change.md            # 全流程日志（追加写入，v1→v2→...，标记 [执行]/[审查]）
```

### 核心文件约定

| 文件 | 角色 | 写入方式 |
|------|------|---------|
| `plan.md` | 变更方案 | `/plan` 覆盖写入 |
| `CONTEXT.md` | 项目用语 | `/grill` 追加/修改 |
| `tasks/T01-xxx.md` | 单个任务 | `/plan-to-tasks` 新建 |
| `checkpoints/<stage>.md` | 审查文件 | 执行 Agent 写上半，审查 Agent 追加下半 |
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

## 快速开始（双 Agent 模式）

1. 窗口 A（执行 Agent）：`/manage-change new <简写>` → `/init-builder`
2. 窗口 B（审查 Agent）：`/init-checker`
3. 执行 Agent：`/grill` → `/plan` → 写审查文件上半部分
4. 审查 Agent：`/check-work` → 审查结果写入审查文件下半部分
5. 执行 Agent 读取审查结论，修正 → 继续 `/plan-to-tasks`
6. 依此类推，在三个审查阶段（plan / tasks / code）交替进行

## 操作约束

| 约束 | 适用范围 | 说明 |
|------|---------|------|
| 每次只问一个问题 | grill, grill-me | 附带推荐选项和理由 |
| 用语确定即时更新 | grill | 写入 CONTEXT.md，不攒批 |
| ADR 仅满足三条件才创建 | grill | 难以逆转 + 无上下文看不懂 + 有真实取舍 |
| 优先垂直切片 | plan-to-tasks | 每片端到端穿透，非按技术层水平拆 |
| 红→绿→重构 | write-code | 先测试→最小实现→重构，不跨 task |
| 修复最多 3 次 | write-code | 验证失败后最多重试 3 次 |
| 根因断言后才能修复 | hunt（需安装 waza） | Root cause: 文件:行号 |

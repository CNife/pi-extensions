# AGENTS.md — AI 协作规范

## 项目结构

```
pi-extensions/
├── AGENTS.md                              # (本文件) AI 协作规范：结构、分工、约定
├── CONTEXT.md                             # 项目用语：变更、任务、grill 等术语定义
├── README.md                              # 面向用户的项目简介、安装、使用说明
├── .gitignore                             # Git 忽略规则
├── changes/                               # 变更目录，每个变更在 changes/YYYYMMDD-<简写>/
│   ├── .active_change                     # 当前活动的变更目录名
│   ├── YYYYMMDD-<简写>/                   # 每个变更的目录
│   │   ├── plan.md                        # 变更方案（/plan 写入）
│   │   ├── CONTEXT.md                     # 本次变更新增/修改的用语（/grill 写入）
│   │   ├── tasks/                         # 可执行任务切片（/plan-to-tasks 写入）
│   │   │   ├── T01-xxx.md
│   │   │   └── T02-xxx.md
│   │   ├── adr/                           # 架构决策记录（/grill 写入 → 完成后同步 docs/adr/）
│   │   │   └── xxx.md
│   │   └── change.md                      # 全流程日志（追加写入，v1→v2→...）
│   └── ...
├── docs/
│   └── adr/                               # 全局架构决策记录（变更完成后同步）
└── skills/                                # pi 技能（每个技能一个 SKILL.md）
    ├── cnife-pi-workflow/SKILL.md         # 工作流全景：流水线顺序、技能关系、使用指南
    ├── manage-change/SKILL.md             # 变更目录管理：new、switch、status、list
    ├── grill/SKILL.md                     # 追问 + 领域对齐
    ├── plan/SKILL.md                      # 写变更方案
    ├── plan-to-tasks/SKILL.md             # 垂直切片拆解任务
    ├── write-code/SKILL.md                # TDD 红绿重构
    ├── review-code/SKILL.md               # AI 审查 + plannotator 人类审
    ├── improve-architecture/SKILL.md      # 扫描架构改进机会
    ├── prototype/SKILL.md                 # 可丢弃原型
    ├── zoom-out/SKILL.md                  # 模块全景地图
    ├── grill-me/SKILL.md                  # 纯追问，不写文件
    └── handoff/SKILL.md                   # 会话交接
```

## 目录约定

| 目录/文件 | 角色 | 操作方式 |
|-----------|------|---------|
| `changes/` | 所有变更记录 | `changes/.active_change` 指向当前活动变更 |
| `changes/YYYYMMDD-<简写>/` | 单个变更的完整生命周期 | 由 `/manage-change new` 创建 |
| `changes/<name>/CONTEXT.md` | 变更内新增/修改的用语 | `/grill` 写入，完成后同步根 CONTEXT.md |
| `changes/<name>/adr/` | 变更内架构决策 | `/grill` 写入，完成后同步 docs/adr/ |
| `skills/` | pi 技能 | 每个技能一个目录，SKILL.md 作为入口 |

## 技能架构

采用**多个小技能**架构，受 [Matt Pocock skills](https://github.com/mattpocock/skills) 启发。

每个技能：
- 职责单一，只做一件事
- 独立完整，可单独使用
- 可自由组合，无隐式依赖

### 核心阶段（流水线）

```
/grill → /plan → /plan-to-tasks → /write-code → /review-code
```

| 技能 | 说明 |
|------|------|
| `/grill` | 追问 + 领域对齐，澄清变更范围和用语 |
| `/plan` | 基于 grill 结论一次性写入 plan.md |
| `/plan-to-tasks` | 垂直切片拆解为可独立验证的子任务 |
| `/write-code` | TDD 红绿重构，逐 task 执行 |
| `/review-code` | AI 审查 + plannotator 人类审查 |

### 独立功能

| 技能 | 说明 |
|------|------|
| `/manage-change` | 变更目录管理：new、switch、status、list |
| `/improve-architecture` | 手动触发，扫描代码库发现架构改进机会 |

### 辅助技能（不入流水线，随时调用）

| 技能 | 说明 |
|------|------|
| `/prototype` | 可丢弃原型，验证代码层不确定性 |
| `/zoom-out` | 提升抽象层级，给出模块全景地图 |
| `/grill-me` | 纯追问，不写文件，不绑定变更 |
| `/handoff` | 会话交接，压缩对话为交接文档 |

### 诊断入口（按需触发，需安装 waza）

| 技能 | 说明 | 安装方式 |
|------|------|----------|
| `/hunt` | 根因诊断，出问题时调用 | `bunx skills add -g tw93/Waza` |

## 开发规范

- **Python**：依赖管理用 `uv`，格式化检查用 `ruff`
- **Git 提交**：简短中文，一行内，不加前缀
- **变更流程**：`grill → plan → plan-to-tasks → write-code → review-code`

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
├── extensions/                            # pi 扩展 — 在 Agent 启动时注入环境的运行时逻辑
│   ├── dev-workflow.ts                    # /new-change, /switch-change 命令处理
│   ├── sh-guard.ts                        # Shell 命令安全分类器
│   └── debug-request-body.ts             # 调试扩展
├── skills/                                # pi 技能（SKILL.md 入口 + references/ 阶段详情）
│   └── development-workflow/
│       ├── SKILL.md                       # 入口文档：流水线、变更目录解析、Plannotator入口
│       └── references/                    # 各阶段完整操作说明
│           ├── grill.md
│           ├── plan.md
│           ├── grill-me.md
│           ├── plan-to-tasks.md
│           ├── write-code.md
│           ├── review-code.md
│           ├── improve-architecture.md
│           ├── prototype.md
│           ├── zoom-out.md
│           └── handoff.md
├── prompts/                               # pi 提示词模板 — Agent 阶段指令（~100-150字精简版）
│   ├── grill.md
│   ├── plan.md
│   ├── grill-me.md
│   ├── plan-to-tasks.md
│   ├── write-code.md
│   ├── review-code.md
│   ├── improve-architecture.md
│   ├── prototype.md
│   ├── zoom-out.md
│   └── handoff.md
└── tests/                                 # 测试脚本
    └── dev-workflow.test.sh               # 开发工作流一致性检查
```

## 目录约定

| 目录/文件 | 角色 | 操作方式 |
|-----------|------|---------|
| `changes/` | 所有变更记录 | `changes/.active_change` 指向当前活动变更 |
| `changes/YYYYMMDD-<简写>/` | 单个变更的完整生命周期 | 由 `/new-change` 创建 |
| `changes/<name>/CONTEXT.md` | 变更内新增/修改的用语 | `/grill` 写入，完成后同步根 CONTEXT.md |
| `changes/<name>/adr/` | 变更内架构决策 | `/grill` 写入，完成后同步 docs/adr/ |
| `extensions/` | pi 扩展 | 主动注册命令和钩子，由 Agent 自动加载 |
| `skills/` | pi 技能 | 通过 SKILL.md 全局描述，含 `references/` 明细 |
| `prompts/` | pi 提示词模板 | 自动发现，Agent 加载时注入为命令 |

## 扩展/技能/Prompt 的分工

pi 的三种能力注入方式有明确分工：

### 扩展（Extension）— 运行时逻辑

- 使用 TypeScript 编写，在 Agent 启动时加载到运行环境
- 适合：处理命令参数、读写文件、调用 CLI、提供上下文（如变更目录解析）
- 本项目中：`dev-workflow.ts` 负责 `/new-change` 和 `/switch-change` 命令，
  通过 `changes/.active_change` 文件提供变更目录上下文

### 技能（Skill）— 领域知识文档

- 使用 Markdown 编写，由 `SKILL.md` 作为入口文件
- 适合：提供完整操作说明、流程定义、规则手册
- 本项目中：`skills/development-workflow/SKILL.md` 提供五阶段工作流全景、
  变更目录解析规则、Plannotator 入口；各阶段详情在 `references/*.md` 中

### 提示词模板（Prompt Template）— 精简指令

- 使用 Markdown 编写，~100-150 字，自动被 pi 发现并注册为 `/command`
- 适合：为 Agent 提供阶段目标的简短驱动指令、最少必要操作规则
- 通过引用 SKILL.md 获取完整说明，避免指令膨胀

### 协作流程

```
Prompt（精简指令）→ 引用 → SKILL.md（入口文档）→ 引用 → references/{phase}.md（完整说明）
                  ↓
          Extension（运行时上下文，如变更目录解析）
```

## 开发规范

- **Python**：依赖管理用 `uv`，格式化检查用 `ruff`
- **Git 提交**：简短中文，一行内，不加前缀
- **变更流程**：`grill → plan → plan-to-tasks → write-code → review-code`

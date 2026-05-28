# AGENTS.md — AI 协作规范

## 项目结构

```text
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
│   ├── adr/                               # 全局架构决策记录（变更完成后同步）
│   ├── cnife-pi-workflow.md               # 技能架构：流水线、技能分类、使用指南
│   ├── deployment.md                      # 部署原理：pi install / pi update 流程
│   └── troubleshooting.md                 # 排查指南：命令→代码、参数流转、本地测试
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
| `docs/cnife-pi-workflow.md` | 技能架构 | 流水线顺序、技能分类、使用指南 |
| `docs/deployment.md` | 部署原理 | pi install / pi update 的内部流程 |
| `docs/troubleshooting.md` | 排查指南 | AI 排查本仓库 bug 时先读 |

## 技能架构

详见 `docs/cnife-pi-workflow.md`。

## 开发规范

- **Python**：依赖管理用 `uv`，格式化检查用 `ruff`
- **Git 提交**：简短中文，一行内，不加前缀
- **变更流程**：`grill → plan → plan-to-tasks → write-code → review-code`
- **排查问题**：先读 `docs/troubleshooting.md`
- **修改代码**：禁止直接修改 `~/.pi/agent/` 下已安装的文件。必须修改当前仓库文件，走完整的部署流程（`git commit` + `git push` + `pi update`）安装到 `~/.pi/agent`。本地测试用符号链接（见 `docs/troubleshooting.md`）

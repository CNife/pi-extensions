# AGENTS.md — AI 协作规范

## 项目结构

Monorepo，npm workspaces 管理。每个子包独立发布到 npm。

```text
pi-extensions/
├── AGENTS.md                              # (本文件) AI 协作规范：结构、分工、约定
├── CONTEXT.md                             # 项目用语：变更、任务、grill 等术语定义
├── README.md                              # 面向用户的项目简介、安装、使用说明
├── .gitignore                             # Git 忽略规则
├── package.json                           # 根：npm workspaces + devDeps
├── biome.json                             # 统一 lint/format 配置
├── tsconfig.json                          # 统一 TS 配置
├── packages/                              # 子包目录
│   ├── execute-python/                    # @cnife/pi-execute-python
│   │   ├── package.json
│   │   └── extensions/execute-python.ts
│   ├── simple-plannotator/                # @cnife/pi-simple-plannotator
│   │   ├── package.json
│   │   └── extensions/index.ts
│   ├── miscs/                             # @cnife/pi-miscs
│   │   ├── package.json
│   │   └── extensions/ (debug-request-body.ts, exit.ts)
│   └── change-based-workflow/             # @cnife/pi-change-based-workflow
│       ├── package.json
│       └── skills/ (12 个 workflow 技能)
├── archive/                               # 已归档代码 (sh-guard.ts)
├── changes/                               # 变更目录，每个变更在 changes/YYYYMMDD-<简写>/
│   ├── .active_change                     # 当前活动的变更目录名
│   └── YYYYMMDD-<简写>/                   # 每个变更的目录
└── docs/
    ├── adr/                               # 全局架构决策记录（变更完成后同步）
    ├── cnife-pi-workflow.md               # 技能架构：流水线、技能分类、使用指南
    ├── deployment.md                      # 部署原理：pi install / pi update 流程
    └── troubleshooting.md                 # 排查指南：命令→代码、参数流转、本地测试
```

## 目录约定

| 目录/文件 | 角色 | 操作方式 |
|-----------|------|---------|
| `packages/` | 子包目录 | 每个子包独立发布 npm |
| `changes/` | 所有变更记录 | `changes/.active_change` 指向当前活动变更 |
| `changes/YYYYMMDD-<简写>/` | 单个变更的完整生命周期 | 由 `/manage-change new` 创建 |
| `changes/<name>/CONTEXT.md` | 变更内新增/修改的用语 | `/grill` 写入，完成后同步根 CONTEXT.md |
| `changes/<name>/adr/` | 变更内架构决策 | `/grill` 写入，完成后同步 docs/adr/ |
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

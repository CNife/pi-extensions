# AGENTS.md — AI 协作规范

## 项目结构

Monorepo，npm workspaces 管理。每个子包独立发布到 npm。

```text
pi-extensions/
├── AGENTS.md                              # (本文件) AI 协作规范
├── CONTEXT.md                             # 项目用语（旧变更流程遗留）
├── README.md                              # 项目简介、安装、使用说明
├── .gitignore
├── package.json                           # 根：npm workspaces + devDeps
├── biome.json                             # 统一 lint/format 配置
├── tsconfig.json                          # 统一 TS 配置
├── .rpiv/                                 # rpiv 工作流产物
│   ├── artifacts/
│   │   ├── research/                      # 调研文档
│   │   ├── plans/                         # 实施计划
│   │   └── reviews/                       # 审查报告
│   └── workflows/                         # 工作流定义（可选）
├── packages/
│   ├── AGENTS.md                          # 扩展开发规范
│   ├── auto-naming-session/               # @cnife/pi-auto-naming-session
│   ├── cache-hit-rate/                    # @cnife/pi-cache-hit-rate
│   ├── execute-python/                    # @cnife/pi-execute-python
│   ├── simple-plannotator/                # @cnife/pi-simple-plannotator
│   ├── miscs/                             # @cnife/pi-miscs
│   └── change-based-workflow/             # @cnife/pi-change-based-workflow
│       └── skills/
│           └── AGENTS.md                  # 技能开发规范
├── archive/                               # 已归档代码
├── changes/                               # (旧流程遗留) 历史变更记录
└── docs/
    ├── adr/                               # 架构决策记录
    ├── cnife-pi-workflow.md               # (旧流程遗留) 旧技能架构文档
    ├── deployment.md                      # 部署原理
    └── troubleshooting.md                 # 排查与测试指南
```

## 目录约定

| 目录/文件 | 角色 | 操作方式 |
|-----------|------|---------|
| `packages/` | 子包目录 | 每个子包独立发布 npm |
| `packages/AGENTS.md` | 扩展开发规范 | inline guidance，AI 自动加载 |
| `.rpiv/artifacts/` | rpiv 流水线产物 | research → blueprint → implement → code-review 各阶段产出 |
| `changes/` | **（旧流程）** 历史变更记录 | 不再使用。参见 `.rpiv/` |
| `docs/troubleshooting.md` | 排查与测试指南 | 命令→代码、参数流转、扩展本地测试、tmux 交互调试 |
| `docs/deployment.md` | 部署原理 | pi install / pi update 的内部流程 |

## 开发流程（rpiv 流水线）

采用 [rpiv-pi](https://github.com/juicesharp/rpiv-mono) 技能包的标准研发流水线：

```text
discover → research → explore → design → blueprint/plan → implement → validate → code-review → commit
```

每个阶段产出对应的 `.rpiv/artifacts/` 文档。详见各 `AGENTS.md` 及 rpiv 技能文档。

## 开发规范

- **Python**：依赖管理用 `uv`，格式化检查用 `ruff`
- **Git 提交**：简短中文，一行内，不加前缀
- **变更流程**：~~`grill → plan → plan-to-tasks → write-code → review-code`~~（旧流程，已废弃）改用 rpiv 流水线
- **排查问题**：先读 `docs/troubleshooting.md`
- **修改代码**：禁止直接修改 `~/.pi/agent/` 下已安装的文件。必须修改当前仓库文件，走完整的部署流程（`git commit` + `git push` + `pi update`）安装到 `~/.pi/agent`。本地测试用符号链接或隔离加载（见 `docs/troubleshooting.md` 扩展本地测试章节）

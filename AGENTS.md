# AGENTS.md

CNife 的 [pi](https://pi.dev) agent 扩展集合（npm workspaces monorepo）。

## 分层

| 层 | 目录 | 规则 |
| --- | --- | --- |
| 产品 | `packages/` | 可发布 `@cnife/pi-*`；进 `workspaces: ["packages/*"]`；规范见 [packages/AGENTS.md](packages/AGENTS.md) |
| 个人 | `personal/` | **非发布单元**、不进 workspaces；根 `package.json` 带 `pi` manifest 只暴露 `personal/`，随根 pi 包 git 分发（见 [ADR 0003](docs/adr/0003-personal-layer-miscs-retirement.md) 修订段） |
| 退役 | `archive/` | 收停用插件：曾为产品的包，或不再需要的个人扩展；流程见历史 PR / [ADR 0003](docs/adr/0003-personal-layer-miscs-retirement.md) |

新产品进 `packages/`；个人参考/自用进 `personal/`；不要把 personal 当成第二个 packages。

## Git 工作流

main 受保护，禁止直接 push。所有改动走 feature 分支 + PR：

```text
git checkout -b feat/xxx → 开发提交 → git push -u origin feat/xxx → gh pr create
```

误提交到 main 的补救：`git checkout -b feat/xxx`（带走 commit）→ `git checkout main && git reset --hard origin/main`（回退本地 main）→ 在 feat/xxx 上继续。禁止对 main 做 force-push。

## Agent skills

### Issue tracker

GitHub Issues（`CNife/pi-extensions`），用 `gh` CLI。见 `docs/agents/issue-tracker.md`。

### Domain docs

multi-context：根 `CONTEXT-MAP.md` 索引各 context 的 `CONTEXT.md`（通用 + nmem），系统级 ADR 在 `docs/adr/`。见 `docs/agents/domain.md`。

## 参考

- [CONTEXT.md](CONTEXT.md) - 领域术语表
- [CONTEXT-MAP.md](CONTEXT-MAP.md) - context 索引
- [packages/AGENTS.md](packages/AGENTS.md) - 扩展开发规范
- [personal/README.md](personal/README.md) - 个人扩展树与 git 包分发
- [docs/troubleshooting.md](docs/troubleshooting.md) - 排查与本地测试
- [docs/deployment.md](docs/deployment.md) - 部署原理

## 测试约定

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.

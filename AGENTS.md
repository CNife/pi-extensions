# AGENTS.md

CNife 的 [pi](https://pi.dev) agent 扩展集合（npm workspaces monorepo）。

## 分层

| 层 | 目录 | 规则 |
| --- | --- | --- |
| 产品 | `packages/` | 可发布 `@cnife/pi-*`；进 `workspaces: ["packages/*"]`；规范见 [packages/AGENTS.md](packages/AGENTS.md) |
| 个人 | `personal/` | 与 `~/.pi/agent/extensions` 同构；**非发布单元**、不进 workspaces；用 `scripts/sync-personal.mjs` 按条目挂载 |
| 退役 | `archive/` | 只收曾为产品、现停更的包；流程见历史 PR / [ADR 0003](docs/adr/0003-personal-layer-miscs-retirement.md) |

新产品进 `packages/`；个人参考/自用进 `personal/`；不要把 personal 当成第二个 packages。

## Agent skills

### Issue tracker

GitHub Issues（`CNife/pi-extensions`），用 `gh` CLI。见 `docs/agents/issue-tracker.md`。

### Triage labels

默认 5 标签：`needs-triage` / `needs-info` / `ready-for-agent` / `ready-for-human` / `wontfix`。见 `docs/agents/triage-labels.md`。

### Domain docs

multi-context：根 `CONTEXT-MAP.md` 索引各 context 的 `CONTEXT.md`（通用 + nmem），系统级 ADR 在 `docs/adr/`。见 `docs/agents/domain.md`。

## 参考

- [CONTEXT.md](CONTEXT.md) - 领域术语表
- [CONTEXT-MAP.md](CONTEXT-MAP.md) - context 索引
- [packages/AGENTS.md](packages/AGENTS.md) - 扩展开发规范
- [personal/README.md](personal/README.md) - 个人扩展树与同步
- [docs/troubleshooting.md](docs/troubleshooting.md) - 排查与本地测试
- [docs/deployment.md](docs/deployment.md) - 部署原理

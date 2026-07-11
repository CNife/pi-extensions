# AGENTS.md

CNife 的 [pi](https://pi.dev) agent 扩展集合（npm workspaces monorepo）。

## Agent skills

### Issue tracker

GitHub Issues（`CNife/pi-extensions`），用 `gh` CLI。见 `docs/agents/issue-tracker.md`。

### Triage labels

默认 5 标签：`needs-triage` / `needs-info` / `ready-for-agent` / `ready-for-human` / `wontfix`。见 `docs/agents/triage-labels.md`。

### Domain docs

single-context：根 `CONTEXT.md` + 根 `docs/adr/`。见 `docs/agents/domain.md`。

## 参考

- [CONTEXT.md](CONTEXT.md) - 领域术语表
- [packages/AGENTS.md](packages/AGENTS.md) - 扩展开发规范
- [docs/troubleshooting.md](docs/troubleshooting.md) - 排查与本地测试
- [docs/deployment.md](docs/deployment.md) - 部署原理

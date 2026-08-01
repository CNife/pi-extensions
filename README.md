# cnife-pi-extensions

CNife 的 [pi](https://pi.dev) agent 扩展集合。

仓库分三层：

| 层 | 目录 | 说明 |
| --- | --- | --- |
| 产品 | [`packages/`](packages/) | 可发布的 npm 包（`@cnife/pi-*`），进 workspaces |
| 个人 | [`personal/`](personal/) | 与全局扩展目录同构；不进 workspaces、不 publish |
| 退役 | [`archive/`](archive/) | 停用的插件（含个人扩展），仅供查阅 |

## 包

| 包 | 说明 |
|---|------|
| [`@cnife/pi-agent-loop-reflection`](packages/agent-loop-reflection/README.md) | 长时 agent loop 自动插入反思提醒 |
| [`@cnife/pi-auto-naming-session`](packages/auto-naming-session/README.md) | turn 边界自动生成/刷新会话标题 |
| [`@cnife/pi-execute-python`](packages/execute-python/README.md) | 用 uv 执行 Python，实时流式输出，自动依赖管理 |
| [`@cnife/pi-footer`](packages/cnife-footer/README.md) | 个人专属两行 footer：工作区/模型状态，全 dim，仅 ASCII+Unicode |
| [`@cnife/pi-inference-speed`](packages/inference-speed/README.md) | footer 显示推理速度 TPS 和首 token 延迟 TTFT |
| [`@cnife/pi-inline-skill-completion`](packages/inline-skill-completion/README.md) | 输入框任意位置补全技能，支持一行多个并折叠渲染 |
| [`@cnife/pi-miscs`](packages/miscs/README.md) | 调试 & 快捷退出等小工具 |
| [`@cnife/pi-nmem`](packages/nmem/README.md) | 用 pi 原生 tool 打 nmem 后端 REST（搜索/深读/保存记忆），替代 nowledge-mem-pi，不依赖 nmem CLI |

## Install

单独安装某个包：

```bash
pi install npm:@cnife/pi-agent-loop-reflection
pi install npm:@cnife/pi-auto-naming-session
pi install npm:@cnife/pi-execute-python
pi install npm:@cnife/pi-footer
pi install npm:@cnife/pi-inference-speed
pi install npm:@cnife/pi-inline-skill-completion
pi install npm:@cnife/pi-miscs
pi install npm:@cnife/pi-nmem
```

## personal

个人扩展用同步脚本按条目软链到本机 `extensions/`（包型会先装依赖）：

```bash
node scripts/sync-personal.mjs --dry-run
node scripts/sync-personal.mjs
```

详见 [personal/README.md](personal/README.md)。分层决策见 [ADR 0003](docs/adr/0003-personal-layer-miscs-retirement.md)。

## License

MIT

---

- 项目结构、目录约定见 [AGENTS.md](AGENTS.md)
- 领域术语表见 [CONTEXT.md](CONTEXT.md)

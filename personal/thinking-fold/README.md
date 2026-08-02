# thinking-fold (personal, trace-only)

推理块折叠预览的简化个人版，基于 [`@99percentpeople/pi-thinking-fold`](https://github.com/99percentpeople/pi-extensions)（MIT）简化重写。砍掉 summary 判定 / 配置 / 设置 UI，只保留 trace 行为。

## 行为

固定三态，无配置：

| 状态 | 显示 |
| --- | --- |
| 推理中（streaming） | 固定高度尾部预览（默认 10 行）+ `Thinking Xs` |
| 推理完成 | `Thought for Xs`（推理内容隐藏） |
| `Ctrl+T` 展开 | 完整推理原文 |

- streaming 时实时刷新尾部预览，看得到推理方向与过程；
- 完成后折叠成一行，不淹没历史；
- `Ctrl+T`（或 Pi 的 `app.thinking.toggle` 键绑定）随时展开完整推理，状态跨轮次保持直到再次按下。

GLM-5.2 等 trace 型模型经 OpenAI Responses 协议不再被误判为 summary 而折叠——本版根本不区分 summary/trace，所有推理模型一律 trace。

## 与上游差异

- 删除 `model-behaviors.ts` / `model-behaviors.json`（summary/trace 判定表）；
- 删除 `config.ts` 与 `/99settings` 注册（无配置，`previewLines` 固定常量 10 于 `renderer.ts`）；
- 删除 `@99percentpeople/pi-shared-settings` 运行时依赖（peer-only）；
- 删除 summary headline 提取与 cursor hold 计时器；
- `createThinkingDisplayMessage` 简化为固定三态。

monkey-patch 机制（`AssistantMessageComponent.updateContent/render` 覆盖 + timing/tick/toggle）原样保留。

## 安装

本包在 `personal/` 层，经 `scripts/sync-personal.mjs` 软链到 `~/.pi/agent/extensions/`：

```bash
# 先卸 npm 版（若装过），防双加载
pi remove npm:@99percentpeople/pi-thinking-fold
# 同步
node scripts/sync-personal.mjs --dry-run
node scripts/sync-personal.mjs
```

Pi 自动发现 `extensions/` 下包目录，无需写进 `settings.json`。

## 调整预览行数

改 `renderer.ts` 里 `DEFAULT_THINKING_FOLD_OPTIONS.previewLines`，重启会话生效。

## 兼容性

与上游相同：monkey-patch `AssistantMessageComponent` 的 `updateContent`/`render`，Pi 改动组件 API 时扩展自动禁用并告警，不改消息原文 / 会话持久化 / 模型上下文。

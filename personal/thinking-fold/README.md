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
- 删除 `createThinkingDisplayMessage` 及渲染前截断辅助（`foldThinkingText` / `hasFoldedThinkingContent`），改用上游 v0.1.6 的「渲染后取行」机制。

monkey-patch 收窄为只覆盖 `AssistantMessageComponent.updateContent`：让 Pi 先用原生 `Markdown` 组件渲染推理，再以私有 marker 定位并包装成取尾部行的 `RenderedThinkingSection`（timing/tick/toggle 不变）。预览保留代码块 / 表格 / 列表等原生 Markdown 格式，折叠高度按真实渲染行数钉死。

## 安装

本包在 `personal/` 层，随 monorepo 根 pi 包分发（详见 [personal/README.md](../README.md)）：

```bash
# 先卸 npm 版（若装过），防双加载
pi remove npm:@99percentpeople/pi-thinking-fold
# 安装根 git 包（含全部 personal 扩展；不 pin ref，跟踪 main）
pi install git:github.com/CNife/pi-extensions
# 后续拉新
pi update --extensions
```

本地开发验证用 `pi --no-extensions -e .` 临时加载整个仓库。

## 调整预览行数

改 `renderer.ts` 里 `DEFAULT_THINKING_FOLD_OPTIONS.previewLines`，重启会话生效。

## 兼容性

只 monkey-patch `AssistantMessageComponent.updateContent`（不再 hook `render`）。marker 仅存在于显示副本，不改 session 源消息 / 持久化 / 模型上下文。若 Pi 改动组件公开 API，扩展启动时自禁用并告警；若仅改动内部子组件布局（找不到 marker），受影响消息安全回退到完整原生渲染，不泄漏标记。

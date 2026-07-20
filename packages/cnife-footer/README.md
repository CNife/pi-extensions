# @cnife/pi-footer

个人专属 pi footer。两行布局，全 dim，仅 ASCII + Unicode（无 nerd font），无配置。

> 个人扩展。安装：`pi install npm:@cnife/pi-footer`

## 布局

```text
<目录> · <分支> ↑<ahead> ↓<behind> *<未提交数> · <会话名>
<provider>/<model_id> · <思考强度> · <已用>/<总量> (<百分比>) · $<花费> · <tps>t/s
```

- 各项 ` · ` 分隔，空值自动省略（无 git 段、无会话名、cost=0、无 tps 等均不显示）
- git：`main ↑1 ↓2 *3`，ahead/behind/未提交数为 0 时隐藏
- cost：`<0.01` 用 3 位小数，否则 2 位；为 0 时整项隐藏
- token：`<1000` 原值，`<1M` 用 `X.XK`，`≥1M` 用 `X.XM`
- tps：单条 assistant message 输出速率 `NN.Nt/s`，无数据时整项隐藏；口径 `usage.output / (message_end − before_provider_request)`，elapsed 含网络 + 排队 + 生成（对齐 pi 官方 `tps.ts`）

## 刷新

- git 状态：10s 定时器 + `tool_result`（agent 工具执行后即时）+ `user_bash`（`!`/`!!` 命令后 1.5s debounce）+ `onBranchChange`
- 其余字段随 pi 内部状态自动重渲染
- tps：`message_end` 后刷新并保持到下一条；切模型 / compact / 树导航 / 新会话时重置；`stopReason` 为 `aborted`/`error` 时丢弃

## 字符约束

仅 ASCII + Unicode 基本平面字符（`· ↑ ↓ *`），不依赖 nerd font。

# @cnife/pi-footer

个人专属 pi footer。两行布局，全 dim，仅 ASCII + Unicode（无 nerd font），无配置。

> 个人扩展，不发布到 npm，仅本地 `pi install` 安装使用。

## 布局

```text
<目录> · <分支> ↑<ahead> ↓<behind> *<未提交数> · <会话名>
<provider>/<model_id> · <思考强度> · <已用>/<总量> (<百分比>) · $<花费>
```

- 各项 ` · ` 分隔，空值自动省略（无 git 段、无会话名、cost=0 等均不显示）
- git：`main ↑1 ↓2 *3`，ahead/behind/未提交数为 0 时隐藏
- cost：`<0.01` 用 3 位小数，否则 2 位；为 0 时整项隐藏
- token：`<1000` 原值，`<1M` 用 `X.XK`，`≥1M` 用 `X.XM`

## 刷新

- git 状态：10s 定时器 + `tool_result`（agent 工具执行后即时）+ `user_bash`（`!`/`!!` 命令后 1.5s debounce）+ `onBranchChange`
- 其余字段随 pi 内部状态自动重渲染

## 字符约束

仅 ASCII + Unicode 基本平面字符（`· ↑ ↓ *`），不依赖 nerd font。

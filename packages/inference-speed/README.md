# @cnife/pi-inference-speed

在 pi 的 footer 状态行中显示当前 assistant message 的**推理速度（TPS）**和**首 token 延迟（TTFT）**。

## 功能

- **TPS**：单条 assistant message 的推理速度，`output tokens / 生成耗时`，单位 tokens/s
- **TTFT**：首 token 延迟，请求发出到首个 token（含 thinking/toolcall）到达的耗时，单位秒

### Footer 格式

```text
TPS123.4T/s TTFT1.2s
```

- 无数据时显示 `TPS--.-T/s TTFT -.-s`（dim 色）
- 每条 assistant message 结束后刷新，保持到下一条

### 计算口径

| 指标 | 起点 | 终点 | 公式 |
|------|------|------|------|
| TPS | `before_provider_request`（请求发出） | `message_end`（message 结束） | `usage.output / elapsed` |
| TTFT | `before_provider_request`（请求发出） | 首个 `_delta`（任意 token 增量） | `(firstDeltaAt - requestAt) / 1000` |

- TPS 公式参考 [`tps.ts`](https://github.com/earendil-works/pi/blob/main/.pi/extensions/tps.ts) 的 `output/elapsedSeconds`，统计范围按单条 message
- TTFT 用流式事件精确计时，首 token 含 `text_delta`/`thinking_delta`/`toolcall_delta` 任意增量

### 事件处理

- **切换模型 / Compaction / 树导航 / 新会话**：重置为占位显示
- 每次 assistant message 结束时刷新 TPS/TTFT
- `stopReason` 为 `aborted`/`error` 时重置为占位

## 安装

```bash
pi install npm:@cnife/pi-inference-speed
```

## 使用

安装后自动生效，无需额外命令。

## 故障排查

| 现象 | 原因 | 解决 |
|------|------|------|
| Footer 显示 `TPS--.-T/s TTFT -.-s` | 当前会话还没有有效的 assistant message | 发送一条消息后会自动更新 |
| TPS 数值异常大 | 极短 message（output 少、耗时极短） | 属正常现象，长 message 会稳定 |

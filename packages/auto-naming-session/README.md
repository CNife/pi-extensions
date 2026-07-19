# @cnife/pi-auto-naming-session

在 pi 中自动生成并周期性刷新会话标题，让标题反映对话的全貌。

## 功能

- 首条消息后立即生成初始标题，无需等待 agent 回合
- 每 N 个 turn 周期刷新，综合整段对话重新提炼标题
- 手动改名后自动停止覆盖
- 标题语言可配置

## 安装

```bash
pi install npm:@cnife/pi-auto-naming-session
```

## 配置

配置文件位于 `~/.pi/agent/cnife-auto-naming-session.json`（`<agent-dir>` 由 `PI_CODING_AGENT_DIR` 决定，默认 `~/.pi/agent`），首次加载时自动生成默认值：

```json
{
  "auto_refresh_turns": 10,
  "model": null,
  "language": "english"
}
```

| 字段 | 默认值 | 说明 |
|------|--------|------|
| `auto_refresh_turns` | `10` | 每 N turn 自动刷新标题，`null` 禁用自动刷新 |
| `model` | `null` | 指定模型 `"provider/modelId"`，`null` 用当前会话模型 |
| `language` | `"english"` | 标题语言 |

## 使用

- **首标题**：第一条 user message 到达后立即生成（`message_end` 事件），不等待 agent 回合。
- **周期刷新**：`agent_end` 时统计自上次命名以来的 user+assistant 消息数，达阈值则综合整段对话重新生成标题。
- **全弧线综合**：每次刷新遍历整个会话分支，收集所有 user/assistant 消息文本喂给 LLM，让标题反映会话全貌而非最近片段。
- **手动保护**：检测到用户手动改过标题后，停止自动覆盖。

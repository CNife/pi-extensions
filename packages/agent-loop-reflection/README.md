# @cnife/pi-agent-loop-reflection

在长时间运行的 pi agent loop 中自动插入一次可见的反思提醒，要求模型暂停确认目标、证据和阻塞状态；如果它卡住、不确定或可能跑偏，就先调用 `advisor` 再继续。

## 功能

- 以 completed turn 为计数单位，在默认 10 个有效 turn 后触发首次提醒。
- 同一个 agent run 内默认每 10 个有效 turn 再提醒一次。
- 使用 `steer` 作为可见用户消息插入当前 agent 流程。
- 自动提醒后的反思 turn 不计入下一次 repeat cadence。
- 所有用户消息（包括 mid-stream steer 和新 round 消息）都会重置倒计时，让用户介入后有足够 turn 空间。
- 正常触发时不显示额外 footer、status、widget、modal 或 notify。

## 安装

```bash
pi install npm:@cnife/pi-agent-loop-reflection
```

> 💡 **推荐**：提醒内容会要求模型在必要时调用 `advisor` 工具。建议同时安装 `@juicesharp/rpiv-workflow` 以获得完整 advisor 支持：
>
> ```bash
> pi install npm:@juicesharp/rpiv-workflow
> ```

## 本地测试

```bash
pi --no-extensions --no-skills -e packages/agent-loop-reflection/extensions/index.ts --no-session
```

需要隔离配置时，设置 `PI_CODING_AGENT_DIR`：

```bash
PI_CODING_AGENT_DIR=/tmp/pi-agent-loop-reflection-test \
  pi --no-extensions --no-skills -e packages/agent-loop-reflection/extensions/index.ts --no-session
```

## 配置

配置文件路径为 `<agent-dir>/cnife-agent-loop-reflection.json`。`<agent-dir>` 由 `PI_CODING_AGENT_DIR` 环境变量决定，默认是 `~/.pi/agent`。

首次启动时会自动写入默认配置：

```json
{
  "reminderTurnsInterval": 10,
  "reminderText": "请先暂停继续推进，做一次 agent loop 反思：\n\n1. 回到用户的原始目标：现在正在做的事是否仍然直接服务于这个目标？\n2. 检查当前证据和方向：已经验证了什么，哪些只是猜测，下一步是否仍然是最小有效动作？\n3. 判断是否卡住、不确定或可能跑偏：如果是，请先调用 `advisor` 获取建议，再继续。\n\n如果一切仍然清晰，请用一两句话说明判断依据，然后继续执行。"
}
```

| 字段 | 默认值 | 说明 |
|------|--------|------|
| `reminderTurnsInterval` | `10` | 首次提醒及后续提醒间隔的有效 turn 数，必须是正整数。 |
| `reminderText` | 中文三步提示 | 插入给模型的可见 `steer` 用户消息，也作为插件自注入消息的识别 marker。 |

缺失配置会自动创建默认文件；读取失败、JSON 非法或字段类型非法时会输出 warning 并使用默认配置。修改配置后需要重启 pi 生效。

## 行为说明

插件在 `turn_end` 事件中递减一个倒计数器。只有当最近一条 assistant message 的 `stopReason` 是 `toolUse` 时才会发送提醒，避免模型已经正常结束时额外开启一轮。

插件通过 `input` 事件监听所有进入 agent 的消息，根据 `source` 字段区分来源：

- `"interactive"` — TUI 用户输入（包括 mid-stream steer）
- `"rpc"` — RPC 调用
- `"extension"` — 插件自己的 `sendUserMessage`（跳过）

遇到非 `"extension"` 的消息时，倒计数器重置为 `reminderTurnsInterval`，确保用户介入后不会马上被自动提醒打断。

## 故障排查

| 现象 | 原因 | 处理 |
|------|------|------|
| 启动后没有提醒 | 未达到 `thresholdTurns`，或 agent 已经正常结束，没有下一轮 continuation | 降低阈值做测试，或观察长工具链任务。 |
| 修改配置后没生效 | 配置只在扩展加载时读取 | 重启 pi。 |
| 非法 JSON 后仍然继续运行 | 这是预期行为；插件会 warning 并使用默认配置 | 修正配置后重启。 |

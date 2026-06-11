# @cnife/pi-agent-loop-reflection

在长时间运行的 pi agent loop 中自动插入一次可见的反思提醒，要求模型暂停确认目标、证据和阻塞状态；如果它卡住、不确定或可能跑偏，就先调用 `advisor` 再继续。

## 功能

- 以 completed turn 为计数单位，在默认 10 个有效 turn 后触发首次提醒。
- 同一个 agent run 内默认每 10 个有效 turn 再提醒一次。
- 使用 `steer` 作为可见用户消息插入当前 agent 流程。
- 自动提醒后的反思 turn 不计入下一次 repeat cadence。
- 用户手动发送新的非插件消息后重置自动提醒节拍。
- 正常触发时不显示额外 footer、status、widget、modal 或 notify。

## 安装

```bash
pi install npm:@cnife/pi-agent-loop-reflection
```

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
  "enabled": true,
  "thresholdTurns": 10,
  "repeatEveryTurns": 10,
  "reminderText": "请先暂停继续推进，做一次 agent loop 反思：\n\n1. 回到用户的原始目标：现在正在做的事是否仍然直接服务于这个目标？\n2. 检查当前证据和方向：已经验证了什么，哪些只是猜测，下一步是否仍然是最小有效动作？\n3. 判断是否卡住、不确定或可能跑偏：如果是，请先调用 `advisor` 获取建议，再继续。\n\n如果一切仍然清晰，请用一两句话说明判断依据，然后继续执行。"
}
```

| 字段 | 默认值 | 说明 |
|------|--------|------|
| `enabled` | `true` | 是否启用自动提醒。 |
| `thresholdTurns` | `10` | 首次提醒前需要完成的有效 turn 数，必须是正整数。 |
| `repeatEveryTurns` | `10` | 后续提醒间隔的有效 turn 数，必须是正整数。 |
| `reminderText` | 中文三步提示 | 插入给模型的可见 `steer` 用户消息，也作为插件自注入消息的识别 marker。 |

缺失配置会自动创建默认文件；读取失败、JSON 非法或字段类型非法时会输出 warning 并使用默认配置。修改配置后需要重启 pi 生效。

## 行为说明

插件在 `turn_end` 事件中读取当前 completed turn 数。只有当最近一条 assistant message 的 `stopReason` 是 `toolUse` 时，插件才会发送提醒，避免模型已经正常结束时额外开启一轮。

插件通过扫描当前 session branch 中最新的非插件 user message 来确定 cadence anchor。插件自己注入的消息通过 `reminderText` 精确匹配识别；如果用户手动发送新的非插件消息，anchor 会更新，提醒节拍重新开始。

## 故障排查

| 现象 | 原因 | 处理 |
|------|------|------|
| 启动后没有提醒 | 未达到 `thresholdTurns`，或 agent 已经正常结束，没有下一轮 continuation | 降低阈值做测试，或观察长工具链任务。 |
| 修改配置后没生效 | 配置只在扩展加载时读取 | 重启 pi。 |
| 非法 JSON 后仍然继续运行 | 这是预期行为；插件会 warning 并使用默认配置 | 修正配置后重启。 |
| 用户手动输入与默认提醒完全相同 | 插件用 `reminderText` 作为 marker，完全相同文本会被视作插件消息 | 改写手动输入或自定义 `reminderText`。 |

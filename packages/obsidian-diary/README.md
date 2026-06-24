# @cnife/pi-obsidian-diary

将当前 pi 会话总结为 Obsidian 日记草稿，并通过 `sendUserMessage` 发给主 Agent，由主 Agent 在用户确认后写入日记文件。

## 功能

- 注册 `/diary` slash 命令，按需触发（命令驱动，非事件驱动）。
- 读取当前会话 transcript（`ctx.sessionManager.getBranch()`，不截断全量）。
- 扫描 Obsidian vault 下的未完成待办（近 14 天）、近期日记（近 10 天前 3 篇各前 30 行）、今日日记全文。
- 按旧中文日期格式计算今日日记路径：`{base}/{diary_dir}/{year}/{month:02d}/{year}年{month}月{day}日{星期}.md`。
- 调用 `completeSimple()` 做语义总结，返回结构化 JSON `{variant, summary, instructions}`。
- 通过 `pi.sendUserMessage(json, {deliverAs:"followUp"})` 发到当前会话，主 Agent 展示草稿给用户确认后写入。

**架构不变量**：扩展层零写入日记文件，唯一写操作是配置缺失时写模板配置文件。日记写入完全委托主 Agent 在用户确认后执行。

## 安装

```bash
pi install npm:@cnife/pi-obsidian-diary
```

## 本地测试

```bash
pi --no-extensions --no-skills -e packages/obsidian-diary/extensions/index.ts --no-session
```

## 配置

配置文件路径为 `<agent-dir>/cnife-obsidian-diary.json`。`<agent-dir>` 由 `PI_CODING_AGENT_DIR` 环境变量决定，默认是 `~/.pi/agent`。

首次调用 `/diary` 时若配置缺失会自动写入模板配置。**配置加载为硬失败**：缺失、损坏或字段类型非法时直接报错退出，绝不使用猜测的配置写入日记。

```json
{
  "model": null,
  "vaults": {
    "work": {
      "base": "/path/to/obsidian/work-vault",
      "diary_dir": "工作日志",
      "template": "日志模板.md",
      "exclude_meta": ["AGENTS.md", "任务.md", "日志模板.md"]
    },
    "personal": {
      "base": "/path/to/obsidian/personal-vault",
      "diary_dir": "个人日记",
      "template": "日记模板.md",
      "exclude_meta": ["AGENTS.md"]
    }
  }
}
```

| 字段 | 说明 |
|------|------|
| `model` | `"provider/modelId"` 指定模型，`null` 用当前会话 `ctx.model`。 |
| `vaults.{work,personal}.base` | Obsidian vault 根目录（支持 `~` 展开）。 |
| `vaults.{work,personal}.diary_dir` | 日记子目录名。 |
| `vaults.{work,personal}.template` | 模板文件名（主 Agent 据此从模板创建新日记）。 |
| `vaults.{work,personal}.exclude_meta` | 扫描时排除的文件名列表（含所有 `*模板.md`）。 |

## 用法

```text
/diary             # 自动判断 work/personal 变体，扫描两个 vault
/diary --work      # 固定为 work 变体，只扫描 work vault
/diary --personal  # 固定为 personal 变体，只扫描 personal vault
```

## 行为说明

- `/diary` 触发后，扩展走 fail-fast 线性链：配置加载 → 参数解析 → 读取 transcript → 扫描待办/近期/今日日记 → 路径越界校验 → 模型选择与认证 → LLM 语义总结 → 发送结构化消息。
- 每个失败路径都在发送消息前 return，确保无错误中间状态。
- `sendUserMessage` 返回 `void` 不可 await，发完即返回，消息进队列由主 Agent 处理。
- 主 Agent 收到的消息包含强指令：**禁止未经用户确认直接写入，必须先展示草稿等待确认**。

## 故障排查

| 现象 | 原因 | 处理 |
|------|------|------|
| 提示"配置缺失或损坏" | 配置文件不存在或 JSON/字段非法 | 按提示路径编辑配置后重试 `/diary`。 |
| 提示"日记路径越界" | `base` 配置异常，计算出的日记路径不在 vault 内 | 检查 `base` 是否正确，是否含 `../` 逃逸。 |
| 提示"认证失败" | API key 未配置或模型无效 | 检查 `model` 配置或 pi 的 API key 设置。 |
| 提示"Diary gen failed" | LLM 调用出错或被中止 | 查看 `stopReason`，超长会话可能触发 `length`。 |
| 提示"当前会话无记录可总结" | 会话 transcript 为空 | 先进行一些对话再调用 `/diary`。 |

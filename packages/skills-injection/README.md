# @cnife/pi-skills-injection

交互式控制哪些技能被注入到 pi 的系统提示词（`available_skills`），持久化配置。

## 解决的痛点

pi 启动时会加载所有已安装技能（`~/.pi/agent/skills/`、`.agents/skills/` 等），并把它们的名称、描述、路径以 `<available_skills>` XML 注入系统提示词。技能一多，系统提示词变长、占用上下文、干扰模型注意力，但用户无法 selectively 关闭某些技能的注入。

本扩展让用户交互式勾选哪些技能【不】被注入，配置持久化，下一条消息即生效。

## 安装

```bash
pi install npm:@cnife/pi-skills-injection
```

## 使用

输入 `/skills-injection` 打开多选界面：

- `↑↓` 导航
- `Space` 切换勾选（勾选 = 排除，不注入到系统提示词）
- `Enter` 保存
- `Esc` 取消

已排除的技能排在列表最前。保存后下一条消息即生效，无需 `/reload`。

每次启动会话时，扩展会通知本会话注入了哪些技能、排除了多少个。

## 配置

配置文件：`~/.pi/agent/cnife-skills-injection.json`

```json
{
  "excluded": ["skill-name-1", "skill-name-2"]
}
```

也可手动编辑此文件，下一条消息生效。

## 技术实现

三个部分：

1. **`before_agent_start` 拦截**：读取配置，从 `event.systemPromptOptions.skills` 过滤掉被排除的技能，用 pi 导出的 `formatSkillsForPrompt` 重新渲染 `<available_skills>` 段，正则替换系统提示词中对应的整段。每 turn 读配置文件，所以下一条消息即生效。

2. **`/skills-injection` 命令**：`ctx.ui.custom()` 自定义 TUI 多选列表（参考 pi 的 `question.ts` 例子，加 `Space` 切换勾选）。保存到配置文件。

3. **`session_start` 通知**：用 `pi.getCommands()` 获取已加载技能列表，过滤掉被排除的，`ctx.ui.notify` 通知用户。

### 边界情况

| 情况 | 处理 |
|------|------|
| 配置为空 / 无排除项 | `before_agent_start` 直接 return，不修改系统提示词 |
| 排除项未命中任何实际技能 | 不修改（避免无谓替换） |
| 所有技能都被排除 | `formatSkillsForPrompt([])` 返回空串，整段从系统提示词移除 |
| `disable-model-invocation` 技能 | 本就不注入 `available_skills`；命令列表中也不显示（排除它无意义） |
| 正则未匹配（如无 `read` 工具） | 不修改，静默跳过 |
| 技能名冲突 | pi 自身按 name 去重，name 是安全键 |

### 生效时机

`before_agent_start` 在每次用户发消息时触发，每次重新读配置文件。所以 `/skills-injection` 保存后，**下一条消息**就按新配置注入，比 `/reload` 更快。重启 pi 后同样读配置文件生效。

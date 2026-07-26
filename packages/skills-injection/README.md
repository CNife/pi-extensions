# @cnife/pi-skills-injection

交互式控制哪些技能被注入到 pi 的系统提示词（`available_skills`），持久化配置。

## 解决的痛点

pi 启动时会加载所有已安装技能（`~/.pi/agent/skills/`、`.agents/skills/` 等），并把它们的名称、描述、路径以 `<available_skills>` XML 注入系统提示词。技能一多，系统提示词变长、占用上下文、干扰模型注意力，但用户无法 selectively 关闭某些技能的注入。

本扩展让用户交互式开关技能注入，配置持久化，下一条消息即生效。

## 安装

```bash
pi install npm:@cnife/pi-skills-injection
```

## 使用

输入 `/skills-injection` 打开设置列表（与 `/settings`、`/tools` 同款交互）：

- `↑↓` 导航
- 输入字符模糊筛选技能名
- `Space` / `Enter` 切换 `enabled` / `disabled`（即时保存）
- `Esc` 关闭

语义：

- `enabled` = 注入到系统提示词
- `disabled` = 不注入

列表按技能名字母序排列。切换后下一条消息即生效，无需 `/reload`。

每次启动会话时，扩展会用英文 notify 列出三类技能（名字字母序 + 数量；空类列表位写 `0`）：

```text
Skills injection
injected (N): a, b
forbidden (0): 0
non-injectable (K): z
```

- `injected`：会注入系统提示词
- `forbidden`：用户在 `/skills-injection` 里 disabled 的
- `non-injectable`：`disableModelInvocation`，本身不进系统提示词（TUI 列表不展示）

## 配置

配置文件：`~/.pi/agent/cnife-skills-injection.json`

```json
{
  "excluded": ["skill-name-1", "skill-name-2"]
}
```

`excluded` 是内部存储（disabled 的技能名）。也可手动编辑此文件，下一条消息生效。

## 技术实现

三个部分：

1. **`before_agent_start` 拦截**：读取配置，从 `event.systemPromptOptions.skills` 过滤掉被排除的技能，用 pi 导出的 `formatSkillsForPrompt` 重新渲染 `<available_skills>` 段，正则替换系统提示词中对应的整段。每 turn 读配置文件，所以下一条消息即生效。

2. **`/skills-injection` 命令**：`ctx.ui.custom()` + `DynamicBorder`（border 色，对齐 `/settings`）+ `SettingsList`，`enableSearch` 做名称模糊筛选。切换即时写配置。技能列表与启动通知同源（见下）。

3. **`session_start` 通知**（与命令共用 `resolveSkills`）：
   - 技能名单以 `pi.getCommands()`（`source === "skill"`）为准
   - `disableModelInvocation` **优先**用 pi 导出的 `loadSkills()`（`Skill.disableModelInvocation`）
   - 仅当某技能不在 `loadSkills` 结果里（如 `resources_discover` 额外路径）时，才读该技能文件 frontmatter
   - 读文件失败时静默按可注入处理
   - 按配置分成 injected / forbidden / non-injectable，英文多行 `ctx.ui.notify`

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

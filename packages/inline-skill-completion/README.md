# @cnife/pi-inline-skill-completion

在输入框**任意位置**补全技能（`/skill:<name>`），并支持**一行提交多个技能**，每个技能在 TUI 中渲染为独立的可折叠块。

## 解决的痛点

pi 原生有两个限制：

1. **补全位置受限**：只允许行首触发 `/` 补全，想在输入框中间补全做不到。
2. **补全数量受限**：默认只能展开一个技能，一行里写多个 `/skill:` 只有行首那个生效。

本扩展解决这两个问题：

- 输入框**非行首**位置输入 `/` 时，自动弹出已安装技能的模糊匹配候选；行首 `/` 仍委托原生 slash 命令补全。
- 提交时**全权展开**文本中所有 `/skill:xxx` token，每个都渲染成原生 `[skill]` 折叠块。

## 安装

```bash
pi install npm:@cnife/pi-inline-skill-completion
```

## 使用

在输入框任意位置输入 `/`，选择技能后插入规范形式 `/skill:<name> `（带尾随空格，便于连续输入多个）。可以一行写多个：

```text
/skill:domain-modeling /skill:grilling 帮我设计用户认证的领域模型
```

提交后，TUI 会渲染：

- `[skill] domain-modeling` 折叠块
- `[skill] grilling` 折叠块
- 正文 `帮我设计用户认证的领域模型`

`Tab` 可切换折叠块展开/收起，与原生技能调用体验一致。

## 展开规则

提交含 `/skill:xxx` token 的文本时，扩展会拦截输入并改用自定义消息渲染（绕过 pi 只展开行首单技能、只渲染单 skill 块的限制）：

- 所有 skill block 按出现顺序**前置**（空行连接）
- **行首第一个** token 连同其尾随分隔符一并删除
- **其余** token 字面保留（维持句子通顺）
- 其余文本原样保留

例：`/skill:a foo /skill:b` →

```text
<skill block a>

<skill block b>
foo /skill:b
```

> 正文里保留的 `/skill:b` 是符合规则的预期行为（行首第一个删除，其余字面保留），非 bug。

### 边界情况

| 情况 | 处理 |
|------|------|
| 无 `/skill:` token | 走原生（普通 user 消息） |
| 未知技能 / 读文件失败 | 该 token 原样保留，不展开 |
| 全部 token 展开失败 | 退回原生 user 消息 |
| 自定义消息发送失败 | 降级为原生（原文当普通 user 消息，避免输入丢失） |
| 流式中提交 | 按 `streamingBehavior` 用 `deliverAs`（steer/followUp）而非 triggerTurn |

## 技术实现

绕开 pi 的 user 消息渲染路径，改用自定义消息（CustomMessage）：

1. `input` 事件里解析所有 `/skill:xxx` token，返回 `action: "handled"` 阻止 pi 创建普通 user 消息。
2. 调用 `pi.sendMessage` 发 `customType: "inline-skills"` 的自定义消息：`content` 是完整展开文本（经 `convertToLlm` 转成 `role: user` 给 LLM），`details` 是结构化 blocks + 正文（给 renderer）。
3. 注册 `messageRenderer`，复用 pi 原生组件渲染：每个 block → `SkillInvocationMessageComponent`（折叠块），正文 → `UserMessageComponent`。

行首单技能时，LLM 收到的展开文本与原生逐字等价。

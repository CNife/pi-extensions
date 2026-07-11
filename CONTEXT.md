# pi-extensions

CNife 的 [pi](https://pi.dev) agent 扩展集合。本文件是领域术语表（glossary）--只记 pi 扩展开发中需要统一的概念，不记开发流程或命令。

## 项目用语

**扩展** (extension)：
通过 `.ts` 文件注册到 pi 的功能模块，提供事件钩子、工具或命令。运行时概念。
_避免_：插件、addon（pi 生态统一用"扩展"）

**技能** (skill)：
`SKILL.md` 文件，给 agent 的指令集。和扩展是两套独立机制--技能是 prompt 层，扩展是代码层。
_避免_：把技能和扩展混为一谈

**包** (package)：
npm workspace 包，发布单元（`@cnife/pi-*`）。一个包可含多个扩展和技能。发布层概念，不等于扩展。
_避免_：模块、子项目

**工具** (tool)：
扩展通过 `registerTool` 注册的、LLM 可调用的能力（如 `executePython`）。由模型主动调用。
_避免_：函数、API

**命令** (slash command)：
扩展通过 `registerCommand` 注册的、用户输入 `/xxx` 触发的能力。由用户主动调用，区别于工具。
_避免_：把命令和工具混用

**会话** (session)：
一次 pi agent 对话，含完整的消息树。扩展常通过 session manager 读写状态。

**turn**：
agent 的一次完整推理-行动循环。扩展常挂在 `turn_end` 等事件上做收尾。一个会话含多个 turn。

**message**：
会话中的单条消息（user / assistant / tool）。比 turn 粒度更细。

**footer / 状态行**：
pi TUI 底部的状态显示区。多个扩展往这里写状态（如缓存命中率、推理速度）。
_避免_：状态栏、statusbar

**provider**：
LLM 服务提供方（如 OpenAI、Anthropic）。扩展解析 model 时需要。

**model**：
provider 下的具体模型（如 `gpt-4o`、`claude-3-5-sonnet`）。扩展通过 model registry 查询。

## Example Dialogue

> **Dev**: 加个新扩展显示 token 用量。
> **Agent**: 这是扩展（挂 `turn_end` 往 footer 写）还是技能（给 agent 的分析指令）？
> **Dev**: 扩展。
> **Agent**: 那 `packages/` 下建个包，`extensions/` 里写 `.ts`，`registerTool` 不需要，直接写 footer。

---
date: 2026-06-24T13:31:20+0800
author: 蔡涛
commit: 012b8f5
branch: feat/obsidian-diary
repository: pi-extensions
topic: "Obsidian Diary Pi Extension"
tags: [research, codebase, obsidian-diary, pi-extension, completeSimple, sendUserMessage]
status: ready
last_updated: 2026-06-24T13:31:20+0800
last_updated_by: 蔡涛
---

# Research: Obsidian Diary Pi Extension

## Research Question

创建 `packages/obsidian-diary/` 为一个源文件扩展。`extensions/index.ts` 中实现 `/diary` handler，handler 内依次完成：参数解析 → 读取 session JSONL → 读取配置并校验 → 计算日记路径 → 读取今日日记内容 → 调用 `completeSimple()` 做语义总结 → 通过 `pi.sendUserMessage()` 将结构化结果发到当前会话。不需要独立的 CLI、subagent、构建步骤或额外的 npm 依赖。

## Summary

obsidian-diary 是一个单源文件扩展，注册 `/diary` slash 命令。命令 handler 用工厂闭包捕获的 `pi`（`ExtensionAPI`）注册，用户键入时触发。handler 走 fail-fast 线性链：加载配置（沿用旧 `vaults` 双 vault 格式 + 可选 `model` 字段，缺失/损坏则硬失败）→ 读当前会话 transcript（`ctx.sessionManager.getBranch()`，不截断全量）→ 扫待办+近期日记（复刻旧 helper 逻辑）→ 计算今日日记路径（旧中文日期格式 `{base}/{diary_dir}/{year}/{month}/{中文日期}.md`）→ 读今日日记内容 → 选模型（可配 `model`，null 用当前 `ctx.model`）→ 调 `completeSimple()` 做语义总结返回结构化 JSON → `pi.sendUserMessage()` 发到当前会话。扩展代码零写入日记文件——唯一的写操作是缺失配置时写模板配置文件；日记写入完全由主 Agent 在用户确认后执行。

关键 API 事实：`sendUserMessage` 在 `ExtensionAPI`（`pi` 参数）上而非 `ctx` 上，返回 `void` 不可 await；`completeSimple` 不抛异常、不自动截断；pi 自身 `/session` 命令也不解析任意 session-id（只打印当前会话路径），故首版去掉 `<session-id>` 参数。

## Detailed Findings

### Command Registration & Handler Contract

- 扩展默认导出工厂函数 `export default function (pi: ExtensionAPI)`，`pi.registerCommand("diary", { handler })` 在工厂执行时注册（仅存 handler，不调用）。规范先例：`packages/simple-plannotator/extensions/index.ts:47`（工厂签名）+ `:50`（`registerCommand`）。`registerCommand` 重载在 `types.d.ts:816`；`RegisteredCommand.handler` 签名 `(args: string, ctx: ExtensionCommandContext) => Promise<void>` 在 `types.d.ts:773`。
- `args` 是原始 `string`（无参时 Pi 传 `""`）。`simple-plannotator/extensions/index.ts:87` 用 `args ?? ""` 防御性处理。
- `ExtensionCommandContext`（`types.d.ts:241-275`）扩展 `ExtensionContext`，含会话变异方法（`waitForIdle`/`newSession`/`fork`/`navigateTree`/`switchSession`/`reload`）——`/diary` 全部不用，只用继承自 `ExtensionContext`（`types.d.ts:207-236`）的读 API：`ui`、`sessionManager`、`modelRegistry`、`model`。
- 参数解析：首版无 `<session-id>`（见 Developer Context 决策）。仅保留 `--work`/`--personal` 互斥标志，手动 split `args` 即可，无需参数库。无标志时变体由 LLM 在 prompt 中自动判断（FRD Decision "Variant: Auto vs Explicit"）。

### Output Channel: sendUserMessage

- `pi.sendUserMessage(content, options?)` 声明在 `types.d.ts:841-843`，签名 `(content: string | (TextContent|ImageContent)[], options?: { deliverAs?: "steer"|"followUp" }): void`。**返回 void，不可 await**。`pi` 由工厂闭包捕获，handler 内可访问（`simple-plannotator/extensions/index.ts:41` 在命令 handler 内用 `pi.sendUserMessage(result.feedback, { deliverAs: "followUp" })`）。
- 对比：`ReplacedSessionContext.sendUserMessage`（`types.d.ts:287-289`）返回 `Promise<void>`，但仅在 `newSession()`/`fork()`/`switchSession()` 的 `withSession` 回调内可用，普通命令 handler 拿不到。一个分析 agent 误报它返回 `Promise<void>`——已据 `types.d.ts:843` 确认为 void。
- `deliverAs`：`"steer"` 替换当前 agent 方向（中断），`"followUp"` 队列附加指令（当前操作完成后处理）。日记草稿不是紧急重定向，应取 `"followUp"`（对齐 `simple-plannotator:41`；`agent-loop-reflection` 用 `"steer"` 是因需立即打断提醒，反模式）。命令 handler 触发时 agent 通常 idle，`followUp` 直接进队列。
- handler 调 `pi.sendUserMessage(json, {deliverAs:"followUp"})` 后即可返回，无需等待。`.then` 模式（`simple-plannotator:65/141/181`）用于异步浏览器会话，日记无需。

### Session JSONL Access (Current Session Only)

- `ctx.sessionManager` 是 `ReadonlySessionManager`（`session-manager.d.ts:136`，`Pick<SessionManager, "getCwd"|"getSessionDir"|"getSessionId"|"getSessionFile"|"getLeafId"|"getLeafEntry"|"getEntry"|"getLabel"|"getBranch"|"getHeader"|"getEntries"|"getTree"|"getSessionName">`）。
- **无参路径**：`ctx.sessionManager.getBranch()`（`:244`，从根到叶全部 entry）内存遍历，即时。`auto-naming-session/extensions/index.ts:192-221` 的 `buildTranscript` 即此模式：迭代 branch，过滤 `type==="message"` 且 `role==="user"|"assistant"`，拼 `${role}: ${text}`。`messageContentToText`（`:179-190`）处理 `string` 与 `Array<{type,text}>` 两种 content。
- `<session-id>` 已移除（见 Developer Context）。因此**无需**文件扫描/`getDefaultSessionDir`/`SessionManager.list` 等解析逻辑。读 transcript 只用 `getBranch()`。

### Config Loading & Validation

- 配置路径：`join(getAgentDir(), "cnife-obsidian-diary.json")`（`getAgentDir()` 返回 `~/.pi/agent/`，`auto-naming-session/extensions/index.ts:28` 先例）。
- 配置格式**沿用旧 `obsidian-diary.json` 的 `vaults` 双 vault 结构**（见 Developer Context），顶层加可选 `model` 字段。结构：

  ```json
  {
    "model": null,
    "vaults": {
      "work": { "base": "...", "diary_dir": "工作日志", "template": "日志模板.md", "exclude_meta": ["AGENTS.md","任务.md","日志模板.md"] },
      "personal": { "base": "...", "diary_dir": "个人日记", "template": "日记模板.md", "exclude_meta": ["AGENTS.md"] }
    }
  }
  ```

- 三级校验模式参考 `auto-naming-session/extensions/index.ts:38-123`（`loadConfig`），但**关键差异**：obsidian-diary 必须**硬失败**（返回 null），不像 auto-naming 宽松回退默认值。原因：日记写入绝不能用猜测的配置。具体：
  - Level 1（文件不存在，`:40-47`）：`saveDefaultConfig()` 写模板（唯一写操作），返回 null 报错退出。`saveDefaultConfig`（`:30-36`）= `mkdirSync(dir,{recursive:true})` + `writeFileSync`。
  - Level 2（读/JSON.parse 失败，`:49-68`）：返回 null 报错（auto-naming 是回退默认值——要改）。
  - Level 3（字段类型校验，`:70-107`）：返回 null 报错（auto-naming 是回退默认值——要改）。
- 配置加载时机：**handler 内懒加载**（每次 `/diary` 调用读一次），非工厂时。理由：命令驱动、调用频率低、配置始终最新、错误能就地报给用户。`auto-naming` 在工厂时加载是因事件驱动频繁触发。配置错误状态可用 `ctx.ui.setStatus(key, ctx.ui.theme.fg("error", msg))`（`auto-naming:334-342` 先例）或 `ctx.ui.notify`。

### Diary Path Computation & File Scanning

- 日记路径**沿用旧中文日期格式**（见 Developer Context）：`compute_paths`（`obsidian-helper.py:72-81`）→ `{base}/{diary_dir}/{year}/{month:02d}/{year}年{month}月{day}日{星期几}.md`。例：`/mnt/c/Obsidian/工作日志/2026/06/2026年06月24日星期三.md`。星期用中文（`WEEKDAYS=["星期一".."星期日"]`，`obsidian-helper.py:22`）。
- 模板路径：`{base}/{diary_dir}/{template}`（`obsidian-helper.py:79`）。注意：旧 helper 在日记不存在时**自动从模板复制**（`:152-156`）——但新扩展架构下扩展不写文件，模板复制交给主 Agent 在用户确认后做，或由 LLM 在 summary 中体现模板结构。
- 月份目录：`{base}/{diary_dir}/{year}/{month:02d}`（`:74`），写日记前需创建——同样交主 Agent。
- 路径越界校验：`resolve(diaryPath).startsWith(resolve(base) + "/")` 防 `../` 逃逸。注意加尾 `/` 防前缀误配（如 `/vault` 匹配 `/vault-escape`）。
- **扫描范围**（见 Developer Context，超 FRD Goals 最小集）：复刻旧 helper 逻辑，全为纯读操作：
  - 待办 `_scan_todos`（`obsidian-helper.py:84-108`）：`os.walk` `{base}/{diary_dir}`，近 14 天，正则 `^\s*-\s*\[([ ^>!/?~br])\]\s+(.+)$`（`:88`）匹配未完成 `- [ ]`，排除 `*模板.md` 和 `exclude_meta` 文件，输出 `{file,line,content}`。
  - 近期日记 `_scan_recent`（`:111-130`）：`os.walk`，近 10 天，排除模板/`exclude_meta`，按 mtime 降序取前 3 篇（`:129`）。读内容时取前 30 行（`:183`）。
  - 今日日记全文（`:191-197`）：`readFileSync`。
- 这三块拼进 LLM prompt 作为上下文（旧 helper 是输出给 AI 读，新扩展是代码读后拼进 prompt）。

### LLM Call Chain (completeSimple)

- 模型选择（见 Developer Context，可配默认当前会话）：
  - `config.model` 为 `null` → `ctx.model`（`types.d.ts:219`，`Model<any>|undefined`）。
  - `config.model` 为 `"provider/modelId"` → `parseModelRef`（`auto-naming:223-229`）→ `ctx.modelRegistry.find(provider, id)`（`model-registry.d.ts:60`）。先例：`auto-naming:238-260`。
- 认证：`await ctx.modelRegistry.getApiKeyAndHeaders(model)`（`model-registry.d.ts:71`）返回 `ResolvedRequestAuth`（`:7-14`：`{ok:true,apiKey?,headers?}|{ok:false,error}`）。**必须检查 `auth.ok`**（`auto-naming:263-269` 先例）。
- 调用：`completeSimple(model, context, options)`（`stream.d.ts:10`）。**不抛异常**（错误以 `AssistantMessage` + `stopReason:"error"|"aborted"` 返回）。签名：`completeSimple<TApi extends Api>(model, context: Context, options?: SimpleStreamOptions): Promise<AssistantMessage>`。
  - `Context`（`pi-ai types.d.ts:236-240`）：`{ systemPrompt?: string; messages: Message[]; tools?: Tool[] }`。
  - `SimpleStreamOptions`（`pi-ai types.d.ts:131-134`）扩展 `StreamOptions`（`:28`，含 `maxTokens?`/`apiKey?`/`headers?`/`signal?` 等），加 `reasoning?`/`thinkingBudgets?`。
  - 先例调用：`auto-naming:275-286`，传 `{ systemPrompt, messages:[{role:"user",content,timestamp:Date.now()}] }` + `{ apiKey:auth.apiKey, headers:auth.headers, maxTokens:60 }`。日记 maxTokens 远大于 60（标题才 60），建议 `2048`（日记数百词）。
- **completeSimple 不自动截断**（见 Developer Context，用户选不截断全量）：`stream.js:23-26` `completeSimple`→`streamSimple`→`provider.streamSimple` 直接发全量 `Context`。主 agent 用 `buildSessionContext()`（`session-manager.d.ts:147,249`）智能管理上下文，但 completeSimple 不走它。用户决定直接全量发，依赖 `model.contextWindow`（`pi-ai types.d.ts:487`）足够大。
- 响应解析：`AssistantMessage`（`pi-ai types.d.ts:189-202`）含 `content:(TextContent|ThinkingContent|ToolCall)[]`、`stopReason:StopReason`（`:183`："stop"|"length"|"toolUse"|"error"|"aborted"）、`errorMessage?`、`usage:Usage`。提取文本：`response.content.filter(c=>c.type==="text").map(c=>c.text).join("").trim()`（`auto-naming:297-302` 先例）。然后 `JSON.parse` 得 `{diaryPath, summary, instructions}`。需处理模型用 ```` ```json ```` 围栏包裹的情况（strip 后再 parse）。
- stopReason 处理：`"error"|"aborted"` → 报错返回（`auto-naming:288-294` 先例）；`"length"` → 可能 JSON 截断不可解析，报错返回；`"stop"` → 成功 parse。

### Fail-Fast Error Chain (No-Write Guarantee)

按序检查，每个失败路径都在写日记前 return：

1. 配置缺失/损坏 → `saveDefaultConfig` 写**模板配置**（非日记）后报错 return。`saveDefaultConfig`（`auto-naming:30-36`）是扩展**唯一写操作**，只写 `cnife-obsidian-diary.json` 到 `getAgentDir()`，与日记路径（vault 下）无交集。
2. 日记路径越界 → `resolve`+`startsWith` 校验失败报错 return。
3. LLM 调用失败（`stopReason:"error"|"aborted"`）→ 报错 return（`completeSimple` 只 HTTP 调用，不写本地文件）。
4. LLM 返回不可解析 JSON → `JSON.parse` 抛错 catch 报错 return。

- 架构不变量：扩展**无任何代码路径写/改日记 `.md`**。唯一写是缺失配置时的模板配置文件。日记写入完全委托主 Agent 在用户确认后执行（`instructions` 字段指示）。对比旧 skill 痛点：旧 AI 有读+写权限→绕过规则→写噪音、跳过读 session；新架构机械操作代码化、LLM 调用无工具访问、写入权完全移出扩展层。

### Package Scaffolding & Jiti Loading

- `packages/obsidian-diary/package.json`：`name:"@cnife/pi-obsidian-diary"`，`pi:{extensions:["./extensions"]}`，`peerDependencies:{ "@earendil-works/pi-coding-agent":"*" }`。模板抄 `packages/auto-naming-session/package.json`（含 `version`/`keywords:["pi-package"]`/`license`/`author`/`homepage`/`bugs`/`repository`/`publishConfig`）。**首提交必须含完整元数据**（先例 `ee1b9d0`/`193b647`/`c299280` 都是事后补元数据/修非法 JSON）。
- `@earendil-works/pi-ai` 不必列为 peerDep（`auto-naming` 从它 import `completeSimple`/`Model`/`TextContent` 也没列；本地测时从根 workspace `node_modules` 解析，发布后从宿主 pi 解析）。
- npm workspaces：根 `package.json` 的 `"workspaces":["packages/*"]` 自动纳入新包，无需手动注册。但**必须更新 `package-lock.json`**（先例每个新包 +12 行；漏更新致 CI 失败）。
- 无构建步骤：所有源文件扩展 `package.json` 无 `scripts`/`build`，jiti 直接编译 `.ts`（`pi -ne -ns -e packages/obsidian-diary/extensions/index.ts`）。`-ne`=`--no-extensions`，`-ns`=`--no-skills`，`-e`=`--extension`。
- tsconfig/biome 继承根配置：`tsconfig.json` 的 `include:["packages/**/*.ts"]` 自动覆盖；`biome.json` 强制双引号、2 空格缩进、organizeImports。
- 加载时间线（`.rpiv/artifacts/research/2026-06-01_21-46-35_pi-extension-api-patterns.md`）：工厂执行时 `pi.registerCommand` 安全（仅存 handler），`pi.sendUserMessage`/`pi.setSessionName` 是 throwing stub 直到 `bindCore`。但 `/diary` handler 在用户键入时才触发，此时 `bindCore` 已完成，所有 `ctx.*` API 安全。
- `npm run check`（根 `package.json:6`）= `npx biome check ./packages`，**只跑 Biome 不跑 tsc**。要求双引号、2 空格、无未用变量、import 有序。类型错误不会被 check 捕获，只在编辑器/手跑 `tsc --noEmit` 暴露。
- README.md：`packages/AGENTS.md` 列为结构一部分，`auto-naming` 没有（例外），其余包都有。建议加。

## Code References

- `packages/simple-plannotator/extensions/index.ts:47` — 工厂签名 `export default function pn(pi: ExtensionAPI)`
- `packages/simple-plannotator/extensions/index.ts:50` — `pi.registerCommand("pnr", {handler})` 规范
- `packages/simple-plannotator/extensions/index.ts:41` — `pi.sendUserMessage(result.feedback, {deliverAs:"followUp"})` 在 handler 内用闭包 `pi`
- `packages/simple-plannotator/extensions/index.ts:87` — `args ?? ""` 防御性参数处理
- `packages/auto-naming-session/extensions/index.ts:28` — `join(getAgentDir(), "cnife-*.json")` 配置路径
- `packages/auto-naming-session/extensions/index.ts:30-36` — `saveDefaultConfig`（唯一写操作：mkdir+writeFileSync 模板配置）
- `packages/auto-naming-session/extensions/index.ts:38-123` — 三级配置校验 `loadConfig`（obsidian-diary 改为硬失败）
- `packages/auto-naming-session/extensions/index.ts:179-221` — `messageContentToText` + `buildTranscript`（getBranch 内存遍历）
- `packages/auto-naming-session/extensions/index.ts:223-229` — `parseModelRef`（"provider/modelId" 解析）
- `packages/auto-naming-session/extensions/index.ts:238-260` — 模型选择（config.model vs ctx.model）
- `packages/auto-naming-session/extensions/index.ts:263-269` — `getApiKeyAndHeaders` + `auth.ok` 检查
- `packages/auto-naming-session/extensions/index.ts:275-286` — `completeSimple` 调用先例
- `packages/auto-naming-session/extensions/index.ts:288-302` — stopReason 处理 + 文本提取
- `packages/auto-naming-session/extensions/index.ts:334-342` — `setConfigErrorStatus`（setStatus+theme.fg）
- `node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts:207-236` — `ExtensionContext`（读 API）
- `node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts:241-275` — `ExtensionCommandContext`（含不用掉的会话变异方法）
- `node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts:773` — `RegisteredCommand.handler` 签名
- `node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts:816` — `registerCommand` 重载
- `node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts:841-843` — `sendUserMessage`（在 ExtensionAPI 上，返回 void）
- `node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts:287-289` — `ReplacedSessionContext.sendUserMessage`（返回 Promise，仅 withSession 内可用）
- `node_modules/@earendil-works/pi-coding-agent/dist/core/session-manager.d.ts:136` — `ReadonlySessionManager` Pick 定义
- `node_modules/@earendil-works/pi-coding-agent/dist/core/session-manager.d.ts:244` — `getBranch()` 从根到叶 entry
- `node_modules/@earendil-works/pi-coding-agent/dist/core/model-registry.d.ts:7-14` — `ResolvedRequestAuth` 类型
- `node_modules/@earendil-works/pi-coding-agent/dist/core/model-registry.d.ts:60,71` — `find` / `getApiKeyAndHeaders`
- `node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/interactive-mode.js:4312-4344` — pi 内置 `/session` 命令 `handleSessionCommand`（只用当前会话 getSessionStats，不解析任意 id）
- `node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js:2313` — `getSessionStats` 返回当前会话 sessionFile/sessionId
- `node_modules/@earendil-works/pi-ai/dist/stream.d.ts:10` — `completeSimple` 声明（不抛异常）
- `node_modules/@earendil-works/pi-ai/dist/types.d.ts:183,189-202` — `StopReason` / `AssistantMessage`
- `node_modules/@earendil-works/pi-ai/dist/types.d.ts:236-240` — `Context` 类型
- `node_modules/@earendil-works/pi-ai/dist/types.d.ts:131-134,28` — `SimpleStreamOptions`/`StreamOptions`
- `node_modules/@earendil-works/pi-ai/dist/types.d.ts:487` — `Model.contextWindow`
- `~/personal_code/skills/knowledge/obsidian-diary/scripts/obsidian-helper.py:72-81` — `compute_paths`（旧中文日期路径计算）
- `~/personal_code/skills/knowledge/obsidian-diary/scripts/obsidian-helper.py:84-108` — `_scan_todos`（待办扫描逻辑）
- `~/personal_code/skills/knowledge/obsidian-diary/scripts/obsidian-helper.py:111-130` — `_scan_recent`（近期日记扫描逻辑）
- `~/.config/cnife-skills/obsidian-diary.json` — 旧配置文件实际格式（vaults 双 vault 结构）

## Integration Points

### Inbound References

- `/diary` slash 命令（用户键入触发）→ `pi.registerCommand` 注册的 handler（`types.d.ts:816`）。无其他 inbound。

### Outbound Dependencies

- `pi.sendUserMessage(json, {deliverAs:"followUp"})`（`types.d.ts:841`）→ 当前会话主 Agent。扩展唯一输出通道，发结构化 JSON `{diaryPath, summary, instructions}`。
- `completeSimple(model, context, opts)`（`stream.d.ts:10`）→ LLM provider。唯一 LLM 交互，返回 `AssistantMessage`。
- `ctx.sessionManager.getBranch()`（`session-manager.d.ts:244`）→ 读当前会话 transcript。
- `ctx.modelRegistry.getApiKeyAndHeaders(model)`（`model-registry.d.ts:71`）→ 解析 API key/headers。

### Infrastructure Wiring

- `packages/obsidian-diary/package.json` 的 `"pi":{"extensions":["./extensions"]}` → pi 发现并 jiti 加载 `extensions/index.ts`。
- 根 `package.json` `"workspaces":["packages/*"]` 自动纳入。
- 配置文件 `~/.pi/agent/cnife-obsidian-diary.json`（`getAgentDir()`）。
- Obsidian vault（配置 `vaults.{work,personal}.base`）→ 读待办/近期/今日日记（纯 `node:fs`）。

## Architecture Insights

- **工厂闭包模式**：`pi`（ExtensionAPI）在工厂作用域捕获，命令 handler 通过闭包访问 `pi.sendUserMessage`，而非通过 `ctx` 参数。`simple-plannotator:47`（工厂）+ `:41`（闭包内用 `pi`）是规范。
- **命令驱动 vs 事件驱动**：`/diary` 是命令驱动（按需触发），配置懒加载在 handler 内；`auto-naming` 是事件驱动（频繁触发），配置工厂时加载。
- **机械操作代码化、语义工作单次 LLM、写入权移出扩展**：旧 skill 痛根是 AI 同时有读+写权限。新架构把读文件/算路径/校验/扫描全放代码，LLM 只做语义总结无工具访问，写入由主 Agent+用户确认。这是从架构上消除绕过，而非靠规则约束。
- **completeSimple 不抛异常**：错误以 `stopReason` 返回，必须检查（不像普通 async 函数 try/catch）。
- **sendUserMessage 是 void**：handler 不能 await 它，发完即返回，消息进队列由主 Agent 处理。
- **配置硬失败 vs 宽松回退**：obsidian-diary 必须硬失败（写入绝不用猜测配置），与 auto-naming 宽松回退相反。

## Precedents & Lessons

5 similar past changes analyzed.

### Precedent: 首次事件驱动扩展 — auto-naming-session

**Commit(s)**: `f5e90bd` — "实现 auto-naming-session 扩展" (2026-06-01)
**Blast radius**: 3 files across 2 layers
  packages/auto-naming-session/package.json — manifest
  packages/auto-naming-session/extensions/index.ts — 371 行单文件
  .rpiv/artifacts/plans/2026-06-01_21-59-51_auto-naming-session.md — plan

**Follow-up fixes**:

- `fd52eef` — "抽取 STATUS_KEY 常量和 config 错误状态函数" (2026-06-01) — 代码审查后补 status 显示
- `c48b635` — "auto-naming-session: 优化触发时机和 prompt，首次消息立即生成标题" (2026-06-04) — 重大行为调整，加 message_end handler
- `9b3cdb8` — "重构四个扩展去除冗余" (2026-06-22) — 301→227 行

**Lessons from docs**:

- `.rpiv/artifacts/research/2026-06-01_21-46-35_pi-extension-api-patterns.md` — completeSimple 不抛异常（查 stopReason）、getBranch 根→叶、配置路径惯例、工厂顶层初始化
- `.rpiv/artifacts/reviews/2026-06-01_23-10-00_auto-naming-session-code-review.md` — 审查发现需抽 STATUS_KEY、config 错误路径需 setStatus，均在 fd52eef 修

**Takeaway**: 配置加载器模式（缺失→建默认、解析错→warn+回退、仅致命→null→错误状态 handler）是标准；合并后最大改动是行为调整（c48b635），说明初始 API 面可能需调整。

### Precedent: registerCommand + sendUserMessage — simple-plannotator

**Commit(s)**: `e0d5e2e` — "拆分为 monorepo" (2026-05-28)
**Blast radius**: 25 files, all layers（monorepo 重组）

**Follow-up fixes (路径校验)**:

- `fff9d0a` — "修复 /pna 无法解析 ~ 开头路径" (2026-05-28) — normalizeUserPath 加 ~ 展开
- `b746846` — "修复 /pna 路径引号导致解析错误" (2026-05-28)
- `918532f` — "simple-plannotator: 去掉 @ 前缀" (2026-05-29) — @ 前缀剥离顺序 bug
- `83f3052` — "修复 /pna 路径引号残留" (2026-06-12) — strip @ 在引号前

**Takeaway**: 路径校验是反复 bug 源（15 天 4 修：~ 展开、引号剥离、@ 顺序、引号残留）。obsidian-diary 的 vault 路径/日记路径校验必须从首版全面处理 ~、引号、相对/绝对、`../` 逃逸。

### Precedent: 新扩展包骨架 + sendUserMessage(steer) — agent-loop-reflection

**Commit(s)**: `661d85e` — "实现 agent-loop-reflection 扩展包" (2026-06-11)
**Blast radius**: 4 files（package.json/index.ts/README.md/package-lock.json +12 行）

**Follow-up fixes**:

- `3996972` — "简化 agent-loop-reflection 单计数器 + input 事件" (同日) — 162 行简化
- `529cd82` — "精简配置，4 字段缩减为 2" (同日) — 删 enabled，合并 threshold/repeat → reminderTurnsInterval

**Takeaway**: 配置面应最小（4 字段当天减到 2）。obsidian-diary 配置只保留 vaults（沿用旧格式）+ model。

### Precedent: package.json 基础设施 bug

**Commit(s)**: `ee1b9d0`/`193b647`/`c299280` (2026-05-29~31)
**Blast radius**: 多 package.json + workflow

**Takeaway**: package.json 元数据首提交必须完整（license/author/homepage/bugs/repository/publishConfig）；单个尾逗号曾致 `npm ci` 失败。lockfile 更新必须。

### Composite Lessons

- **路径校验是反复 bug 源**（`simple-plannotator` 15 天 4 修，`fff9d0a`/`83f3052`）。obsidian-diary vault/日记路径校验首版就要全：~、引号、@、相对/绝对、`../` 逃逸。
- **配置面最小化**（`agent-loop-reflection` 529cd82 当天 4→2 字段；`auto-naming` 核心默认即工作）。obsidian-diary 只 vaults+model。
- **package.json 元数据首提交必须完整**（`ee1b9d0`/`193b647`/`c299280` 事后补/修）。含 license/author/homepage/bugs/repository/publishConfig。
- **lockfile 更新必须**（每新包 +12 行；漏更新致 CI 失败）。加包后 `npm install --package-lock-only`。
- **completeSimple 是对的 LLM 调用**（`auto-naming:275` 先例，await + 查 stopReason）。FRD 单 LLM 调用架构有充分先例。
- **合并后行为调整正常**（`auto-naming` c48b635 合并 3 天后加 message_end）。扩展要易改：单文件、清晰函数边界、配置驱动。

## Historical Context (from `.rpiv/artifacts/`)

- `.rpiv/artifacts/discover/2026-06-24_11-50-19_obsidian-diary-pi-extension.md` — 本研究的输入 FRD，含 6 个 Decisions 和 3 个 Open Questions
- `.rpiv/artifacts/research/2026-06-01_21-46-35_pi-extension-api-patterns.md` — 扩展加载生命周期（loader.js→runner.js bindCore→事件派发）、completeSimple/getBranch/配置路径 API 调研

## Developer Context

**Q (discover: Architect Subagent vs One-Call): 语义总结交给 subagent 还是一次 LLM 调用？**
A: 一次 LLM 调用。`completeSimple()` 有现成先例（`packages/auto-naming-session/extensions/index.ts:275`）。

**Q (discover: Boundary Write Authority): 写入权限放哪层？**
A: 主 Agent 在用户确认后写入。扩展层零写入日记文件，唯一写是缺失配置时写模板配置。

**Q (discover: CLI Standalone Binary vs No Build): 是否需独立 CLI？**
A: 不独立 CLI，扩展直接用 `node:fs`。

**Q (discover: Variant Auto vs Explicit): work/personal 变体如何选？**
A: 无参自动判断，可 `--work|--personal` 覆盖。

**Q (discover: Config Location and Migration): 配置存哪？兼容旧路径？**
A: `getAgentDir()/cnife-obsidian-diary.json`，不兼容旧路径。但**配置格式沿用旧 `~/.config/cnife-skills/obsidian-diary.json` 的 `vaults` 双 vault 结构**（每个含 base/diary_dir/template/exclude_meta），顶层加可选 `model: null` 字段。

**Q (discover: Scope Single File vs Multi-File): 包结构一个还是多文件？**
A: 一个源文件 `extensions/index.ts`。

**Q (FRD Requirement 2: `/diary <session-id>` 参数): 任意 session-id 怎么解析成文件路径？**
A: **去掉 `<session-id>` 参数，不在首版功能范围内。** 经查证 pi 内置 `/session` 命令（`interactive-mode.js:4312` `handleSessionCommand`）也只用 `this.sessionManager`（当前会话）的 `getSessionStats()`（`agent-session.js:2313`，返回当前会话 sessionFile/sessionId），**不实现**任意 session-id→文件解析。`ReadonlySessionManager`（`session-manager.d.ts:136`）也无按 id 查找文件的 API。因此 `/diary` 首版只用 `ctx.sessionManager.getBranch()` 读当前会话 transcript。FRD Requirement 2 的有参场景取消。

**Q (FRD Open Question 1: LLM 模型选择): 用当前会话模型还是固定预设？**
A: **可配，默认当前会话模型。** 沿用 `auto-naming-session` 先例 `model: string | null`（null=当前 `ctx.model`，可配 `"provider/modelId"` 覆盖，经 `parseModelRef`+`modelRegistry.find` 解析）。零配置可用，高级用户能 pin 便宜模型。质量与成本可权衡。

**Q (FRD Open Question 2: prompt session 消息量控制): 截断还是全量？**
A: **不截断，直接全量。** `completeSimple` 不自动截断（`stream.js:23-26` 直接发全量 `Context`），依赖 `model.contextWindow`（`pi-ai types.d.ts:487`）足够大。用户选最简方案，超长会话若触发 `stopReason:"length"` 或 API 报错则后续再处理。

**Q (FRD Goals vs 旧 helper 扫描范围): 只读今日日记还是加扫待办/近期日记？**
A: **沿用旧中文日期路径 + 加扫待办+近期日记。** 日记路径用旧 `compute_paths`（`obsidian-helper.py:72-81`）：`{base}/{diary_dir}/{year}/{month:02d}/{year}年{m}月{d}日{星期}.md`。扫描复刻旧 helper：待办 `_scan_todos`（`:84-108`，近14天未完成 `- [ ]`，正则 `^\s*-\s*\[([ ^>!/?~br])\]\s+(.+)$`）+ 近期日记 `_scan_recent`（`:111-130`，近10天前3篇各前30行）+ 今日日记全文。全为纯读操作，拼进 LLM prompt。这超 FRD Goals 最小集（FRD 只要求读今日日记），但用户明确要保留旧 helper 的扫描能力。

## Related Research

- `.rpiv/artifacts/research/2026-06-01_21-46-35_pi-extension-api-patterns.md` — Pi 扩展 API 模式调研（加载生命周期、completeSimple、getBranch、配置路径）

## Open Questions

- **主 Agent 收到结构化消息后执行写入的可靠性如何保证？** （FRD Open Question 3）依赖 `instructions` 字段的 prompt compliance——主 Agent 是否总是按指令展示草稿给用户确认后再写，而非直接写或忽略。需要在实际使用中验证，可能需在 prompt 中强化指令措辞（如明确"禁止直接写入，必须先展示草稿并等待用户确认"）。

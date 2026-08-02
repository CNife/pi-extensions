---
name: add-provider-models-to-pi
disable-model-invocation: true
description: 往 pi 的 models.json 新增/适配 provider 模型。
---

# Add Provider Models to Pi

把"往 pi 的 `models.json` 加模型"这件带判断的操作固化成可复用的执行规程。

**对应 provider（leading word）**：模型实际被托管/调用的 provider，以其 `baseUrl`/`api` 为准——不是模型的厂商。例：火山方舟（`ark.cn-beijing.volces.com`）托管了 MiniMax/Kimi，但 models.dev 里只有 `minimax.io`/`kimi.com` 厂商端点。参数必须取自**对应 provider**，否则 API 格式/窗口会错。

## 执行协议

### 1. 确认 Input

- 目标 pi provider：`/home/cnife/.pi/agent/models.json` 中已存在的 provider key，或用户要新建并命名。
- 模型清单：一个或多个模型，按 id/名称（如 `minimax-m3`、`kimi-k2.7-code`）。
- **完成标准**：目标 provider 与模型清单已明确；provider 已存在或新建名已定。

### 2. 源定位 —— 按对应 provider（托管端点）匹配

1. 读目标 pi provider 的 `baseUrl` + `api`。
2. 按 models-dev-query 的方法查 models.dev，找 `api`/`baseUrl` 与之相同的 provider：命中则取参；未命中（如方舟）则回退抓该**对应 provider**的官方 API 文档（web）。
3. 注意：models.dev 的厂商端点（minimax.io）与托管端点（方舟）是不同 provider，模型名相同也不能混用参数。
4. 确认目标模型在该**对应 provider**（精确到 baseUrl/套餐端点）已上线——同厂商不同套餐是不同 provider，模型可用性不同。例：方舟 `ark-coding-plan`（`/api/coding/v3`）与 `ark-agent-plan`（`/api/plan/v3`）模型列表不同，kimi-k3 仅在 agent-plan 上线。

- **完成标准**：每个目标模型的参数源已确定（models.dev 命中 / 官方文档回退）且已确认在该对应 provider 端点上线，并记下依据。

### 3. 适配 —— 翻译成 pi 的 model 条目

按目标 provider 的 `api` 类型查 [`api-adapters.md`](api-adapters.md) 对应节，确认该 api 的 compat 字段集、思考参数机制、off 语义、maxTokens 字段名、缓存与 tool 格式（per-api 事实依据）。

- `id`：用用户给的 id；与源确认是端点实际接受的模型名（方舟支持全小写，也接受控制台原名）。
- `name`：显示名。
- `reasoning`：来自源。
- `thinkingLevelMap`：见第 4 步三层合成。
- `input`：pi schema 仅接受 `text`/`image`；源的 `video` 等丢弃。
- `contextWindow` / `maxTokens`：以**对应 provider**官方文档为准；与 models.dev 冲突时取官方文档（如方舟 M3 为 512k 而非目录 1M）。文档无明确值时，参考其他 provider 上同一模型的参数（取模型官方厂商端点的默认值，如 kimi-k3 取 moonshotai 而非第三方网关），并标注“待 capture 验证”。
- `cost`：源有按 token 计价填；订阅/套餐制（如 Coding Plan）省略（pi 默认 0）。
- **完成标准**：每个模型已生成符合 pi schema 的 JSON 块，input 已去 video，context/maxTokens 取自对应 provider 官方文档。

### 4. 思考三层合成（核心难点）

1. **Layer1 Provider 机制**：端点怎么收思考参数--按 `api` 类型查 [`api-adapters.md`](api-adapters.md) 对应节的「思考参数机制」「off 语义」（pi 如何把 `thinkingLevelMap`/`compat` 翻译成实际请求参数）；源码指针亦在该文件。
2. **Layer2 模型能力**：模型自身支持什么——来自源（`reasoning` 否？toggle？分级？常开？）。
3. **Layer3 pi 处理**：pi 把统一 level 翻译成端点参数，两步——先 clamp（见 [`api-adapters.md`](api-adapters.md)「pi 共享机制」：不支持的档位向上挪到最近支持档，故 `null` 档位不会被透传给端点），再按 api 发 `thinkingLevelMap[level]`（`null`=不支持/不展示，非 `null`=支持且 pi 发该端点值）。`off` 行为因 `api` 而异（见对应节「off 语义」），**`off`≠不发**：off 非 `null` 时 pi 发显式关闭信号，`null` 时不发、落 provider 默认（always-reasoning 模型落模型默认 on，可关闭模型落 provider 默认）。

- 合成：`off` 映射非 `null`（如 `"none"`）= 支持关闭（pi 可选 off 档，具体发送行为见 [`api-adapters.md`](api-adapters.md)）；`off->null` = 不支持关闭。其余档位按模型实际支持情况映射成端点接受的 effort/toggle 字符串，不支持者置 `null`。同 provider 已有模型仅作交叉校验。
- **完成标准**：每个推理模型已列出全部 7 个档位 `off/minimal/low/medium/high/xhigh/max` 的映射值；`null`=不支持，非 `null` 字符串=支持且为端点接受值；Layer1 已查 [`api-adapters.md`](api-adapters.md) 对应节（必须查，不可凭记忆），`off` 语义已确认（支持关闭->非 `null`，不支持关闭->`null`）。

### 5. Checkpoint

跑完取参+适配，产出 **brief** 再让用户确认一次，确认后才写入：

- 将要插入的模型块（diff/表格）。
- 关键判断：参数源（models.dev 命中 / 官方文档回退）、三层思考结论（机制/能力/最终 map）、context/maxTokens 取值（与 models.dev 不同会标明）、cost 省略或填了。
- 来源链接。
- **完成标准**：brief 已呈现并经用户确认；`models.json` 写入且 `jq empty` 校验通过。

---

**验证阶段（步骤 6–9）：测试-抓取-循环-固定**--写入配置后立即验证，用 `capture.ts` 扩展抓取 pi 实际发送的请求和响应，通过 ≤3 轮测试-改进循环收敛到正确配置，最终固定。

**前提**：步骤 5 已写入 `models.json` 且 `jq empty` 通过；`capture.ts` 位于技能 `scripts/capture.ts`。

### 6. 运行 agentic 测试

用 `pi --extension` 临时加载 `capture.ts`，执行一个 agentic 任务（多轮工具调用），
一次性覆盖四个调试维度：

```bash
PI_CAPTURE_LOG=/tmp/pi-verify-<provider>.jsonl \
  pi --extension <skill-dir>/scripts/capture.ts \
  --print --model <provider>/<model> \
  '用 bash 工具列出 /tmp 目录下的前 5 个文件名，然后告诉我一共多少个'
```

- `<skill-dir>` 替换为本技能实际路径（`fd add-provider-models-to-pi` 定位）。
- 注意用 `--print`（非交互模式），事件自动触发。
- 日志写入 `PI_CAPTURE_LOG` 指定路径（默认 `/tmp/pi-capture.jsonl`），格式为 JSONL（一行一个聚合 CALL 块）。
- **完成标准**：pi 正常完成请求、日志文件已生成非空。

### 7. 抓取调试

读取 JSONL 日志，用 jq 按 CALL 块分析四维度（每行一个聚合块：assistant 含 `request.payload`/`responses`/`message`，user/toolResult 为精简块 `callIndex=null`）：

| 维度 | jq 证据（JSONL 字段） |
|---|---|
| **基础链路** | `.responses[].status`=200；`.message.stopReason` 非 error |
| **思考参数** | `.request.payload` 含 `reasoning`/`thinking`/`reasoning_effort`；`.message.content.thinkingBlocks>0` |
| **tool 格式** | `.request.payload.tools` 非空；`.message.stopReason`=toolUse + `.message.content.toolCalls` 非空 |
| **缓存** | assistant 块第 2+ 个 `.message.usage.cacheRead>0` |

```bash
L=/tmp/pi-verify-<provider>.jsonl
# 基础链路
jq -c 'select(.role=="assistant") | {callIndex, status: .responses[0].status, stopReason: .message.stopReason, errorMessage: .message.errorMessage}' "$L"
# 思考参数（请求侧字段 + 响应侧 thinkingBlocks）
jq -c 'select(.role=="assistant") | {callIndex, reasoning: .request.payload.reasoning, thinking: .request.payload.thinking, reasoningEffort: .request.payload.reasoning_effort, thinkingBlocks: .message.content.thinkingBlocks}' "$L"
# tool 格式
jq -c 'select(.role=="assistant") | {callIndex, toolCount: (.request.payload.tools // [] | length), stopReason: .message.stopReason, toolCalls: .message.content.toolCalls}' "$L"
# 缓存
jq -c 'select(.role=="assistant") | {callIndex, cacheRead: .message.usage.cacheRead, cacheWrite: .message.usage.cacheWrite}' "$L"
```

**注意事项**：

- `before_provider_headers` 事件拿不到 Authorization--pi 在事件返回后才注入 auth。调试 API key 靠"跑通与否"判断。
- user / toolResult 块 `callIndex=null`（无 provider 请求），分析时用 `select(.role=="assistant")` 过滤。
- 日志不脱敏（含 payload 里的 system prompt 全文、messages），调试结束删除。
- **完成标准**：四维度均已检查，确认有无问题或明确问题所在。

### 8. 循环改进

如果步骤 7 发现配置问题，进入改进循环：

1. **回退**：配置问题需恢复时，用步骤 5 的备份或 `git diff models.json` 还原。
2. **调整**：根据步骤 7 的发现修正 `models.json` 配置：
   - `thinkingLevelMap` 档位映射错 → 调整第 4 步得出的映射。
   - `compat` 推断不对 → 显式设置 `compat` 字段覆盖自动推断。
   - 其他字段错 → 按第 3 步重新适配。
3. **重测**：重复步骤 6--用 `PI_CAPTURE_LOG` 覆盖旧日志，确认问题已解决。
4. **上限**：≤3 轮。超过 3 轮仍未通过，**暂停**并向用户报告：
   - 当前抓取发现（哪些维度通过、哪些失败）。
   - 已尝试的调整及其效果。
   - 待排查的配置问题。
   - 回滚：从备份或 git 恢复步骤 5 前的 `models.json`。

一轮定义：一次 `pi --extension capture.ts --print` 运行 + 日志分析。
同轮内多次运行（修复后重测）仍算同一轮。

- **完成标准**：配置问题已解决 或 超限暂停向用户报告。

### 9. 固定

配置验证通过后固定最终结果：

1. **清除扩展**：调试完成后，确认 `models.json` 未引用 `capture.ts`（无 `--extension` 依赖）。
2. **校验**：`jq empty /home/cnife/.pi/agent/models.json` 确保 JSON 有效。
3. **确认**：`pi --list-models 2>&1 | grep <provider>` 确认新模型可见。
4. **清理**：删除临时日志文件：`rm -f /tmp/pi-verify-<provider>.jsonl`。
5. **简报**：告知用户：已添加的模型列表、已通过的测试维度、capture.ts 保留位置（后续排查可复用）。

- **完成标准**：models.json 有效、模型在 pi 中可见、日志已清理、用户已被告知结果。

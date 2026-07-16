# @cnife/pi-nmem

替代 [nowledge-mem-pi](https://github.com/nowledge-labs/nowledge-mem-pi) 的 pi 扩展，用 pi 原生 custom tool 把 nmem 后端能力暴露给 LLM，根治「LLM → shell → nmem CLI」中介层的三大痛点：

1. `--json` 输出冗长，占上下文 token
2. agent 乱猜 nmem 参数（命令面大、参数多）
3. 保存记忆时内容含引号/换行，与 bash 转义搏斗

改为 LLM 直接调用结构化 tool，内部纯打 nmem 后端 REST，跳过 shell 与 nmem CLI。详见 [ADR-0001](../../docs/adr/0001-pi-native-tool-not-axi-cli.md)。

## 能力总览

| 职责 | 做法 | 来源 |
|---|---|---|
| ① custom tool（3 个） | 注册 3 个 tool，内部打 nmem REST | 全新 |
| ② ambient sync | 自动把 pi 会话同步为 nmem 线程 | fork nowledge-mem-pi extension |
| ③ 启动上下文注入 | `before_agent_start` 注入 Context Bundle（纯 REST `GET /context/bundle`） | fork，启动注入改打 REST，摆脱 nmem CLI |

运行时只需 nmem 后端 REST 可达，**不依赖 nmem CLI**。低频/高级操作（save_thread handoff、记忆/线程批量管理、系统管理、导入导出等）仍可用裸 `nmem` CLI 手动完成。

## tool surface（3 个，纯打 REST）

| tool | REST 端点 | 用途 |
|---|---|---|
| `nmem_search(query, kind?, limit?)` | `POST /memories/search` / `GET /threads/search` | 搜记忆（kind=memories，默认）或过往会话（kind=threads）。返回精简字段、明确空状态、预计算聚合（returned/total） |
| `nmem_read_thread(thread_id, offset?)` | `GET /threads/{id}` | 深读会话全文；~8000 字预算自动分段，返回 `offset=N` hint 引导继续；无 limit 参数（agent 不猜条数） |
| `nmem_save_memory(title, content, unit_type?, importance?, labels?, id?)` | `POST /memories` / `PATCH /memories/{id}` | upsert 记忆：content 作结构化参数零转义；无 id/空串新建（labels 生效），非空 id 更新（labels 忽略并告警） |

**不占 tool 槽**（交给 extension ambient）：read_context、status、sync。
**留裸 `nmem` CLI**：save_thread（handoff）、记忆/线程批量管理、系统管理。

## ambient 能力（fork 自 nowledge-mem-pi）

- **会话自动同步**：`agent_end` 防抖 750ms + `session_before_compact`/`switch`/`shutdown` 刚性 flush，两阶段 `POST /threads` → `POST /threads/{id}/append`（deduplicate + idempotency_key 幂等）。后端不可达时降级为 `ctx.ui.notify` 提示，不阻塞会话。
- **启动上下文注入**：`before_agent_start` 同步注入 Context Bundle（owner/agent/space/rules/working memory）。`GET /context/bundle` 失败时降级为 guidance-only（仅注入引导文本）。

## 配置

沿用 `~/.nowledge-mem/config.json`：

```json
{
  "apiUrl": "http://127.0.0.1:14242",
  "apiKey": "<optional>"
}
```

优先级：环境变量 `NMEM_API_URL` / `NMEM_API_KEY` > `config.json` > 默认 `http://127.0.0.1:14242`。`space` / `agentId` / `hostAgentId` 等旧配置项 v1 静默忽略（v1 不碰 space，未来支持）。

## 引导层（三层分工）

- **startupGuidance**：注入 systemPrompt，能力总览 + WM 已注入提示 + 降级状态。
- **promptGuidelines**：每个 tool 激活时扁平追加「何时调该 tool」的英文 bullets。
- **AGENTS.md**：用户侧全局 `~/.pi/agent/AGENTS.md` 管理跨 tool 检索路由（插件不 ship、不注入）。把旧路由里的 `search-memory 技能` 引用改为 `nmem_search` 等 tool 名即可无缝切换。

## 错误与降级

- **tool 层**：所有错误一律 throw → pi 设 `isError:true`，LLM 据结构化错误（错误码 + 消息 + 下一步建议）自纠正。错误码：`backend_unreachable` / `unauthorized` / `not_found` / `bad_request`（400 和 422）/ `server_error`。
- **inject 层**：后端不可达时 `ctx.ui.notify` + guidance-only 兜底面具用户，不阻塞启动。

## 替代关系

卸载 nowledge-mem-pi，安装 @cnife/pi-nmem。等价功能 + 三大痛点根治。运行时只需 nmem 后端 REST 可达，不依赖 nmem CLI。

## 参考

- 架构决策：[ADR-0001](../../docs/adr/0001-pi-native-tool-not-axi-cli.md)
- 调研：[docs/nmem-usage-patterns.md](./docs/nmem-usage-patterns.md)
- 术语：根 [CONTEXT.md](../../CONTEXT.md) 的 nmem 集成 section

LICENSE：MIT。本包 fork 了 nowledge-mem-pi 的 extension 逻辑（ambient sync + 启动注入），其版权声明见 [LICENSE](./LICENSE)。

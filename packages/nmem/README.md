# @cnife/pi-nmem

替代 [nowledge-mem-pi](https://github.com/nowledge-labs/nowledge-mem-pi) 的 pi 扩展，用 pi 原生 custom tool 把 nmem 后端能力暴露给 LLM，根治「LLM → shell → nmem CLI」中介层的三大痛点：

1. `--json` 输出冗长，占上下文 token
2. agent 乱猜 nmem 参数（命令面大、参数多）
3. 保存记忆时内容含引号/换行，与 bash 转义搏斗

改为 LLM 直接调用结构化 tool，内部纯打 nmem 后端 REST，跳过 shell 与 nmem CLI。详见 [ADR-0001](../../docs/adr/0001-pi-native-tool-not-axi-cli.md)。

## 能力总览

| 职责 | 做法 | 来源 |
|---|---|---|
| ① custom tool（4 个） | 注册 4 个 tool，内部打 nmem REST | 全新 |
| ② ambient sync | 自动把 pi 会话同步为 nmem 线程 | fork nowledge-mem-pi extension |
| ③ 启动上下文注入 | `before_agent_start` 注入 Context Bundle（纯 REST `GET /context/bundle`）；**默认关闭**，`/nmem-config injectContextBundle true` 手动开启 | fork，启动注入改打 REST，摆脱 nmem CLI |

运行时只需 nmem 后端 REST 可达，**不依赖 nmem CLI**。低频/高级操作（save_thread handoff、记忆/线程批量管理、系统管理、导入导出等）仍可用裸 `nmem` CLI 手动完成。

## 安装

```bash
pi install npm:@cnife/pi-nmem
```

## tool surface（4 个，纯打 REST）

| tool | REST 端点 | 用途 |
|---|---|---|
| `nmem_search(query, kind?, limit?)` | `POST /memories/search` / `GET /threads/search` | 搜记忆（kind=memories，默认）或过往会话（kind=threads）。返回精简字段、明确空状态、预计算聚合（returned/total） |
| `nmem_read_thread(thread_id, offset?)` | `GET /threads/{id}` | 深读会话全文；~8000 字预算自动分段，返回 `offset=N` hint 引导继续；无 limit 参数（agent 不猜条数） |
| `nmem_list_threads(limit?, offset?, source?)` | `GET /threads` | 按导入时间列举会话（最新优先）；扁平分页（returned/total/has_more）+ hint；与 search 互补（list 按时间无 query，search 按 query） |
| `nmem_save_memory(title, content, unit_type?, importance?, labels?, id?)` | `POST /memories` / `PATCH /memories/{id}` | upsert 记忆：content 作结构化参数零转义；无 id/空串新建（labels 生效），非空 id 更新（labels 忽略并告警） |

**不占 tool 槽**（交给 extension ambient）：read_context、status、sync。
**留裸 `nmem` CLI**：save_thread（handoff）、记忆/线程批量管理、系统管理。

## ambient 能力（fork 自 nowledge-mem-pi）

- **会话自动同步**：`agent_end` 防抖 750ms + `session_before_compact`/`switch`/`shutdown` 刚性 flush，两阶段 `POST /threads` → `POST /threads/{id}/append`（deduplicate + idempotency_key 幂等）。后端不可达时降级为 `ctx.ui.notify` 提示，不阻塞会话。
- **启动上下文注入**：`before_agent_start` 注入 Context Bundle（owner/agent/space/rules/working memory）。**v0.5.0 起默认关闭**，需 `/nmem-config injectContextBundle true` 手动开启（下次会话启动生效）。无论开关，引导文本（startupGuidance）恒注入；开启后 `GET /context/bundle` 失败时降级为「不可用」提示。

## 配置

两个配置文件，职责分离：

### 插件配置 `~/.pi/agent/cnife-nmem.json`

控制插件自身行为，首次加载自动生成默认值（`<agent-dir>` 由 `PI_CODING_AGENT_DIR` 决定，默认 `~/.pi/agent`）：

```json
{
  "injectContextBundle": false
}
```

| 键 | 类型 | 默认 | 含义 |
|---|---|---|---|
| `injectContextBundle` | boolean | `false` | 启动时是否注入 Context Bundle 正文（大，吃 token）。关闭时引导文本仍注入 |

用 `/nmem-config` 命令查看与设置（也可手改文件）：

```text
/nmem-config                              # 显示当前配置（含只读的 apiUrl）
/nmem-config injectContextBundle true     # 开启 Context Bundle 注入
/nmem-config injectContextBundle false    # 关闭
```

改动**下次会话启动生效**。

### 后端连接 `~/.nowledge-mem/config.json`

连接哪个 nmem 后端（与 nowledge-mem-pi 共享），`/nmem-config` 只读显示、不在此改：

```json
{
  "apiUrl": "http://127.0.0.1:14242",
  "apiKey": "<optional>"
}
```

优先级：环境变量 `NMEM_API_URL` / `NMEM_API_KEY` > `config.json` > 默认 `http://127.0.0.1:14242`。`space` / `agentId` / `hostAgentId` 等旧配置项 v1 静默忽略（v1 不碰 space，未来支持）。

## 引导层（三层分工）

- **startupGuidance**：注入 systemPrompt，能力总览 + 检索/保存纪律 + 来源约定；Context Bundle 实际注入时额外提示「bundle 已在上方」。恒注入，不受 `injectContextBundle` 影响。
- **promptGuidelines**：每个 tool 激活时扁平追加「何时调该 tool」的英文 bullets。
- **AGENTS.md**：用户侧全局 `~/.pi/agent/AGENTS.md` 管理跨 tool 检索路由（插件不 ship、不注入）。把旧路由里的 `search-memory 技能` 引用改为 `nmem_search` 等 tool 名即可无缝切换。

## 错误与降级

- **tool 层**：所有错误一律 throw -> pi 设 `isError:true`，LLM 据结构化错误（错误码 + 消息 + 下一步建议）自纠正。错误码：`timeout` / `backend_unreachable` / `unauthorized` / `not_found` / `bad_request`（400 和 422）/ `server_error`。
- **重试**：REST 客户端默认对瞬时错误（`timeout` / `backend_unreachable` / `server_error`）自动重试 2 次（指数退避 + 抖动，固定 8s 超时），4xx 快速失败；调用方与 LLM 不感知。`nmem_save_memory` 新建记忆（POST /memories，非幂等）opt-out 不重试，超时提至 30s 吸收 embedding 冷启动。
- **inject 层**：后端不可达时 `ctx.ui.notify` + guidance-only 兜底面具用户，不阻塞启动。

## 替代关系

卸载 nowledge-mem-pi，安装 @cnife/pi-nmem。等价功能 + 三大痛点根治。运行时只需 nmem 后端 REST 可达，不依赖 nmem CLI。

## 参考

- 架构决策：[ADR-0001](../../docs/adr/0001-pi-native-tool-not-axi-cli.md)
- 调研：[docs/nmem-usage-patterns.md](./docs/nmem-usage-patterns.md)
- 术语：[CONTEXT.md](./CONTEXT.md)
- 许可：MIT；本包 fork 了 nowledge-mem-pi 的 extension 逻辑（ambient sync + 启动注入），版权声明见 [LICENSE](./LICENSE)

# R3 调研：nmem 后端 REST API 权威文档（OpenAPI + 运行时验证）

> wayfinder ticket #70 的 research findings。为 #71/#72 决策提供事实基础，校正 r1 §7。
> 调研日期：2026-07-16
> 权威来源：`http://127.0.0.1:14242/openapi.json`（OpenAPI 3.1.0, "Nowledge Mem API", info.version `0.9.15`, 276 paths）+ 运行时实测
> nmem CLI 版本：`0.10.28`（与 API `info.version 0.9.15` 是不同版本线，勿混用）

## ⚠ 关键发现：OpenAPI 与运行时三处不符

OpenAPI schema 是 FastAPI 风格（含 `HTTPValidationError` schema），但后端实际行为在三处偏离声明。**422 错误体是 `text/plain` 的 axum/serde Rust 格式**（`Failed to deserialize the JSON body into the target type: missing field`），非 FastAPI 的 JSON `{"detail":[...]}`——这表明后端是 **Rust/axum**，但 OpenAPI 模仿了 FastAPI 风格（含从 FastAPI 抄来的 `HTTPValidationError` schema）。

| 项 | OpenAPI 声称 | 运行时实测（2026-07-16） | 结论 |
|---|---|---|---|
| `offset` on `/memories/search` | `MemorySearchRequest` 无此字段 | 生效（`offset=0,limit=1` → memory `09b8991f`；`offset=3,limit=1` → memory `crystal_c3b89e83`，不同条目且相关性更低） | OpenAPI 请求体 schema 不完整，**offset 实际可用** |
| 缺 `query` on `/memories/search` | `query` required → 422 | `200` 返回 `[]`（空数组） | query 非强制，缺省返回空 |
| 422 错误体格式 | `{"detail":[{"loc":...,"msg":...,"type":...}]}`（FastAPI JSON） | `text/plain` `Failed to deserialize the JSON body into the target type: missing field \`content\` at line 1 column N`（axum/serde Rust 格式） | **后端是 Rust/axum 生成 FastAPI 风格 OpenAPI**；r1 §7.7 观察正确 |

**实现指导**（给 #66 错误处理 + REST 客户端模块）：

- body 解析需兼容 JSON 与纯文本：先 `JSON.parse`，失败用原始文本作 detail（r1 §7.7 已建议，本调研确认必要）。
- `offset` 可用但**不保证文档化**——依赖它有版本漂移风险，tool 层若需分页应显式评估（#64 read_thread 用 offset 已确认；memories search 的 offset 是否暴露给 LLM 是 #71 相关决策）。
- 空 search 返回 `200 []` 非错误，tool 层空状态判断走 `array.length === 0`（#64 已定）。

## 对 #71/#72 的直接回答

### #71 — `nmem_search` memories `total` 语义

**结论**：`POST /memories/search` REST 响应是**裸数组**，无顶层 `total` / `total_found` / `count` 字段，也无请求参数可让后端返回真实匹配总数。`total` 只能是 `array.length`（返回条数，受 `limit` 影响）。**r1 §7.1 正确。**

对比：`GET /threads/search` 有顶层 `total_found`（真实匹配总数），与 memories 的 `total = array.length` 语义不一致——这是 #71 冲突的本质，需在 grilling 中决策（标注/移除/promptGuidelines 说明）。

### #72 — `nmem_save_memory` labels 参数 upsert 不一致

**结论**：存在独立的 label 关联 REST 端点，**选项 (d) 可行**：

| 端点 | 方法 | 说明 |
|---|---|---|
| `/memories/{memory_id}/labels` | GET | 列出 memory 已关联 labels（响应 `{labels: [...]}`） |
| `/memories/{memory_id}/labels/{label_id}` | POST | 关联 label（路径参数 `memory_id` + `label_id`，响应 `{message: string}`） |
| `/memories/{memory_id}/labels/{label_id}` | DELETE | 解除关联 |
| `/labels` | GET | 列出全部 labels（含 `id`/`name`/`color`/`description`/`created_at`，支持 `limit`/`offset`/`order_by`/`order_desc`） |
| `/labels` | POST | 创建 label（query params: `name` 必填 / `color` / `description`，响应 label 对象含 `id`） |

**注意**：关联端点需 `label_id`（**非 label name**）。按 name 关联需两步：先 `GET /labels`（查 name→id，不存在则 `POST /labels` 创建）→ 再 `POST /memories/{id}/labels/{label_id}`。

- `POST /memories`：请求体 `labels`（label **名**数组）生效，响应 `assigned_labels` 返回。
- `PATCH /memories/{memory_id}`：`labels` 在请求体中**静默忽略**（OpenAPI 请求体 `additionalProperties: true` 无字段约束，运行时接受任意 key 但不处理 labels）。**r1 §7.5 正确。**

→ #72 决策输入：option (d) 技术可行但需两步路径（name→id→关联）；需在 grilling 中权衡 (d) 的完整 upsert 一致性 vs (a/b/c) 的简单性（throw/标注/移除 labels 参数）。

> **#72 实测校正（2026-07-16，grilling 阶段）**：上文「`POST /memories`...labels 生效」（本节 bullet）表述模糊，实测澄清——
>
> - POST on **create**（id 缺失）：labels **set** 语义（设为这组）。
> - POST on **upsert**（id 已存在）：labels **add** 语义（追加，非 set）；响应 `assigned_labels` 只报「本次操作分配的」labels，非 memory 全部 labels，易误导。
> - 后端**无任何端点能一步 set 已有 memory 的 labels**（要 set 需 full diff：GET 现有 -> DELETE 多余 -> POST 新增）。
> - **nmem CLI `m update` 无 labels 参数**（仅 title/content/importance/unit-type/space），全局无 label 命令；唯一 labels 入口是 `m add -l`（新建时设）。即整个 nmem 生态（后端 PATCH + CLI `m update`）都不支持更新已有 memory 的 labels。
> - 实测 `DELETE /memories/{id}`、`DELETE /labels/{id}` 端点可用（本表/r3 主体未列）。
>
> **#72 最终决策**：labels = create-time 初始标注，update 不碰（对齐 nmem 能力边界），非空 labels on update -> `warnings` 不 throw。详见 [#72 resolution](https://github.com/CNife/pi-extensions/issues/72#issuecomment-4987912111)。

## 各端点权威 schema（OpenAPI + 运行时）

### POST /memories/search

**请求体**（`MemorySearchRequest`）：

| 字段 | 类型 | required | 说明 |
|---|---|---|---|
| `query` | string | OpenAPI 声明 required；运行时可选（缺省返回 `[]`） | 搜索查询 |
| `limit` | integer | 否 | 最大返回条数 |
| `offset` | integer | 否 | **OpenAPI 未声明但运行时生效**（分页） |
| `mode` | string \| null | 否 | `'deep'`（默认）或 `'fast'`（BM25+vector only） |
| `filter_labels` | array[string] \| null | 否 | 按 label 名过滤 |
| `unit_type` | string \| null | 否 | `fact`/`preference`/`decision`/`plan`/`procedure`/`learning`/`context`/`event` |
| `include_entities` | boolean | 否 | 包含 `related_entities` |
| `metadata_filters` | array[string] \| null | 否 | metadata `key=value` AND 过滤 |
| `space_id` | string \| null | 否 | 隔离空间（v1 不传） |
| `event_date_from` / `event_date_to` | string \| null | 否 | 事件日期过滤（`YYYY`/`YYYY-MM`/`YYYY-MM-DD`） |
| `temporal_context` | string \| null | 否 | `past`/`present`/`future`/`timeless` |
| `recorded_date_from` / `recorded_date_to` | string \| null | 否 | 记录日期过滤 |

**响应** [200]：**数组**，每元素：

| 字段 | 说明 |
|---|---|
| `memory` | 完整 memory node（见下表）。**不含 `labels`/`label_ids`**（需另行 `GET /memories/{id}/labels`） |
| `similarity_score` | 语义相似度分数 |
| `relevance_reason` | 相关性原因（如 `Text Match (65%) + Keyword Match (35%)`） |
| `related_entities` | 关联实体数组 |
| `evolves_context` | EVOLVES 版本链上下文 |
| `related_memory_links` | 显式 memory links |

`memory` node 字段（节选，完整含 ~40 字段）：`id` / `node_type` / `created_at` / `updated_at` / `metadata`（含 `score_breakdown`/`graph_traversal`/`search_context_snapshot`，实现丢弃）/ `content` / `title` / `importance` / `confidence` / `pagerank_score` / `embedding` / `source_range` / `source` / `space_id` / `semantic_field` / `access_count` / `appearances` / `clicks` / `decay_score_cached` / `temporal_context` / `event_start` / `event_end` / `unit_type` / `is_latest` / `version` / `is_crystal` / `crystal_title` / `extraction_method` / `review_status`。

**响应** [422]：`text/plain` `Failed to deserialize the JSON body into the target type: ...`（axum 格式，非 JSON）。

### GET /threads/search

**Query params**：`query`（req）、`mode`（`'suggestions'`/`'full'`，默认 `full`）、`limit`（默认 20）、`source`、`space_id`。

**响应** [200]：

| 字段 | 说明 |
|---|---|
| `threads` | 数组，每元素含 `id`（内部 UUID）/ `thread_id`（pi- 前缀）/ `title` / `summary` / `message_count` / `source` / `space_id` / `participants` / `last_activity` / `relevance_score` / `total_matches` / `matched_messages[]`（`message_id`/`message_index`/`role`/`snippet`/`match_score`） |
| `total_found` | 真实匹配总数（**memories search 无此字段**） |
| `search_metadata` | `query`/`mode`/`matched_messages_count`/`error`/`search_engine` |

**响应** [422]：同上 text/plain。

### GET /threads/{thread_id}

**Query params**：`thread_id`（path, req）、`limit`、`offset`（默认 0）、`space_id`。

- `{thread_id}` **同时接受内部 UUID 和 thread_id（pi- 前缀）**，两者都返回 200。**r1 §7.3 正确。**

**响应** [200]：

| 字段 | 说明 |
|---|---|
| `thread` | 嵌套 thread node（`id`/`thread_id`/`title`/`summary`/`message_count`/`source`/`space_id`/`project`/`workspace`/`tool_version`/`import_date`/...） |
| `messages` | 数组（`id`/`content`/`role`/`order_index`/`timestamp`/`token_count`/...） |
| `total_messages` | 顶层，消息总数（不受 limit 影响） |
| `total_tokens` | 总 token 数 |
| `related_memories` / `entities` / `covered_message_ids` | 关联数据 |

- offset 超出范围：`messages: []` + `total_messages` 不变（`200`）——空状态。

**响应** [404]：`{"detail":"Thread not found"}`（JSON，运行时实测确认）。

### POST /memories（创建 / upsert）

**请求体**（`MemoryCreateRequest`，节选）：

| 字段 | 类型 | required | 说明 |
|---|---|---|---|
| `content` | string | **是** | 记忆正文（**缺省 422**，运行时实测） |
| `title` | string \| null | 否 | 标题 |
| `id` | string \| null | 否 | **upsert 用**：提供且已存在则更新，响应 `action="updated"` |
| `labels` | array[string] \| null | 否 | label **名**数组（**POST 生效**，`assigned_labels` 返回） |
| `importance` | number | 否 | 0.0–1.0 |
| `confidence` | number | 否 | 置信度 |
| `unit_type` | string | 否 | `fact`/`preference`/`decision`/`plan`/`procedure`/`learning`/`context`/`event` |
| `source` | string \| null | 否 | 来源应用 |
| `source_thread_id` / `source_message_id` / `source_message_range` | 可选 | 否 | 源消息定位 |
| `space_id` | string \| null | 否 | 隔离空间（v1 不传） |
| `metadata` | object | 否 | 附加元数据 |
| `event_start` / `event_end` | string \| null | 否 | 事件日期（`YYYY`/`YYYY-MM`/`YYYY-MM-DD`） |

**响应** [200]：

| 字段 | 说明 |
|---|---|
| `memory` | 完整 memory node |
| `action` | `'created'` 或 `'updated'`（upsert 命中） |
| `extracted_entities` | 抽取实体数组 |
| `assigned_labels` | 分配的 labels（**POST 生效**） |
| `created_relationships` | 新建关系数 |
| `warnings` | 非致命后续问题 |

**响应** [422]：`text/plain` `Failed to deserialize the JSON body into the target type: missing field \`content\`...`（**实测确认**，HTTP 422, CT `text/plain; charset=utf-8`）。

### PATCH /memories/{memory_id}（更新）

**请求体**：OpenAPI 声明 `{"type":"object","additionalProperties":true,"title":"Request"}`——**generic body 无字段约束**。运行时接受 `title`/`content`/`importance`/`unit_type`/`space` 等，**`labels` 静默忽略**（接受不报错，不更新）。**r1 §7.5 正确。**

**响应** [200]：完整 memory 对象（`id`/`title`/`content`/`source`/`time`/`importance`/`rating`/`label_ids`/`is_favorite`/`source_thread`/`confidence`/`space_id`/`unit_type`/`metadata`）。**无 `action`/`updated_fields`/`success`**（CLI 计算）。

**响应** [404]：`{"detail":"Memory not found: <id>"}`（JSON）。

### GET /memories/{memory_id}

**Query params**：`memory_id`（path, req）、`space_id`。

**响应** [200]：完整 memory 对象（同 PATCH 响应），**含 `label_ids`**（label **ID** 数组，非名）。

### GET /context/bundle

**Query params**：`agent_id`、`source_app`、`host_agent_id`、`space_id`、`include_working_memory`（boolean，默认 true）。

**响应** [200]：OpenAPI 声明 generic `{}`（无 schema）。运行时（r1 §7.6）实测含顶层 `rendered_markdown`（直接可用，与 CLI `nmem --json context` 一致）、`working_memory.content`（WM 全文）、`owner_profile`/`agent_profile`/`active_space`/`rule_stack`/`kfs_roots`/`authorship`/`warnings`/`schema_version`/`generated_at`/`bundle_kind`/`compiled_hash`。

### POST /threads（创建线程，sync 用）

**请求体**：`thread_id`（req, string）、`title`、`messages`（req, array）、`participants`、`source`、`space_id`、`project`、`workspace`、`tool_version`、`import_date`、`metadata`。

**响应** [200]：`{thread, messages, created_relationships, auto_generated_summary, extracted_memories, auto_extraction_performed}`。

### POST /threads/{thread_id}/append（追加消息，sync 用）

**请求体**：OpenAPI generic body。运行时接受 messages 数组 + `deduplicate` / `idempotency_key`（nowledge-mem-pi 已验证，fork 复用，见 r2）。

**响应** [200]：`{success, thread_id, messages_added, total_messages}`。

## r1 §7 校正汇总

| r1 §7 节 | r1 原结论 | OpenAPI | 运行时 | 最终校正 |
|---|---|---|---|---|
| §7.1 search 无 total | 正确 | 确认（数组响应，无 total 字段） | 确认 | ✅ 维持 |
| §7.1 search 缺 query 返回 `[]` | 正确 | **不符**（声明 query required→422） | **确认 200 `[]`** | ✅ 维持；注 OpenAPI 不符 |
| §7.1 labels 不存在 | 正确 | 确认（memory node 无 label_ids） | 确认 | ✅ 维持 |
| §7.2 threads `total_found` | 正确 | 确认 | 确认 | ✅ 维持 |
| §7.3 thread_id 双接受 | 正确 | 确认 | 确认 | ✅ 维持 |
| §7.3 messages `order_index` | 正确 | 确认 | 确认 | ✅ 维持 |
| §7.3 offset 超出 → 空 messages | 正确 | 确认（offset 默认 0） | 确认 | ✅ 维持 |
| §7.4 POST missing content 422 | 正确 | 声明 JSON `detail` | **实测 text/plain** | ⚠️ 格式修正：text/plain 非 JSON |
| §7.5 PATCH 无 action/updated_fields | 正确 | 确认（generic body） | 确认 | ✅ 维持 |
| §7.5 PATCH labels 静默忽略 | 正确 | 确认（additionalProperties:true 无约束） | 确认 | ✅ 维持 |
| §7.6 bundle `rendered_markdown` | 正确 | generic `{}`（未声明） | 确认 | ✅ 维持 |
| §7.7 422 纯文本 | 正确 | **不符**（声明 JSON HTTPValidationError） | **确认 text/plain** | ✅ 维持；注 OpenAPI 不符；后端 axum 非 FastAPI |
| §7.8 offset on search | 正确 | **不符**（`MemorySearchRequest` 无 offset） | **确认生效** | ✅ 维持；注 OpenAPI 请求体不完整 |
| §7.8 threads/search 无 offset | 正确 | 确认（仅 limit） | 确认 | ✅ 维持 |
| §7.9 sync 端点 | 正确（nowledge-mem-pi 验证） | 确认（POST /threads + /append 存在） | 确认 | ✅ 维持 |

**净结论**：r1 §7 的 curl 探测结论**全部维持**，仅 §7.4 的错误体格式描述需从「FastAPI/Pydantic 标准」修正为「axum/serde Rust 纯文本」。OpenAPI 在 offset / 缺 query / 422 格式三处与运行时不符，实现应以**运行时实测为准**，OpenAPI 仅作字段清单参考。

## 新增 r1 §7 未覆盖的端点 / 字段

| 端点 / 字段 | 说明 |
|---|---|
| `POST /memories/{memory_id}/labels/{label_id}` | 关联 label 到已有 memory（#72 option d） |
| `DELETE /memories/{memory_id}/labels/{label_id}` | 解除关联 |
| `GET /memories/{memory_id}/labels` | 列出 memory 的 labels |
| `GET` / `POST /labels` | 列出 / 创建 labels（name→id 解析，关联端点前置） |
| `POST /memories` 的 `id` 字段 | upsert 语义（命中已有 id 则 `action="updated"`） |
| search 请求体新参数 | `mode` / `filter_labels` / `unit_type` / `include_entities` / `metadata_filters` / `event_date_*` / `temporal_context` / `recorded_date_*` |
| search 响应 memory node | `pagerank_score` / `semantic_field` / `decay_score_cached` / `is_crystal` / `extraction_method` / `review_status` 等（实现按 #64 选 8 字段，丢弃 debug） |

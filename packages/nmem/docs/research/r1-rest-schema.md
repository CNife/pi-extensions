# R1 调研：nmem 后端 REST 端点 Response Schema + config 格式

> wayfinder ticket #61 的 research findings。为 ticket A（tool 返回精简 schema）提供事实输入。
> 调研日期：2026-07-15

> **⚠ 修正（2026-07-15 实测）**：§1-5 实际记录的是 CLI `nmem --json` 转换后的输出，**非原始 REST 响应**。CLI 在 Rust 层做了字段提取/重命名/聚合（如计算 `total`/`search_mode`、把 `similarity_score` 映射为 `score`、解析 `labels`）。pi-nmem「纯打 REST」实现的真实数据源见下方 **§7 真实 REST 响应形状**，REST 客户端模块需在 TS 层复刻等价转换。

## 1. POST /memories/search

**来源**: CLI `nmem --json m search '<query>' --limit 1`

### 顶层字段

| 字段 | 类型 | 可省略 | 说明 |
|------|------|--------|------|
| `query` | `string` | 否 | 搜索查询字符串 |
| `total` | `number` (int) | 否 | 匹配总数 |
| `search_mode` | `string` | 否 | 搜索模式，如 `"fast_bm25_vector"`（normal）或 `"3_strategy_hybrid"`（deep） |
| `memories` | `array` | 否 | 记忆对象数组 |

### `memories[]` 元素字段

| 字段 | 类型 | 可省略 | 说明 |
|------|------|--------|------|
| `id` | `string` (UUID) | 否 | 如 `"70da4c22-0000-4000-8000-000000000000"` |
| `title` | `string` | 否 | 记忆标题 |
| `content` | `string` | 否 | 记忆正文 |
| `score` | `number` (float) | 否 | 搜索相关性分数，如 `0.8475` |
| `importance` | `number` (float) | 否 | 重要性 0.0–1.0 |
| `unit_type` | `string` (enum) | 否 | `fact`/`preference`/`decision`/`plan`/`procedure`/`learning`/`context`/`event` |
| `labels` | `string[]` | 是 | 标签列表；始终返回，可为空数组 |
| `source` | `string` | 否 | 来源标识，如 `"cli"`、`"agent"` |
| `created_at` | `string` (ISO 8601) | 否 | 如 `"2026-07-08T09:40:47+00:00"` |
| `space_id` | `string` | 否 | 空间 ID，如 `"default"` |

**关键**: 搜索返回的记忆对象含 `score`（搜索分数），是与 list/show 的关键区别。

## 2. GET /threads/search

**来源**: CLI `nmem --json t search '<query>' --limit 1`

### 顶层字段

| 字段 | 类型 | 可省略 | 说明 |
|------|------|--------|------|
| `query` | `string` | 否 | 搜索查询 |
| `total` | `number` (int) | 否 | 匹配总数 |
| `threads` | `array` | 否 | 线程对象数组 |

### `threads[]` 元素字段

| 字段 | 类型 | 可省略 | 说明 |
|------|------|--------|------|
| `id` | `string` | 否 | 如 `"pi-019eaa4d-d53f-7072-a70d-6626988f56d3"` |
| `title` | `string` | 否 | 线程标题 |
| `message_count` | `number` (int) | 否 | 消息总数 |
| `matches` | `number` (int) | 否 | 匹配数（至少为 1） |
| `source` | `string` | 否 | 来源，如 `"pi"` |
| `space_id` | `string` | 否 | 空间 ID |

**与 `t list` 区别**: `t list` 返回字段名为 `messages`（非 `message_count`），含 `created_at`（人类可读如 `"Jul 15, 2026"`），**不**含 `matches`。

## 3. GET /threads/{id}

**来源**: CLI `nmem --json t show <id> --limit 1`

### 顶层字段

| 字段 | 类型 | 可省略 | 说明 |
|------|------|--------|------|
| `id` | `string` | 否 | 线程 ID |
| `title` | `string` | 否 | 线程标题 |
| `source` | `string` | 否 | 来源，如 `"pi"` |
| `created_at` | `string` (ISO 8601) | 否 | 如 `"2026-07-15T08:13:50.824403Z"` |
| `space_id` | `string` | 否 | 空间 ID |
| `total_messages` | `number` (int) | 否 | 消息总数 |
| `message_count` | `number` (int) | 否 | 实际返回消息数（受 `--limit` 影响） |
| `messages` | `array` | 否 | 消息对象数组 |

### `messages[]` 元素字段

| 字段 | 类型 | 可省略 | 说明 |
|------|------|--------|------|
| `index` | `number` (int) | 否 | 消息序号（0-based） |
| `role` | `string` | 否 | `"user"` 或 `"assistant"` |
| `content` | `string` | 否 | 消息全文 |

**注意**: 消息对象只观察 `index`/`role`/`content` 三字段，不返回 `id`/`timestamp`。`content` 可含 HTML，底层存纯文本。

## 4. POST /memories

**来源**: CLI `nmem m add '<content>' -t '<title>' --unit-type <type> -i <importance> -j`

### 返回字段

| 字段 | 类型 | 可省略 | 说明 |
|------|------|--------|------|
| `success` | `boolean` | 否 | 固定 `true` |
| `id` | `string` (UUID) | 否 | 新建记忆 ID |
| `action` | `string` | 否 | 固定 `"created"` |
| `title` | `string` | 是 | 提交时提供才返回 |
| `unit_type` | `string` (enum) | 是 | 提交时提供才返回 |

**注意**: 创建成功不返回完整记忆对象，仅摘要确认。需完整对象要再调 `GET /memories/{id}`。

## 5. PATCH /memories/{id}

**来源**: CLI `nmem --json m update <id> -t '<title>'`

### 返回字段

| 字段 | 类型 | 可省略 | 说明 |
|------|------|--------|------|
| `success` | `boolean` | 否 | 固定 `true` |
| `action` | `string` | 否 | 固定 `"updated"` |
| `id` | `string` (UUID) | 否 | 更新记忆 ID |
| `updated_fields` | `string[]` | 否 | 哪些字段被更新，如 `["title"]` |
| `unit_type` | `string` (enum) | 是 | 记忆原始 `unit_type` |

**可更新字段**（CLI `--help`）：`title`、`content`、`importance`、`unit_type`、`space`/`space_id`。

## 6. 配置文件格式

### 文件位置

- 路径：`~/.nowledge-mem/config.json`
- 来源：CLI `nmem config show` + 源码 `client.py::CONFIG_PATH`

### JSON 结构（脱敏）

```json
{
  "apiUrl": "http://127.0.0.1:14242",
  "apiKey": "sk-..."
}
```

| 键 | 类型 | 可省略 | 说明 |
|------|------|--------|------|
| `apiUrl` / `api_url` | `string` | 是 | API 基础 URL，默认 `http://127.0.0.1:14242` |
| `apiKey` / `api_key` | `string` | 是 | API 密钥；不设时不认证 |

**注意**: 本地无 `config.json` 文件时，CLI 用默认 URL。fallback 逻辑：先读 env，再读 config.json，最后默认。

### 环境变量

| 变量 | 说明 |
|------|------|
| `NMEM_API_URL` | 覆盖 API 基础 URL；优先级高于 config.json |
| `NMEM_API_KEY` | 覆盖 API 密钥；优先级高于 config.json |
| `NMEM_SPACE` | 默认空间名称（用于 `m add`/`m search` 的 `--space`） |
| `NMEM_SPACE_ID` | 默认空间 ID（`client.py` 中 Hermes 客户端同设为 `NMEM_SPACE` 别名） |

## 7. 真实 REST 响应形状（curl 验证 2026-07-15）

> curl 直连后端 `http://127.0.0.1:14242`（nmem v0.10.27）验证。本节是 pi-nmem「纯打 REST」实现的实际数据源，§1-5 的 CLI 输出形状是 LLM-facing 的目标 schema（token 高效），REST 客户端模块负责两者间的字段映射。

### 7.0 字段映射总表（REST -> spec schema）

| spec schema 字段 | 真实 REST 位置 | 说明 |
|---|---|---|
| memories `total` | `array.length` | 返回条数，非总匹配数（REST 无 total 字段） |
| memories `score` | 元素级 `similarity_score` | 直接取 |
| memories `labels` | **不可用** | search 端点不返回；统一返回 `[]` |
| memories 其余字段 | `memory.{id,title,content,importance,unit_type,created_at}` | memory 子对象 |
| threads `total` | 顶层 `total_found` | CLI 的 `total` 由此映射 |
| threads `matches` | 元素级 `total_matches` | CLI 的 `matches` 由此映射 |
| threads `id` | 元素 `thread_id`（pi- 前缀） | read_thread 可用；GET /threads/{id} 同时接受内部 id 和 thread_id |
| thread `title`/`created_at` | 嵌套 `thread.title`/`thread.created_at` | 非顶层 |
| thread `total_messages` | 顶层 `total_messages` | 直接取 |
| messages `index` | `order_index` | 重命名 |
| save created `id` | `memory.id`（POST 响应） | 子对象 |
| save created `action` | `action`（POST 响应，值 `"created"`） | 直接取 |
| save updated `action` | **自设 `"updated"`** | PATCH 响应无此字段 |
| save updated `id` | `memory.id`（PATCH 响应）或请求 id | 子对象 |
| save updated `updated_fields` | **自推断**（请求参数 keys） | PATCH 响应无此字段 |
| context bundle 注入文本 | 顶层 `rendered_markdown` | 直接取，与 CLI 一致 |

### 7.1 POST /memories/search

**请求**：`POST /memories/search`，body `{"query": string, "limit"?: int, "offset"?: int}`

**响应**（HTTP 200）：**数组**（非对象），每个元素：

```json
{
  "memory": {
    "id", "node_type": "Memory", "created_at", "updated_at",
    "metadata": { "score_breakdown", "graph_traversal", "search_context_snapshot" },
    "content", "title", "importance", "confidence", "pagerank_score", "embedding",
    "source_range", "source", "space_id", "semantic_field", "unit_type",
    "is_latest", "version", ...
  },
  "similarity_score": 0.8435,
  "relevance_reason": "Text Match (65%) + Keyword Match (35%)",
  "related_entities": [],
  "evolves_context": null,
  "related_memory_links": []
}
```

- **空结果**：`[]`（HTTP 200）
- **缺 query**：返回 `[]`（HTTP 200，非错误）
- **无顶层 `total`/`search_mode`/`query`**（CLI 计算；`total` = `array.length`）
- **`labels` 不存在**（search 端点不返回；GET /memories/{id} 返回 `label_ids` 非解析名，CLI 另行解析）
- `metadata` 含大量 debug 信息（score_breakdown/graph_traversal/search_context_snapshot），实现丢弃
- 支持 `offset` 分页（offset=0 与 offset=2 返回不同条目）

### 7.2 GET /threads/search

**请求**：`GET /threads/search?query=string&limit=int`

**响应**（HTTP 200）：

```json
{
  "threads": [{
    "id": "内部UUID",
    "thread_id": "pi-<session>",
    "title", "summary",
    "message_count": 359,
    "source": "pi", "space_id": "default", "participants": [],
    "last_activity": "ISO",
    "relevance_score": 8.01,
    "total_matches": 1,
    "matched_messages": [{ "message_id", "message_index", "role", "snippet", "match_score" }]
  }],
  "total_found": 67,
  "search_metadata": { "query", "mode", "matched_messages_count", "error", "search_engine" }
}
```

- 顶层 `total`（CLI）= `total_found`（REST）
- 元素 `matches`（CLI）= `total_matches`（REST）
- 元素有 `id`（内部 UUID）和 `thread_id`（pi- 前缀）两个标识；**返回 `thread_id` 给 LLM**（read_thread 可直接用）

### 7.3 GET /threads/{id}

**请求**：`GET /threads/{id}?limit=int&offset=int`

- `{id}` **同时接受内部 UUID 和 thread_id（pi- 前缀）**，两者都返回 200
- `limit`/`offset` 可选；不传则返回全部消息

**响应**（HTTP 200）：

```json
{
  "thread": {
    "id", "node_type": "Thread", "created_at", "updated_at", "metadata",
    "thread_id", "title", "summary", "message_count", "participants",
    "source", "space_id", "project", "workspace", "tool_version", "import_date"
  },
  "messages": [{
    "id", "node_type": "Message", "created_at", "updated_at",
    "metadata": { "external_id", "pi_entry_id", "pi_entry_type", "pi_message_role", "source_app" },
    "content", "role", "order_index": 0, "timestamp", "token_count"
  }],
  "related_memories": [], "entities": [],
  "total_messages": 359, "total_tokens": 0, "covered_message_ids": []
}
```

- `title`/`created_at`/`source`/`space_id` 在**嵌套 `thread` 对象**（非顶层）
- messages 用 `order_index`（非 `index`）
- `total_messages` 在顶层（消息总数，不受 limit 影响）
- **offset 超出范围**：返回 `messages: []` + `total_messages` 不变（HTTP 200）--空状态
- **404**：`{"detail":"Thread not found"}` HTTP 404

### 7.4 POST /memories

**请求**：`POST /memories`，body `{title?, content, unit_type?, importance?, source?, ...}`

**响应**（HTTP 200）：

```json
{
  "memory": { "id", "title", "content", "importance", "unit_type", "source", "space_id", "created_at", ... },
  "action": "created",
  "extracted_entities": [], "assigned_labels": [],
  "created_relationships": [], "warnings": []
}
```

- `action` 值 `"created"`，`id` = `memory.id`
- **缺 content**：HTTP **422**，**纯文本** body（非 JSON，FastAPI/Pydantic 标准校验错误）：

  ```text
  Failed to deserialize the JSON body into the target type: missing field `content` at line 1 column 22
  ```

### 7.5 PATCH /memories/{id}

**请求**：`PATCH /memories/{id}`，body `{title?, content?, importance?, unit_type?, space?}`

**响应**（HTTP 200）：**完整 memory 对象**（非操作摘要）

```json
{
  "id", "title", "content", "source", "time", "created_at", "importance",
  "rating", "confidence", "space_id", "unit_type", "metadata",
  "label_ids": [], "is_favorite", "source_thread", "is_crystal", "review_status"
}
```

- **无 `action`/`updated_fields`/`success`**（这些是 CLI 计算的）
  - `action`：实现自设 `"updated"`
  - `updated_fields`：实现从请求参数 keys 自推断（如提交 `{title, content}` 则 `updated_fields: ["title","content"]`）
- **404**：`{"detail":"Memory not found: <id>"}` HTTP 404

### 7.6 GET /context/bundle

**请求**：`GET /context/bundle`（可选 `?source_app=pi`；v1 不传 space）

**响应**（HTTP 200）：

```json
{
  "schema_version", "generated_at", "bundle_kind",
  "owner_profile", "agent_profile", "active_space", "rule_stack", "working_memory",
  "kfs_roots", "authorship", "warnings",
  "rendered_markdown": "# Nowledge Mem Context Bundle\n...",
  "compiled_hash"
}
```

- `rendered_markdown` 在 REST 顶层直接可用（与 CLI `nmem --json context` 一致），注入用此字段，无需自行渲染
- `working_memory.content` 也含 WM 全文（bundle 已含，无需单独 fallback）

### 7.7 错误响应形状

| 场景 | HTTP status | body 格式 | 说明 |
|---|---|---|---|
| 后端不可达（fetch throw） | 0 | - | 连接拒绝/超时/DNS/Invalid URL |
| 认证失败 | 401 | 待测 | 本地无 apiKey 未触发 |
| 资源不存在 | 404 | JSON `{"detail": "..."}` | thread/memory not found |
| 参数校验失败 | **422** | **纯文本** `Failed to deserialize...` | 非 400、非 JSON；FastAPI/Pydantic 标准 |
| 后端错误 | 5xx | 待测 | - |

> **spec 错误码映射修正**：spec 错误码表 `bad_request` 写的是 HTTP 400，但实际后端用 **422** 做参数校验。实现应将 `bad_request` 映射 **400 和 422**。body 解析需兼容 JSON 与纯文本：先尝试 `JSON.parse`，失败则用原始文本作 detail。

### 7.8 分页参数

| 端点 | limit | offset | 不传默认 |
|---|---|---|---|
| POST /memories/search | ✓ | ✓ | 返回全部匹配 |
| GET /threads/search | ✓ | - | - |
| GET /threads/{id} | ✓ | ✓ | 返回全部消息 |

### 7.9 sync 端点（fork nowledge-mem-pi 复用）

ambient sync 用到的端点，nowledge-mem-pi 已验证成熟，fork 时原样复用其 `postJson` 调用：

- `POST /threads`：创建线程（首次）
- `POST /threads/{thread_id}/append`：追加消息（带 `deduplicate: true` + `idempotency_key`），404 时回退重建

响应处理只看 `ok`/`status`，不解析 body 字段（与 nowledge-mem-pi 一致）。

## 附：端点差异要点

| 端点 | 关键差异 |
|------|----------|
| `m search` vs `m list` | `search` 带 `score`/`query`/`search_mode`；`list` 带 `returned`，不含 `labels`，可能省 `title` |
| `t search` vs `t list` | `search` 用 `message_count`+`matches`；`list` 用 `messages`+`created_at`（人类可读） |
| `t show` vs `t list` | `show` 含 `total_messages`、完整 `messages[]`、ISO `created_at` |
| `m update` vs `m show` | `update` 返回操作确认摘要非完整对象 |

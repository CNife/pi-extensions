# R1 调研：nmem 后端 REST 端点 Response Schema + config 格式

> wayfinder ticket #61 的 research findings。为 ticket A（tool 返回精简 schema）提供事实输入。
> 调研日期：2026-07-15

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

## 附：端点差异要点

| 端点 | 关键差异 |
|------|----------|
| `m search` vs `m list` | `search` 带 `score`/`query`/`search_mode`；`list` 带 `returned`，不含 `labels`，可能省 `title` |
| `t search` vs `t list` | `search` 用 `message_count`+`matches`；`list` 用 `messages`+`created_at`（人类可读） |
| `t show` vs `t list` | `show` 含 `total_messages`、完整 `messages[]`、ISO `created_at` |
| `m update` vs `m show` | `update` 返回操作确认摘要非完整对象 |

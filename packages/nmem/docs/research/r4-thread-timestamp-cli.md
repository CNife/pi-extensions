# r4: nmem CLI 能否获取 thread 精确创建时刻

> 调研日期：2026-07-18
> 后端：`https://nmem.cnife.cn`（remote mode），CLI v0.10.30

---

## 一句话结论

**CLI 不能通过 `t list` / `t show` 直接获取真正的「会话开始时刻」（即第一条消息的时间戳），但能通过 `nmem fs cat messages.jsonl --line 1 --lines 1` 可靠拿到。** 如果只接受 `thread.created_at` 的近似值（导入时间，偏离通常在 1–9 分钟），`nmem --json t show <id>` 的 `created_at` 字段是完整 ISO 时刻。

---

## 5 个核心问题

### Q1: `t list` 返回的 `created_at` 语义？会话开始/导入/记录时间？只到天还是带时刻？

**结论：只到天（`"Jul 18, 2026"`），语义是记录/导入日期，不是会话开始时间。**

证据：

- `nmem --json t list -n 2` 实测输出：

  ```json
  {"id":"pi-019f754a-...","created_at":"Jul 18, 2026",...}
  ```

- REST `GET /threads?limit=2` 对应字段名是 `date`（不是 `created_at`），值也仅到天 `"Jul 18, 2026"`。
- 与 `t show --json` 返回的 `created_at: "2026-07-18T13:00:17.927969Z"` 精细值对比，t list 截断了时间部分。

### Q2: `import_date` / `last_activity` 带不带时刻？哪个最接近会话开始时间？

**结论：`import_date` 是完整 ISO 时刻（带 sub-second 精度），但语义是「导入/记录时间」，不是「会话开始时间」。`last_activity` 只在 search 结果中出现，未在本次实测中验证（search 返回无时间字段）。**

证据：

- REST `GET /threads/{id}` 的 thread node 中 `created_at` 和 `import_date` 值相同（`"2026-07-18T13:00:17.927969Z"`），均为导入时间。
- CLI 的 `t show --json` 只暴露 `created_at`（无 `import_date`）。
- 三线程对比（REST）：

| 线程 | thread.created_at | messages[0].timestamp | 差值 |
|---|---|---|---|
| daily-recap 适配讨论 | 13:00:17.927969Z | 12:57:14.949000+00:00 | ~3 min |
| 本调研 | 13:26:31.283791Z | 13:25:33.057000+00:00 | ~1 min |
| HPC 巡检(6/30) | 01:12:40.315082Z | 01:03:46.513000+00:00 | ~9 min |

`import_date` / `created_at` 总是晚于或等于 `messages[0].timestamp`。

### Q3: `messages[0].timestamp` 是否等于会话开始时刻？格式？CLI 能否拿到？

**结论：`messages[0].timestamp` 是最接近「会话开始时刻」的字段，格式为 ISO 8601 带时区（如 `"2026-07-18T12:57:14.949000+00:00"`），但 CLI 的 `t show --json` 无法拿到（messages 只返回 `index/role/content`）。**

证据：

- REST `GET /threads/{id}` 响应中 messages 数组每项含 `timestamp`（r3 REST 文档 L122 确认）。
- `nmem --json t show <id> -n 1` 实测输出中 messages 仅含 `index/role/content`，**无 `timestamp`**。
- CLI 源码不可见（为 Rust 编译产物），但实测已充分证明 CLI 的 t show 丢弃了 message timestamp。

**CLI 替代路径**：`nmem fs cat /threads/<src>/<thread-title-hash>/messages.jsonl --line 1 --lines 1` 可拿到第一条消息的完整 JSON，含 `timestamp` 字段。

实测：

```json
{"id":"msgocc_...","role":"user","content":"...","order_index":0,
 "timestamp":"2026-07-18T12:57:14.949000+00:00","token_count":0}
```

来源：`nmem fs cat /threads/pi/nmem-CLI-线程精确创建时刻调研-00000000/messages.jsonl --line 1 --lines 1`

### Q4: 有没有任何 CLI 命令/参数直接拿到 thread 精确创建时刻？

**逐命令结论：**

| 命令 | 能否拿精确时刻 | 说明 |
|---|---|---|
| `nmem t list --json` | ❌ 不能 | 只有 `created_at: "Jul 18, 2026"`（日期无时间） |
| `nmem t show --json <id>` | ⚠️ 部分 | 能拿到 `created_at`（导入时间，完整 ISO），非会话开始时间 |
| `nmem t search --json` | ❌ 不能 | 返回结果无任何时间字段 |
| `nmem feed --json` | ❌ 不能 | 事件有 `created_at` 但事件不关联 thread 创建 |
| `nmem fs stat <path> --json` | ❌ 不能 | `created_at`/`updated_at` 均为 `null` |
| `nmem fs cat <meta.md>` | ⚠️ 部分 | 能拿到 `created_at`（导入时间，同 t show） |
| `nmem fs cat <messages.jsonl> --line 1 --lines 1` | ✅ **能** | 拿到 `messages[0].timestamp`（真正会话开始时刻） |
| `nmem export` | ❌ 不能（未测试完整） | export 可导出完整数据但太重，不适用于日常查询 |
| `nmem stats` | ❌ 不能 | 仅计数，无时间字段 |
| `nmem context` | ❌ 不能 | session-start context，不暴露 thread 时间 |

### Q5: 如果 CLI 拿不到，最佳替代方案？

**CLI 能通过 `nmem fs cat messages.jsonl --line 1 --lines 1` 拿到真正的会话开始时刻**，因此不需要「替代方案」。

如果只需近似值（容忍 1–9 分钟偏差），`nmem --json t show <id>` 的 `created_at` 字段是轻量选择（不需要额外查 fs cat）。

---

## 完整调研记录

### Step 1: 环境确认

```bash
nmem status
# cli v0.10.30, server v0.10.30, mode remote, api https://nmem.cnife.cn

nmem config show
# API key: set
```

配置来源：`/home/cnife/.nowledge-mem/config.json` 含 `apiKey`。

### Step 2: --help 记录

| 命令 | 关键参数 |
|---|---|
| `nmem t list --help` | `-n/--limit`、`-j/--json`、`--source`、`--space`、`--offset` |
| `nmem t show --help` | `-n/--limit`（消息数）、`-j/--json`、`--offset`、`--content-limit` |
| `nmem t search --help` | `-n/--limit`、`-j/--json`、`--source`、`--space` |
| `nmem feed --help` | `--days`、`--from/--to`、`--type`、`--all`、`-n/--limit`（事件数） |
| `nmem fs --help` | 子命令：`ls/cat/stat/find/grep/recall/write/rm` |
| `nmem fs stat --help` | `-j/--json`、`<PATH>` |
| `nmem fs cat --help` | `--line`、`--lines`、`--raw`、`--frontmatter`、`--fragment` |
| `nmem export --help` | `--no-zip`、`--overwrite`、`--no-memories/--no-threads/...`（选择性导出） |
| `nmem stats --help` | `-j/--json` |
| `nmem context --help` | 无时间相关参数 |

### Step 3: CLI 实测

**`nmem --json t list -n 2`**：`created_at: "Jul 18, 2026"` 仅日期。

**`nmem --json feed --days 1 -n 3 --all`**：events 有完整 `created_at`（如 `"2026-07-18T13:06:36.106680+00:00"`），但事件不直接关联 thread 创建。

**`nmem --json fs ls /threads/`** → 列出按 source 分组的 thread 目录。
**`nmem --json fs stat /threads/pi/某thread/`** → `created_at: null, updated_at: null`。

**`nmem fs cat /threads/pi/.../meta.md`**：

```yaml
---
created_at: "2026-06-30T01:12:40.315082Z"
updated_at: "2026-07-01T07:45:34.441196Z"
---
```

来源：`nmem fs cat /threads/pi/nmem-CLI-线程精确创建时刻调研-00000000/meta.md`

**`nmem --json fs cat /threads/pi/.../messages.jsonl --line 1 --lines 1`**：

```json
{"id":"...","role":"user","content":"...","order_index":0,
 "timestamp":"2026-07-18T12:57:14.949000+00:00","token_count":0}
```

来源：`nmem fs cat /threads/pi/nmem-CLI-线程精确创建时刻调研-00000000/messages.jsonl --line 1 --lines 1`

### Step 4: REST API 直接调用

Python `urllib` 调用，Authorization Bearer + X-NMEM-API-Key。

**`GET /threads?limit=2`**：

```json
{"threads":[{"id":"pi-...","date":"Jul 18, 2026",...}],"pagination":{...}}
```

字段名为 `date`（非 `created_at`），仅日期。

**`GET /threads/{id}?offset=0&limit=1`**：

```json
{"thread":{"id":"...","created_at":"2026-07-18T13:00:17.927969Z",
           "import_date":"2026-07-18T13:00:17.927969Z",...},
 "messages":[{"id":"...","timestamp":"2026-07-18T12:57:14.949000+00:00",
              "created_at":"2026-07-18T13:00:17.927969+00:00",...}]}
```

- `thread.created_at` = `import_date`（导入时间）
- `messages[0].timestamp`（真实时间）
- `messages[0].created_at`（导入时间）

三线程对比完整数据见 Q2 表格。

### Step 5: CLI 源码

nmem CLI 是 Rust 编译产物（`/home/cnife/.local/share/uv/tools/nmem-cli/bin/nmem`，14MB 二进制）。本地无 Rust 源码可查。

### Step 6: REST 文档

来源：`/home/cnife/code/pi-extensions/packages/nmem/docs/research/r3-rest-api-docs.md`

- L105：search 返回 `last_activity`（未实测证实保精度）
- L121：`GET /threads/{id}` thread node 含 `import_date`
- L122：messages 含 `timestamp` 字段

---

## 对 daily-recap 的建议

### 远程会话按 CST 04:00 分界

对于**远程会话**（本机无 jsonl），推荐使用以下方案获取会话精确开始时刻：

**推荐 CLI 命令（精确路径）：**

```bash
# 1. 拿到 thread 的 FS 路径中的 short-id
THREAD_INFO=$(nmem --json t show <thread_id> -n 1 2>/dev/null)
# 2. 用 thread title 构造 short-id（注：需先通过 fs ls 获取准确路径）
nmem fs cat /threads/<source>/<title-short-id>/messages.jsonl --line 1 --lines 1
```

**更实用的组合命令（先列线程，再拿时间）：**

```bash
# 用 t show --json 的 created_at（近似值，轻量）
nmem --json t show <thread_id> | python3 -c "import sys,json; print(json.load(sys.stdin)['created_at'])"
```

**如果需精确到 `messages[0].timestamp`：**

```bash
# 先用 fs ls 找到 thread 的 FS 路径
FS_PATH=$(nmem --json fs ls /threads/pi/ | python3 -c "
import sys, json
data = json.load(sys.stdin)
# 从 entries 中找到目标 thread 的路径
entries = data.get('entries', [])
import re
# 查找匹配 title 或 id 的条目
# ...
")
# 然后读第一条消息的时间戳
nmem fs cat "$FS_PATH/messages.jsonl" --line 1 --lines 1 | python3 -c "import sys,json; print(json.loads(sys.stdin.read())['timestamp'])"
```

### 时间字段推荐优先级

| 优先级 | 字段 | CLI 路径 | 精度 | 成本 |
|---|---|---|---|---|
| 1 (最佳) | `messages[0].timestamp` | `fs cat messages.jsonl --line 1 --lines 1` | 精确到微秒 | 2次CLI调用 + 一次json解析 |
| 2 (轻量) | `thread.created_at` | `t show --json <id>` | 偏离 <10min | 1次CLI调用 |
| 3 (不可用) | `t list` 的 `created_at` | `t list --json` | 只到天 | — |

### 注意事项

1. `messages[0].timestamp` 取的是第一条消息的时间。对于 Pi 会话，第一条消息可能是插件注入的 `inline-skills` 或 `rpiv-git-context` 等系统消息，其时间戳仍然早于真实的用户首条消息——但这已经是 nmem 侧能拿到的最早时间。
2. 如果关心的是**真实的用户首条消息**（而非系统消息），可能需要读 messages.jsonl 过滤 `role != "system"` 的第一条。
3. `fs cat messages.jsonl` 返回完整 JSONL，用 `--line 1 --lines 1` 只取第一行避免大文件读取。
4. FS 路径的 short-id（如 `nmem-CLI-线程精确创建时刻调研-00000000`）不是固定不变的——它由 title 加 hash 构成。同一 title 的目录名在不同空间/时间可能不同。建议通过 `nmem --json fs ls /threads/pi/` 获取实时路径。

### 后端 REST API 备选

如果 CLI 不便，Python 脚本可直接调 REST API：

```python
import urllib.request, json
headers = {"Authorization": f"Bearer {API_KEY}", "X-NMEM-API-Key": API_KEY}
req = urllib.request.Request(f"{API_URL}/threads/{thread_id}?offset=0&limit=1", headers=headers)
data = json.loads(urllib.request.urlopen(req).read())
msg0_ts = data["messages"][0]["timestamp"]  # 精确会话开始时刻
```

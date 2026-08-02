---
name: pi-session-query
description: Pi 会话 JSONL 查询原语库 + 运行器：树形解析会话，供查询脚本组合完成会话分析。
disable-model-invocation: true
---

# Pi Session Query - 会话查询原语库

把一个 Pi Agent 会话记录文件（JSONL）解析成 `Session` 对象，暴露五组查询原语，供查询脚本组合完成任意复杂会话分析。

> **路径约定**：本文档所有相对路径均相对本 SKILL.md 所在目录（下称「技能目录」= 本文件 location 的 dirname）。脚本入口为 `<技能目录>/scripts/query.py`，勿按当前工作目录（CWD）解析。

## 定位

与 [daily-recap](https://github.com/CNife/skills/tree/main/knowledge/daily-recap) 互补：

| | daily-recap | pi-session-query |
|---|---|---|
| 视角 | 线性提取摘要 | 完整树形解析 |
| 范围 | 批量、跨文件、跨机器 | 单文件、全 block 还原 |
| 产出 | 摘要（标题/时间/首末消息） | 原语组合的任意查询 |
| 树还原 | 有意不还原（只要摘要） | 正确还原主路径 + 分支 |

## 调用形态

```bash
# <技能目录> = 本 SKILL.md 所在目录（本文件 location 的 dirname）；scripts/query.py 相对它解析，勿按 CWD
# session：jsonl 路径 或 session id（自动去 ~/.pi/agent/sessions glob）
# script：路径、-（stdin）、-c/--code CODE（内联）
uv run --script <技能目录>/scripts/query.py <session> <查询脚本路径>
uv run --script <技能目录>/scripts/query.py <session> -
uv run --script <技能目录>/scripts/query.py <session> -c '<查询脚本源码>'

# session id 自省（agent 场景，省去手找文件路径）
uv run --script <技能目录>/scripts/query.py $PI_SUBAGENT_PARENT_SESSION -c 'print(s.title())'
```

session id 解析：参数非已存在文件、且不含路径分隔符/不以 `.jsonl` 结尾时视为 id，去 `~/.pi/agent/sessions/`（或环境变量 `PI_SESSIONS_DIR`）递归 glob `*_<id>.jsonl`。命中多个报 `ambiguous_session`。

运行器解析会话成 `Session` 对象 `s`，注入到查询脚本命名空间并 exec。查询脚本自行 `print` 输出（通常 `print(encode(...))` 用 TOON 省 token）。

## 注入的命名空间

查询脚本 exec 时可用的全局变量：

| 名字 | 说明 |
|------|------|
| `s` | 已载入的 `Session` 对象（会话文件已解析） |
| `Session` | `Session` 类（可重新构造） |
| `encode` | TOON 编码（toon-format 不可用或编码异常时降级 JSON + stderr 警告） |
| `decode` | TOON 解码 |
| `truncate` | 截断长文本，附 size hint |
| `__name__` | `"__main__"`（`if __name__ == "__main__"` 守卫生效） |
| `__file__` | 脚本来源标签：路径、`<stdin>`、`<inline>`（traceback 定位用） |

查询脚本可用标准库 + 注入的原语 + toon；第三方库 MVP 不支持。

## 原语 API

`Session` 对象的五组原语，均返回最小 schema 的 dict/list（遵循 AXI 输出原则）。

### 会话元数据

| 方法 | 返回 |
|------|------|
| `s.header()` | `{version, id, timestamp, cwd, parent_session}` |
| `s.title()` | 会话标题（最新 `session_info.name`），无则 `None` |

### 树结构

| 方法 | 返回 |
|------|------|
| `s.leaf()` | 末端节点：物理最后一条 entry（不用"最后 assistant 消息"启发式——会话以 user/toolResult 结束时会错；与 Pi 源码 `buildSessionPath` 一致） |
| `s.entry(id)` | 单个 entry 摘要 |
| `s.parent_chain(id)` | 从 id 回溯到根的链（self-first） |
| `s.children(id)` | id 的直接子节点 |
| `s.branch_leaves()` | 所有叶子节点（分支末端） |
| `s.tree()` | `{total_entries, root_id, leaves, branch_count}` |
| `s.common_ancestor(a, b)` | a、b 的最近公共祖先（LCA） |

### 路径与消息

| 方法 | 返回 |
|------|------|
| `s.path(leaf_id=None)` | root-to-leaf 完整链，按 timestamp 序（含 compaction 等所有 entry）。默认 leaf 为物理最后一条 |
| `s.context_entries(leaf_id=None)` | compaction-aware 活跃 entry 列表（Pi `buildContextEntries` 语义：省略最后一个 compaction 的 `firstKeptEntryId` 之前的条目） |
| `s.messages(leaf_id=None, *, role=None, tool=None, content=None, time=None)` | path 上 message 摘要，可按角色/工具名/正文子串/时间范围过滤（`time=(start, end)` ISO 8601，按字典序） |
| `s.blocks(entry_id)` | content[] block：assistant 给 thinking/text/toolCall/image，toolResult 给 text/image；image 只给 mimeType+size，不返回 base64 |
| `s.tool_pairs(leaf_id=None)` | path 上 toolCall ↔ toolResult 按 call id 配对（精确匹配，含复合 id） |

### 分析专用

| 方法 | 返回 |
|------|------|
| `s.diff(a, b)` | 两条分支（leaf id）在公共祖先之后的各自走向：`{common_ancestor, a_only, b_only}`（root-first，从祖先向外） |
| `s.tool_stats(leaf_id=None)` | `{total, by_tool, errors, error_rate}` |
| `s.token_stats(leaf_id=None)` | 累计 token 消耗与成本（来自 assistant `usage`）：`{input, output, cache_read, cache_write, total, cost, assistant_turns, by_model}` |
| `s.compaction_points(leaf_id=None)` | path 上的压缩点：`[{id, timestamp, tokensBefore, firstKeptEntryId, summary}]` |

`leaf_id` 参数缺省时取物理最后一条 entry。path/messages/tool_pairs/token_stats 等都基于"指定 leaf 到根"的路径，可分析任意分支。

## 查询脚本示例

还原主路径对话流：

```python
print(encode([{"role": m["role"], "text": m["text"]} for m in s.messages()]))
```

查看主路径上所有助手思考：

```python
for m in s.messages(role="assistant"):
    for b in s.blocks(m["id"]):
        if b["type"] == "thinking":
            print(m["id"], b["text"])
```

配对工具调用与结果、统计出错率：

```python
print(encode(s.tool_stats()))
print(encode(s.tool_pairs()))
```

对比两条分支差异：

```python
leaves = [e["id"] for e in s.branch_leaves()]
if len(leaves) >= 2:
    print(encode(s.diff(leaves[0], leaves[1])))
```

定位压缩点并查看摘要：

```python
print(encode(s.compaction_points()))
```

## 错误与退出码

| 场景 | exit | stdout |
|------|:----:|--------|
| 用法错误（参数缺失/互斥） | 2 | `{"error":true,"type":"usage",...}` |
| 会话/查询脚本文件不存在 | 2 | `{"error":true,"type":"file_not_found",...}` |
| session id 无匹配文件 | 2 | `{"error":true,"type":"session_not_found",...}` |
| session id 匹配多个文件 | 2 | `{"error":true,"type":"ambiguous_session","matches":[...],...}` |
| 缺 session header | 1 | `{"error":true,"type":"missing_header",...}` |
| v1/v2 会话（v3 only：v1 线性无 id/parentId） | 1 | `{"error":true,"type":"unsupported_version","version":N,...}` |
| 文件无有效条目 | 1 | `{"error":true,"type":"empty",...}` |
| 查询脚本抛异常 | 1 | `{"error":true,"type":"query_error","traceback":...}` |
| 某行 JSON 无法解析 | 0 | 跳过该行，stderr 警告 |

错误输出固定用 JSON（不依赖 toon），确保可解析。查询脚本返回空结果是 `[]`/`{total:0}` 等明确空状态，非报错。

## 脚本位置

`<技能目录>/scripts/query.py`（相对本 SKILL.md 所在目录） - PEP 723 单文件脚本，依赖 `toon-format>=0.9.0b1,<1.0`（PyPI beta）。原语库 + 运行器自包含于单文件，查询脚本通过 exec 注入的命名空间访问原语，无需 import 本地模块。

## 参考

- Pi 会话格式 -> `~/github_code/pi/packages/coding-agent/docs/session-format.md`（权威格式参考，已覆盖 block/message/entry 类型、树结构、context building）
- AXI 输出原则 -> `~/github_code/axi/`（TOON 输出、最小 schema、截断、聚合、空状态、结构化错误）
- TOON 格式 -> toonformat.dev；Python 库 `toon-format`（PyPI 0.9.0b1，beta，API 可能变）

#!/usr/bin/env uv run
# /// script
# requires-python = ">=3.11"
# dependencies = ["toon-format>=0.9.0b1,<1.0"]
# ///
"""pi-session-query - Pi 会话查询原语库 + 运行器。

把一个 Pi Agent 会话记录（JSONL）解析成 Session 对象，暴露会话元数据、树结构、
路径与消息、查询过滤、分析专用五组原语，供查询脚本组合完成复杂会话分析。

调用形态::

    uv run --script query.py <会话 jsonl 路径> <查询脚本路径>

运行器预载入 Session 对象 ``s``、``Session`` 类、``encode``/``decode``、
``truncate`` 到查询脚本命名空间并 exec。查询脚本自行 print 输出（通常
``print(encode(...))``）。

只支持 v3 会话（树形 id/parentId）；v1/v2 拒绝并结构化错误指出 version。
"""

from __future__ import annotations

import argparse
import glob
import json
import os
import sys
import traceback
from pathlib import Path

# ── TOON 编解码（lazy + JSON fallback）─────────────────────────────────────
# toon-format (PyPI 0.9.0b1+) 是 beta，导入失败或编码异常时降级 JSON，
# 不崩溃。Session 原语层本身不依赖 toon，纯标准库可测。
_toon_encode = None
_toon_decode = None
try:
    from toon_format import decode as _toon_decode
    from toon_format import encode as _toon_encode
except Exception:
    pass


def encode(value) -> str:
    """TOON 编码；toon-format 不可用或编码异常时降级 JSON 并 stderr 警告。"""
    if _toon_encode is not None:
        try:
            return _toon_encode(value)
        except Exception as e:
            print(f"[warn] TOON 编码失败，降级 JSON: {e}", file=sys.stderr)
    return json.dumps(value, ensure_ascii=False)


def decode(s: str):
    """TOON 解码；toon-format 不可用时用 JSON（静默降级，因调用方已知输入格式）。"""
    if _toon_decode is not None:
        return _toon_decode(s)
    return json.loads(s)


# ── 辅助函数 ────────────────────────────────────────────────────────────────

DEFAULT_TEXT_LIMIT = 200


def truncate(text: str | None, limit: int = DEFAULT_TEXT_LIMIT) -> str:
    """截断长文本，附 size hint（AXI 原则 3）。"""
    if not text:
        return ""
    if len(text) <= limit:
        return text
    return text[:limit] + f"… (+{len(text) - limit} chars)"


def _first_text(content) -> str:
    """从 message content 提取首段文本（拼接所有 text block）。"""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = [
            b.get("text", "") for b in content if isinstance(b, dict) and b.get("type") == "text"
        ]
        return " ".join(parts)
    return ""


def _block_types(content) -> list[str]:
    if isinstance(content, list):
        return [b.get("type") for b in content if isinstance(b, dict)]
    if isinstance(content, str):
        return ["text"]
    return []


def _msg_has_tool(message: dict, tool: str) -> bool:
    """message 是否涉及指定工具（toolCall.name 或 toolResult.toolName 命中）。"""
    content = message.get("content")
    if isinstance(content, list):
        for b in content:
            if isinstance(b, dict) and b.get("type") == "toolCall" and b.get("name") == tool:
                return True
    if message.get("role") == "toolResult" and message.get("toolName") == tool:
        return True
    return False


# ── 异常 ────────────────────────────────────────────────────────────────────


class SessionError(Exception):
    """会话解析/查询错误，携带 type 与 exit_code 供运行器结构化输出。

    exit_code 默认 1（数据层错误）；参数层错误（文件缺失、id 歧义）传 exit_code=2。
    """

    def __init__(self, type: str, message: str, *, exit_code: int = 1, **detail):
        super().__init__(message)
        self.type = type
        self.message = message
        self.exit_code = exit_code
        self.detail = detail


# ── Session 原语库 ──────────────────────────────────────────────────────────


class Session:
    """Pi 会话 JSONL 的只读查询原语库。

    解析 v3 会话文件（树形 id/parentId），暴露五组原语：会话元数据、树结构、
    路径与消息、查询过滤、分析专用。所有原语返回最小 schema 的 dict/list。
    """

    def __init__(self, jsonl_path: str | Path):
        self.file_path = Path(jsonl_path)
        raw = self.file_path.read_text(encoding="utf-8")
        self.header_obj: dict | None = None
        self.entries: list[dict] = []
        self._by_id: dict[str, dict] = {}
        bad = 0

        for line in raw.splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                bad += 1
                print(f"[warn] 跳过无法解析的行: {line[:80]!r}", file=sys.stderr)
                continue
            if obj.get("type") == "session":
                self.header_obj = obj
                continue
            self.entries.append(obj)
            if "id" in obj:
                self._by_id[obj["id"]] = obj

        self.bad_lines = bad

        if self.header_obj is None:
            raise SessionError("missing_header", "缺少 session header 行")
        version = self.header_obj.get("version", 1)
        if version < 3:
            raise SessionError(
                "unsupported_version", f"仅支持 v3 会话，文件为 v{version}", version=version
            )
        if not self.entries:
            raise SessionError("empty", "文件无有效条目")

    # ── 内部：原始路径 ──────────────────────────────────────────────────────

    def _raw_path(self, leaf_id: str | None = None) -> list[dict]:
        """leaf 到根的原始 entry 链（root-first），默认 leaf 为物理最后一条。

        与 Pi 源码 buildSessionPath 一致：leaf ??= entries[-1]，回溯 parentId。
        """
        leaf = self._by_id.get(leaf_id) if leaf_id else self.entries[-1]
        if leaf is None:
            raise SessionError("not_found", f"无此 entry: {leaf_id}", id=leaf_id)
        chain: list[dict] = []
        cur: dict | None = leaf
        while cur is not None:
            chain.append(cur)
            pid = cur.get("parentId")
            cur = self._by_id.get(pid) if pid else None
        chain.reverse()
        return chain

    def _chain_ids(self, entry_id: str) -> list[str]:
        """entry_id 到根的 id 链（self-first，不含 None）。"""
        ids: list[str] = []
        cur = self._by_id.get(entry_id)
        while cur is not None:
            ids.append(cur.get("id"))
            pid = cur.get("parentId")
            cur = self._by_id.get(pid) if pid else None
        return ids

    def _summarize(self, entry: dict) -> dict:
        """按 entry type 产出最小 schema 摘要。"""
        t = entry.get("type")
        base: dict = {
            "id": entry.get("id"),
            "type": t,
            "parentId": entry.get("parentId"),
            "timestamp": entry.get("timestamp"),
        }
        if t == "message":
            m = entry.get("message", {}) or {}
            base["role"] = m.get("role")
            base["text"] = truncate(_first_text(m.get("content")))
            base["block_types"] = _block_types(m.get("content"))
            if m.get("role") == "assistant":
                base["model"] = m.get("model")
        elif t == "compaction":
            base["tokensBefore"] = entry.get("tokensBefore")
            base["firstKeptEntryId"] = entry.get("firstKeptEntryId")
            base["summary"] = truncate(entry.get("summary", ""))
        elif t == "branch_summary":
            base["fromId"] = entry.get("fromId")
            base["summary"] = truncate(entry.get("summary", ""))
        elif t == "model_change":
            base["provider"] = entry.get("provider")
            base["modelId"] = entry.get("modelId")
        elif t == "thinking_level_change":
            base["thinkingLevel"] = entry.get("thinkingLevel")
        elif t == "session_info":
            base["name"] = entry.get("name")
        elif t == "label":
            base["targetId"] = entry.get("targetId")
            base["label"] = entry.get("label")
        elif t in ("custom", "custom_message"):
            base["customType"] = entry.get("customType")
        return base

    # ── 会话元数据 ──────────────────────────────────────────────────────────

    def header(self) -> dict:
        """会话 header 元数据：version/id/timestamp/cwd/parent_session。"""
        h = self.header_obj or {}
        return {
            "version": h.get("version"),
            "id": h.get("id"),
            "timestamp": h.get("timestamp"),
            "cwd": h.get("cwd"),
            "parent_session": h.get("parentSession"),
        }

    def title(self) -> str | None:
        """会话标题：最新一条非空 session_info.name（/name 可多次设置）。"""
        name = None
        for e in self.entries:
            if e.get("type") == "session_info":
                n = e.get("name")
                if n:
                    name = n
        return name

    # ── 树结构 ──────────────────────────────────────────────────────────────

    def leaf(self) -> dict:
        """末端节点：物理最后一条 entry（与 Pi 源码 buildSessionPath 默认一致）。"""
        return self._summarize(self.entries[-1])

    def entry(self, id: str) -> dict:
        """单个 entry 摘要。"""
        e = self._by_id.get(id)
        if e is None:
            raise SessionError("not_found", f"无此 entry: {id}", id=id)
        return self._summarize(e)

    def parent_chain(self, id: str) -> list[dict]:
        """从 id 回溯到根的链（self-first，不含根的 parentId None）。"""
        if id not in self._by_id:
            raise SessionError("not_found", f"无此 entry: {id}", id=id)
        return [self._summarize(self._by_id[i]) for i in self._chain_ids(id)]

    def children(self, id: str) -> list[dict]:
        """id 的直接子节点。"""
        return [self._summarize(e) for e in self.entries if e.get("parentId") == id]

    def branch_leaves(self) -> list[dict]:
        """所有叶子节点（无子节点的 entry）--分支末端。"""
        parent_ids = {e.get("parentId") for e in self.entries if e.get("parentId")}
        return [self._summarize(e) for e in self.entries if e.get("id") not in parent_ids]

    def tree(self) -> dict:
        """整棵树精简结构：总数、根、叶子、分支数。"""
        leaves = self.branch_leaves()
        return {
            "total_entries": len(self.entries),
            "root_id": self.entries[0].get("id") if self.entries else None,
            "leaves": leaves,
            "branch_count": max(len(leaves) - 1, 0),
        }

    def common_ancestor(self, a: str, b: str) -> dict | None:
        """a、b 的最近公共祖先（LCA）；无公共祖先返回 None。"""
        for x in (a, b):
            if x not in self._by_id:
                raise SessionError("not_found", f"无此 entry: {x}", id=x)
        set_a = set(self._chain_ids(a))
        cur = self._by_id.get(b)
        while cur is not None:
            if cur.get("id") in set_a:
                return self._summarize(cur)
            pid = cur.get("parentId")
            cur = self._by_id.get(pid) if pid else None
        return None

    # ── 路径与消息 ──────────────────────────────────────────────────────────

    def path(self, leaf_id: str | None = None) -> list[dict]:
        """root-to-leaf 完整链（含 compaction 等所有 entry 类型）。"""
        return [self._summarize(e) for e in self._raw_path(leaf_id)]

    def context_entries(self, leaf_id: str | None = None) -> list[dict]:
        """compaction-aware 活跃 entry 列表（Pi buildContextEntries 语义）。

        path 上最后一个 compaction 之前、firstKeptEntryId 之前的条目省略
        （已被压缩摘要替代）。无 compaction 时与 path() 相同。
        """
        raw = self._raw_path(leaf_id)
        compaction = None
        for e in raw:
            if e.get("type") == "compaction":
                compaction = e  # 取最后一个
        if compaction is None:
            return [self._summarize(e) for e in raw]
        idx = raw.index(compaction)
        result: list[dict] = [compaction]
        found_first_kept = False
        for e in raw[:idx]:
            if e.get("id") == compaction.get("firstKeptEntryId"):
                found_first_kept = True
            if found_first_kept:
                result.append(e)
        result.extend(raw[idx + 1 :])
        return [self._summarize(e) for e in result]

    def messages(
        self,
        leaf_id: str | None = None,
        *,
        role: str | None = None,
        tool: str | None = None,
        content: str | None = None,
        time: tuple[str | None, str | None] | None = None,
    ) -> list[dict]:
        """path 上的 message 摘要，可按 role/tool/content 过滤。

        - role: 按消息角色（user/assistant/toolResult/bashExecution/...）
        - tool: 只保留涉及该工具的消息（toolCall.name 或 toolResult.toolName）
        - content: 文本子串搜索
        - time: (start, end) ISO 8601 时间范围，按 timestamp 字典序过滤（None 边界无界）
        """
        out: list[dict] = []
        for e in self._raw_path(leaf_id):
            if e.get("type") != "message":
                continue
            m = e.get("message", {}) or {}
            r = m.get("role")
            if role and r != role:
                continue
            text = _first_text(m.get("content"))
            if content and content not in text:
                continue
            if tool and not _msg_has_tool(m, tool):
                continue
            if time:
                ts = e.get("timestamp", "")
                start, end = time
                if (start and ts < start) or (end and ts > end):
                    continue
            out.append(
                {
                    "id": e.get("id"),
                    "role": r,
                    "timestamp": e.get("timestamp"),
                    "text": truncate(text),
                    "block_types": _block_types(m.get("content")),
                    "model": m.get("model") if r == "assistant" else None,
                }
            )
        return out

    def blocks(self, entry_id: str) -> list[dict]:
        """单个 message entry 的 content[] block 列表（text/thinking 截断，image 只给 size）。"""
        e = self._by_id.get(entry_id)
        if e is None:
            raise SessionError("not_found", f"无此 entry: {entry_id}", id=entry_id)
        if e.get("type") != "message":
            return []
        m = e.get("message", {}) or {}
        content = m.get("content")
        if isinstance(content, str):
            return [{"type": "text", "text": truncate(content)}]
        if not isinstance(content, list):
            return []
        out: list[dict] = []
        for b in content:
            if not isinstance(b, dict):
                continue
            bt = b.get("type")
            if bt == "text":
                out.append({"type": "text", "text": truncate(b.get("text", ""))})
            elif bt == "thinking":
                out.append({"type": "thinking", "text": truncate(b.get("thinking", ""))})
            elif bt == "toolCall":
                out.append(
                    {
                        "type": "toolCall",
                        "id": b.get("id"),
                        "name": b.get("name"),
                        "arguments": b.get("arguments"),
                    }
                )
            elif bt == "image":
                out.append(
                    {"type": "image", "mimeType": b.get("mimeType"), "size": len(b.get("data", ""))}
                )
            else:
                out.append({"type": bt})
        return out

    def tool_pairs(self, leaf_id: str | None = None) -> list[dict]:
        """path 上 toolCall ↔ toolResult 按 call id 配对。

        toolCall.id 与 toolResult.toolCallId 精确匹配（含复合 id 场景）。
        无对应结果的 toolCall，toolResult 字段为 None。
        """
        calls: dict[str, dict] = {}
        results: dict[str, dict] = {}
        for e in self._raw_path(leaf_id):
            if e.get("type") != "message":
                continue
            m = e.get("message", {}) or {}
            if m.get("role") == "assistant" and isinstance(m.get("content"), list):
                for b in m["content"]:
                    if isinstance(b, dict) and b.get("type") == "toolCall":
                        calls[b.get("id")] = {"entry_id": e.get("id"), "block": b}
            elif m.get("role") == "toolResult":
                results[m.get("toolCallId")] = {"entry_id": e.get("id"), "msg": m}
        pairs: list[dict] = []
        for cid, c in calls.items():
            r = results.get(cid)
            pairs.append(
                {
                    "toolCall": {
                        "id": cid,
                        "name": c["block"].get("name"),
                        "entry_id": c["entry_id"],
                        "arguments": c["block"].get("arguments"),
                    },
                    "toolResult": (
                        {
                            "toolCallId": cid,
                            "toolName": r["msg"].get("toolName"),
                            "entry_id": r["entry_id"],
                            "isError": r["msg"].get("isError"),
                            "text": truncate(_first_text(r["msg"].get("content"))),
                        }
                        if r
                        else None
                    ),
                }
            )
        return pairs

    # ── 分析专用 ────────────────────────────────────────────────────────────

    def diff(self, a: str, b: str) -> dict:
        """两条分支（leaf id）在公共祖先之后的各自走向。

        返回 common_ancestor、a_only、b_only（均为 entry 摘要，root-first，
        从公共祖先向外，不含公共祖先本身）。
        """
        for x in (a, b):
            if x not in self._by_id:
                raise SessionError("not_found", f"无此 entry: {x}", id=x)
        chain_a = self._chain_ids(a)
        set_a = set(chain_a)
        chain_b = self._chain_ids(b)
        lca_id = None
        for cid in chain_b:
            if cid in set_a:
                lca_id = cid
                break
        a_only: list[str] = []
        for cid in chain_a:
            if cid == lca_id:
                break
            a_only.append(cid)
        b_only: list[str] = []
        for cid in chain_b:
            if cid == lca_id:
                break
            b_only.append(cid)
        a_only.reverse()
        b_only.reverse()
        return {
            "a": a,
            "b": b,
            "common_ancestor": self._summarize(self._by_id[lca_id]) if lca_id else None,
            "a_only": [self._summarize(self._by_id[i]) for i in a_only],
            "b_only": [self._summarize(self._by_id[i]) for i in b_only],
        }

    def tool_stats(self, leaf_id: str | None = None) -> dict:
        """path 上工具调用统计：总数、按工具分布、出错数、出错率。"""
        pairs = self.tool_pairs(leaf_id)
        by_tool: dict[str, int] = {}
        errors = 0
        for p in pairs:
            name = p["toolCall"]["name"]
            by_tool[name] = by_tool.get(name, 0) + 1
            if p["toolResult"] and p["toolResult"]["isError"]:
                errors += 1
        total = len(pairs)
        return {
            "total": total,
            "by_tool": by_tool,
            "errors": errors,
            "error_rate": round(errors / total, 4) if total else 0.0,
        }

    def token_stats(self, leaf_id: str | None = None) -> dict:
        """path 上 assistant 消息的 token 累计消耗与成本（来自 message.usage）。"""
        agg = {"input": 0, "output": 0, "cache_read": 0, "cache_write": 0, "total": 0}
        cost = {"input": 0.0, "output": 0.0, "cache_read": 0.0, "cache_write": 0.0, "total": 0.0}
        by_model: dict[str, int] = {}
        turns = 0
        for e in self._raw_path(leaf_id):
            if e.get("type") != "message":
                continue
            m = e.get("message", {}) or {}
            if m.get("role") != "assistant":
                continue
            u = m.get("usage") or {}
            agg["input"] += u.get("input", 0)
            agg["output"] += u.get("output", 0)
            agg["cache_read"] += u.get("cacheRead", 0)
            agg["cache_write"] += u.get("cacheWrite", 0)
            agg["total"] += u.get("totalTokens", 0)
            c = u.get("cost") or {}
            cost["input"] += c.get("input", 0.0)
            cost["output"] += c.get("output", 0.0)
            cost["cache_read"] += c.get("cacheRead", 0.0)
            cost["cache_write"] += c.get("cacheWrite", 0.0)
            cost["total"] += c.get("total", 0.0)
            model = m.get("model")
            if model:
                by_model[model] = by_model.get(model, 0) + 1
            turns += 1
        return {**agg, "cost": cost, "assistant_turns": turns, "by_model": by_model}

    def compaction_points(self, leaf_id: str | None = None) -> list[dict]:
        """path 上的压缩点：id/timestamp/tokensBefore/firstKeptEntryId/摘要。"""
        return [
            {
                "id": e.get("id"),
                "timestamp": e.get("timestamp"),
                "tokensBefore": e.get("tokensBefore"),
                "firstKeptEntryId": e.get("firstKeptEntryId"),
                "summary": truncate(e.get("summary", "")),
            }
            for e in self._raw_path(leaf_id)
            if e.get("type") == "compaction"
        ]


# ── 运行器 ───────────────────────────────────────────────────────────────────


def _emit_error(type: str, message: str, *, exit_code: int = 1, **detail) -> None:
    """结构化错误输出到 stdout（固定 JSON，不依赖 toon）并 exit。"""
    obj = {"error": True, "type": type, "message": message, **detail}
    print(json.dumps(obj, ensure_ascii=False))
    sys.exit(exit_code)


def _sessions_root() -> Path:
    """Pi 会话存储根目录：环境变量 PI_SESSIONS_DIR 覆盖，默认 ~/.pi/agent/sessions。"""
    env = os.environ.get("PI_SESSIONS_DIR")
    return Path(env).expanduser().resolve() if env else Path.home() / ".pi" / "agent" / "sessions"


def _resolve_session(arg: str) -> Path:
    """session 参数解析：文件路径直接用；否则当 session id 去 sessions 目录 glob。

    启发式区分路径与 id：含路径分隔符或以 .jsonl 结尾视为路径（不存在报
    file_not_found）；否则当 id（Pi 文件名 ``<ts>_<id>.jsonl``，glob
    ``*_<id>.jsonl``，命中 0 报 session_not_found，多个报 ambiguous_session，
    均 exit 2）。
    """
    p = Path(arg).expanduser()
    if p.is_file():
        return p
    looks_like_path = "/" in arg or "\\" in arg or arg.endswith(".jsonl")
    if looks_like_path:
        raise SessionError("file_not_found", f"会话文件不存在: {arg}", exit_code=2, path=arg)
    root = _sessions_root()
    if not root.is_dir():
        raise SessionError(
            "session_not_found",
            f"session 目录不存在且 {arg!r} 非文件路径",
            exit_code=2,
            arg=arg,
            searched=str(root),
        )
    matches = sorted(root.rglob(f"*_{glob.escape(arg)}.jsonl"))
    if not matches:
        raise SessionError(
            "session_not_found", f"未找到 session: {arg}", exit_code=2, id=arg, searched=str(root)
        )
    if len(matches) > 1:
        raise SessionError(
            "ambiguous_session",
            f"session id 匹配多个文件: {arg}",
            exit_code=2,
            id=arg,
            matches=[str(m) for m in matches],
        )
    return matches[0]


class _ArgParser(argparse.ArgumentParser):
    """argparse 出错时走结构化 JSON 输出（而非默认 stderr usage + exit 2）。"""

    def error(self, message: str) -> None:  # type: ignore[override]
        _emit_error("usage", message, exit_code=2)


def main() -> None:
    parser = _ArgParser(prog="query.py", description="Pi 会话查询原语库 + 运行器")
    parser.add_argument("session", help="会话 jsonl 路径或 session id")
    parser.add_argument("script", nargs="?", help="查询脚本路径，- 表 stdin")
    parser.add_argument("-c", "--code", dest="code", default=None, help="内联查询脚本")
    args = parser.parse_args()

    if args.code is not None and args.script is not None:
        _emit_error("usage", "不能同时指定查询脚本路径/stdin 与 -c/--code", exit_code=2)
    if args.code is None and args.script is None:
        _emit_error("usage", "须提供查询脚本：路径、-（stdin）或 -c/--code CODE", exit_code=2)

    try:
        jsonl_path = _resolve_session(args.session)
        s = Session(jsonl_path)
    except SessionError as e:
        _emit_error(e.type, e.message, exit_code=e.exit_code, **e.detail)

    if args.code is not None:
        script_src = args.code
        file_label = "<inline>"
    elif args.script == "-":
        if sys.stdin.isatty():
            print("[warn] stdin 是终端，等待输入（Ctrl-D 结束）", file=sys.stderr)
        script_src = sys.stdin.read()
        file_label = "<stdin>"
    else:
        script_path = args.script
        if not Path(script_path).is_file():
            _emit_error(
                "file_not_found", f"查询脚本不存在: {script_path}", exit_code=2, path=script_path
            )
        script_src = Path(script_path).read_text(encoding="utf-8")
        file_label = script_path

    namespace = {
        "__name__": "__main__",
        "__file__": file_label,
        "s": s,
        "Session": Session,
        "encode": encode,
        "decode": decode,
        "truncate": truncate,
    }
    try:
        exec(compile(script_src, file_label, "exec"), namespace)
    except SystemExit:
        raise
    except Exception as e:
        _emit_error(
            "query_error", f"{type(e).__name__}: {e}", exit_code=1, traceback=traceback.format_exc()
        )


if __name__ == "__main__":
    main()

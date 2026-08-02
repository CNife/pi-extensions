#!/usr/bin/env uv run
# /// script
# requires-python = ">=3.11"
# dependencies = ["pytest>=8", "toon-format>=0.9.0b1,<1.0"]
# ///
"""query.py 的测试 - 原语层（主 seam）+ 运行器端到端（辅 seam）。

运行：cd <skill目录> && uv run --script tests/test_query.py

测试哲学：只测外部行为（原语公开接口 + 运行器外部行为），期望值来自 Pi
会话格式文档与构造场景，独立于实现。
"""

from __future__ import annotations

import sys
from pathlib import Path

# 测试在 tests/，脚本目录不在 sys.path；显式加入以便 import 被测模块。
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

import json
import os
import subprocess

import pytest
import query

SCRIPT_DIR = Path(__file__).resolve().parent
QUERY_PY = SCRIPT_DIR.parent / "scripts" / "query.py"


# ── helpers ─────────────────────────────────────────────────────────────────


def _write_session(tmp_path: Path, lines: list[dict], name: str = "s.jsonl") -> Path:
    p = tmp_path / name
    p.write_text("\n".join(json.dumps(entry) for entry in lines) + "\n", encoding="utf-8")
    return p


def _header(**extra) -> dict:
    h = {
        "type": "session",
        "version": 3,
        "id": "s1",
        "timestamp": "2024-12-03T14:00:00.000Z",
        "cwd": "/proj",
    }
    h.update(extra)
    return h


def _msg(
    eid: str | None,
    pid: str | None,
    role: str,
    content,
    ts: str = "2024-12-03T14:00:01.000Z",
    **msg_extra,
) -> dict:
    m: dict = {"role": role, "content": content}
    m.update(msg_extra)
    return {"type": "message", "id": eid, "parentId": pid, "timestamp": ts, "message": m}


def _usage(inp=10, out=20, total=30) -> dict:
    return {
        "input": inp,
        "output": out,
        "cacheRead": 0,
        "cacheWrite": 0,
        "totalTokens": total,
        "cost": {
            "input": 0.001,
            "output": 0.002,
            "cacheRead": 0.0,
            "cacheWrite": 0.0,
            "total": 0.003,
        },
    }


def _forked_session(tmp_path: Path) -> Path:
    """带 fork 的会话：

        a1(user) -> a2(asst:thinking+text+toolCall) -> a3(toolResult) -> a4(user) -> a5(asst)
                                                                └-> b1(branch_summary) -> b2(user) -> b3(asst)

    fork 点 a3 有两子 a4、b1；末端为 b3（物理最后一条）。
    """
    lines = [
        _header(),
        _msg("a1", None, "user", [{"type": "text", "text": "hello"}], ts="2024-01-01T00:00:00Z"),
        _msg(
            "a2",
            "a1",
            "assistant",
            [
                {"type": "thinking", "thinking": "let me think"},
                {"type": "text", "text": "running bash"},
                {
                    "type": "toolCall",
                    "id": "call_1",
                    "name": "bash",
                    "arguments": {"command": "ls"},
                },
            ],
            ts="2024-01-01T00:00:01Z",
            model="claude-sonnet-4",
            usage=_usage(),
        ),
        _msg(
            "a3",
            "a2",
            "toolResult",
            [{"type": "text", "text": "file.txt"}],
            ts="2024-01-01T00:00:02Z",
            toolCallId="call_1",
            toolName="bash",
            isError=False,
        ),
        _msg(
            "a4", "a3", "user", [{"type": "text", "text": "go branch A"}], ts="2024-01-01T00:00:03Z"
        ),
        _msg(
            "a5",
            "a4",
            "assistant",
            [{"type": "text", "text": "A result"}],
            ts="2024-01-01T00:00:04Z",
            model="claude-sonnet-4",
        ),
        {
            "type": "branch_summary",
            "id": "b1",
            "parentId": "a3",
            "timestamp": "2024-01-01T00:00:05Z",
            "fromId": "a5",
            "summary": "explored A",
        },
        _msg(
            "b2", "b1", "user", [{"type": "text", "text": "go branch B"}], ts="2024-01-01T00:00:06Z"
        ),
        _msg(
            "b3",
            "b2",
            "assistant",
            [{"type": "text", "text": "B result"}],
            ts="2024-01-01T00:00:07Z",
            model="claude-sonnet-4",
        ),
    ]
    return _write_session(tmp_path, lines)


def _compacted_session(tmp_path: Path) -> Path:
    """带压缩的会话：a1(user) -> a2(asst) -> comp(firstKeptEntryId=a2) -> a3(user) -> a4(asst)。"""
    lines = [
        _header(),
        _msg(
            "a1",
            None,
            "user",
            [{"type": "text", "text": "early message"}],
            ts="2024-01-01T00:00:00Z",
        ),
        _msg(
            "a1b",
            "a1",
            "assistant",
            [{"type": "text", "text": "early reply"}],
            ts="2024-01-01T00:00:01Z",
            model="claude-sonnet-4",
        ),
        {
            "type": "compaction",
            "id": "c1",
            "parentId": "a1b",
            "timestamp": "2024-01-01T00:00:02Z",
            "summary": "early summarized",
            "firstKeptEntryId": "a1b",
            "tokensBefore": 5000,
        },
        _msg(
            "a3",
            "c1",
            "user",
            [{"type": "text", "text": "after compact"}],
            ts="2024-01-01T00:00:03Z",
        ),
        _msg(
            "a4",
            "a3",
            "assistant",
            [{"type": "text", "text": "final"}],
            ts="2024-01-01T00:00:04Z",
            model="claude-sonnet-4",
            usage=_usage(5, 8, 13),
        ),
    ]
    return _write_session(tmp_path, lines)


def _find_real_session() -> Path | None:
    d = Path.home() / ".pi" / "agent" / "sessions"
    if not d.is_dir():
        return None
    files = sorted(d.rglob("*.jsonl"), key=lambda p: p.stat().st_mtime, reverse=True)
    return files[0] if files else None


# ── Slice 1: 解析 + 元数据 ──────────────────────────────────────────────────


def test_header_returns_metadata(tmp_path):
    s = query.Session(_forked_session(tmp_path))
    h = s.header()
    assert h == {
        "version": 3,
        "id": "s1",
        "timestamp": "2024-12-03T14:00:00.000Z",
        "cwd": "/proj",
        "parent_session": None,
    }


def test_header_includes_parent_session_when_forked(tmp_path):
    p = _write_session(
        tmp_path,
        [
            _header(parentSession="/orig/x.jsonl"),
            _msg("a1", None, "user", [{"type": "text", "text": "hi"}]),
        ],
    )
    assert query.Session(p).header()["parent_session"] == "/orig/x.jsonl"


def test_leaf_is_physical_last_entry(tmp_path):
    """末端节点是物理最后一条 entry（b3），不是最后一个 assistant text。"""
    s = query.Session(_forked_session(tmp_path))
    leaf = s.leaf()
    assert leaf["id"] == "b3"
    assert leaf["role"] == "assistant"


def test_title_from_latest_session_info(tmp_path):
    """/name 多次设置取最新非空。"""
    lines = [
        _header(),
        {"type": "session_info", "id": "i1", "parentId": None, "timestamp": "t", "name": "first"},
        _msg("a1", "i1", "user", [{"type": "text", "text": "hi"}]),
        {"type": "session_info", "id": "i2", "parentId": "a1", "timestamp": "t", "name": "second"},
    ]
    s = query.Session(_write_session(tmp_path, lines))
    assert s.title() == "second"


def test_title_none_when_no_session_info(tmp_path):
    s = query.Session(_forked_session(tmp_path))
    assert s.title() is None


def test_missing_header_raises(tmp_path):
    p = _write_session(tmp_path, [_msg("a1", None, "user", [{"type": "text", "text": "hi"}])])
    with pytest.raises(query.SessionError) as ei:
        query.Session(p)
    assert ei.value.type == "missing_header"


def test_v1_session_rejected(tmp_path):
    p = _write_session(
        tmp_path,
        [
            {"type": "session", "version": 1, "id": "s", "timestamp": "t", "cwd": "/p"},
            _msg("a1", None, "user", [{"type": "text", "text": "hi"}]),
        ],
    )
    with pytest.raises(query.SessionError) as ei:
        query.Session(p)
    assert ei.value.type == "unsupported_version"
    assert ei.value.detail["version"] == 1


def test_empty_file_raises(tmp_path):
    p = _write_session(tmp_path, [_header()])
    with pytest.raises(query.SessionError) as ei:
        query.Session(p)
    assert ei.value.type == "empty"


def test_bad_json_line_skipped_with_warning(tmp_path, capsys):
    """某行 JSON 无法解析 -> 跳过并 stderr 警告，不崩。"""
    raw = (
        json.dumps(_header())
        + "\n"
        + "{bad json\n"
        + json.dumps(_msg("a1", None, "user", [{"type": "text", "text": "hi"}]))
        + "\n"
    )
    p = tmp_path / "s.jsonl"
    p.write_text(raw, encoding="utf-8")
    s = query.Session(p)
    assert s.bad_lines == 1
    assert len(s.entries) == 1
    err = capsys.readouterr().err
    assert "[warn]" in err


# ── Slice 2: 树结构 ─────────────────────────────────────────────────────────


def test_parent_chain_to_root(tmp_path):
    s = query.Session(_forked_session(tmp_path))
    chain = s.parent_chain("b3")
    assert [e["id"] for e in chain] == ["b3", "b2", "b1", "a3", "a2", "a1"]


def test_children_of_fork_point(tmp_path):
    """fork 点 a3 有两子 a4、b1。"""
    s = query.Session(_forked_session(tmp_path))
    kids = s.children("a3")
    assert {e["id"] for e in kids} == {"a4", "b1"}


def test_branch_leaves(tmp_path):
    """叶子：a5（A 分支末端）、b3（B 分支末端，物理最后）。"""
    s = query.Session(_forked_session(tmp_path))
    leaves = s.branch_leaves()
    assert {e["id"] for e in leaves} == {"a5", "b3"}


def test_tree_summary(tmp_path):
    s = query.Session(_forked_session(tmp_path))
    t = s.tree()
    assert t["total_entries"] == 8
    assert t["root_id"] == "a1"
    assert t["branch_count"] == 1  # 2 叶子 - 1


def test_common_ancestor(tmp_path):
    """a5 与 b3 的最近公共祖先是 a3（fork 点）。"""
    s = query.Session(_forked_session(tmp_path))
    lca = s.common_ancestor("a5", "b3")
    assert lca["id"] == "a3"


def test_common_ancestor_none_when_unrelated(tmp_path):
    """无公共祖先返回 None（理论上 v3 会话同根，此例构造异常数据）。"""
    lines = [
        _header(),
        _msg("a1", None, "user", [{"type": "text", "text": "x"}]),
        _msg("b1", "zzz", "user", [{"type": "text", "text": "y"}]),
    ]
    s = query.Session(_write_session(tmp_path, lines))
    assert s.common_ancestor("a1", "b1") is None


def test_entry_not_found_raises(tmp_path):
    s = query.Session(_forked_session(tmp_path))
    with pytest.raises(query.SessionError) as ei:
        s.entry("nope")
    assert ei.value.type == "not_found"


def test_parent_chain_not_found_raises(tmp_path):
    s = query.Session(_forked_session(tmp_path))
    with pytest.raises(query.SessionError) as ei:
        s.parent_chain("nope")
    assert ei.value.type == "not_found"


def test_common_ancestor_not_found_raises(tmp_path):
    s = query.Session(_forked_session(tmp_path))
    with pytest.raises(query.SessionError) as ei:
        s.common_ancestor("nope", "a1")
    assert ei.value.type == "not_found"


def test_diff_not_found_raises(tmp_path):
    s = query.Session(_forked_session(tmp_path))
    with pytest.raises(query.SessionError) as ei:
        s.diff("nope", "a5")
    assert ei.value.type == "not_found"


# ── Slice 3: 路径与消息 ─────────────────────────────────────────────────────


def test_path_root_to_leaf_default(tmp_path):
    """默认 leaf=b3，path 为 root(b3 回溯)->a1..b3。"""
    s = query.Session(_forked_session(tmp_path))
    p = s.path()
    assert [e["id"] for e in p] == ["a1", "a2", "a3", "b1", "b2", "b3"]


def test_path_specified_leaf_follows_branch_a(tmp_path):
    s = query.Session(_forked_session(tmp_path))
    p = s.path("a5")
    assert [e["id"] for e in p] == ["a1", "a2", "a3", "a4", "a5"]


def test_messages_filter_by_role(tmp_path):
    s = query.Session(_forked_session(tmp_path))
    users = s.messages(role="user")
    assert [e["id"] for e in users] == ["a1", "b2"]  # 默认 leaf=b3 路径上 a1、b2 是 user
    assert all(e["role"] == "user" for e in users)


def test_messages_filter_by_tool(tmp_path):
    """tool=bash 保留涉及 bash 的消息（a2 toolCall + a3 toolResult）。"""
    s = query.Session(_forked_session(tmp_path))
    msgs = s.messages("a5", tool="bash")
    assert [e["id"] for e in msgs] == ["a2", "a3"]


def test_messages_search_content(tmp_path):
    s = query.Session(_forked_session(tmp_path))
    msgs = s.messages(content="branch B")
    assert [e["id"] for e in msgs] == ["b2"]


def test_messages_filter_by_time(tmp_path):
    """time 范围按 timestamp 字典序过滤：a5 路径含 a1(00:00:00)..a5(00:00:04)，
    time=(00:00:02, 00:00:04) -> a3,a4,a5。"""
    s = query.Session(_forked_session(tmp_path))
    msgs = s.messages("a5", time=("2024-01-01T00:00:02Z", "2024-01-01T00:00:04Z"))
    assert [e["id"] for e in msgs] == ["a3", "a4", "a5"]


def test_blocks_thinking_text_toolcall(tmp_path):
    s = query.Session(_forked_session(tmp_path))
    blocks = s.blocks("a2")
    types = [b["type"] for b in blocks]
    assert types == ["thinking", "text", "toolCall"]
    call = next(b for b in blocks if b["type"] == "toolCall")
    assert call["name"] == "bash"
    assert call["arguments"] == {"command": "ls"}


def test_blocks_image_returns_size_not_data(tmp_path):
    """image block 不返回 base64 data，只给 mimeType + size（AXI 截断）。"""
    lines = [
        _header(),
        _msg(
            "a1",
            None,
            "user",
            [
                {"type": "image", "data": "base64==", "mimeType": "image/png"},
                {"type": "text", "text": "see img"},
            ],
        ),
    ]
    s = query.Session(_write_session(tmp_path, lines))
    blocks = s.blocks("a1")
    img = next(b for b in blocks if b["type"] == "image")
    assert img["mimeType"] == "image/png"
    assert img["size"] == len("base64==")
    assert "data" not in img


def test_context_entries_compaction_aware(tmp_path):
    """compaction 之后：[compaction, firstKept(a1b), a3, a4]，a1 被省略。"""
    s = query.Session(_compacted_session(tmp_path))
    ctx = s.context_entries()
    assert [e["id"] for e in ctx] == ["c1", "a1b", "a3", "a4"]


def test_path_keeps_full_chain_with_compaction(tmp_path):
    """path() 返回完整链（含被压缩的 a1），不省略。"""
    s = query.Session(_compacted_session(tmp_path))
    p = s.path()
    assert [e["id"] for e in p] == ["a1", "a1b", "c1", "a3", "a4"]


# ── Slice 4: 工具配对 ───────────────────────────────────────────────────────


def test_tool_pairs_match_by_call_id(tmp_path):
    s = query.Session(_forked_session(tmp_path))
    pairs = s.tool_pairs("a5")
    assert len(pairs) == 1
    p = pairs[0]
    assert p["toolCall"]["id"] == "call_1"
    assert p["toolCall"]["name"] == "bash"
    assert p["toolResult"]["toolCallId"] == "call_1"
    assert p["toolResult"]["isError"] is False
    assert p["toolResult"]["text"] == "file.txt"


def test_tool_pairs_missing_result_is_none(tmp_path):
    """toolCall 无对应 toolResult 时 toolResult=None。"""
    lines = [
        _header(),
        _msg(
            "a1",
            None,
            "assistant",
            [{"type": "toolCall", "id": "call_x", "name": "bash", "arguments": {}}],
        ),
        _msg("a2", "a1", "user", [{"type": "text", "text": "no result yet"}]),
    ]
    s = query.Session(_write_session(tmp_path, lines))
    pairs = s.tool_pairs()
    assert pairs[0]["toolResult"] is None


# ── Slice 5: 分析专用 ───────────────────────────────────────────────────────


def test_tool_stats(tmp_path):
    s = query.Session(_forked_session(tmp_path))
    stats = s.tool_stats("a5")
    assert stats["total"] == 1
    assert stats["by_tool"] == {"bash": 1}
    assert stats["errors"] == 0
    assert stats["error_rate"] == 0.0


def test_tool_stats_counts_errors(tmp_path):
    lines = [
        _header(),
        _msg(
            "a1",
            None,
            "assistant",
            [{"type": "toolCall", "id": "c1", "name": "bash", "arguments": {}}],
        ),
        _msg(
            "a2",
            "a1",
            "toolResult",
            [{"type": "text", "text": "err"}],
            toolCallId="c1",
            toolName="bash",
            isError=True,
        ),
        _msg(
            "a3",
            "a2",
            "assistant",
            [{"type": "toolCall", "id": "c2", "name": "read", "arguments": {}}],
        ),
        _msg(
            "a4",
            "a3",
            "toolResult",
            [{"type": "text", "text": "ok"}],
            toolCallId="c2",
            toolName="read",
            isError=False,
        ),
    ]
    s = query.Session(_write_session(tmp_path, lines))
    stats = s.tool_stats()
    assert stats["total"] == 2
    assert stats["by_tool"] == {"bash": 1, "read": 1}
    assert stats["errors"] == 1
    assert stats["error_rate"] == 0.5


def test_token_stats(tmp_path):
    s = query.Session(_forked_session(tmp_path))
    ts = s.token_stats("a5")
    assert ts["input"] == 10
    assert ts["output"] == 20
    assert ts["total"] == 30
    assert ts["assistant_turns"] == 2  # a5 路径含 a2、a5 两个 assistant
    assert ts["cost"]["total"] == 0.003
    assert ts["by_model"] == {"claude-sonnet-4": 2}


def test_compaction_points(tmp_path):
    s = query.Session(_compacted_session(tmp_path))
    cps = s.compaction_points()
    assert len(cps) == 1
    cp = cps[0]
    assert cp["id"] == "c1"
    assert cp["tokensBefore"] == 5000
    assert cp["firstKeptEntryId"] == "a1b"
    assert cp["summary"] == "early summarized"


def test_diff_two_branches(tmp_path):
    """a5 vs b3：公共祖先 a3，a_only=[a4,a5]，b_only=[b1,b2,b3]。"""
    s = query.Session(_forked_session(tmp_path))
    d = s.diff("a5", "b3")
    assert d["common_ancestor"]["id"] == "a3"
    assert [e["id"] for e in d["a_only"]] == ["a4", "a5"]
    assert [e["id"] for e in d["b_only"]] == ["b1", "b2", "b3"]


def test_truncate_adds_size_hint():
    assert query.truncate("short") == "short"
    long = "x" * 300
    out = query.truncate(long, limit=10)
    assert out.startswith("x" * 10)
    assert "+290 chars" in out


# ── Slice 6: 运行器端到端 ───────────────────────────────────────────────────


def _run_runner(
    jsonl: Path | str,
    script: Path | None = None,
    *,
    extra_args: list[str] | None = None,
    stdin: str | None = None,
    env: dict[str, str] | None = None,
) -> subprocess.CompletedProcess:
    args = ["uv", "run", "--script", str(QUERY_PY), str(jsonl)]
    if script is not None:
        args.append(str(script))
    if extra_args:
        args.extend(extra_args)
    run_env = None if env is None else {**os.environ, **env}
    return subprocess.run(
        args,
        capture_output=True,
        text=True,
        cwd=SCRIPT_DIR.parent,
        timeout=120,
        input=stdin,
        env=run_env,
        check=False,
    )


def test_runner_usage_error_exit2(tmp_path):
    """无参数 -> 结构化错误 exit 2。"""
    r = _run_runner(tmp_path / "none.jsonl")
    assert r.returncode == 2
    obj = json.loads(r.stdout)
    assert obj["type"] == "usage"
    assert obj["error"] is True


def test_runner_file_not_found_exit2(tmp_path):
    """会话文件不存在 -> exit 2。"""
    script = tmp_path / "q.py"
    script.write_text("print('hi')")
    r = _run_runner(tmp_path / "missing.jsonl", script)
    assert r.returncode == 2
    obj = json.loads(r.stdout)
    assert obj["type"] == "file_not_found"


def test_runner_injects_session_and_exec(tmp_path):
    """运行器注入 s/Session/encode/decode 并 exec 查询脚本。"""
    jsonl = _forked_session(tmp_path)
    script = tmp_path / "q.py"
    script.write_text(
        "print(s.leaf()['id'])\n"
        "print(Session.__name__)\n"
        "assert callable(encode) and callable(decode)\n"
    )
    r = _run_runner(jsonl, script)
    assert r.returncode == 0, r.stderr
    assert r.stdout.strip().splitlines() == ["b3", "Session"]


def test_runner_toon_output(tmp_path):
    """查询脚本用 encode 输出 TOON 格式（tabular array）。"""
    jsonl = _forked_session(tmp_path)
    script = tmp_path / "q.py"
    script.write_text(
        "leaves = [{'id': e['id'], 'role': e.get('role')} for e in s.branch_leaves()]\n"
        "print(encode(leaves))\n"
    )
    r = _run_runner(jsonl, script)
    assert r.returncode == 0, r.stderr
    out = r.stdout
    assert "]{id,role" in out  # TOON tabular header（非 JSON 降级）
    assert "a5" in out and "b3" in out


def test_runner_query_error_exit1(tmp_path):
    """查询脚本抛异常 -> 结构化错误 exit 1，含 traceback。"""
    jsonl = _forked_session(tmp_path)
    script = tmp_path / "q.py"
    script.write_text("raise ValueError('boom')\n")
    r = _run_runner(jsonl, script)
    assert r.returncode == 1
    obj = json.loads(r.stdout)
    assert obj["type"] == "query_error"
    assert "ValueError" in obj["message"]
    assert "traceback" in obj


def test_runner_main_guard_works(tmp_path):
    """exec 时 __name__='__main__'，查询脚本的 if __name__ 守卫生效。"""
    jsonl = _forked_session(tmp_path)
    script = tmp_path / "q.py"
    script.write_text("if __name__ == '__main__':\n    print(s.header()['id'])\n")
    r = _run_runner(jsonl, script)
    assert r.returncode == 0, r.stderr
    assert r.stdout.strip() == "s1"


def test_runner_v1_rejected_exit1(tmp_path):
    """v1 会话 -> 结构化错误 exit 1，指出 version。"""
    p = _write_session(
        tmp_path,
        [
            {"type": "session", "version": 1, "id": "s", "timestamp": "t", "cwd": "/p"},
            _msg("a1", None, "user", [{"type": "text", "text": "hi"}]),
        ],
    )
    script = tmp_path / "q.py"
    script.write_text("print('unreached')")
    r = _run_runner(p, script)
    assert r.returncode == 1
    obj = json.loads(r.stdout)
    assert obj["type"] == "unsupported_version"
    assert obj["version"] == 1


# ── Slice 7: 脚本传入方式与 session id 解析 ──────────────────────────────


def _sessions_tree(tmp_path: Path, session_id: str) -> Path:
    """构造 Pi 风格 sessions 目录：<root>/<slug>/<ts>_<id>.jsonl，返回 root。

    文件内容复用 _forked_session，但 header id 改写为 session_id，使文件名 id
    与内容 id 一致（便于测试断言 s.header()['id'] == session_id）。
    """
    root = tmp_path / "sessions"
    sub = root / "proj"
    sub.mkdir(parents=True)
    raw_lines = _forked_session(tmp_path).read_text(encoding="utf-8").splitlines()
    header = json.loads(raw_lines[0])
    header["id"] = session_id
    raw_lines[0] = json.dumps(header, ensure_ascii=False)
    (sub / f"2024-01-01T00-00-00Z_{session_id}.jsonl").write_text(
        "\n".join(raw_lines) + "\n", encoding="utf-8"
    )
    return root


def test_runner_inline_code(tmp_path):
    """-c/--code 内联脚本：注入的 s 可用。"""
    jsonl = _forked_session(tmp_path)
    r = _run_runner(jsonl, extra_args=["-c", "print(s.leaf()['id'])"])
    assert r.returncode == 0, r.stderr
    assert r.stdout.strip() == "b3"


def test_runner_inline_code_long_form(tmp_path):
    jsonl = _forked_session(tmp_path)
    r = _run_runner(jsonl, extra_args=["--code", "print(s.header()['id'])"])
    assert r.returncode == 0, r.stderr
    assert r.stdout.strip() == "s1"


def test_runner_stdin_script(tmp_path):
    """- 表 stdin：从 stdin 读脚本源。"""
    jsonl = _forked_session(tmp_path)
    r = _run_runner(jsonl, script=Path("-"), stdin="print(s.leaf()['id'])\n")
    assert r.returncode == 0, r.stderr
    assert r.stdout.strip() == "b3"


def test_runner_session_id_resolves(tmp_path):
    """session 传 id：去 PI_SESSIONS_DIR glob *_<id>.jsonl 自动定位。"""
    sid = "019fabcd-0000-0000-0000-000000000000"
    root = _sessions_tree(tmp_path, sid)
    r = _run_runner(
        sid, extra_args=["-c", "print(s.header()['id'])"], env={"PI_SESSIONS_DIR": str(root)}
    )
    assert r.returncode == 0, r.stderr
    assert r.stdout.strip() == sid


def test_runner_session_not_found_exit2(tmp_path):
    """id 无匹配 -> session_not_found exit 2。"""
    root = _sessions_tree(tmp_path, "real-id")
    r = _run_runner("no-such-id", extra_args=["-c", "print(1)"], env={"PI_SESSIONS_DIR": str(root)})
    assert r.returncode == 2
    obj = json.loads(r.stdout)
    assert obj["type"] == "session_not_found"
    assert obj["id"] == "no-such-id"


def test_runner_ambiguous_session_exit2(tmp_path):
    """同 id 多文件 -> ambiguous_session exit 2，列出候选。"""
    root = tmp_path / "sessions"
    for sub in ("dir1", "dir2"):
        d = root / sub
        d.mkdir(parents=True)
        (d / "2024-01-01T00-00-00Z_dup.jsonl").write_text(
            _forked_session(tmp_path).read_text(encoding="utf-8"), encoding="utf-8"
        )
    r = _run_runner("dup", extra_args=["-c", "print(1)"], env={"PI_SESSIONS_DIR": str(root)})
    assert r.returncode == 2
    obj = json.loads(r.stdout)
    assert obj["type"] == "ambiguous_session"
    assert len(obj["matches"]) == 2


def test_runner_script_and_code_mutually_exclusive(tmp_path):
    """同时给脚本路径和 -c -> usage exit 2。"""
    jsonl = _forked_session(tmp_path)
    script = tmp_path / "q.py"
    script.write_text("print('hi')")
    r = _run_runner(jsonl, script, extra_args=["-c", "print(1)"])
    assert r.returncode == 2
    obj = json.loads(r.stdout)
    assert obj["type"] == "usage"


def test_runner_no_script_no_code(tmp_path):
    """只传 session、无 script/code -> usage exit 2（script nargs='?' 新分支）。"""
    jsonl = _forked_session(tmp_path)
    r = _run_runner(jsonl)
    assert r.returncode == 2
    obj = json.loads(r.stdout)
    assert obj["type"] == "usage"


# ── 真实数据 smoke test ──────────────────────────────────────────────────────


def test_smoke_real_session():
    """真实 pi 会话文件：能解析、版本 v3、主路径非空、leaf=path 末端。"""
    f = _find_real_session()
    if f is None:
        pytest.skip("无真实 pi 会话文件 (~/.pi/agent/sessions)")
    s = query.Session(f)
    assert s.header()["version"] == 3
    p = s.path()
    assert len(p) > 0
    assert s.leaf()["id"] == p[-1]["id"]
    # 树结构自洽：每个非根 entry 的 parentId 在 path 回溯可达根
    assert s.parent_chain(s.leaf()["id"])[-1]["id"] == p[0]["id"]


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-v"]))

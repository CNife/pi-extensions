#!/usr/bin/env uv run
# /// script
# requires-python = ">=3.11"
# dependencies = ["pytest>=8"]
# ///
"""subagent.py 的测试 - 翻译器（主 seam）+ 端到端冒烟（辅 seam）。

运行：cd <skill目录> && uv run --script tests/test_subagent.py

测试哲学（沿用 pi-session-query test_query.py 先例）：只测外部行为，期望值来自
原型验证的 frontmatter->参数契约 + 构造场景，独立于实现。

两 seam：
- 主 seam（纯、无需 herdr）：frontmatter->参数翻译器，模块 import 测。喂三个真实 .md
  的 frontmatter 契约（explorer/reviewer 用 tools、worker 用 deny-tools 且无 tools），
  断言发出的 pi 参数。
- 辅 seam（集成、需 HERDR_SUBAGENT_E2E=1 且 HERDR_ENV=1 + pi）：端到端 CLI 冒烟，对只读
  explorer 跑 spawn/task/wait/result/close，断言抽出的结果非空且干净。无门控则跳过。
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
import subagent

SCRIPT_DIR = Path(__file__).resolve().parent
SUBAGENT_PY = SCRIPT_DIR.parent / "scripts" / "subagent.py"


# ── 三个真实 agent .md 的 frontmatter 契约（照 ~/.pi/agent/agents/ 原件复制）────────

_EXPLORER_MD = """\
---
name: explorer
description: 只读探索代码库或联网调研外部信息，返回有证据的摘要。不进行编辑。
model: opencode-go/deepseek-v4-flash
thinking: high
tools: read, ffgrep, fffind, ls, web_search, web_fetch, nmem_search, nmem_read_thread
spawning: false
auto-exit: true
session-mode: standalone
---

# 角色

你负责收集事实、返回证据，不做判断。
"""

_REVIEWER_MD = """\
---
name: reviewer
description: 只读审查代码变更（diff/PR/提交）或 agent 指令/文档，提供基于证据的发现。
model: ark-coding-plan/glm-5.2
thinking: max
tools: bash, ffgrep, fffind
spawning: false
auto-exit: true
session-mode: standalone
---

# 角色

你负责对变更给出判断。
"""

_WORKER_MD = """\
---
name: worker
description: 简单任务的执行者。
model: opencode-go/deepseek-v4-flash
thinking: max
deny-tools: advisor, nmem_save_memory
spawning: false
auto-exit: true
session-mode: standalone
---

# 角色

你负责执行明确任务，不做设计决策。
"""


def _write(tmp_path: Path, name: str, content: str) -> Path:
    p = tmp_path / name
    p.write_text(content, encoding="utf-8")
    return p


# ── Slice 1: parse_agent_md ─────────────────────────────────────────────────


def test_parse_splits_frontmatter_and_body(tmp_path):
    p = _write(tmp_path, "explorer.md", _EXPLORER_MD)
    fm, body = subagent.parse_agent_md(p)
    assert fm["name"] == "explorer"
    assert fm["model"] == "opencode-go/deepseek-v4-flash"
    assert fm["thinking"] == "high"
    assert (
        fm["tools"]
        == "read, ffgrep, fffind, ls, web_search, web_fetch, nmem_search, nmem_read_thread"
    )
    assert "# 角色" in body
    assert "---" not in body.splitlines()[0]


def test_parse_frontmatter_strips_values(tmp_path):
    """frontmatter 值前后空格剥除；body 保留原样。"""
    p = _write(tmp_path, "x.md", "---\nname:  spaced  \nmodel:  a/b  \n---\n\nbody line\n")
    fm, body = subagent.parse_agent_md(p)
    assert fm["name"] == "spaced"
    assert fm["model"] == "a/b"
    assert body.startswith("\nbody line")


def test_parse_no_frontmatter_treats_all_as_body(tmp_path):
    """无 --- 开头：整体当 body，frontmatter 为空 dict。"""
    p = _write(tmp_path, "x.md", "# just a role\nno frontmatter\n")
    fm, body = subagent.parse_agent_md(p)
    assert fm == {}
    assert "just a role" in body


# ── Slice 2: derive_name ────────────────────────────────────────────────────


def test_derive_name_lowercase_stem(tmp_path):
    p = _write(tmp_path, "Explorer.md", "---\n---\n")
    assert subagent.derive_name(p) == "explorer"


def test_derive_name_replaces_invalid_chars(tmp_path):
    """herdr 名必须匹配 [a-z][a-z0-9_-]{0,31}；非法字符替成 -。"""
    p = _write(tmp_path, "My Agent.md", "---\n---\n")
    assert subagent.derive_name(p) == "my-agent"


def test_derive_name_truncates_long_stem(tmp_path):
    p = _write(tmp_path, "a" * 40 + ".md", "---\n---\n")
    n = subagent.derive_name(p)
    assert len(n) <= 32
    assert n[0].isalpha()


# ── Slice 3: build_pi_args - 翻译器主契约 ──────────────────────────────────


def _args_pairs(args: list[str]) -> dict[str, str]:
    """把 ['--model','x','--thinking','y'] 变 {--model: x, --thinking: y}，便于断言。"""
    pairs: dict[str, str] = {}
    i = 0
    while i < len(args) - 1:
        if args[i].startswith("--"):
            pairs[args[i]] = args[i + 1]
            i += 2
            continue
        i += 1
    return pairs


def test_explorer_translates_tools_and_append_prompt(tmp_path):
    """explorer：tools（逗号空格已剥）、model（带斜杠）、thinking、append-system-prompt 角色文件路径。"""
    p = _write(tmp_path, "explorer.md", _EXPLORER_MD)
    fm, _body = subagent.parse_agent_md(p)
    role = tmp_path / "role.md"
    args = subagent.build_pi_args(fm, role)
    pairs = _args_pairs(args)

    assert pairs["--model"] == "opencode-go/deepseek-v4-flash"
    assert pairs["--thinking"] == "high"
    # 逗号空格已剥成纯逗号分隔
    assert (
        pairs["--tools"]
        == "read,ffgrep,fffind,ls,web_search,web_fetch,nmem_search,nmem_read_thread"
    )
    # 默认 append-system-prompt 指向角色文件路径
    assert pairs["--append-system-prompt"] == str(role)
    # 不含 exclude-tools
    assert "--exclude-tools" not in pairs
    # 不含被丢字段
    assert "--no-session" not in args
    assert "--no-context-files" not in args


def test_reviewer_translates_tools_with_slash_model(tmp_path):
    p = _write(tmp_path, "reviewer.md", _REVIEWER_MD)
    fm, _body = subagent.parse_agent_md(p)
    role = tmp_path / "role.md"
    args = subagent.build_pi_args(fm, role)
    pairs = _args_pairs(args)

    assert pairs["--model"] == "ark-coding-plan/glm-5.2"
    assert pairs["--thinking"] == "max"
    assert pairs["--tools"] == "bash,ffgrep,fffind"
    assert pairs["--append-system-prompt"] == str(role)


def test_worker_translates_deny_tools_and_no_tools(tmp_path):
    """worker：deny-tools -> exclude-tools，且无 --tools。"""
    p = _write(tmp_path, "worker.md", _WORKER_MD)
    fm, _body = subagent.parse_agent_md(p)
    role = tmp_path / "role.md"
    args = subagent.build_pi_args(fm, role)
    pairs = _args_pairs(args)

    assert pairs["--model"] == "opencode-go/deepseek-v4-flash"
    assert pairs["--thinking"] == "max"
    assert pairs["--exclude-tools"] == "advisor,nmem_save_memory"
    assert "--tools" not in pairs
    assert pairs["--append-system-prompt"] == str(role)


def test_system_prompt_mode_replace_uses_system_prompt(tmp_path):
    """frontmatter system-prompt-mode: replace -> --system-prompt（替换），非默认 append。"""
    fm = {"model": "a/b", "system-prompt-mode": "replace"}
    role = tmp_path / "role.md"
    args = subagent.build_pi_args(fm, role)
    pairs = _args_pairs(args)
    assert "--system-prompt" in pairs
    assert pairs["--system-prompt"] == str(role)
    assert "--append-system-prompt" not in pairs


def test_args_omit_absent_fields(tmp_path):
    """缺字段就不发对应参数：无 model/thinking/tools 都不发。"""
    fm = {"name": "bare"}
    role = tmp_path / "role.md"
    args = subagent.build_pi_args(fm, role)
    pairs = _args_pairs(args)
    assert "--model" not in pairs
    assert "--thinking" not in pairs
    assert "--tools" not in pairs
    assert "--exclude-tools" not in pairs
    # body 永远走系统提示词（默认 append）
    assert pairs["--append-system-prompt"] == str(role)


def test_tools_whitespace_variants_collapsed(tmp_path):
    """逗号+任意空格都剥成纯逗号；空段过滤。"""
    fm = {"tools": " read , ffgrep ,, ls "}
    role = tmp_path / "role.md"
    args = subagent.build_pi_args(fm, role)
    assert _args_pairs(args)["--tools"] == "read,ffgrep,ls"


def test_ignored_fields_not_emitted(tmp_path):
    """name/description/spawning/auto-exit/session-mode 是被丢字段，不出现在 args。"""
    fm = {
        "name": "x",
        "description": "人读",
        "model": "a/b",
        "spawning": "false",
        "auto-exit": "true",
        "session-mode": "standalone",
    }
    role = tmp_path / "role.md"
    args = subagent.build_pi_args(fm, role)
    # 没有 --spawning/--auto-exit 之类（pi 不认）；只该有 --model + --append-system-prompt
    flags = {a for a in args if a.startswith("--")}
    assert flags == {"--model", "--append-system-prompt"}


# ── Slice 4: CLI 派发 - 结构化错误 ──────────────────────────────────────────


def _run_cli(*args: str, env: dict[str, str] | None = None) -> subprocess.CompletedProcess:
    run_env = None if env is None else {**os.environ, **env}
    return subprocess.run(
        ["uv", "run", "--script", str(SUBAGENT_PY), *args],
        capture_output=True,
        text=True,
        cwd=SCRIPT_DIR.parent,
        timeout=60,
        env=run_env,
        check=False,
    )


def test_cli_no_subcommand_usage_exit2():
    r = _run_cli()
    assert r.returncode == 2
    obj = json.loads(r.stdout)
    assert obj["error"] is True
    assert obj["type"] == "usage"


def test_cli_unknown_subcommand_usage_exit2():
    r = _run_cli("frobnicate")
    assert r.returncode == 2
    assert json.loads(r.stdout)["type"] == "usage"


def test_cli_spawn_missing_md_file_exit2(tmp_path):
    r = _run_cli("spawn", str(tmp_path / "nope.md"))
    assert r.returncode == 2
    obj = json.loads(r.stdout)
    assert obj["type"] == "file_not_found"


# ── 辅 seam：端到端冒烟（门控） ─────────────────────────────────────────────


def _e2e_enabled() -> bool:
    return os.environ.get("HERDR_ENV") == "1" and os.environ.get("HERDR_SUBAGENT_E2E") == "1"


@pytest.mark.skipif(not _e2e_enabled(), reason="需 HERDR_ENV=1 且 HERDR_SUBAGENT_E2E=1")
def test_e2e_explorer_round_trip(tmp_path):
    """对只读 explorer 跑 spawn/task/wait/result/close，结果非空且干净。"""
    # 用临时副本避免改原件
    md = _write(tmp_path, "explorer.md", _EXPLORER_MD)
    repo_root = SCRIPT_DIR.parent.parent.parent
    readme = repo_root / "README.md"
    assert readme.is_file(), "E2E 需要仓库 README.md 存在"

    name = "e2e-explorer"
    try:
        spawn = _run_cli("spawn", str(md), "--name", name)
        assert spawn.returncode == 0, spawn.stderr
        sp = json.loads(spawn.stdout)
        assert sp["name"] == name
        assert sp["tab"]
        assert sp["pane"]
        assert sp["workdir"]

        task_text = f"读取 {readme} 的第一行，把该行原文作为最终回复。不要写任何文件。"
        task = _run_cli("task", name, task_text)
        assert task.returncode == 0, task.stderr
        assert json.loads(task.stdout)["sent"] is True

        wait = _run_cli("wait", name, "--timeout", "120000")
        assert wait.returncode == 0, wait.stderr
        w = json.loads(wait.stdout)
        assert w["name"] == name
        assert w["state"] in {"idle", "done", "blocked"}

        result = _run_cli("result", name)
        assert result.returncode == 0, result.stderr
        text = json.loads(result.stdout)["text"]
        assert text and text.strip(), "结果不应为空"
        assert "CNife" in text  # README 第一行
        assert "Model scope" not in text  # 干净：无 pi 启动横幅（抽取 bug 回归保护）
    finally:
        _run_cli("close", name)  # 幂等清理


@pytest.mark.skipif(not _e2e_enabled(), reason="需 HERDR_ENV=1 且 HERDR_SUBAGENT_E2E=1")
def test_e2e_close_is_idempotent(tmp_path):
    """close 幂等：重复清理不报错。"""
    md = _write(tmp_path, "explorer.md", _EXPLORER_MD)
    name = "e2e-close"
    try:
        sp = json.loads(_run_cli("spawn", str(md), "--name", name).stdout)
        assert sp["name"] == name
        c1 = _run_cli("close", name)
        assert c1.returncode == 0, c1.stderr
        assert json.loads(c1.stdout)["ok"] is True
        c2 = _run_cli("close", name)
        assert c2.returncode == 0, c2.stderr  # 再 close 不报错
        assert json.loads(c2.stdout)["ok"] is True
    finally:
        _run_cli("close", name)


@pytest.mark.skipif(not _e2e_enabled(), reason="需 HERDR_ENV=1 且 HERDR_SUBAGENT_E2E=1")
def test_e2e_parallel_two_explorers(tmp_path):
    """并行 E2E：两个 explorer 同时跑，轮流 wait/result/close 直到 exhausted。

    覆盖 wait 的并行接手语义：settled 后必须 result+close 成对才让位，
    全部处理完 wait 返回 exhausted；同时验证已 close 的死名字不挡路。
    """
    md = _write(tmp_path, "explorer.md", _EXPLORER_MD)
    repo_root = SCRIPT_DIR.parent.parent.parent
    readme = repo_root / "README.md"
    assert readme.is_file(), "E2E 需要仓库 README.md 存在"

    names = ["e2e-par-a", "e2e-par-b"]
    try:
        for n in names:
            sp = json.loads(_run_cli("spawn", str(md), "--name", n).stdout)
            assert sp["name"] == n

        for n in names:
            task_text = f"读取 {readme} 的第一行，把该行原文作为最终回复。不要写任何文件。"
            t = _run_cli("task", n, task_text)
            assert json.loads(t.stdout)["sent"] is True

        # 逐个接手：wait → result → close，直到 exhausted
        got: dict[str, str] = {}
        for _ in range(4):  # 2 轮接手 + 尾部 exhausted，留 1 轮余量
            w = json.loads(_run_cli("wait", *names, "--timeout", "120000").stdout)
            if w["state"] == "exhausted":
                break
            assert w["name"] in names, f"不应返回死名字: {w}"
            r = json.loads(_run_cli("result", w["name"]).stdout)
            got[w["name"]] = r["text"]
            c = _run_cli("close", w["name"])
            assert json.loads(c.stdout)["ok"] is True
        else:
            raise AssertionError("未等到 exhausted，wait 可能卡在已处理的名字上")

        assert set(got) == set(names), f"两个结果都应取到: {got}"
        for text in got.values():
            assert text and text.strip(), "结果不应为空"
            assert "CNife" in text
            assert "Model scope" not in text  # 干净：无启动横幅
    finally:
        for n in names:
            _run_cli("close", n)


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-v"]))

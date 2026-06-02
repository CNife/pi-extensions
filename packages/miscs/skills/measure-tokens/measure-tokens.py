#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = [
#   "deepseek-tokenizer",
#   "tiktoken",
# ]
# ///

"""
测量 pi 工具的 token 开销。

用法:
  uv run measure-tokens.py                              # 完整流程: 捕获 → 分析 → 报告
  uv run measure-tokens.py --analyze-only                # 只分析已有 payload
  uv run measure-tokens.py --analyze-only --dir <path>   # 从指定目录分析 payload
  uv run measure-tokens.py --tokenizer cl100k_base       # 指定分词器
  uv run measure-tokens.py --tokenizer auto              # 从 payload model 字段自动识别
  uv run measure-tokens.py --help                        # 显示此帮助

支持的分词器:
  deepseek     DeepSeek 自研分词器 (vocab=128818), 对中文高效
  cl100k_base  OpenAI GPT-4 分词器 (vocab=100k)
  o200k_base   OpenAI o1 / GPT-4o 分词器 (vocab=200k)
  auto         从 payload model 字段自动识别, 默认 deepseek
"""

import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

# ── Tokenizer selection ──────────────────────────────────────
_TOKENIZER_NAME = "deepseek"  # default, may be overridden by --tokenizer
_ENCODER = None

def _load_tokenizer(name: str):
    """Load the specified tokenizer. Called once at startup."""
    global _ENCODER, _TOKENIZER_NAME
    _TOKENIZER_NAME = name
    if name == "deepseek":
        from deepseek_tokenizer import ds_token
        _ENCODER = ds_token
    elif name == "cl100k_base":
        from tiktoken import get_encoding
        _ENCODER = get_encoding("cl100k_base")
    elif name == "o200k_base":
        from tiktoken import get_encoding
        _ENCODER = get_encoding("o200k_base")
    else:
        raise ValueError(f"Unknown tokenizer: {name}")

def t(s: str) -> int:
    """Encode and return token count."""
    if _ENCODER is None:
        _load_tokenizer("deepseek")
    return len(_ENCODER.encode(s))

def detect_tokenizer_from_model(model_name: str) -> str:
    """Heuristic: detect which tokenizer is appropriate for a model."""
    model_lower = model_name.lower()
    if any(k in model_lower for k in ("deepseek", "mimo")):
        return "deepseek"
    elif any(k in model_lower for k in ("gpt-4", "gpt-3.5", "cl100k")):
        return "cl100k_base"
    return "deepseek"  # fallback


DEBUG_DIR = Path("/tmp/pi-token-measure")  # may be overridden by --dir
SOCKET_DIR = Path("/tmp/claude-tmux-sockets")
SOCKET = SOCKET_DIR / "claude.sock"
SESSION = "pi-measure-tokens"
TARGET = f"{SESSION}:1.1"

# ── CLI arg parsing ──────────────────────────────────────────

def parse_args():
    args = {"analyze_only": False, "tokenizer": "deepseek", "dir": None}
    i = 1
    while i < len(sys.argv):
        arg = sys.argv[i]
        if arg in ("--help", "-h"):
            print(__doc__.strip())
            sys.exit(0)
        elif arg == "--analyze-only":
            args["analyze_only"] = True
        elif arg == "--tokenizer":
            i += 1
            if i < len(sys.argv):
                args["tokenizer"] = sys.argv[i]
        elif arg == "--dir":
            i += 1
            if i < len(sys.argv):
                args["dir"] = sys.argv[i]
        i += 1
    return args


# ── Phase 1: Capture ──────────────────────────────────────────

def clean():
    if DEBUG_DIR.exists():
        shutil.rmtree(DEBUG_DIR)
    DEBUG_DIR.mkdir(parents=True)
    SOCKET_DIR.mkdir(parents=True, exist_ok=True)

def start_pi():
    subprocess.run(["tmux", "-S", str(SOCKET), "kill-session", "-t", SESSION], capture_output=True)
    time.sleep(0.3)
    subprocess.run(["tmux", "-S", str(SOCKET), "new", "-d", "-s", SESSION], capture_output=True)
    time.sleep(0.3)
    subprocess.run(["tmux", "-S", str(SOCKET), "send-keys", "-t", TARGET, "--",
                    f"export PI_DEBUG_REQUEST_BODY={DEBUG_DIR} && pi"], capture_output=True)
    print(f"  pi started, debug at {DEBUG_DIR}")

def send(text: str):
    subprocess.run(["tmux", "-S", str(SOCKET), "send-keys", "-t", TARGET, "--", text], capture_output=True)

def capture(lines: int = 50) -> str:
    r = subprocess.run(["tmux", "-S", str(SOCKET), "capture-pane", "-p", "-J", "-t", TARGET,
                        "-S", f"-{lines}"], capture_output=True, text=True)
    return r.stdout

def wait_output(pattern: str, timeout: int = 60) -> bool:
    import re
    deadline = time.time() + timeout
    while time.time() < deadline:
        if re.search(pattern, capture(100), re.IGNORECASE):
            return True
        time.sleep(1)
    return False


# ── Phase 2: Analyze ──────────────────────────────────────────

def analyze() -> dict:
    files = sorted(DEBUG_DIR.glob("*.json"))
    if not files:
        return {"from_payload": False}

    print(f"\n  Found {len(files)} payload files")

    try:
        with open(files[0]) as f:
            base = json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        print(f"  ⚠ Failed to load payload: {e}")
        return {"from_payload": False}

    sys_msg = base["messages"][0]["content"] if base.get("messages") else ""
    tools_list = base.get("tools", [])
    model_name = base.get("model", "")

    # Tool definitions from payload
    ask_tool = todo_tool = None
    for te in tools_list:
        fn = te.get("function", te)
        n = fn.get("name", "")
        if n == "ask_user_question":
            ask_tool = json.dumps(te, ensure_ascii=False)
        elif n == "todo":
            todo_tool = json.dumps(te, ensure_ascii=False)

    ask_args = ask_result = ""
    todo_calls = []
    for fp in files:
        try:
            with open(fp) as f:
                data = json.load(f)
        except (json.JSONDecodeError, OSError) as e:
            print(f"  ⚠ Skipping corrupted payload {fp.name}: {e}")
            continue
        for msg in data.get("messages", []):
            for tc in msg.get("tool_calls", []):
                fn = tc.get("function", {})
                n = fn.get("name", "")
                if n == "ask_user_question" and not ask_args:
                    ask_args = fn.get("arguments", "")
                elif n == "todo" and fn.get("arguments", "") not in todo_calls:
                    todo_calls.append(fn.get("arguments", ""))
            if msg["role"] == "tool":
                ct = msg.get("content", "")
                if "User has answered your questions" in ct:
                    ask_result = ct

    ask_g = todo_g = ""
    if "Use ask_user_question whenever" in sys_msg:
        s = sys_msg.find("Use ask_user_question whenever")
        e = sys_msg.find("\n- Use `todo`")
        if e > s: ask_g = sys_msg[s:e].strip()
    if "Use `todo` for complex" in sys_msg:
        s = sys_msg.find("Use `todo` for complex")
        e = sys_msg.find("\n- Be concise in your")
        if e > s: todo_g = sys_msg[s:e].strip()

    return {
        "ask_tool": ask_tool, "todo_tool": todo_tool,
        "ask_args": ask_args, "ask_result": ask_result,
        "ask_guide": ask_g, "todo_guide": todo_g,
        "todo_calls": todo_calls,
        "model_name": model_name,
        "from_payload": True,
    }


def compute(data: dict) -> dict:
    # ── All-tools static from payload ──
    all_tools = []
    sys_tok = 0
    if data["from_payload"]:
        files = sorted(DEBUG_DIR.glob("*.json"))
        try:
            with open(files[0]) as f:
                base = json.load(f)
        except (json.JSONDecodeError, OSError) as e:
            print(f"  ⚠ Failed to reload payload: {e}")
            base = {}
        sys_content = base["messages"][0]["content"]
        sys_tok = t(sys_content)
        for te in base.get("tools", []):
            fn = te.get("function", te)
            full_tok = t(json.dumps(te, ensure_ascii=False))
            desc_tok = t(fn.get("description", ""))
            params_tok = t(json.dumps(fn.get("parameters", {}), ensure_ascii=False))
            all_tools.append({"name": fn.get("name", "?"), "full": full_tok,
                              "desc": desc_tok, "params": params_tok})
        all_tools.sort(key=lambda x: x["full"], reverse=True)

    total_all_tools = sum(x["full"] for x in all_tools)

    if data["from_payload"] and data.get("ask_tool") and data.get("todo_tool"):
        ask_tok = t(data["ask_tool"])
        todo_tok = t(data["todo_tool"])
    else:
        ask_tok = 910
        todo_tok = 505

    ask_g_tok = t(data["ask_guide"]) if data.get("ask_guide") else 0
    todo_g_tok = t(data["todo_guide"]) if data.get("todo_guide") else 0

    ask_ol = t("ask_user_question: Ask the user up to 4 structured questions (2-4 options each) when requirements are ambiguous")
    todo_ol = t("todo: Manage a task list to track multi-step progress")

    aa_tok = t(data["ask_args"]) if data.get("ask_args") else 0
    ar_tok = t(data["ask_result"]) if data.get("ask_result") else 0
    todo_toks = [t(c) for c in data.get("todo_calls", [])]

    static_rpiv = ask_tok + todo_tok + ask_g_tok + todo_g_tok + ask_ol + todo_ol

    return {
        "tokenizer": _TOKENIZER_NAME,
        "all_tools": all_tools,
        "total_all_tools": total_all_tools,
        "sys_tok": sys_tok,
        "vocab": getattr(_ENCODER, 'vocab_size', None) or getattr(_ENCODER, 'max_token_value', None) or 100000,
        "ask_tok": ask_tok,
        "todo_tok": todo_tok,
        "ask_g_tok": ask_g_tok,
        "todo_g_tok": todo_g_tok,
        "ask_ol": ask_ol,
        "todo_ol": todo_ol,
        "ask_args_tok": aa_tok,
        "ask_result_tok": ar_tok,
        "todo_toks": todo_toks,
        "static_rpiv": static_rpiv,
        "payload_count": len(list(DEBUG_DIR.glob("*.json"))) if data["from_payload"] else 0,
    }


def report(r: dict):
    avg_c = sum(r["todo_toks"]) // len(r["todo_toks"]) if r["todo_toks"] else 0
    ask_static = r["ask_tok"] + r["ask_g_tok"] + r["ask_ol"]
    todo_static = r["todo_tok"] + r["todo_g_tok"] + r["todo_ol"]
    ask_dyn = r["ask_args_tok"] + r["ask_result_tok"]

    print()
    print("=" * 62)
    tk_name = r["tokenizer"]
    tk_vocab = f", vocab={r['vocab']}" if r['vocab'] else ""
    print(f"  Token Overhead Report  ({tk_name}{tk_vocab})")
    src = f"{r['payload_count']} payloads" if r["payload_count"] else "fallback strings"
    print(f"  Source: {src}")
    print("=" * 62)

    # ── All tools ranking ──
    if r["all_tools"]:
        print()
        print("  ┌─ All Tools Static Overhead (tools[] JSON) ────────────┐")
        print(f"  │ {'Tool':<28s} {'Full':>6s} {'Desc':>6s} {'Params':>6s} │")
        print(f"  │ {'─'*28} {'─'*6} {'─'*6} {'─'*6} │")
        for ts in r["all_tools"]:
            tag = "  ← rpiv" if ts["name"] in ("ask_user_question", "todo") else ""
            print(f"  │ {ts['name']:<28s} {ts['full']:>6d} {ts['desc']:>6d} {ts['params']:>6d}{tag}")
        print(f"  │ {'─'*28} {'─'*6} {'─'*6} {'─'*6} │")
        print(f"  │ {'Total':<28s} {r['total_all_tools']:>6d}                         │")
        print(f"  └──────────────────────────────────────────────────────┘")
        if r["sys_tok"]:
            non_tool = r["sys_tok"] - r["total_all_tools"]
            print(f"  System prompt: {r['sys_tok']:>6d} tokens total")
            print(f"  ├─ tools[] definitions: {r['total_all_tools']:>6d} ({r['total_all_tools']/r['sys_tok']*100:.1f}%)")
            print(f"  │   └─ rpiv tools:       {r['ask_tok']+r['todo_tok']:>6d} ({(r['ask_tok']+r['todo_tok'])/r['sys_tok']*100:.1f}%)")
            print(f"  └─ other (instructions,   {non_tool:>6d} ({non_tool/r['sys_tok']*100:.1f}%)")
            print(f"      skills, context, etc.)")

    print()
    print("  ┌─ rpiv Tools Focus ────────────────────────────────────┐")
    print(f"  │  ask_user_question tool JSON:     {r['ask_tok']:>5d} tokens            │")
    print(f"  │  todo tool JSON:                  {r['todo_tok']:>5d} tokens            │")
    print(f"  │  ask guidelines (4 rules):        {r['ask_g_tok']:>5d} tokens            │")
    print(f"  │  todo guidelines (7 rules):       {r['todo_g_tok']:>5d} tokens            │")
    print(f"  │  one-liner refs (ask+todo):        {r['ask_ol']+r['todo_ol']:>5d} tokens            │")
    print(f"  ├──────────────────────────────────────────────────────┤")
    print(f"  │  Subtotal (rpiv static):          {r['static_rpiv']:>5d} tokens            │")
    print(f"  └──────────────────────────────────────────────────────┘")
    print()
    print("  ┌─ Dynamic Overhead ────────────────────────────────────┐")
    print(f"  │  ask_user_question (4 questions, ~3 options each):   │")
    print(f"  │    call arguments:            {r['ask_args_tok']:>5d} tokens               │")
    print(f"  │    tool result:               {r['ask_result_tok']:>5d} tokens               │")
    print(f"  │    subtotal:                 ~{ask_dyn:>5d} tokens               │")
    print(f"  ├──────────────────────────────────────────────────────┤")
    print(f"  │  todo: {len(r['todo_toks'])} creates                                  │")
    for i, tok in enumerate(r["todo_toks"]):
        print(f"  │    #{i+1}: {tok:>5d} tokens                                  │")
    print(f"  │    avg:                      ~{avg_c:>5d} tokens/call               │")
    print(f"  └──────────────────────────────────────────────────────┘")
    print()
    print("  ┌─ Decision Guide (per round) ─────────────────────────┐")
    ROUNDING_BUFFER = 100  # unmeasured tool call overhead buffer
    both = ask_static + ask_dyn + todo_static + avg_c * 3 + ROUNDING_BUFFER
    print(f"  │  ask_user_question only:      {ask_static+ask_dyn:>5d} tokens/round        │")
    print(f"  │  todo only (3 ops):           {todo_static+avg_c*3+100:>5d} tokens/round        │")
    print(f"  │  both tools used:             {both:>5d} tokens/round        │")
    print(f"  │  rpiv static only:            {r['static_rpiv']:>5d} tokens/round        │")
    print(f"  │  ALL tools static (13 tools):  {r['total_all_tools']:>5d} tokens/round        │")
    print(f"  ├──────────────────────────────────────────────────────┤")
    print(f"  │  128K context:  ~{128000//both:>3d} rounds (both tools)        │")
    print(f"  └──────────────────────────────────────────────────────┘")


# ── CLI ────────────────────────────────────────────────────────

def main():
    args = parse_args()

    # Apply --dir override
    global DEBUG_DIR
    if args["dir"]:
        DEBUG_DIR = Path(args["dir"])

    # Initialize tokenizer
    if args["tokenizer"] == "auto":
        if not args["analyze_only"]:
            print("  ⚠ --tokenizer auto only applies in --analyze-only mode; using deepseek for capture")
        # Defer to after payload analysis for model detection
    else:
        _load_tokenizer(args["tokenizer"])

    if args["analyze_only"]:
        print(f"Tokenizer: {args['tokenizer']}")
        data = analyze()
        if args["tokenizer"] == "auto" and data.get("model_name"):
            detected = detect_tokenizer_from_model(data["model_name"])
            print(f"  Auto-detected from model '{data['model_name']}': {detected}")
            _load_tokenizer(detected)
        elif args["tokenizer"] == "auto":
            _load_tokenizer("deepseek")
        r = compute(data)
        report(r)
        return

    print("Phase 1/3: Capturing data")
    clean()
    start_pi()
    if not wait_output(r"╰─", timeout=45):
        print("  ⚠ pi may not have started fully")
        # Continue anyway — best-effort capture
    time.sleep(3)

    send("帮我设计一个笔记方案。每天写技术笔记，需要快速搜索、标签、导出PDF。纠结用 Notion 还是本地文件。先问清楚需求再给建议。")
    if wait_output(r"ask_user_question", timeout=45):
        print("  ✓ ask_user_question triggered, answering...")
        time.sleep(2)
        # Answer questions dynamically — send Enter for each question
        import re
        for q in range(4):
            pane_before = capture(50)
            send("Enter")
            time.sleep(1.5)
            pane_after = capture(50)
            if q < 3:
                send("Tab")
                time.sleep(0.5)
            # If pane content didn't change, assume no more questions
            if pane_before == pane_after:
                break
        send("Enter")
        time.sleep(4)
        print("  ✓ questionnaire answered")
    else:
        print("  ⚠ ask_user_question not triggered")

    if wait_output(r"需要我帮你|推荐|方案", timeout=60):
        print("  Response received, triggering todo...")
    time.sleep(2)
    send("做一个研究项目：对比分析 Docker、Podman、containerd。分三个阶段：收集资料、对比分析、写总结报告。请用 todos 管理任务进度。")
    if wait_output(r"todo|Todos|Created #", timeout=45):
        print("  ✓ todo triggered")
    else:
        print("  ⚠ todo not triggered")

    time.sleep(3)
    send("C-d")
    time.sleep(2)
    subprocess.run(["tmux", "-S", str(SOCKET), "kill-session", "-t", SESSION], capture_output=True)
    print("  Data capture complete.\n")

    print("Phase 2/3: Analyzing")
    data = analyze()
    print("\nPhase 3/3: Report")
    r = compute(data)
    report(r)


if __name__ == "__main__":
    main()

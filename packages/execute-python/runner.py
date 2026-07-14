"""Persistent Python kernel runner for the execute-python extension.

NDJSON-over-stdio protocol (one JSON object per line):

  Host -> runner:
    {"id": "<rid>", "code": "<src>"}   execute one cell
    {"type": "exit"}                    graceful shutdown

  Runner -> host (all response frames carry the request id except "ready"):
    {"type": "ready"}
    {"type": "started", "id": "<rid>", "count": <int>}
    {"type": "stream", "id": "<rid>", "stream": "stdout"|"stderr", "data": "<str>"}
    {"type": "display", "id": "<rid>", "data": "<repr>"}
    {"type": "done", "id": "<rid>", "exit_code": <int>,
     "error": null | {"name","value","traceback"}, "cancelled": <bool>}

IPC channel: a duplicated real stdout (fd 1). User code's sys.stdout is
redirected to a frame emitter, so user print() never corrupts the NDJSON
control stream.

SIGINT strategy:
  - Idle (blocked on stdin.readline): SIG_IGN -> SIGINT is a no-op.
  - Executing user code: default_int_handler -> raises KeyboardInterrupt,
    caught here -> done(cancelled=true), kernel SURVIVES and reads the next
    request.

Parent watchdog: if the host dies (ppid changes), os._exit(2) so the runner
never outlives its host as an orphan.
"""

from __future__ import annotations

import ast
import json
import os
import signal
import sys
import threading
import traceback
import types

# --- IPC channel: a duplicated real stdout (fd 1). -----------------------
# User code's sys.stdout is redirected to a frame emitter below, so user
# print() never corrupts the NDJSON control stream. _ipc is the only writer
# of raw NDJSON lines.
_ipc = os.fdopen(os.dup(1), "w", buffering=1)


def _send(frame: dict) -> None:
    _ipc.write(json.dumps(frame) + "\n")
    _ipc.flush()


# --- Persistent execution namespace (state survives across cells). -------
_NS: dict = {"__name__": "__main__"}
# Current request id, threaded into stream/display frames so the host can
# correlate them with the pending execution. Set at the top of _run_cell.
_CURRENT_RID: str = ""


def display(value) -> None:
    """Output hook injected into the user namespace."""
    _send({"type": "display", "id": _CURRENT_RID, "data": repr(value)})


_NS["display"] = display


class _StreamEmitter:
    def __init__(self, name: str) -> None:
        self._name = name

    def write(self, data: str) -> int:
        if data:
            _send({"type": "stream", "id": _CURRENT_RID, "stream": self._name, "data": data})
        return len(data)

    def flush(self) -> None:
        pass

    def isatty(self) -> bool:
        return False


sys.stdout = _StreamEmitter("stdout")  # type: ignore[assignment]
sys.stderr = _StreamEmitter("stderr")  # type: ignore[assignment]


# --- Signal handling: ignore SIGINT while idle, raise while executing. ---
def _install_idle_sigint() -> None:
    try:
        signal.signal(signal.SIGINT, signal.SIG_IGN)
    except (OSError, ValueError):
        pass


def _install_exec_sigint() -> None:
    try:
        signal.signal(signal.SIGINT, signal.default_int_handler)
    except (OSError, ValueError):
        pass


_install_idle_sigint()


# --- Parent watchdog: self-terminate if reparented (host died). ----------
def _start_parent_watchdog() -> None:
    if os.name != "posix":
        return
    original_ppid = os.getppid()
    if original_ppid <= 1:
        return

    def watch() -> None:
        while True:
            try:
                if os.getppid() != original_ppid:
                    os._exit(2)
            except Exception:
                os._exit(2)
            threading.Event().wait(0.5)

    threading.Thread(target=watch, daemon=True).start()


# --- Cell execution. -----------------------------------------------------
def _compile_cell(code: str):
    """Split cell source into (exec_code, eval_expr) via AST.

    If the last top-level statement is an expression, compile the preceding
    statements as exec and the trailing expression as eval so its value can
    be auto-displayed. Otherwise compile everything as exec and return a
    None eval expression (no auto-display).

    Returns (code_object | None, code_object | None). An empty cell yields
    (None, None).
    """
    mod = ast.parse(code, "<cell>", "exec")
    if not mod.body:
        return None, None
    last = mod.body[-1]
    if isinstance(last, ast.Expr):
        if len(mod.body) > 1:
            exec_mod = ast.Module(body=mod.body[:-1], type_ignores=[])
            exec_code = compile(exec_mod, "<cell>", "exec")
        else:
            exec_code = None
        eval_code = compile(ast.Expression(body=last.value), "<cell>", "eval")
        return exec_code, eval_code
    return compile(mod, "<cell>", "exec"), None


def _run_cell(rid: str, code: str) -> None:
    global _CURRENT_RID
    _CURRENT_RID = rid
    _send({"type": "started", "id": rid})

    _install_exec_sigint()
    cancelled = False
    exit_code = 0
    error = None
    try:
        _exec_code, _eval_expr = _compile_cell(code)
        if _exec_code is not None:
            exec(_exec_code, _NS)
        if _eval_expr is not None:
            _eval_value = eval(_eval_expr, _NS)
            if _eval_value is not None:
                display(_eval_value)
    except KeyboardInterrupt:
        # SIGINT during exec -> settle as cancelled, kernel stays alive.
        cancelled = True
        exit_code = 130
        error = {
            "name": "KeyboardInterrupt",
            "value": "Execution interrupted",
            "traceback": "",
        }
    except SystemExit as exc:
        # A plain sys.exit() inside a cell ends the cell, not the kernel.
        code_int = exc.code if isinstance(exc.code, int) else (0 if exc.code is None else 1)
        exit_code = code_int
    except BaseException as exc:  # noqa: BLE001 - surface every user error
        exit_code = 1
        tb = "".join(traceback.format_exception(type(exc), exc, exc.__traceback__))
        error = {"name": type(exc).__name__, "value": str(exc), "traceback": tb}
        # Stream the traceback to stderr too so the LLM sees it inline.
        _send({"type": "stream", "id": rid, "stream": "stderr", "data": tb})
    finally:
        _install_idle_sigint()

    # Snapshot of persistent namespace: top-level user names, filtered to
    # what a caller needs to decide whether to reuse prior state. Drops
    # dunder names, the injected display() hook, and imported modules
    # (re-importing a module is cheap, so listing them is noise).
    variables = sorted(
        k
        for k, v in _NS.items()
        if not k.startswith("_")
        and k != "display"
        and not isinstance(v, types.ModuleType)
    )

    _send(
        {
            "type": "done",
            "id": rid,
            "exit_code": exit_code,
            "error": error,
            "cancelled": cancelled,
            "variables": variables,
        }
    )


def main() -> None:
    _start_parent_watchdog()
    _send({"type": "ready"})
    # readline() is responsive on a pipe: returns as soon as a newline arrives.
    while True:
        line = sys.stdin.readline()
        if not line:  # EOF - host closed stdin
            break
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except json.JSONDecodeError:
            continue
        if req.get("type") == "exit":
            break
        rid = req.get("id", "")
        code = req.get("code", "")
        _run_cell(rid, code)
    try:
        _ipc.close()
    except Exception:
        pass


if __name__ == "__main__":
    main()

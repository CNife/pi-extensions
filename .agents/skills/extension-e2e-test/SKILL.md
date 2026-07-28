---
name: extension-e2e-test
description: "E2E-test a pi extension by driving it through herdr — load it in isolation, send real messages, assert on the footer. Use when the user wants to test or verify an extension (测试扩展/验证插件/E2E/看看这个插件), debug one that is broken (扩展不工作/footer 不对/extension not showing), or compare models. For pi extension testing specifically; general herdr control belongs to the herdr skill."
when_to_use: "测试扩展, E2E验证, 插件测试, 验证footer, 扩展不工作, extension e2e, 本地测试扩展"
---

# Extension E2E Test

End-to-end validation of a pi extension in an isolated herdr workspace: load the extension alone, drive pi like a user (send messages, switch models), and assert on the footer status line.

> 🔴 **Requires herdr**: works only inside herdr (`HERDR_ENV=1`). Check `test "${HERDR_ENV:-}" = 1`; if unset, stop — the CLI talks to the running instance over a unix socket and has no effect outside.

## The two command surfaces

herdr exposes the same terminal at two levels; pick the right one.

- **agent surface** — herdr has recognized *which* coding agent occupies the pane (pi, claude, codex, …) and drives it through a **lifecycle** state machine: `idle` (ready), `working`, `blocked` (approval/question UI), `done`, `unknown` (unclassifiable). Commands: `agent prompt` / `wait` / `get` / `list` / `read` / `send-keys`.
- **pane surface** — the terminal as a byte stream. Commands: `pane run` / `send-text` / `send-keys` / `read` / `wait-output`.

**Prefer the agent surface.** It waits on real state transitions instead of grepping the viewport (which false-matches text already on screen), and `agent prompt --wait` is an atomic submit-and-wait whose **stall guard** returns `agent_prompt_stalled` if pi shows no lifecycle change within 5s. That is the structural cure for **false completion** — the message was sent but pi never ran it, so a bare "wait idle" matches the still-idle pane. The agent surface also sees `blocked` approvals the pane surface is blind to.

**The one prerequisite — and the trap.** Detection works only while herdr can read pi's state. For pi that signal comes from a pi extension, `~/.pi/agent/extensions/herdr-agent-state.ts`, which reports state to herdr (this is why detection is reliable: `screen_detection_skipped: true`, no scraping). The isolation this skill uses (`--no-extensions`) disables that extension and drops pi to `unknown`. The fix is to load it back explicitly — the second `-e` in step 2. If a target ever reads `unknown`, drop to the pane surface (REFERENCE.md → Fallback).

## Prerequisites

- `herdr` on PATH and running inside it (`HERDR_ENV=1`)
- `pi` available (compiled or via `npx`)
- the extension source path known
- `~/.pi/agent/extensions/herdr-agent-state.ts` present (`herdr integration install pi`)

## Workflow

### 1. Create an isolated workspace

```bash
EXT_PATH="$(pwd)/packages/<pkg>/extensions/<file>.ts"
WS_JSON=$(herdr workspace create --cwd "$(pwd)" --label "pi-e2e-<ext>" --no-focus)
ROOT_PANE=$(echo "$WS_JSON" | python3 -c 'import sys,json; print(json.load(sys.stdin)["result"]["root_pane"]["pane_id"])')
WID=$(echo "$WS_JSON" | python3 -c 'import sys,json; print(json.load(sys.stdin)["result"]["workspace"]["workspace_id"])')
```

`--no-focus` keeps the user's focus. **Done when** both `ROOT_PANE` and `WID` are parsed from the JSON — always parse fresh, since IDs compact when workspaces close.

### 2. Start pi in isolation

```bash
# -ne: no auto-discovered extensions · -ns: no skills · -e: load only what's named
herdr pane run "$ROOT_PANE" \
  "pi --no-extensions --no-skills -e '$EXT_PATH' -e '$HOME/.pi/agent/extensions/herdr-agent-state.ts'"
```

The second `-e` (herdr-agent-state.ts) keeps detection alive: `-e` is repeatable and `-ne` only disables *auto-discovery*, so explicit `-e` paths still load — fully isolated, yet herdr still sees pi. Log through `pane read --source visible`; redirecting pi's stdout (`> file`, `2>&1 | tee`) breaks the PTY and TUI rendering. **Done when** the command is sent (readiness is confirmed next).

### 3. Wait for readiness and confirm detection

```bash
herdr agent wait "$ROOT_PANE" --until idle --timeout 20000
herdr agent get "$ROOT_PANE"
herdr pane read "$ROOT_PANE" --source visible --lines 50
```

**Done when** `agent get` reports pi (not `unknown`) **and** the empty footer is visible (e.g. inference-speed shows `--.-T/s FT -.-s`). If `unknown`, re-check the second `-e` in step 2, else use the pane fallback (REFERENCE.md → Fallback).

### 4. Send a message and verify the footer

```bash
# Fast models: 30000. Reasoning models (high/xhigh thinking): 120000+.
herdr agent prompt "$ROOT_PANE" "<test prompt>" --wait --timeout 120000
herdr pane read "$ROOT_PANE" --source visible --lines 50
```

`agent prompt --wait` waits for the first settled state observed *after* submission, so its stall guard rules out false completion. **Done when** the footer shows populated values (e.g. inference-speed `16.0T/s FT1.6s`), not the empty placeholder. Repeat for a second turn to verify cross-turn state.

A cheap fast model for routine testing: `opencode-go/deepseek-v4-flash`. For multi-model, slash-command, and multi-turn variants see REFERENCE.md.

### 5. Clean up

```bash
herdr workspace close "$WID"
```

Terminates pi and everything in the workspace. `send-keys` rejects control characters (no `C-d`), so cleanup is always `workspace close`. **Done when** close returns `ok`.

## Command reference

| Task | Command |
|------|---------|
| Create workspace | `herdr workspace create --cwd <path> --label <name> --no-focus` → `.result.workspace.workspace_id`, `.result.root_pane.pane_id` |
| Wait readiness | `herdr agent wait <pane> --until idle [--timeout MS]` |
| Confirm detection | `herdr agent get <pane>` (must not be `unknown`) |
| Send + wait | `herdr agent prompt <pane> "<text>" --wait [--timeout MS]` |
| Slash command | `herdr pane run <pane> "/model <id>"`, then `agent wait --until idle` |
| Read screen | `herdr pane read <pane> --source visible --lines <N>` (plain text) |
| Output wait (fallback) | `herdr pane wait-output <pane> --match <text>` OR `--regex <pattern>` |
| Close | `herdr workspace close <wid>` |

`agent wait` states: `idle`/`working`/`blocked`/`done`/`unknown`; without `--until` it matches `idle`/`done`/`blocked`. These waits are indefinite without `--timeout` — always pass one. Exit code 0 = matched/settled, non-zero = timeout; there is no `matched` field to inspect.

## Footer extraction

`pane read --source visible --lines N` returns the viewport as **plain text with no ANSI escapes** (the default text format strips styling), so grep it directly:

```bash
herdr pane read "$ROOT_PANE" --source visible --lines 50 | grep "<status-key>"
```

For `ctx.ui.setStatus(key, text)`, grep the `key` to isolate the footer line — the last non-empty line, with the model/context line just above it. To assert populated-vs-empty, match a pattern only the populated state has: inference-speed's empty `--.-T/s` has no digits, so `grep -E '[0-9]+\.[0-9]T/s'` matches only a populated footer.

Always `--source visible` and always `--lines N` for TUI apps: `recent`/`recent-unwrapped` read scrollback (empty for full-screen TUIs) and the default line count is 1. Only `--format ansi` carries escapes — strip before grepping: `sed -E "s/$(printf '\033')\[[0-9;]*m//g"`.

## Disclosed reference

Branches and troubleshooting live in [REFERENCE.md](REFERENCE.md): the pane-surface fallback (when detection is `unknown`), multi-model testing, slash-command testing, multi-turn verification, startup options, log analysis, and a symptom→fix table.

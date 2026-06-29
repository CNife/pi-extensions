---
name: extension-e2e-test
description: "End-to-end test pi extensions using herdr. Covers isolation loading, multi-model testing, footer/state verification, and session lifecycle. Make sure to use this skill whenever you want to verify an extension works, test changes to an extension, debug a broken extension, or run model-comparison tests — even if they just say \"测一下扩展\" or \"看看这个插件\". NOT for general herdr usage outside of pi extension testing. Triggers: 测试扩展/E2E验证/herdr/插件测试/验证插件效果/footer显示不对/扩展不工作/extension not showing/local extension test."
when_to_use: "测试扩展, E2E验证, 插件测试, herdr, 验证footer, 扩展不工作, extension e2e, 本地测试扩展"
---

# Extension E2E Test

End-to-end validation of pi extensions in an isolated herdr workspace. This skill simulates real user interaction — sending messages, switching models, and reading the footer status line — to verify extension behavior across turns and model boundaries.

> 🔴 **Requires herdr**: This skill only works when running inside herdr (`HERDR_ENV=1`). If not set, stop — the herdr CLI talks to the running herdr instance over a local unix socket and has no effect outside.

## Prerequisites

- `herdr` installed and available in PATH
- `HERDR_ENV=1` (running inside herdr)
- `pi` command available (compiled or via `npx`)
- Extension source file path known

## Workflow

### 1. Create an isolated workspace

Use `--no-focus` so the test workspace doesn't steal your current focus.

```bash
EXT_PATH="$(pwd)/packages/<pkg>/extensions/<file>.ts"
WS_JSON=$(herdr workspace create --cwd "$(pwd)" --label "pi-e2e-<ext>" --no-focus)
ROOT_PANE=$(echo "$WS_JSON" | python3 -c 'import sys,json; print(json.load(sys.stdin)["result"]["root_pane"]["pane_id"])')
WID=$(echo "$WS_JSON" | python3 -c 'import sys,json; print(json.load(sys.stdin)["result"]["workspace"]["workspace_id"])')
```

Keep `$ROOT_PANE` and `$WID` — you'll use them in every subsequent step.

### 2. Start pi with the extension loaded in isolation

The pane is a real PTY — pi's TUI renders naturally (unlike tmux where `2>&1 | tee` breaks rendering).

```bash
# -ne: no auto-discovered extensions · -ns: no skills · -e: load only the extension under test
herdr pane run "$ROOT_PANE" "pi --no-extensions --no-skills -e '$EXT_PATH'"
```

### 3. Wait for pi to be ready and verify baseline state

```bash
# Wait for pi to finish booting (agent_status transitions to idle)
herdr wait agent-status "$ROOT_PANE" --status idle --timeout 20000

# Alternative if agent-status doesn't detect pi: wait for version banner
# herdr wait output "$ROOT_PANE" --source visible --match "pi v" --timeout 20000

# Read the TUI footer — always use --source visible for full-screen TUI apps
herdr pane read "$ROOT_PANE" --source visible --lines 50 | tail -5
```

**Expected**: pi's status line visible at the bottom, extension's footer showing initial/empty state (e.g. `--.-T/s FT -.-s` for inference-speed, `Cache C--.-% T--.-% R--.-% M--` for cache-hit-rate).

> ⚠️ **Always use `--source visible` for TUI apps like pi.** The `recent` / `recent-unwrapped` sources read scrollback history — full-screen TUIs don't produce scrollback, so these return empty content. Also always specify `--lines N`; without it, `pane read` returns only **1 line**.

### 4. Send a test message and verify the response footer

```bash
herdr pane send-text "$ROOT_PANE" "<test prompt>"
herdr pane send-keys "$ROOT_PANE" Enter
```

Wait for the model to respond using `wait output` targeting the footer line. For a fast model, 30s is enough; reasoning models (glm-5.2, deepseek with xhigh) can take 120s+.

```bash
# Wait for the footer to show populated values (regex: any digit in the status line)
herdr wait output "$ROOT_PANE" --source visible \
  --match '[0-9]' --regex --timeout 120000

# Read the updated footer
herdr pane read "$ROOT_PANE" --source visible --lines 50 | tail -3
```

`wait output --source visible` polls the current viewport — more precise than a fixed `sleep`. Pass `--regex` for flexible matching (e.g., match a digit to distinguish populated values from placeholders).

Repeat for a second turn to verify cross-turn state:

```bash
herdr pane send-text "$ROOT_PANE" "<test prompt 2>"
herdr pane send-keys "$ROOT_PANE" Enter
herdr wait output "$ROOT_PANE" --source visible \
  --match '[0-9]' --regex --timeout 120000
herdr pane read "$ROOT_PANE" --source visible --lines 50 | tail -3
```

### 5. Multi-model testing (optional)

Verify graceful degradation by testing with a model that has the feature and one that doesn't.

```bash
# Switch model in-session
herdr pane run "$ROOT_PANE" "/model <model-id>"

# Session resets — extension should reinitialize to empty state
herdr wait output "$ROOT_PANE" --source visible \
  --match '<empty-placeholder-pattern>' --timeout 10000

# Read baseline after model switch
herdr pane read "$ROOT_PANE" --source visible --lines 50 | tail -3

# Send a test message with the new model
herdr pane send-text "$ROOT_PANE" "<test prompt>"
herdr pane send-keys "$ROOT_PANE" Enter
herdr wait output "$ROOT_PANE" --source visible \
  --match '[0-9]' --regex --timeout 120000
herdr pane read "$ROOT_PANE" --source visible --lines 50 | tail -3
```

### 6. Clean up

```bash
herdr workspace close "$WID"
```

This terminates pi and all processes running in the workspace's panes. Unlike tmux (where you'd send Ctrl+D then `kill-session`), herdr's `send-keys` does NOT support `C-d` — always use `workspace close` for cleanup.

## Startup Options

Start pi with a specific model and thinking level:

```bash
pi --no-extensions --no-skills -e '$EXT_PATH' --model alibaba-cn/qwen3.7-plus 2>&1 | tee $LOG_FILE
# Thinking level: append --thinking high|medium|low|xhigh|off
```

Use this when the test requires a specific provider or model behavior (e.g., testing cacheWrite requires an anthropic-messages provider; testing no-cache behavior can use an openai-compatible provider like opencode-go).

## Key Patterns

### Extension Isolation Loading

```text
pi --no-extensions --no-skills -e packages/<pkg>/extensions/<file>.ts
```

| Flag | Purpose |
|------|---------|
| `--no-extensions` / `-ne` | Disable all globally installed extensions |
| `--no-skills` / `-ns` | Disable skill loading |
| `-e <path>` | Load only the specified extension |
| `--no-session` | Skip session persistence (test ephemeral) |
| `--model <id>` | Start with a specific model |

### herdr Workspace & Pane Lifecycle

```text
Create workspace:   herdr workspace create --cwd <path> --label <name> --no-focus
Run command:        herdr pane run <pane_id> "<command>"
Send text:          herdr pane send-text <pane_id> "<text>"
Send key:           herdr pane send-keys <pane_id> Enter
Read visible:       herdr pane read <pane_id> --source visible --lines <N>
Wait for output:    herdr wait output <pane_id> --source visible --match <p> [--regex] [--timeout MS]
Wait for status:    herdr wait agent-status <pane_id> --status idle [--timeout MS]
Close workspace:    herdr workspace close <workspace_id>
```

- Always use `--no-focus` for test workspaces so they don't steal the user's current focus
- `wait output --source visible` checks the current viewport and returns immediately if the text already exists; otherwise it polls
- To match text that appears after a message is sent, match on a digit (`[0-9]`) or a specific regex that excludes the empty-state placeholder
- IDs compact when workspaces close — always parse fresh IDs from `workspace create` output

### Footer Status Extraction

The extension's status line is at the very bottom of the pi TUI. Capture the last few lines and grep for the status key:

```bash
herdr pane read "$ROOT_PANE" --source visible --lines 50 | tail -5
```

For extensions that register via `ctx.ui.setStatus()`, the key is the first argument to `setStatus`. Grep for it to isolate the footer line: `grep "<status-key>"`.

### Model Switching

```bash
herdr pane run "$ROOT_PANE" "/model <model-name>"
```

After a model change, the session resets — the extension reinitializes and shows its empty/initial state. Use `wait output --source visible --match <empty-pattern>` to confirm readiness before sending the next test message.

### Slash Command Testing

When testing an extension that registers a `/command`, pi passes the raw argument string to the handler **without stripping quotes**. A user typing `/pna "/path/with spaces/file.md"` delivers `args = '"/path/with spaces/file.md"'` (quotes included).

Test in herdr by sending the exact string the user would type:

```bash
herdr pane send-text "$ROOT_PANE" "/pna \"/path/with spaces/file.md\""
herdr pane send-keys "$ROOT_PANE" Enter
```

If the handler expects unquoted paths, strip quotes defensively: `args.replaceAll(/^"|"$/g, '')`.

### Multi-Turn Verification

To verify stateful behavior (accumulation, baselines, resets):

1. **Turn 1**: Baseline — first message should show initial metrics
2. **Turn 2**: Cross-turn — second message should show incremental changes
3. **Context change**: Send a different-topic message to verify behavior under context shift
4. **Model switch**: Verify metrics reset after `/model`

## Pitfalls

| Problem | Symptom | Fix |
|---------|---------|-----|
| TUI footer not visible in pane read | `pane read --source recent` returns empty or partial content | Use `--source visible` for full-screen TUI apps like pi. `recent`/`recent-unwrapped` read scrollback history — pi's TUI doesn't produce meaningful scrollback |
| pane read returns only 1 line | Output is unexpectedly short | Always pass `--lines N`. Without it, `pane read` defaults to **1 line** |
| send-keys fails on C-d | `unsupported key C-d` error | herdr's `send-keys` doesn't accept control characters like `C-d`. Use `workspace close` for cleanup — it terminates the pane and all running processes cleanly |
| Slow reasoning model | `wait output` times out mid-message | Increase `--timeout` to 120000ms+ for reasoning models (glm-5.2, deepseek) with high thinking levels. If consistently timing out, switch to a faster model |
| Extension not loaded | Footer shows no extension status | Verify `-e` path is correct; read visible before pi fully boots to catch errors: `herdr pane read "$ROOT_PANE" --source visible --lines 100` |
| Model not found | "No matching models" in pi | Use exact model ID from pi's model list (Ctrl+P / `/model` completion); try fuzzy search |
| Model produces tool calls | Multiple assistant messages per turn (complicates state tracking) | Check branch structure before asserting on state |
| npm extension conflict | Two versions of same extension (npm + local) cause footer/state collision | Uninstall npm version: `pi uninstall @cnife/<pkg>`, or use `-ne` (included in isolation loading above) to prevent conflict |
| Workspace ID changes | Reusing a stale workspace ID fails | IDs compact when workspaces close. Always parse fresh IDs from `workspace create` or `workspace list` responses — never hardcode |

## Log Analysis

For most tests, `pane read --source visible --lines 200` serves as the log — it dumps the entire visible TUI content including any error messages pi printed during boot.

```bash
# Dump the full visible screen
herdr pane read "$ROOT_PANE" --source visible --lines 200

# Check for errors
herdr pane read "$ROOT_PANE" --source visible --lines 200 | grep -i "error\|warn\|exception"
```

If deeper log analysis is needed, start pi with `2>&1 | tee /tmp/pi-e2e.log` inside `pane run` — but note that piping stdout may prevent pi from detecting a TTY, which can affect TUI rendering. Reserve `tee` for cases where raw terminal output is needed.

## Reference

This skill replaces the tmux-based E2E testing methodology that was previously documented here. herdr was chosen because its workspace/pane API provides a simpler, more precise workflow for TUI E2E testing: real PTY (no pipe-related rendering issues), agent_status-based readiness detection (no fixed sleeps), and `wait output --source visible` for precise footer matching.

---
name: extension-e2e-test
description: "End-to-end test pi extensions using tmux. Covers isolation loading, multi-model testing, footer/state verification, and session lifecycle. Make sure to use this skill whenever the user wants to verify an extension works, test changes to an extension, debug a broken extension, or run model-comparison tests — even if they just say \"测一下扩展\" or \"看看这个插件\". NOT for general tmux usage outside of pi extension testing. Triggers: 测试扩展/E2E验证/跑一下tmux/验证插件效果/footer显示不对/扩展不工作/extension not showing/local extension test."
when_to_use: "测试扩展, E2E验证, 插件测试, tmux, 验证footer, 扩展不工作, extension e2e, 本地测试扩展"
---

# Extension E2E Test

End-to-end validation of pi extensions in an isolated tmux environment. This skill simulates real user interaction — sending messages, switching models, and reading the footer status line — to verify extension behavior across turns and model boundaries.

## Prerequisites

- `tmux` installed (stock config, no plugins needed)
- `pi` command available (compiled or via `npx`)
- Extension source file path known

---

## Workflow

### 1. Prepare the environment

```bash
# Socket directory for all agent tmux sessions
SOCKET_DIR="${TMPDIR:-/tmp}/claude-tmux-sockets"
mkdir -p "$SOCKET_DIR"
SOCKET="$SOCKET_DIR/pi-e2e.sock"
SESSION="pi-e2e"
LOG_FILE="/tmp/pi-e2e-${SESSION}.log"

# Kill any leftover session from a previous run
tmux -S "$SOCKET" kill-session -t "$SESSION" 2>/dev/null

# Determine absolute extension path
EXT_PATH="$(pwd)/packages/<name>/extensions/<file>.ts"
```

### 2. Start pi with the extension loaded in isolation

```bash
# -ne: no auto-discovered extensions
# -ns: no skills
# -e: load only the extension under test
# 2>&1 | tee log: capture output for later analysis
tmux -S "$SOCKET" new-session -d -s "$SESSION" -x 120 -y 40 \; \
  send-keys "cd $(pwd) && pi --no-extensions --no-skills -e '$EXT_PATH' 2>&1 | tee $LOG_FILE" Enter

# Wait for pi to fully start
sleep 4
```

### 3. Verify baseline state

```bash
# Capture the footer area
tmux -S "$SOCKET" capture-pane -p -J -t "$SESSION" -S -5 2>&1 | tail -5
```

Expected: pi's status line visible at the bottom, extension's footer status showing initial/empty state (e.g. `Cache C:--.-- T:--.-- R:--.-- M:--` for a cache extension).

### 4. Send a test message and verify response

```bash
tmux -S "$SOCKET" send-keys -t "$SESSION" -- "<test prompt>" Enter
```

**Timing**: Wait for the model to respond. Use a baseline sleep (30-60s depending on model), then verify:

```bash
tmux -S "$SOCKET" capture-pane -p -J -t "$SESSION" -S -10 2>&1 | grep "^<ext-status-key>"
```

The extension's footer line is the primary verification target. Also check that the model responded (text visible above the footer).

Repeat for the second turn to verify cross-turn state:

```bash
tmux -S "$SOCKET" send-keys -t "$SESSION" -- "<test prompt 2>" Enter
sleep 30
tmux -S "$SOCKET" capture-pane -p -J -t "$SESSION" -S -10 2>&1 | grep "^<ext-status-key>"
```

### 5. Multi-model testing

Test with a model that has the feature AND one that doesn't to verify graceful degradation.

```bash
# Switch model (in-session)
tmux -S "$SOCKET" send-keys -t "$SESSION" -- "/model <model-id>" Enter
sleep 3

# Verify state reset (extension should reinitialize)
tmux -S "$SOCKET" capture-pane -p -J -t "$SESSION" -S -10 2>&1 | grep "^<ext-status-key>"
# Expected: metrics reset to initial/empty state

# Send test messages with the new model
tmux -S "$SOCKET" send-keys -t "$SESSION" -- "<test prompt>" Enter
sleep 35
tmux -S "$SOCKET" capture-pane -p -J -t "$SESSION" -S -10 2>&1 | grep "^<ext-status-key>"
```

### 6. Clean up

```bash
tmux -S "$SOCKET" kill-session -t "$SESSION" 2>/dev/null
```

The log file (`$LOG_FILE`) retains the full session for post-hoc analysis.

---

## Startup Options

Start pi with a specific model and thinking level for targeted testing:

```bash
pi --no-extensions --no-skills -e '$EXT_PATH' --model alibaba-cn/qwen3.7-plus 2>&1 | tee $LOG_FILE
# Thinking level: append --thinking high|medium|low|xhigh|off
```

Use this when the test requires a specific provider or model behavior (e.g., testing cacheWrite requires an anthropic-messages provider; testing no-cache behavior can use an openai-compatible provider like opencode-go).

---

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

### tmux Session Lifecycle

```text
Start:   tmux -S <sock> new-session -d -s <name>
Capture: tmux -S <sock> capture-pane -p -J -t <session> -S -<N>
Send:    tmux -S <sock> send-keys -t <session> -- "<text>" Enter
Clean:   tmux -S <sock> kill-session -t <session>
```

- Always use `-S <sock>` to isolate from user's tmux sessions
- Use `-J` for `capture-pane` to join wrapped lines
- Negative `-S` value shows last N lines (positive shows from line N)
- When navigating to the enter key of the tmux session, the session window should be referenced with `:` separator, e.g. `-t <session>:0.0`
- If the pane is not found at `:0.0`, use the correct window index: find with `tmux -S <sock> list-panes -a`

### Footer Status Extraction

The extension's status line is at the very bottom of the TUI. Capture the last 5-10 lines and grep for the status key:

```bash
tmux -S "$SOCKET" capture-pane -p -J -t "$SESSION" -S -5 2>&1 | grep "^<KEY>"
```

For extensions that register via `ctx.ui.setStatus()`, the key is the first argument to `setStatus`.

### Model Switching

```bash
tmux -S "$SOCKET" send-keys -t "$SESSION" -- "/model <model-name>" Enter
```

Wait for the model change to complete (`sleep 3`). After model change, the session resets — the extension should reinitialize and show its initial/empty state.

### Slash Command Testing

When testing an extension that registers a `/command`, pi passes the raw argument string to the handler **without stripping quotes**. A user typing `/pna "/path/with spaces/file.md"` delivers `args = '"/path/with spaces/file.md"'` (quotes included).

Test in tmux by sending the exact string the user would type:

```bash
tmux -S "$SOCKET" send-keys -t "$SESSION" -- "/pna \"/path/with spaces/file.md\"" Enter
```

If the handler expects unquoted paths, strip quotes defensively: `args.replaceAll(/^"|"$/g, '')`.

### Multi-Turn Verification

To verify stateful behavior (accumulation, baselines, resets):

1. **Turn 1**: Baseline — first message should show initial metrics
2. **Turn 2**: Cross-turn — second message should show incremental changes
3. **Context change**: Send a different-topic message to verify behavior under context shift
4. **Model switch**: Verify metrics reset after `/model`

---

## Pitfalls

| Problem | Symptom | Fix |
|---------|---------|-----|
| tmux can't find window 0 | `can't find window: 0` | Check pane index: `tmux -S <sock> list-panes -a` then use the correct target like `<session>:1.0` |
| pi not starting | tmux pane is empty | Remove `2>&1` redirection; pi needs a real TTY which tmux provides |
| Sleep too short | Output is incomplete | Increase wait time (30s for fast models, 60s+ for slow/reasoning models) |
| Socket conflict | "address already in use" | Always `kill-session` before `new-session`, or use a unique socket path |
| Extension not loaded | Footer shows no extension status | Verify `-e` path is absolute; check tmux output for error messages |
| Model not found | "No matching models" | Use exact model ID from `models.json` or pi's model list; try fuzzy search |
| Timed out during test | Command hangs or model stops responding | Increase sleep duration; if model consistently times out, switch to a faster model or reduce thinking level. After a timeout, the next `/model` switch resets the session — use this to recover. |
| Model produces tool calls | Multiple asst msgs per turn (complicates state tracking) | Check branch structure before asserting on state |
| npm extension conflict | Two version of same extension loaded (npm + local), causing footer/state collision | Uninstall npm version: `pi uninstall @cnife/<pkg>`, or replace npm path with local symlink: `ln -sf \$(pwd)/packages/<pkg>/extensions/<file>.ts \$(find ~/.pi/agent/npm/node_modules -path "*<pkg>*" -name "*.ts" | head -1)` — test完成后务必恢复 |

---

## Log Analysis

The `tee` log file captures all terminal output for post-hoc analysis. The path is `$LOG_FILE` (defaults to `/tmp/pi-e2e-pi-e2e.log`):

```bash
# Check extension initialization
grep -i "error\|warn\|exception" $LOG_FILE

# Check footer status at specific times
grep "^Cache\|^<status-key>" $LOG_FILE

# Check model usage stats (pi footer line shows ↑input ↓output RcacheRead WcacheWrite)
grep "↑.*↓" $LOG_FILE
```

---

## Reference: Troubleshooting Topics Moved Here

This skill consolidates the E2E testing methodology that was previously scattered across `docs/troubleshooting.md`. Specifically:

- Extension isolation loading → §Key Patterns
- tmux interactive testing → §Workflow
- Config file testing → §Key Patterns (Extension Isolation)
- Compilation check → §Prerequisites

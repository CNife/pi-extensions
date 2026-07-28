# E2E Test Reference

Disclosed branches and troubleshooting for [extension-e2e-test](SKILL.md). Loaded on demand — the core workflow stays in SKILL.md.

## Fallback: the pane surface

When `agent get` reads `unknown` (herdr cannot classify the agent), drive waits through output matching. The command is `pane wait-output` — there is no `herdr wait` group.

```bash
# --match <TEXT> (literal) OR --regex <PATTERN> (Rust regex): mutually exclusive, one required.
# --regex takes the pattern as its value.
herdr pane wait-output "$ROOT_PANE" --source visible --regex '[0-9]+\.[0-9]T/s' --timeout 120000
```

Two-phase waiting without the agent surface — confirm pi started, then confirm it finished. A single "wait for the result" can false-complete while pi is still idle (see *false completion* in SKILL.md):

```bash
herdr pane send-text "$ROOT_PANE" "<test prompt>"
herdr pane send-keys "$ROOT_PANE" Enter
herdr pane wait-output "$ROOT_PANE" --source visible --match "<started-marker>" --timeout 10000
herdr pane wait-output "$ROOT_PANE" --source visible --regex '[0-9]+\.[0-9]T/s' --timeout 120000
```

Exit 0 = matched, non-zero = timeout (no `matched` field).

## Multi-model testing

Verify graceful degradation with a model that has the feature and one that lacks it. A model switch is a pi slash command, so send it through the pane surface and wait for the reset on the agent surface:

```bash
herdr pane run "$ROOT_PANE" "/model <model-id>"
herdr agent wait "$ROOT_PANE" --until idle --timeout 15000   # session resets, extension reinitializes
herdr pane read "$ROOT_PANE" --source visible --lines 50      # footer back to its empty placeholder
herdr agent prompt "$ROOT_PANE" "<test prompt>" --wait --timeout 120000
herdr pane read "$ROOT_PANE" --source visible --lines 50
```

## Slash-command testing

For an extension that registers a `/command`, pi passes the raw argument string to the handler **without stripping quotes**: typing `/pna "/path/with spaces/file.md"` delivers `args = '"/path/with spaces/file.md"'` (quotes included). Send the exact string via `pane run`:

```bash
herdr pane run "$ROOT_PANE" "/pna \"/path/with spaces/file.md\""
```

If the handler expects unquoted paths, strip defensively: `args.replaceAll(/^"|"$/g, '')`.

## Multi-turn verification

For stateful behavior (accumulation, baselines, resets):

1. **Baseline** — first message shows initial metrics.
2. **Cross-turn** — second message shows incremental change.
3. **Context change** — a different-topic message to verify behavior under context shift.
4. **Model switch** — metrics reset after `/model` (session resets, extension reinitializes).

## Startup options

```text
pi --no-extensions --no-skills -e <ext> -e ~/.pi/agent/extensions/herdr-agent-state.ts [options]
```

| Flag | Purpose |
|------|---------|
| `--no-extensions` / `-ne` | Disable auto-discovered extensions (explicit `-e` still loads) |
| `--no-skills` / `-ns` | Disable skill loading |
| `-e <path>` | Load the named extension (repeatable) |
| `--no-session` | Skip session persistence (ephemeral test) |
| `--model <id>` | Start with a specific model (e.g. `opencode-go/deepseek-v4-flash`) |
| `--thinking <level>` | `off|minimal|low|medium|high|xhigh|max` |

Pick a specific model when the test needs particular provider behavior (cache-write requires an anthropic-messages provider; no-cache behavior can use an openai-compatible provider like opencode-go).

## Log analysis

`pane read --source visible --lines 200` *is* the log — it dumps the whole visible TUI, including any error pi printed during boot:

```bash
herdr pane read "$ROOT_PANE" --source visible --lines 200 | grep -iE "error|warn|exception"
```

## Troubleshooting

Symptom-keyed; the authoritative explanations live in SKILL.md.

| Symptom | Fix |
|---------|-----|
| pi reads `unknown` to herdr | The isolation `-ne` disabled `herdr-agent-state.ts` — add the second `-e` (step 2). Still unknown → pane fallback above |
| `unrecognized command wait` | No `herdr wait` group exists — use `herdr pane wait-output` / `herdr agent wait` |
| `--regex` argument error | `--regex` takes the pattern as its value and is mutually exclusive with `--match`: `--regex '<pattern>'` |
| False completion right after sending | Use `agent prompt --wait` (stall-guarded) or two-phase waiting — see *false completion* in SKILL.md |
| `agent_prompt_stalled` | pi never started working within 5s — the message did not run. Read visible to confirm it reached the input, and check pi is not `blocked` on an approval |
| Footer missing from read | Use `--source visible` and `--lines N` (see Footer extraction in SKILL.md) |
| ANSI breaks a grep | Only happens with `--format ansi`; default text reads are ANSI-free |
| Slow reasoning model times out | Raise `--timeout` to 120000+, or test with a fast model (`opencode-go/deepseek-v4-flash`) |
| Extension not loaded | Verify the `-e` path; `pane read --source visible --lines 100` to catch boot errors |
| npm + local extension collide | Uninstall the npm version `pi uninstall @cnife/<pkg>`, or rely on `-ne` (already in step 2) |
| Stale workspace ID fails | IDs compact on close — parse fresh from `workspace create`/`workspace list` |

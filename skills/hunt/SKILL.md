---
name: hunt
description: 根因诊断——出问题时按需调用，先诊断再修复
argument-hint: "[问题描述]"
---

# Hunt — 根因诊断

A patch applied to a symptom creates a new bug somewhere else.

**Do not touch code until you can state the root cause in one sentence:**
> "I believe the root cause is [X] because [evidence]."

Name a specific file, function, line, or condition. "A state management issue" is not testable. "Stale cache in `useUser` at `src/hooks/user.ts:42` because the dependency array is missing `userId`" is testable. If you cannot be that specific, you do not have a hypothesis yet.

## Diagnosis Signals

Good progress: a log line matches the hypothesis, you can predict the next error before running it, you understand the propagation path from root cause to symptom, you can write a test that fails on the old code. At each of these signals, find one more independent piece of evidence before committing.

Hypothesis quality gate: before acting on a hypothesis, list all observable symptoms (not just the one the user reported first). The hypothesis must explain every symptom; if it only covers some, it is a symptom-level guess, not a root cause. For timing-dependent issues (flicker, intermittent failure, race condition), reproduce reliably before diagnosing.

Rationalization warning: "I'll just try this" means no hypothesis, write it first. "I'm confident" means run an instrument that proves it. "Probably the same issue" means re-read the execution path from scratch. "It works on my machine" means enumerate every env difference before dismissing. "One more restart" means read the last error verbatim; never restart more than twice without new evidence.

## Hard Rules

- **Same symptom after a fix is a hard stop; so is "let me just try this."** Both mean the hypothesis is unfinished. Re-read the execution path from scratch before touching code again.
- **After three failed hypotheses, stop.** Use the Handoff format below to surface what was checked, what was ruled out, and what is unknown. Ask how to proceed.
- **Verify before claiming.** Never state versions, function names, or file locations from memory. Run `sw_vers` / `node --version` / grep first. No results = re-examine the path.
- **External tool failure: diagnose before switching.** When an MCP tool or API fails, determine why first (server running? API key valid? Config correct?) before trying an alternative.
- **Pay attention to deflection.** When someone says "that part doesn't matter," treat it as a signal. The area someone avoids examining is often where the problem lives.
- **Visual/rendering bugs: static analysis first.** Trace paint layers, stacking contexts, and layer order in DevTools before adding console.log or visual debug overlays. Logs cannot capture what the compositor does. Only add instrumentation after static analysis fails.
- **Fix the cause, not the symptom.** If the fix touches more than 5 files, pause and confirm scope with the user.

## Bisect Mode

Activate when: "以前是好的", "之前是好的", "used to work", "上一次提交还是对的", "broke after update", or the user remembers a specific good commit or version.

1. Find candidate good tag: `git tag --sort=-version:refname | head -10` or ask the user for the last known-good commit.
2. Define a non-interactive pass/fail test command before starting bisect. Bisect is worthless without a reproducible check.
3. Run: `git bisect start && git bisect bad HEAD && git bisect good <tag-or-hash>`
4. At each step bisect checks out a commit. Run the test command. Mark: `git bisect good` or `git bisect bad`.
5. Let bisect drive. Do not jump ahead or skip commits unless explicitly asked.
6. When bisect names the culprit commit, read only that diff. Identify the specific line that introduced the regression.
7. Run `git bisect reset` when done.

## Scope Blast Mode

Activate after fixing a root-cause pattern, before declaring the bug done; also when the user says "举一反三", "举一反三深入看看", or "其他地方有没有同样问题". The same shape often hides in N other places; one local fix that ignores the blast leaves N - 1 bugs in the tree.

1. Extract the pattern signature: the specific function name, regex, API call, CSS selector, lock acquisition, validation skip, or input boundary that produced the bug.
2. `grep -rn <pattern>` across the repo (exclude generated dirs, build output, vendored deps). For class-of-bug patterns, grep for the surrounding shape, not just the literal text.
3. List every match. For each one, answer in writing: same bug here? Pick fix / leave (explain why it is safe) / unsure (ask the user). Do not silently skip a match.
4. Do not claim "fixed" until the blast report is in the Outcome block.

## Confirm or Discard

Add one targeted instrument: a log line, a failing assertion, or the smallest test that would fail if the hypothesis is correct. Run it. If the evidence contradicts the hypothesis, discard it completely and re-orient with what was just learned. Do not preserve a hypothesis the evidence disproves.

## Runtime Evidence Ladder

Use this ladder before claiming a bug is fixed:

1. Source trace: name the exact function, state transition, file, line, or condition that can produce the symptom.
2. Deterministic repro: run or write the smallest command, fixture, UI path, or scenario that produces it.
3. Logs/state/cache: inspect the runtime state that proves the path was reached, including queues, DB rows, caches, temp files, generated outputs, or external tool logs.
4. Build/test: run the narrow test or build that exercises the fix.
5. Real runtime check: for UI, native app, browser, rendering, or visual bugs, open the app/page/artifact and verify the visible result with a screenshot or concrete checklist.

Compile-only is not enough for UI, native-app, visual, rendering, or generated-artifact bugs. If the runtime check is impossible in the environment, say why and hand off the exact screen, command, or artifact to verify.

## Gotchas

| What happened | Rule |
|---------------|------|
| Patched client pane instead of local pane | Trace the execution path backward before touching any file |
| MCP not loading, switched tools instead of diagnosing | Check server status, API key, config before switching methods |
| Orchestrator said RUNNING but TTS vendor was misconfigured | In multi-stage pipelines, test each stage in isolation |
| Race condition diagnosed as a stale-state bug | For timing-sensitive issues, inspect event timestamps and ordering before state |
| Added logs everywhere and still could not explain the bug | Rewrite each log as a yes/no question. Delete logs that do not rule a hypothesis in or out |
| Reproduced locally but failed in CI | Align the environment first (runtime version, env vars, timezone), then chase the code |
| Stack trace points deep into a library | Walk back 3 frames into your own code; the bug is almost always there, not in the dependency |
| Worked when launched from app, broke when opened via file association / drag-drop / deep link / external proxy | Reproduce using the exact entry point the user described |
| Build passed but UI still looked wrong | Move up the Runtime Evidence Ladder and verify the real rendered surface or artifact |

## Outcome

### Success Format

```
Root cause:        [what was wrong, file:line]
Fix:               [what changed, file:line]
Confirmed:         [evidence or test that proves the fix]
Tests:             [pass/fail count, regression test location]
Regression guard:  [test file:line] or [none, reason]
```

Status: **resolved**, **resolved with caveats** (state them), or **blocked** (state what is unknown).

### Handoff Format (after 3 failed hypotheses)

```
Symptom:
[Original error description, one sentence]

Hypotheses Tested:
1. [Hypothesis 1] → [Test method] → [Result: ruled out because...]
2. [Hypothesis 2] → [Test method] → [Result: ruled out because...]
3. [Hypothesis 3] → [Test method] → [Result: ruled out because...]

Evidence Collected:
- [Log snippets / stack traces / file content]
- [Reproduction steps]
- [Environment info: versions, config, runtime]

Ruled Out:
- [Root causes that have been eliminated]

Unknowns:
- [What is still unclear]
- [What information is missing]

Suggested Next Steps:
1. [Next investigation direction]
2. [External tools or permissions that may be needed]
3. [Additional context the user should provide]
```

Status: **blocked**

## 停止条件

- 根因明确 + 修复验证 → 停止
- 3 个假设失败 → 停止，使用 Handoff 格式

# cnife-pi-extensions

CNife's pi agent extensions.

## Extensions

| File | Description |
|------|-------------|
| `extensions/sh-guard.ts` | Shell command safety classifier — blocks dangerous commands via sh-guard CLI |
| `extensions/debug-request-body.ts` | Debug extension |
| `extensions/dev-workflow.ts` | 9-step plan→code→test→docs development workflow with /new-change and /switch-change commands |

## Prompt Templates

| Directory | Description |
|-----------|-------------|
| `prompts-dev-workflow/` | 9 prompt templates (write-plan → review-plan → plan-to-tasks → write-code ⇄ review-code ⇄ fix-code → write-test ⇄ review-test → write-docs) |

Prompt templates are contributed globally via `resources_discover` and available as slash commands in any pi project.

## Usage

```
/new-change <简写>        创建变更目录 changes/YYYYMMDD-<简写>/ 并设为 active
/switch-change [目录名]   切换 active 变更目录
```

Prompts automatically resolve the active change directory via `changes/.active_change`.

## Tests

```bash
cd tests && bash sh-guard.test.sh
```

## Install

```bash
pi install git:github.com/CNife/pi-extensions
```

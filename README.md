# cnife-pi-extensions

CNife's pi agent extensions.

Refer to [AGENTS.md](AGENTS.md) for the project structure, directory conventions, and division of responsibilities among extensions, skills, and prompt templates.

## Extensions

| File | Description |
|------|-------------|
| `extensions/sh-guard.ts` | Shell command safety classifier — blocks dangerous commands via sh-guard CLI |
| `extensions/debug-request-body.ts` | Debug extension |
| `extensions/dev-workflow.ts` | 9-stage plan→code→test→docs development workflow with /new-change and /switch-change commands |

## Prompt Templates

| Directory | Description |
|-----------|-------------|
| `prompts/` | 9 prompt templates (write-plan → review-plan → plan-to-tasks → write-code ⇄ review-code ⇄ fix-code → write-test ⇄ review-test → write-docs) |

Prompt templates are auto-discovered by pi from the package's `prompts/` convention directory.

## Skills

| Directory | Description |
|-----------|-------------|
| `skills/development-workflow/` | 入口文档 + references/ 阶段详情，提供 9 阶段工作流全景、变更目录解析规则、Plannotator 审阅入口 |

Each skill's `SKILL.md` serves as an entry document; full phase details are in `references/`.

## Usage

```
/new-change <简写>        创建变更目录 changes/YYYYMMDD-<简写>/ 并设为 active
/switch-change [目录名]   切换 active 变更目录
```

Prompts automatically resolve the active change directory via `changes/.active_change`.

## Tests

```bash
# Shell 命令安全分类器测试
tests/sh-guard.test.sh

# 开发工作流结构一致性测试（92 项断言）
tests/dev-workflow.test.sh
```

运行方式：

```bash
cd tests && bash dev-workflow.test.sh
cd tests && bash sh-guard.test.sh
```

## Install

```bash
pi install git:github.com/CNife/pi-extensions
```

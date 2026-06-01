# Skill Development (change-based-workflow)

## Skill Structure

```text
skills/<kebab-name>/
└── SKILL.md
```

## SKILL.md Frontmatter

```yaml
---
name: <kebab-case-slug>       # Must match directory name
description: "<Chinese, one line>"   # ~40 chars max
argument-hint: "<argspec>"     # <> required, [] optional, | enum
---
```

## Section Conventions

- Heading: `# <EnglishName> — <Chinese tagline>`
- Common sections: **输入** (Input), **核心原则**, **工作流程**, **写入规则**, **产出**, **停止条件**
- **停止条件** is mandatory — document when the skill exits
- Every pipeline skill appends to `change.md` with versioned blocks (`# 变更 v{N}：<skill>`)

## Change Directory Reference

```text
changes/YYYYMMDD-<slug>/
├── change.md        # Appended by all pipeline skills (never overwritten)
├── plan.md          # Created by /plan (overwritten)
├── CONTEXT.md       # Terminology by /grill
├── tasks/           # By /plan-to-tasks: T01-<slug>.md
├── checkpoints/     # Dual-agent review files
├── adr/             # Architecture decisions by /grill
```

`$CHANGE_DIR` = current change directory (resolved via `.active_change` or arg).

## Pipeline Skills (in order)

| Skill | Writes | Description |
|-------|--------|-------------|
| `/manage-change` | Directory, `.active_change` | Create/switch change context |
| `/grill` | CONTEXT.md, ADRs | Clarify scope and terminology |
| `/plan` | plan.md | Write implementation plan |
| `/plan-to-tasks` | tasks/*.md | Split plan into atomic tasks |
| `/write-code` | Source files | TDD, red-green-refactor per task |
| `/check-work` | checkpoints/*.md | Review and verify (checker agent) |

## Dual-Agent Model

- **Executor Agent**: Runs `/grill → /plan → /plan-to-tasks → /write-code`
- **Checker Agent**: Runs `/check-work` on each stage's output
- Handoff via `changes/<dir>/checkpoints/<stage>.md`

## Key Rules

- Single SKILL.md per skill directory
- Chinese prose, English commands
- Explicit stop conditions in every skill
- Dual-agent file handoff (no IPC)

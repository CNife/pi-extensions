# Skill Development

## Structure

```text
skills/<kebab-name>/
└── SKILL.md
```

## SKILL.md Frontmatter

```yaml
---
name: <kebab-name>           # Must match directory name
description: "<Chinese, ~40 chars>"
argument-hint: "<argspec>"    # <> required, [] optional, | enum
---
```

## Sections

- Heading: `# <English> — <Chinese tagline>`
- Common sections: **输入**, **核心原则**, **工作流程**, **写入规则**, **停止条件**
- **停止条件** is mandatory

## Change Directory

```text
changes/YYYYMMDD-<slug>/
├── change.md        # Appended by all pipeline skills (never overwritten)
├── plan.md          # Created by /plan
├── CONTEXT.md       # Terminology by /grill
├── tasks/           # By /plan-to-tasks
├── checkpoints/     # Dual-agent review files
└── adr/             # Architecture decisions
```

## Pipeline

| Skill | Description |
|-------|-------------|
| `/grill` | Clarify scope and terminology |
| `/plan` | Write implementation plan |
| `/plan-to-tasks` | Split plan into atomic tasks |
| `/write-code` | TDD per task |
| `/check-work` | Review and verify |

## Key Rules

- Single SKILL.md per directory
- Chinese prose, English commands
- Explicit stop conditions
- Dual-agent via file handoff (executor ↔ checker through checkpoints/)

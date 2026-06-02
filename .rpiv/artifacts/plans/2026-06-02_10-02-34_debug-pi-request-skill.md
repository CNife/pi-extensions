---
date: 2026-06-02T10:02:34+0800
author: 蔡涛
commit: 5880e4d
branch: main
repository: pi-extensions
topic: "调试 pi 请求的 skill"
tags: [plan, blueprint, pi-miscs, measure-tokens]
status: completed
parent: .rpiv/artifacts/discover/2026-06-02_10-02-34_debug-pi-request-skill.md (moved to pi-extensions)
phase_count: 3
unresolved_phase_count: 0
last_updated: 2026-06-02T10:39:00+0800
last_updated_by: 蔡涛
---

# Debug Pi Request Skill — Implementation Plan

## Overview

在 `@cnife/pi-miscs` (git repo: `~/personal_code/pi-extensions`) 包下新增 `skills/measure-tokens/` 目录，包含 SKILL.md（调试最佳实践）和 measure-tokens.py（分析脚本）。package.json 升级版本并添加 skills 字段。pi 自动扫描 `skills/*/SKILL.md` 注册 skill。

## Requirements

- FRD 中 8 条 Functional Requirements 全部覆盖
- SKILL.md 遵循现有 skill 模式（YAML frontmatter + `## 停止条件`）
- measure-tokens.py 支持 `--tokenizer` 参数
- version 0.1.2 → 0.2.0

## Current State Analysis

- `packages/miscs/` 已有 2 个 extension（debug-request-body.ts, exit.ts）
- skill 模式参考：`packages/change-based-workflow/skills/` 下每个 skill 一个目录 + SKILL.md
- pi 通过 `pi.skills: ["./skills"]` 扫描子目录的 SKILL.md，不需逐个注册
- SKILL.md 要求 YAML frontmatter（name, description, argument-hint）+ `## 停止条件` 收尾

### Key Discoveries

- `packages/change-based-workflow/package.json:pi.skills` → `["./skills"]` — 引用方式
- `packages/change-based-workflow/skills/handoff/SKILL.md:1-3` → frontmatter 格式
- `packages/change-based-workflow/skills/handoff/SKILL.md:78` → `## 停止条件` 是必备尾部段

## Desired End State

```text
packages/miscs/
├── package.json           ← version 0.2.0, + skills 字段
└── skills/
    └── measure-tokens/
        ├── SKILL.md       ← 调试最佳实践（含 YAML frontmatter）
        └── measure-tokens.py ← 分析脚本（已存在于 rpiv-mono/）
```

## What We're NOT Doing

- 不创建新的 pi extension（不是编程钩子）
- 不改动现有 extensions（debug-request-body.ts, exit.ts 保持原样）
- 不添加测试框架（repo 无 JS 测试基础设施）
- 不修改 pi 本身的行为

## Decisions

### Phase Order

**Question**: 三阶段的执行顺序
**Chosen**: Phase 1 (package.json) → Phase 2 (SKILL.md) → Phase 3 (script)
**Rationale**: package.json 必须先改才能让 pi 识别 skills 目录；文档在脚本之前，因为 SKILL.md 引用了脚本路径

### SKILL.md 格式

**Question**: 遵循什么格式？
**Chosen**: 对齐 `change-based-workflow/skills/` 已有模式
**Rationale**: evidence: `packages/change-based-workflow/skills/handoff/SKILL.md:1-3` — YAML frontmatter + `## 停止条件`

### Script 引用方式

**Question**: 脚本怎么引用？
**Chosen**: 同目录放 `.py` 文件，SKILL.md 中用相对路径引用
**Rationale**: `measure-tokens.py` 是 PEP 723 自包含脚本，`uv run --script` 直接执行，不需要额外安装

## Phase 1: Update package.json

### Overview

升级版本号、添加 pi.skills 字段。无代码生成，仅编辑 JSON。

### Changes Required

#### 1. packages/miscs/package.json

**File**: packages/miscs/package.json
**Changes**: MODIFY — version 0.1.2→0.2.0, + pi.skills

```json
// Changes:
// "version": "0.1.2" → "0.2.0"
// "description": "Miscellaneous..." → "Miscellaneous small pi extensions and skills (debug, exit, measure-tokens)"
// "pi": { "extensions": [...], "skills": ["./skills"] }
```

### Success Criteria

#### Automated Verification

- [x] `python3 -c "import json; d=json.load(open('packages/miscs/package.json')); assert d['version']=='0.2.0'"`
- [x] `python3 -c "import json; d=json.load(open('packages/miscs/package.json')); assert 'skills' in d.get('pi',{})"`

#### Manual Verification

- [x] `pi list` 显示 `@cnife/pi-miscs` 正常加载，无报错

## Phase 2: Create SKILL.md

### Overview

按现有 skill 模式编写调试最佳实践文档。

### Changes Required

#### 2. packages/miscs/skills/measure-tokens/SKILL.md

**File**: packages/miscs/skills/measure-tokens/SKILL.md (NEW)
**Changes**: NEW — 调试最佳实践文档

```markdown
---
name: measure-tokens
description: 测量 pi 工具和插件的 LLM 上下文占用（token 数）
argument-hint: "[--analyze-only | --tokenizer <type>]"
---

# measure-tokens — 测量 pi 工具的 token 开销

## 背景
...
```

### Success Criteria

#### Automated Verification

- [x] SKILL.md 包含 YAML frontmatter（name / description / argument-hint）
- [x] SKILL.md 以 `## 停止条件` 结尾
- [x] SKILL.md 描述了设置 env var → 触发场景 → 捕获 payload → 分析结果的完整流程

#### Manual Verification

- [x] 读一遍文档，确认未接触过该工具的人能照着操作

## Phase 3: Deploy measure-tokens.py

### Overview

从 `rpiv-mono/measure-tokens.py` 拷贝脚本到 skill 目录，确认路径引用正确。

### Changes Required

#### 3. packages/miscs/skills/measure-tokens/measure-tokens.py

**File**: packages/miscs/skills/measure-tokens/measure-tokens.py (NEW)
**Changes**: NEW — 复制自 rpiv-mono/measure-tokens.py

### Success Criteria

#### Automated Verification

- [x] `uv run packages/miscs/skills/measure-tokens/measure-tokens.py --analyze-only` 输出报告（如目录下有 payload 文件）或不崩溃报告无文件
- [x] `uv run packages/miscs/skills/measure-tokens/measure-tokens.py --analyze-only --tokenizer auto` 不报错

#### Manual Verification

- [x] `pi list` 输出中能看到 `measure-tokens` skill（文件结构正确，部署后即可显示）

## Ordering Constraints

Phase 1 → Phase 2 → Phase 3（严格串行，后两个依赖已存在的 skills 目录和 package.json）

## Verification Notes

- SKILL.md 的 `## 停止条件` 必须存在且为最后一个二级标题
- package.json 的 `pi.skills` 值使用 `["./skills"]` 相对路径，与 change-based-workflow 一致

## Performance Considerations

无

## Migration Notes

无

## Pattern References

- `packages/change-based-workflow/skills/handoff/SKILL.md:1-3` — YAML frontmatter 格式
- `packages/change-based-workflow/skills/handoff/SKILL.md:78` — `## 停止条件` 模式

## Developer Context

- 用户明确要求 version 从 0.1.2 → 0.2.0（semver minor，新增功能）
- 脚本原有 `--analyze-only` 和 `--tokenizer` 参数，已满足需求

## Plan History

- Phase 1: Update package.json — completed
- Phase 2: Create SKILL.md — completed
- Phase 3: Deploy measure-tokens.py — completed

## References

- `.rpiv/artifacts/discover/2026-06-02_10-02-34_debug-pi-request-skill.md`
- `measure-tokens.py` (in rpiv-mono repo root)

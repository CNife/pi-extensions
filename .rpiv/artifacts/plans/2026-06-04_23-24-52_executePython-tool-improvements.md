---
date: 2026-06-04T23:24:52+0800
author: CNife
commit: 9d9d738
branch: main
repository: pi-extensions
topic: executePython-tool-improvements
tags: [plan, execute-python, tool-rendering, error-display, tool-interception]
status: ready
parent: .rpiv/artifacts/discover/2026-06-04_22-56-48_executePython-tool-improvements.md
phase_count: 3
unresolved_phase_count: 0
last_updated: 2026-06-04T23:24:52+0800
last_updated_by: CNife
---

# executePython 工具改进实施计划

## Overview

改进 executePython 工具在终端中的展示体验：修复错误时折叠视图不显示任何错误信息的 bug，默认折叠输出代码，并在用户通过 bash 执行 Python 脚本时温和引导其使用 executePython。

## Requirements

- 修复错误展示 bug：无论折叠还是展开状态，用户都能看到完整的 Python 错误信息（stderr / traceback）
- 温和引导 AI 优先选择 executePython 而非 bash 执行 Python 代码
- 保持输出默认折叠，避免长输出淹没终端

## Current State Analysis

executePython 工具在折叠模式下，当执行出错时，用户只能看到状态栏的 `Error N`，无法看到具体的错误信息。此外，AI 经常通过 bash 执行 `python -c` 等 Python 命令，而不是直接使用 executePython 工具。

### Key Discoveries

- `packages/execute-python/extensions/execute-python.ts:337-435` — renderResult 函数实现
- `packages/execute-python/extensions/execute-python.ts:71-85` — promptGuidelines 定义
- `packages/execute-python/extensions/execute-python.ts:440-442` — 扩展导出函数
- `node_modules/@earendil-works/pi-coding-agent/docs/extensions.md:743-762` — tool_result 事件文档
- `archive/sh-guard.ts:96-183` — bash 工具拦截模式参考

## Desired End State

- 执行 `executePython` 并触发 Python 异常时，折叠状态下 TUI 显示 stdout 前 5 行 + `--- stderr below ---` + 完整 traceback
- 在 bash 中执行 `python3 -c "print(1)"`，tool_result 返回内容末尾出现 `Tip: Use executePython for Python code instead of bash.`
- executePython 工具的 system prompt Guidelines 中包含新增的 guideline 条目

## What We're NOT Doing

- 不折叠输入代码区域
- 不调整输出折叠预览行数（保持 5 行）
- 不统计或记录 bash→executePython 转换次数
- 不对提示做限流或去重
- 不新增 Ctrl+O 快捷键或其他键盘交互变更

## Decisions

### Bash 提示机制

**Question**: 如何在 bash 执行 Python 代码后引导 AI 改用 executePython？
**Recommended**: D+A 组合：`promptGuidelines` 预防 + `tool_result` 追加纠正
**Chosen**: 采用 D+A 组合
**Rationale**: 系统提示词始终引导（防患于未然），tool_result 追加在违规后温和提醒（亡羊补牢），两者叠加效果好且实现成本低；system message 注入方式权重过高且与 tool_result 上下文脱节，评估后排除。

### 检测模式

**Question**: bash 命令中哪些模式应触发提示？
**Recommended**: 匹配含 `python` + `-c` 的命令，包括 `python3 -c`、`uv run python -c`、`python -c` 等变体
**Chosen**: 匹配含 `python` + `-c` 的 bash 命令
**Rationale**: inline Python 执行（`-c`）是 AI 最容易误用 bash 的场景，也是 executePython 的核心替代目标。

### 提示文案

**Question**: 提示文案的具体文字和语气？
**Recommended**: guideline 用 `"Use executePython for running Python code (python -c, scripts) instead of bash."`；tool_result 追加用 `"\nTip: Use executePython for Python code instead of bash."`
**Chosen**: 同上
**Rationale**: 参考 pi 系统提示词风格——祈使句、简洁、工具自名、决策导向。

### 错误展示修复

**Question**: 出错时折叠模式如何展示错误信息？
**Recommended**: 折叠模式下 stdout 预览后追加 `--- stderr below ---` + 完整 stderr；展开模式不变
**Chosen**: 同上（遵循现有模式）
**Rationale**: 用户必须看到错误信息才能调试；保持折叠/展开切换行为不变，最小侵入修复 bug。

### 输入折叠

**Question**: 是否需要折叠输入代码区域？
**Recommended**: 不折叠，保持现状
**Chosen**: 不折叠
**Rationale**: executePython 场景脚本通常较短，折叠输入会增加操作成本，收益不大。

### 输出折叠行数

**Question**: 是否需要调整折叠预览行数？
**Recommended**: 保持 5 行，不调整
**Chosen**: 保持 5 行
**Rationale**: 当前 5 行预览已在信息量与空间占用间取得平衡。

### 转换统计与限流

**Question**: 是否需要记录转换次数或对提示限流？
**Recommended**: 两者都不需要
**Chosen**: 不需要
**Rationale**: 工具使用频率低，限流增加复杂度；统计非核心需求。

## Phase 1: 错误展示修复

### Overview

修改 renderResult 函数，在折叠模式下当 stderr 非空时追加错误信息显示。

### Changes Required

#### 1. packages/execute-python/extensions/execute-python.ts:380-390

**File**: packages/execute-python/extensions/execute-python.ts
**Changes**: MODIFY — 修改 renderResult 函数，在折叠模式下追加 stderr 显示

```typescript
    // Collapsed mode: show first 5 lines of stdout
    if (!expanded) {
      if (details?.stdout) {
        const lines = details.stdout.split("\n");
        const preview = lines.slice(0, 5).join("\n");
        if (preview) {
          text += preview;
        }
        if (lines.length > 5) {
          text += `\n${theme.fg("muted", `... ${lines.length - 5} more lines`)}`;
        }
      }
      // Show stderr in collapsed mode when present
      if (details?.stderr) {
        text += `\n${theme.fg("warning", "--- stderr below ---")}`;
        text += `\n${details.stderr}`;
      }
    }
```

### Success Criteria

#### Automated Verification

- [x] 类型检查通过：`npm run check`
- [x] 测试通过：`npm test`（项目无 test 脚本，跳过）
- [x] 执行 executePython 并触发 Python 异常（如 `raise ValueError("test")`），折叠状态下 TUI 显示 stdout 前 5 行 + `--- stderr below ---` + 完整 traceback

#### Manual Verification

- [x] 执行成功（exitCode=0）且无 stderr 时，折叠状态不显示 `--- stderr below ---` 分隔行
- [x] 展开状态下 TUI 显示完整 stdout + stderr（行为与修复前一致）

## Phase 2: promptGuidelines 追加

### Overview

在 executePython 工具定义中添加新的 guideline 条目，引导 AI 优先选择 executePython。

### Changes Required

#### 2. packages/execute-python/extensions/execute-python.ts:80-85

**File**: packages/execute-python/extensions/execute-python.ts
**Changes**: MODIFY — 在 promptGuidelines 数组中追加新条目

```typescript
  promptGuidelines: [
    "Use for complex tasks: heavy computation, multi-step data processing, heredoc-style scripts",
    "Use packages param to declare ALL third-party dependencies (uv auto-manages venv)",
    "Prefer bash for simple commands or short pipes (≤3 |)",
    "No bash escaping needed — write Python code directly",
    "Use executePython for running Python code (python -c, scripts) instead of bash.",
  ],
```

### Success Criteria

#### Automated Verification

- [ ] 类型检查通过：`npm run check`
- [ ] 测试通过：`npm test`
- [ ] executePython 工具的 system prompt Guidelines 中包含新增的 guideline 条目

#### Manual Verification

- [ ] 新增的 guideline 条目符合 pi 系统提示词风格

## Phase 3: tool_result 拦截

### Overview

在扩展导出函数中添加 pi.on("tool_result", ...) 事件监听，检测 bash 命令中的 Python 执行模式并追加提示。

### Changes Required

#### 3. packages/execute-python/extensions/execute-python.ts:440-442

**File**: packages/execute-python/extensions/execute-python.ts
**Changes**: MODIFY — 在默认导出函数中添加 tool_result 事件监听

```typescript
export default function (pi: ExtensionAPI) {
  pi.registerTool(executePythonTool);

  // Intercept bash tool results to guide AI toward executePython
  pi.on("tool_result", async (event, ctx) => {
    if (event.toolName !== "bash") return;

    const command = (event.input as { command?: string })?.command ?? "";
    // Detect python -c patterns in bash commands
    if (/python[0-9.]*\s+-c\s/.test(command)) {
      return {
        content: [
          ...event.content,
          {
            type: "text" as const,
            text: "\nTip: Use executePython for Python code instead of bash.",
          },
        ],
      };
    }
  });
}
```

### Success Criteria

#### Automated Verification

- [ ] 类型检查通过：`npm run check`
- [ ] 测试通过：`npm test`
- [ ] 在 bash 中执行 `python3 -c "print(1)"`，tool_result 返回内容末尾出现提示
- [ ] 在 bash 中执行 `uv run python -c "print(1)"`，tool_result 返回内容末尾出现相同提示

#### Manual Verification

- [ ] 在 bash 中执行不含 `python -c` 的命令（如 `python script.py` 或 `ls`），不出现提示
- [ ] 使用 `/extension-e2e-test` 技能验证上述场景全部通过

## Ordering Constraints

- Phase 1 必须在 Phase 2 和 Phase 3 之前完成（错误展示修复是基础）
- Phase 2 和 Phase 3 可以并行执行（互不依赖）
- 所有 Phase 完成后进行集成测试

## Verification Notes

- 执行 `executePython` 并触发 Python 异常（如 `raise ValueError("test")`），折叠状态下 TUI 显示 stdout 前 5 行 + `--- stderr below ---` + 完整 traceback
- 执行 `executePython` 并触发 Python 异常，展开状态下 TUI 显示完整 stdout + stderr（行为与修复前一致）
- 执行成功（exitCode=0）且无 stderr 时，折叠状态不显示 `--- stderr below ---` 分隔行
- 在 bash 中执行 `python3 -c "print(1)"`，tool_result 返回内容末尾出现 `Tip: Use executePython for Python code instead of bash.`
- 在 bash 中执行 `uv run python -c "print(1)"`，tool_result 返回内容末尾出现相同提示
- 在 bash 中执行不含 `python -c` 的命令（如 `python script.py` 或 `ls`），不出现提示
- executePython 工具的 system prompt Guidelines 中包含新增的 guideline 条目
- 使用 `/extension-e2e-test` 技能验证上述场景全部通过

## Performance Considerations

- tool_result 追加提示的字符串操作应在微秒级完成，不影响工具返回延迟
- 无新增性能瓶颈

## Migration Notes

- 无数据迁移需求
- 无向后兼容性问题

## Pattern References

- `packages/execute-python/extensions/execute-python.ts:337-435` — renderResult 函数实现模式
- `packages/execute-python/extensions/execute-python.ts:71-85` — promptGuidelines 定义模式
- `archive/sh-guard.ts:96-183` — bash 工具拦截模式参考
- `node_modules/@earendil-works/pi-coding-agent/docs/extensions.md:743-762` — tool_result 事件处理模式

## Developer Context

- 2026-06-04T23:24:52+0800: 确认错误展示修复遵循现有模式（directional confirm）
- 2026-06-04T23:24:52+0800: 批准 3 个切片的分解

## Plan History

- Phase 1: 错误展示修复 — approved as generated
- Phase 2: promptGuidelines 追加 — approved as generated
- Phase 3: tool_result 拦截 — approved as generated

## References

- 输入描述：用户提供的 feature description（2026-06-04）
- 代码库探针：`packages/execute-python/extensions/execute-python.ts`（renderResult 函数，lines 337-435）
- pi 系统提示词风格参考：`node_modules/@earendil-works/pi-coding-agent/dist/core/system-prompt.js`
- pi 扩展事件系统文档：`node_modules/@earendil-works/pi-coding-agent/docs/extensions.md`

## Plan Review (Step 8)

_Independent post-finalization review by artifact-code-reviewer and artifact-coverage-reviewer subagents. Findings triaged at Step 9._

| source   | plan-loc          | codebase-loc                | severity   | dimension             | finding   | recommendation   | resolution         |
| -------- | ----------------- | --------------------------- | ---------- | --------------------- | --------- | ---------------- | ------------------ |
| code     | Phase 1 §1        | packages/execute-python/extensions/execute-python.ts:380-390 | concern | actionability | Phase 1 section header cites lines 415-435 but the actual collapsed-mode block (`if (!expanded && details?.stdout)`) is at lines 380-390 — a ~35 line offset that could mislead implementers about which section to modify | Correct the line range in the Phase 1 header from `:415-435` to `:380-390` to match the actual location of the collapsed-mode code | applied: line range corrected to :380-390 |

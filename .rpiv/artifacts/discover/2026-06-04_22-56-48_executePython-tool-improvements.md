---
date: 2026-06-04T22:56:48+0800
author: CNife
commit: 9d9d738
branch: main
repository: pi-extensions
topic: executePython-tool-improvements
tags: [intent, frd, execute-python, tool-rendering, error-display, tool-interception]
status: complete
last_updated: 2026-06-04T22:56:48+0800
last_updated_by: CNife
---

# FRD: executePython 工具改进

## Summary

改进 executePython 工具在终端中的展示体验：修复错误时折叠视图不显示任何错误信息的 bug，默认折叠输出代码，并在用户通过 bash 执行 Python 脚本时温和引导其使用 executePython。

## Problem & Intent

最终用户在使用 executePython 工具时，遇到 Python 执行错误，在折叠视图下看不到任何 traceback 或错误信息，只能看到状态栏的 `Error N`，调试困难。此外，用户观察到 AI 经常通过 bash 执行 `python -c` 等 Python 命令，而不是直接使用 executePython 工具，导致工具选择不一致。

## Goals

- 修复错误展示 bug：无论折叠还是展开状态，用户都能看到完整的 Python 错误信息（stderr / traceback）
- 温和引导 AI 优先选择 executePython 而非 bash 执行 Python 代码
- 保持输出默认折叠，避免长输出淹没终端

## Non-Goals

- 不折叠输入代码区域
- 不调整输出折叠预览行数（保持 5 行）
- 不统计或记录 bash→executePython 转换次数
- 不对提示做限流或去重
- 不新增 Ctrl+O 快捷键或其他键盘交互变更

## Functional Requirements

1. **错误展示修复**：当 executePython 执行结果 exitCode !== 0 时，无论 expanded 状态如何，stderr 内容必须对用户可见。折叠模式下，在 stdout 预览后追加 `--- stderr below ---` 分隔行及完整 stderr 内容；展开模式行为不变。
2. **Bash 使用引导（预防层）**：在 executePython 工具的 `promptGuidelines` 中追加一条 guideline：`"Use executePython for running Python code (python -c, scripts) instead of bash."`，使 system prompt 始终引导 AI 优先选择 executePython。
3. **Bash 使用引导（纠正层）**：在 bash 工具的 `tool_result` 事件中，检测返回内容是否包含 Python 执行痕迹（命令含 `python` + `-c` 模式，如 `python3 -c`、`uv run python -c`、`python -c` 等）。若检测到，在 tool_result 的 content 末尾追加：`"\nTip: Use executePython for Python code instead of bash."`。
4. **输出折叠保持**：折叠模式下继续显示 stdout 前 5 行 + `... N more lines` 提示，行为不变。

## Non-Functional Requirements

- **Performance**: tool_result 追加提示的字符串操作应在微秒级完成，不影响工具返回延迟。
- **Security**: 无新增安全约束；tool_result 内容追加仅追加纯文本提示，不修改原始执行结果数据。
- **UX / Accessibility**: 错误信息应在所有视图中可读；提示文案简洁直接，参考 pi 系统提示词风格。
- **Reliability**: 错误展示修复不得破坏现有的折叠/展开切换逻辑；stderr 为空时不应出现多余分隔行。

## Constraints & Assumptions

- 技术约束：修改仅限 `packages/execute-python/extensions/execute-python.ts` 及 executePython 扩展代码；bash tool_result 拦截通过 pi 扩展事件系统实现。
- 假设：AI 在下一轮对话中会阅读上一轮的 tool_result 内容，追加提示足以影响其工具选择决策。
- 假设：用户场景中 Python 脚本通常较短（<20 行），不折叠输入不会造成终端空间问题。

## Acceptance Criteria

- [ ] 执行 `executePython` 并触发 Python 异常（如 `raise ValueError("test")`），折叠状态下 TUI 显示 stdout 前 5 行 + `--- stderr below ---` + 完整 traceback
- [ ] 执行 `executePython` 并触发 Python 异常，展开状态下 TUI 显示完整 stdout + stderr（行为与修复前一致）
- [ ] 执行成功（exitCode=0）且无 stderr 时，折叠状态不显示 `--- stderr below ---` 分隔行
- [ ] 在 bash 中执行 `python3 -c "print(1)"`，tool_result 返回内容末尾出现 `Tip: Use executePython for Python code instead of bash.`
- [ ] 在 bash 中执行 `uv run python -c "print(1)"`，tool_result 返回内容末尾出现相同提示
- [ ] 在 bash 中执行不含 `python -c` 的命令（如 `python script.py` 或 `ls`），不出现提示
- [ ] executePython 工具的 system prompt Guidelines 中包含新增的 guideline 条目
- [ ] 使用 `/extension-e2e-test` 技能验证上述场景全部通过

## Recommended Approach

在 `packages/execute-python/extensions/execute-python.ts` 中修改 `renderResult` 函数：折叠模式下，当 stderr 非空时追加 `--- stderr below ---` 及 stderr 内容；同时在 executePython 的 `promptGuidelines` 数组中追加一条新 guideline。Bash tool_result 拦截通过 executePython 扩展的 `pi.on("tool_result", ...)` 事件实现，检测命令模式后修改 event.content。

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
**Chosen**: 同上
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

## Open Questions

- 无

## Suggested Follow-ups

- 观察 bash tool_result 拦截是否会影响其他使用 `python` 命令但非执行代码的场景（如 `python --version`），如有误报再优化检测正则。

## References

- 输入描述：用户提供的 feature description（2026-06-04）
- 代码库探针：`packages/execute-python/extensions/execute-python.ts`（renderResult 函数，lines 337-435）
- pi 系统提示词风格参考：`node_modules/@earendil-works/pi-coding-agent/dist/core/system-prompt.js`
- pi 扩展事件系统文档：`node_modules/@earendil-works/pi-coding-agent/docs/extensions.md`

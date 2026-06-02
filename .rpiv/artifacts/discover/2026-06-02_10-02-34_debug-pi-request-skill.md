---
date: 2026-06-02T10:02:34+0800
author: 蔡涛
commit: 44eb16b
branch: main
repository: rpiv-mono
topic: "调试 pi 请求的 skill — 用 debug-request-body 测量工具/插件的上下文占用"
tags: [intent, frd, pi-miscs, debug-request-body, skill]
status: complete
last_updated: 2026-06-02T10:02:34+0800
last_updated_by: 蔡涛
---

# FRD: 调试 pi 请求的 skill

## Summary

在 `@cnife/pi-miscs` 包下新增一个 skill，封装本会话中积累的「用 `debug-request-body` 测量 pi 工具/插件上下文占用」的经验和脚本。skill 包含 SKILL.md（最佳实践文档）和 measure-tokens.py（分析脚本），定位通用化，适用于 pi 使用者和插件开发者评估任意工具的 token 开销。

## Problem & Intent

作为 pi 的使用者和插件开发者，需要能评估工具、插件对 LLM 上下文的实际占用（token 数），从而决定是否使用、如何优化。现有的 `debug-request-body` 扩展提供了数据捕获能力，但缺少指导如何设计测试场景、如何分析 payload、如何解读结果的最佳实践文档和配套工具。

## Goals

- 提供一份完整的 SKILL.md，描述从「设置调试环境」到「分析 token 开销」的端到端流程
- 提供配套的 `measure-tokens.py` 脚本，自动分析捕获的 payload，输出结构化报告
- 脚本支持通过 `--tokenizer` 参数选择分词器（deepseek / cl100k_base / auto），`auto` 从 model 字段自动识别
- 覆盖静态开销（tools[] 定义、system prompt 注入）和动态开销（工具调用参数、返回结果）
- 通用化设计：可测量任意 pi 工具的 token 开销，不限于 rpiv 工具

## Non-Goals

- 不实现 pi extension（不是编程钩子，而是给 agent 读的 skill 文档）
- 不涉及修改 pi 的行为或工具定义本身
- 不覆盖工具执行耗时测量（纯 token 开销，不含性能计时）
- 分词器不绑定特定 provider，通过 `--tokenizer` 参数选择

## Functional Requirements

1. SKILL.md 应包含：背景说明、前置条件、操作步骤（设置 env var → 触发场景 → 捕获 payload → 分析结果）、数据解读指南
2. measure-tokens.py 应能从 `tools[]` 数组提取真实工具定义计算 token 数
3. measure-tokens.py 应自动从 system prompt 提取使用指南/guidelines
4. measure-tokens.py 应输出所有工具的静态 token 占用排名
5. measure-tokens.py 应输出决策参考（每轮对话总消耗、128K 窗口可支撑轮数）
6. 脚本应支持 `--analyze-only` 模式（复用已有 payload，不启动 pi）
7. 脚本应通过 `uv run --script` 直接执行，自动管理依赖（PEP 723）
8. 通过 `--tokenizer` 参数选择分词器（`deepseek`/`cl100k_base`/`auto`），auto 模式从 model 字段自动识别

## Non-Functional Requirements

- **Performance**: 脚本分析应在 5 秒内完成（vs 手动分析数小时）
- **Reliability**: payload 文件缺失时应优雅回退（字符串估算，不崩溃）
- **Portability**: 单文件脚本，`uv run --script` 即可运行，无需预先安装
- **Accuracy**: 默认使用 DeepSeek 自研分词器（`deepseek-tokenizer`），vocab=128818，对中文更高效；可通过 `--tokenizer` 切换

## Constraints & Assumptions

- `debug-request-body` 扩展已安装在 `@cnife/pi-miscs` 中
- `PI_DEBUG_REQUEST_BODY` 环境变量控制扩展激活
- 目标部署位置：`packages/miscs/skills/measure-tokens/`
- `package.json` 需新增 `"skills": ["./skills"]` 字段
- 用户有 tmux 可用（skill 文档描述手动操作替代方案）
- DeepSeek 分词器可从 PyPI 安装（`deepseek-tokenizer` 包）；cl100k_base 来自 `tiktoken`

## Acceptance Criteria

- [ ] `uv run measure-tokens.py --analyze-only --tokenizer auto` 输出完整报告，自动识别分词器
- [ ] `uv run measure-tokens.py --analyze-only --tokenizer cl100k_base` 使用 GPT-4 分词器输出结果
- [ ] 报告包含所有工具的 token 占用排名
- [ ] 报告区分静态开销和动态开销
- [ ] SKILL.md 描述了完整的调试流程，一个未接触过该工具的人能照着操作

## Recommended Approach

在 `@cnife/pi-miscs` 包中新增 `skills/measure-tokens/` 目录，包含 SKILL.md 和 measure-tokens.py。package.json 添加 `"skills": ["./skills"]` 字段。SKILL.md 描述端到端最佳实践，measure-tokens.py 作为自动化分析工具。通过 `uv run --script` 驱动脚本，零安装依赖。`--tokenizer` 参数控制分词器选择。

## Decisions

### 产物形态

**Question**: 做成 extension 还是 skill？
**Recommended**: extension（编程钩子）
**Chosen**: skill（文档 + 脚本）
**Rationale**: 用户明确表示只要 SKILL.md + 脚本，不需要编程扩展

### 部署位置

**Question**: 放在哪个包下面？
**Recommended**: `@cnife/pi-miscs`，已有 `debug-request-body` 扩展，天然配套
**Chosen**: `packages/miscs/skills/measure-tokens/`
**Rationale**: 配套已有扩展，package.json 只需新增 skills 字段

### 通用性范围

**Question**: 只覆盖本次实验场景，还是通用化？
**Recommended**: 通用化，覆盖任意工具的 token 开销测量
**Chosen**: 通用化
**Rationale**: 作为 skill 应该能重复使用，不绑定特定工具

### 分词器选择

**Question**: 固定用 DeepSeek 分词器还是可配置？
**Recommended**: 可配置，默认 DeepSeek
**Chosen**: `--tokenizer` 参数（deepseek / cl100k_base / auto）
**Rationale**: 用户可能用不同 provider（GPT、Claude 等），不同模型用不同分词器更准确

## Open Questions

- 是否需要处理 provider 返回的 `usage` 信息中的 token 统计？暂不处理，依赖 payload 捕获

## Suggested Follow-ups

- agent tool 的 description 占用 3412 tokens（占 tools[] 的 52%），可考虑向 pi 维护者建议精简
- 后续可扩展为「工具性能分析套件」，加入执行耗时测量（利用 tool_execution_start/end hooks）

## References

- `/home/cnife/.pi/agent/npm/node_modules/@cnife/pi-miscs/extensions/debug-request-body.ts` — 现有 debug 扩展
- `/home/cnife/github_code/rpiv-mono/measure-tokens.py` — 本次实验开发的测量脚本
- `/home/cnife/github_code/rpiv-mono/.rpiv/artifacts/discover/2026-06-02_09-11-29_measure-token-overhead-rpiv-tools.md` — 本次实验的 FRD

---
date: 2026-06-28T22:48:15+0800
author: CNife
commit: a120028
branch: main
repository: pi-extensions
topic: "Cache Hit Rate footer 格式对齐 pi 原生"
tags: [intent, frd, cache-hit-rate, footer, format]
status: ready
last_updated: 2026-06-28T22:48:15+0800
last_updated_by: CNife
---

# FRD: Cache Hit Rate footer 格式对齐 pi 原生

## Summary

将 `@cnife/pi-cache-hit-rate` 的 footer 文本格式从 `Cache C:12.34 T:92.10 R:96.30 M:1.2k`（冒号 + 2 位小数）改为 `Cache C12.3% T92.1% R96.3% M1.2k`（无冒号 + 1 位小数 + 百分号），对齐 pi 原生 footer 的「前缀直连数值」风格。仅改文本模板，着色机制与指标计算逻辑零改动。

## Problem & Intent

开发者原话：「给 cache-hit-rate 插件做个显示上的小优化，与 pi 原生的提示方式对齐，格式从 `C:12.34` 改成 `C12.3`，其他几个也类似」。

访谈中明确的两点动机：

1. **紧凑省位** —— 当前 footer 字符太多（冒号 + 2 位小数），想压缩占用宽度。
2. **可读性** —— 2 位小数过于精细，1 位小数已足够区分缓存健康度。

背景目标：与 pi 原生状态行风格统一，减少「插件感」与视觉割裂。

## Goals

- 压缩 footer 宽度：去掉冒号、百分比小数位 2→1
- 与 pi 原生 footer 数字风格对齐：无冒号、前缀字母直连数值、百分比带 `%`
- 保持 1 位小数足以区分缓存健康度

## Non-Goals

- 不动着色机制（`applyColor` + `colorRules` 配置文件）
- 不动指标计算逻辑（`buildState`、miss 累计、baselinePrompt 轮边界处理）
- 不改 C/T/R/M 四个前缀字母（它们是本扩展的语义标识）
- 不对齐 pi 原生 `formatTokens` 的细分分段（M 保留现有 `fmtCompact`）

## Functional Requirements

1. 系统应将 C/T/R 三个百分比指标格式化为「前缀 + 1 位小数 + `%`」，无冒号、无空格（如 `C12.3%`）。
2. 系统应将 M 指标格式化为「前缀 + 紧凑数字」，无冒号（如 `M1.2k`），保留现有 `fmtCompact` 的分段逻辑（`<1000` 直显、`<1M` 用 `1.2k`、否则 `1.2M`）。
3. 系统在无数据（`totalPromptTokens <= 0`）时应显示 `Cache C--.-% T--.-% R--.-% M--`。
4. 着色规则（`applyColor` 按 `colorRules` 区间着色）与指标计算（`buildState` + miss 累计）行为保持不变。

## Non-Functional Requirements

- **Performance**: 无新增开销，仅替换字符串模板与 `toFixed` 参数。
- **UX / Accessibility**: footer 宽度减少约 4 字符（非空：`C:12.34`→`C12.3%` 每项省 1 字符 ×3 + `M:1.2k`→`M1.2k` 省 1；空状态省 3 字符），为其他状态项留出位置；1 位小数降低视觉噪音。
- **Reliability**: 不引入新错误路径；空状态占位与新格式对称，避免「有时有 % 有时无」的歧义。

## Constraints & Assumptions

- 改动限于 `packages/cache-hit-rate/extensions/cache-hit-rate.ts`（`fmtPercent` + `formatStatus`）与 `packages/cache-hit-rate/README.md`（footer 示例）。
- 遵循项目 Biome 格式规范（双引号、2 空格缩进）。
- 不直接修改 `~/.pi/agent/` 下已安装文件；走仓库 `git commit` + `git push` + `pi update` 流程安装，本地测试用 `pi -ne -ns -e packages/cache-hit-rate/extensions/cache-hit-rate.ts`（见项目 AGENTS.md）。
- 假设：pi 原生 footer 风格以 `/home/cnife/github/pi/packages/coding-agent/src/modes/interactive/components/footer.ts` 为准（probe 已验证，测试 `test/footer-width.test.ts:142` 断言 `CH25.0%`）。

## Acceptance Criteria

- [ ] `cache-hit-rate.ts` 的 `fmtPercent` 对非 null 值调用 `toFixed(1)`，null 返回 `--.-`。
- [ ] `formatStatus` 非空分支输出形如 `Cache C12.3% T92.1% R96.3% M1.2k`（无冒号、1 位小数、C/T/R 带 `%`、M 不带 `%`）。
- [ ] `formatStatus` 空状态分支输出 `Cache C--.-% T--.-% R--.-% M--`。
- [ ] diff 不触及 `applyColor`、`validateColorRules`、`loadConfig`、`buildState`、`getUsageSample` 及 `message_end` 处理器中 miss 计算的函数体。
- [ ] `README.md` 的 footer 格式示例（第 15 行附近）与「无数据时显示」示例（第 18 行附近）更新为新格式。
- [ ] 用 extension-e2e-test 技能在 tmux 隔离加载改动后扩展，footer 实际渲染显示新格式（`C12.3%` 样式，无冒号）。

## Recommended Approach

仅修改 `packages/cache-hit-rate/extensions/cache-hit-rate.ts` 的 `fmtPercent`（`toFixed(2)`→`toFixed(1)`、null 占位 `--.--`→`--.-`）与 `formatStatus`（C/T/R 模板从 `X:${fmtPercent(v)}` 改为 `X${fmtPercent(v)}%`、M 从 `M:${fmtCompact(v)}` 改为 `M${fmtCompact(v)}`、空状态硬编码字符串同步），以及 `packages/cache-hit-rate/README.md` 的 footer 格式示例两处。着色（`applyColor` + `colorRules`）与计算（`buildState` + miss）逻辑不动。无新文件、无新依赖、无配置迁移。

## Decisions

### 改动边界：只改文本模板

**Question**: 探查发现着色机制（`applyColor` + `colorRules`，cache-hit-rate.ts:263-290）和指标计算（`buildState` + miss 累计，cache-hit-rate.ts:197-253、420-423）都与 footer 文本格式解耦。这次只改文本模板（冒号/小数位/紧凑格式），着色和计算逻辑保留不动，对吗？
**Recommended**: 只改文本模板
**Chosen**: 只改文本模板
**Rationale**: evidence: packages/cache-hit-rate/extensions/cache-hit-rate.ts:263-290 + :197-253 与 formatStatus:297-345 解耦，confirmed

### 前缀字母：保持 C/T/R/M

**Question**: 探查发现 pi 原生缓存命中率用 `CH` 前缀（footer.ts:137-138），但本扩展用 C/T/R/M 四字母区分四个独立指标，且 T/R/M 在 pi 原生 footer 无对应项。保持扩展的 C/T/R/M 前缀不变，对吗？
**Recommended**: 保持 C/T/R/M
**Chosen**: 保持 C/T/R/M
**Rationale**: C/T/R/M 是本扩展的语义标识，pi 原生无 T/R/M 对应项；改 CH 会破坏四指标区分，且非本扩展前缀对齐的原话意图

### 百分号：C/T/R 加 %

**Question**: C/T/R 三个百分比指标，要不要在数字后加 `%` 号？pi 原生 `CH45.6%` 带 %（footer.ts:137-138），但你原话示例 `C12.3` 不带 %。
**Recommended**: 不加 %（C12.3）——符合原话示例与紧凑 intent
**Chosen**: 加 %（C12.3%）
**Rationale**: developer 明确选择加 % 以与 pi 原生 `CH45.6%` 完全对齐；evidence: /home/cnife/github/pi/packages/coding-agent/src/modes/interactive/components/footer.ts:137-138 + test/footer-width.test.ts:142

### M 紧凑格式：保留现有 fmtCompact

**Question**: M（累计失效 token）的紧凑格式怎么处理？当前 `fmtCompact`（cache-hit-rate.ts:169-173）分段比 pi 原生 `formatTokens`（footer.ts:23-29）粗。
**Recommended**: 保留现有 fmtCompact
**Chosen**: 保留现有 fmtCompact
**Rationale**: 最小 diff 符合「只改文本模板」intent；miss token 量级一般不大，细分分段差异实际很少显现；仅去冒号（`M:1.2k`→`M1.2k`）

### 空状态占位：带 %

**Question**: 空状态占位要不要带 `%`？当前 `C:--.--`（无 %），非空将变成 `C12.3%`（有 %）。
**Recommended**: 带 %（C--.-%）
**Chosen**: 带 %（C--.-%）
**Rationale**: 与非空格式 `C12.3%` 对称，一眼可辨是百分比指标，避免「有时有 % 有时无」的视觉歧义

### 验收方式：tmux E2E 目视

**Question**: 改动完成后怎么验收？
**Recommended**: tmux E2E 目视
**Chosen**: tmux E2E 目视
**Rationale**: 符合项目 AGENTS.md 扩展本地测试规范与 extension-e2e-test 技能，能看到真实 footer 渲染效果而非纸面格式

## Open Questions

无。

## Suggested Follow-ups

- README.md 的「指标说明」表格（第 49-58 行）描述指标含义而非显示格式，本次无需改；若未来想统一文档语气可复核。
- pi 原生 `formatTokens` 的细分分段（`<10000` 才用 1 位小数、`<1M` 取整、`<10M` 才用 1 位小数 M，footer.ts:23-29）若未来 M 量级增大显现差异，可再对齐 `fmtCompact`。

## References

- `packages/cache-hit-rate/extensions/cache-hit-rate.ts` —— 待改（`fmtPercent`:292-295、`formatStatus`:297-345）
- `packages/cache-hit-rate/README.md` —— 待改（footer 示例:14-20）
- `/home/cnife/github/pi/packages/coding-agent/src/modes/interactive/components/footer.ts:23-29, 133-145` —— pi 原生 footer 格式参考
- `/home/cnife/github/pi/packages/coding-agent/test/footer-width.test.ts:142` —— `CH25.0%` 断言

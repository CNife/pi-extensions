---
date: 2026-06-29T15:14:46+0800
author: 蔡涛
commit: b89c066
branch: main
repository: pi-extensions
topic: "Simplify inference-speed footer display"
tags: [intent, frd, inference-speed]
status: ready
last_updated: 2026-06-29T15:14:46+0800
last_updated_by: 蔡涛
---

# FRD: Simplify inference-speed footer display

## Summary

精简 `packages/inference-speed/` 扩展的 footer 显示：去掉 `TPS` 前缀、把 `TTFT` 缩成 `FT`，有数据态从 `TPS12.3T/s TTFT1.2s` 变成 `12.3T/s FT1.2s`，无数据占位符从 `TPS--.-T/s TTFT -.-s` 变成 `--.-T/s FT -.-s`。改动限于扩展内两个字符串字面量加 README 三处格式样例，不触碰计算口径与事件逻辑。

## Problem & Intent

用户原话：**标签冗长累赘**。footer 上 `TPS`/`TTFT` 前缀看着啰嗦，纯粹想精简视觉——并不缺 footer 空间。这决定了后续细节不必为极致省字符牺牲可读性（保留中间空格、保留 `FT` 这种仍可辨识的缩写）。

## Goals

- 去掉 footer 显示里的冗长标签（`TPS` 前缀、`TTFT` 全写）
- 新格式与 repo 内 footer 短标签约定（`cache-hit-rate` 的 `C`/`T`/`R`/`M`）协调
- 同步更新 README 文档的格式样例，保持文档与实现一致

## Non-Goals

- 不改 TPS/TTFT 的计算口径（`output/elapsed`、首 delta 计时公式）
- 不改事件处理逻辑（`session_start`/`session_tree`/`session_compact`/`model_select`/`before_provider_request`/`message_update`/`message_end`）
- 不加测试（repo 内 `packages/` 下所有扩展均无测试文件，遵循现状）
- 不统一有数据态和占位符态的空格差异（用户选了保持现状的占位符空格习惯）

## Functional Requirements

1. 系统 SHALL 在有数据时 footer 显示 `${tps.toFixed(1)}T/s FT${ttft.toFixed(1)}s`（示例 `12.3T/s FT1.2s`）——去掉 `TPS` 前缀、`TTFT` 缩为 `FT`。
2. 系统 SHALL 在无数据时 footer 显示 `--.-T/s FT -.-s`（dim 色）——保持当前占位符"标签后空格再缺省值"的视觉习惯。
3. 系统 SHALL 同步更新 `packages/inference-speed/README.md` 的格式样例：footer 格式块、占位符说明、故障排查表三处。

## Non-Functional Requirements

- **Performance**: 无影响，只改两个字符串字面量。
- **Security**: 无影响。
- **UX / Accessibility**: `FT` 缩写需可辨识（First Token，结合 `T/s` 单位与 README 说明自明）；新格式与 `cache-hit-rate` 短标签风格一致；占位符保留 dim 色区分无数据态。
- **Reliability**: 无影响，不动事件逻辑与计时锚点。

## Constraints & Assumptions

- 改动限于 `packages/inference-speed/extensions/inference-speed.ts:20`（`EMPTY` 常量）和 `:41`（`text` 模板）两个字符串字面量，加 `README.md` 三处样例——探查确认无其他代码引用这些字面量。
- 无测试文件，验证靠本地 tmux 加载扩展观察 footer。
- 不动 `@earendil-works/pi-coding-agent` peer dependency。
- 假设：`FT` 缩写对用户足够自明（结合 `T/s` 单位和 README 说明）；若研究阶段发现歧义，可回退到更长的 `TTFT` 或加前缀。

## Acceptance Criteria

- [ ] `packages/inference-speed/extensions/inference-speed.ts:20` 的 `EMPTY` 为 `"--.-T/s FT -.-s"`
- [ ] `packages/inference-speed/extensions/inference-speed.ts:41` 的 `text` 模板为 `` `${sample.tps.toFixed(1)}T/s FT${sample.ttft.toFixed(1)}s` ``
- [ ] `packages/inference-speed/README.md` 的 footer 格式样例（line 13 区域）、占位符说明（line 16 区域）、故障排查表（line 49 区域）均更新为新格式
- [ ] 本地 tmux 跑 `pi -ne -ns -e packages/inference-speed/extensions/inference-speed.ts`，发送一条消息后 footer 显示 `NN.NT/s FTN.Ns` 形态；未发消息时显示 `--.-T/s FT -.-s`（dim 色）

## Recommended Approach

改 `packages/inference-speed/extensions/inference-speed.ts` 的 `publish` 函数里两个字符串字面量（`:20` `EMPTY`、`:41` `text` 模板），同步更新 `packages/inference-speed/README.md` 三处格式样例，本地 tmux 加载扩展验证 footer 显示。无新文件、无新依赖、无持久化。

## Decisions

### 简化动机

**Question**: 你简化 inference-speed 的 footer 显示，主要想解决什么问题？这会决定后续细节（比如占位符、空格、缩写语义）该怎么取舍。
**Recommended**: n/a — `intent` question
**Chosen**: 标签冗长累赘（纯粹视觉精简，并不缺 footer 空间）
**Rationale**: 用户原话；决定了不必为极致省字符牺牲可读性——保留中间空格、保留 `FT` 可辨识缩写、占位符不必强行和有数据态统一空格。

### README 同步

**Question**: 探查发现 README.md 里有当前格式的样例（line 13 `TPS123.4T/s TTFT1.2s`、line 16/49 占位符 `TPS--.-T/s TTFT -.-s`）。本次改动是否一并更新 README 的格式样例？
**Recommended**: 一并更新 README
**Chosen**: 一并更新 README
**Rationale**: evidence: `packages/inference-speed/README.md:13/16/49` + confirmed；保持文档与实现一致，避免代码与文档脱节。

### 占位符格式

**Question**: 无数据时的占位符，当前是 `TPS--.-T/s TTFT -.-s`。新格式下你想要哪种？（当前代码有数据态 `TTFT1.2s` 和占位符态 `TTFT -.-s` 本身就不一致——占位符 TTFT 后多一个空格）
**Recommended**: `--.-T/s FT -.-s`（保持当前占位符的 FT 后空格习惯）
**Chosen**: `--.-T/s FT -.-s`
**Rationale**: 改动最小（只动 `TPS`/`TTFT` 两个标签），保持当前占位符"标签后空格再缺省值"的视觉惯例；用户动机是精简标签而非统一有数据/占位符格式，统一空格属于 scope 外的额外修正。

## Open Questions

无。

## Suggested Follow-ups

- 当前代码有数据态 `TTFT1.2s` 和占位符态 `TTFT -.-s` 本身就不一致（占位符 TTFT 后多一个空格）——本次保留了这个不一致（占位符 `FT` 后空格、有数据 `FT` 后无空格）。若未来想统一两种状态的空格规则，可单独处理。`packages/inference-speed/extensions/inference-speed.ts:20,41`
- 旧 FRD `.rpiv/artifacts/discover/2026-06-28_23-13-59_inference-speed.md` 记录了原始格式决策（`TPS--.-T/s TTFT -.-s` 占位、`TPS…T/s TTFT…s` 有数据态），本次改动后该归档文档与现状不同步——归档文档按惯例不动，但研究阶段可留意历史决策脉络。

## References

- 输入：用户 free-text `再简化下 packages/inference-speed/ 的显示：TPS12.3T/s TTFT1.2s -> 12.3T/s FT1.2s`
- 源文件：`packages/inference-speed/extensions/inference-speed.ts`
- 文档：`packages/inference-speed/README.md`
- 旧 FRD：`.rpiv/artifacts/discover/2026-06-28_23-13-59_inference-speed.md`
- 对标扩展：`packages/cache-hit-rate`（footer 短标签约定：`C`/`T`/`R`/`M` + `Cache` 前缀）

# plan 阶段 — 完整操作说明

## 输入

- grill 结论：`$CHANGE_DIR/change.md` 中最新 grill 节的澄清结论
- 项目用语：`$CHANGE_DIR/CONTEXT.md`（grill 产出）

## 核心原则

基于 grilled 结论一次性写入 plan.md，**不再追问**。如果 grill 阶段有遗漏导致无法写出完整方案，在 plan.md 中标注假设并继续。

## plan.md 模板

```markdown
# 变更方案

## 目标

{一句话描述这个变更要解决什么问题}

## 背景

{为什么需要这个变更，当前状态是什么}

## 最终方案

{方案的核心内容——架构、流程、结构}

## 关键决策

| # | 决策 | 理由 |
|---|------|------|
| 1 | {决策} | {理由} |

## 用语

{本次变更涉及的项目用语，与 CONTEXT.md 保持一致}

## 假设

{grill 未完全澄清的点，以假设方式声明}
```

## 写入规则

- 覆盖写入 `$CHANGE_DIR/plan.md`
- 所有用语与 `$CHANGE_DIR/CONTEXT.md` 保持一致
- 不引入 grill 阶段未讨论的新概念
- 假设声明以"假设："开头，标注不确定性

## change.md 追加

plan.md 写入完毕后，自动追加到 change.md（如 grill 阶段已追加过则跳过）。

## 停止条件

- plan.md 写入完毕 → 停止，提示进入 `/plan-to-tasks`
- grill 结论不足以写方案 → 标注假设，写入后停止

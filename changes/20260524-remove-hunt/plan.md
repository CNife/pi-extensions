# 变更方案

## 目标

删除本地 hunt 技能，改为使用 waza 的 hunt，减少维护负担。

## 背景

本地维护 hunt 技能增加维护成本，waza（tw93/waza）已提供更完善的 hunt 技能，包含 `when_to_use`、`dispatch_intent` 和 `Durable Context Preflight` 等增强功能。

## 最终方案

1. 删除 `skills/hunt/SKILL.md`
2. 更新 AGENTS.md 和 README.md：保留 hunt 引用，标注为外部技能
3. 更新 cnife-pi-workflow：添加脚注说明安装方式

## 关键决策

| # | 决策 | 理由 |
|---|------|------|
| 1 | 删除本地 hunt 技能 | 减少维护负担，避免重复 |
| 2 | 使用 waza 的 hunt | 统一技能来源，waza 版本更完善 |
| 3 | 保留文档引用 | 用户能知道有这个功能 |

## 用语

无新增用语。

## 假设

无。

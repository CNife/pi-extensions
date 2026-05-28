# 技能架构

采用**多个小技能**架构，受 [Matt Pocock skills](https://github.com/mattpocock/skills) 启发。

每个技能：

- 职责单一，只做一件事
- 独立完整，可单独使用
- 可自由组合，无隐式依赖

## 核心阶段（流水线）

```text
/grill → /plan → /plan-to-tasks → /write-code → /review-code
```

| 技能 | 说明 |
|------|------|
| `/grill` | 追问 + 领域对齐，澄清变更范围和用语 |
| `/plan` | 基于 grill 结论一次性写入 plan.md |
| `/plan-to-tasks` | 垂直切片拆解为可独立验证的子任务 |
| `/write-code` | TDD 红绿重构，逐 task 执行 |
| `/review-code` | AI 审查 + plannotator 人类审查 |

## 独立功能

| 技能 | 说明 |
|------|------|
| `/manage-change` | 变更目录管理：new、switch、status、list |
| `/improve-architecture` | 手动触发，扫描代码库发现架构改进机会 |

## 辅助技能（不入流水线，随时调用）

| 技能 | 说明 |
|------|------|
| `/prototype` | 可丢弃原型，验证代码层不确定性 |
| `/zoom-out` | 提升抽象层级，给出模块全景地图 |
| `/grill-me` | 纯追问，不写文件，不绑定变更 |
| `/handoff` | 会话交接，压缩对话为交接文档 |

## 诊断入口（按需触发，需安装 waza）

| 技能 | 说明 | 安装方式 |
|------|------|----------|
| `/hunt` | 根因诊断，出问题时调用 | `bunx skills add -g tw93/Waza` |

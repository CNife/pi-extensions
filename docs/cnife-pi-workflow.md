# 技能架构

采用**多个小技能**架构，受 [Matt Pocock skills](https://github.com/mattpocock/skills) 启发。

每个技能：

- 职责单一，只做一件事
- 独立完整，可单独使用
- 可自由组合，无隐式依赖

## 双 Agent 模型

采用执行 Agent + 审查 Agent 交替工作模式。两个独立 pi 会话，通过 `changes/<变更>/checkpoints/` 下的审查文件和 `change.md` 同步状态。

## 核心阶段（执行 Agent）

| 技能 | 说明 |
|------|------|
| `/grill` | 追问 + 领域对齐，澄清变更范围和用语 |
| `/plan` | 基于 grill 结论一次性写入 plan.md |
| `/plan-to-tasks` | 垂直切片拆解为可独立验证的子任务 |
| `/write-code` | TDD 红绿重构，逐 task 执行 |

## 审查阶段（审查 Agent）

| 技能 | 说明 |
|------|------|
| `/check-work` | 审查 Agent 入口——对照基线审查产物，输出审查结论 |

## 独立功能

| 技能 | 说明 |
|------|------|
| `/manage-change` | 变更目录管理：new、switch、status、list |
| `/improve-architecture` | 手动触发，扫描代码库发现架构改进机会 |

## 辅助技能（不入流水线，随时调用）

| 技能 | 说明 |
|------|------|
| `/init-builder` | 执行 Agent 初始化——定位变更、了解进度、检查审查文件 |
| `/init-checker` | 审查 Agent 初始化——自动推断待审查阶段、加载 /check |
| `/prototype` | 可丢弃原型，验证代码层不确定性 |
| `/zoom-out` | 提升抽象层级，给出模块全景地图 |
| `/grill-me` | 纯追问，不写文件，不绑定变更 |
| `/handoff` | 会话交接，压缩对话为交接文档 |

## 诊断入口（按需触发，需安装 waza）

| 技能 | 说明 | 安装方式 |
|------|------|----------|
| `/hunt` | 根因诊断，出问题时调用 | `bunx skills add -g tw93/Waza` |

审查 Agent 使用 Waza 的 `/check` 技能执行审查，安装方式同上。

---
name: development-workflow
description: 9 阶段 AI 开发工作流（write-plan → review-plan → plan-to-tasks → write-code ⇄ review-code ⇄ fix-code → write-test ⇄ review-test → write-docs）。提供变更目录解析、阶段输入输出约定、Plannotator 审阅入口。当用户执行开发任务、创建变更、或使用 /new-change /switch-change 时使用。
---

# Development Workflow — 入口文档

9 阶段 plan → code → test → docs 开发工作流。每个变更在 `changes/YYYYMMDD-<简写>/` 下以 plan.md、tasks.md、change.md 三个核心文件驱动。

**各阶段完整操作说明请参见 [`references/`](./references/) 下对应文件。**

## 流水线全景

```
/new-change → write-plan → review-plan → plan-to-tasks
                                              ↓
                                          write-code
                                              ↕
                              review-code ⇄ fix-code
                                              ↓
                              write-test ⇄ review-test
                                              ↓
                                          write-docs
```

| 阶段 | 命令 | 输入 | 产出 | 完整说明 |
|------|------|------|------|---------|
| 0 | `/new-change <简写>` | 变更简写 | `changes/YYYYMMDD-<简写>/` | — |
| 1 | `/write-plan` | 对话需求 | `plan.md` + `change.md`(v1) | [references/write-plan.md](./references/write-plan.md) |
| 2 | `/review-plan` | `plan.md` | 审核结论追加到 `change.md` | [references/review-plan.md](./references/review-plan.md) |
| 3 | `/plan-to-tasks` | `plan.md` | `tasks.md` + 追加 `change.md` | [references/plan-to-tasks.md](./references/plan-to-tasks.md) |
| 4 | `/write-code` | `tasks.md` | 编码 + 追加 `change.md` | [references/write-code.md](./references/write-code.md) |
| 5 | `/review-code` | `change.md` | 审阅报告追加到 `change.md` | [references/review-code.md](./references/review-code.md) |
| 5a | `/fix-code` | review-code 报告 | 修复 + 追加 `change.md` | [references/fix-code.md](./references/fix-code.md) |
| 6 | `/write-test` | `change.md` | 测试 + 追加 `change.md` | [references/write-test.md](./references/write-test.md) |
| 7 | `/review-test` | `change.md` | 审阅报告追加到 `change.md` | [references/review-test.md](./references/review-test.md) |
| 8 | `/write-docs` | `change.md` | 文档更新 + 追加 `change.md` | [references/write-docs.md](./references/write-docs.md) |

## 变更目录解析

各阶段 prompt 均遵守以下规则确定当前变更目录（记为 `$CHANGE_DIR`）：

1. `$ARGUMENTS` 非空 → 直接作为目录名使用
2. `changes/.active_change` 存在 → 读取其内容作为目录名（去掉首尾空白）
3. 执行 `ls changes/` 找到最近 `YYYYMMDD-*` 子目录 → 向用户确认
4. 以上均无 → 提示用户先执行 `/new-change <简写>`

`$CHANGE_DIR` 确定后，所有文件路径均相对于项目根目录。

## 核心文件约定

| 文件 | 角色 | 写入方式 |
|------|------|---------|
| `plan.md` | 变更方案（目标、结构、关键决策、实施要点） | 覆盖写入 |
| `tasks.md` | 子任务拆解与并行分层计划 | 覆盖写入 |
| `change.md` | 全流程变更日志（追加，版本号顺延 v1→v2→...） | 追加写入 |

## 阶段跳转索引

各阶段的完整操作说明、输出格式模板、编码/验证/审阅规则等详见 `references/` 下的对应文件：

| 阶段 | reference 文件 | 主要内容 |
|------|---------------|---------|
| write-plan | [references/write-plan.md](./references/write-plan.md) | 逐层提问流程、每次一问规则、输出格式模板 |
| review-plan | [references/review-plan.md](./references/review-plan.md) | 四类排查规则、审核输出格式、审核后同步 plan.md |
| plan-to-tasks | [references/plan-to-tasks.md](./references/plan-to-tasks.md) | 拆解规则、依赖分析、并行分层模板 |
| write-code | [references/write-code.md](./references/write-code.md) | 编码规则、并行执行指引、验证循环 |
| review-code | [references/review-code.md](./references/review-code.md) | 范围审阅、Hard Stops、format/lint 审查 |
| fix-code | [references/fix-code.md](./references/fix-code.md) | 修复流程、讨论模式、修复后验证 |
| write-test | [references/write-test.md](./references/write-test.md) | 测试范围、用例规范、验证规则 |
| review-test | [references/review-test.md](./references/review-test.md) | 测试质量审查、断言检查、覆盖率 |
| write-docs | [references/write-docs.md](./references/write-docs.md) | 文档影响评估、逐文件更新原则 |

### 操作约束精简版

各 Agent 实现时必须遵守的硬性约束，完整版见对应 references 文件：

| 约束 | 适用范围 | 说明 |
|------|---------|------|
| 审查最多 3 轮 | review-code | 含 fix-code 来回，第 3 轮为最终审阅 |
| 修复最多 3 次 | write-code, write-test | 验证失败后最多重试 3 次 |
| format/lint 修复最多 2 轮 | review-code | 2 轮后未解决的问题记录到残留清单 |
| 测试最多 2 轮审查 | review-test | 第 2 轮为最终测试审查 |
| 每层任务按 ID 顺序执行 | write-code | 每层内顺序执行，全部通过进入下一层 |
| 每次只问一个问题 | write-plan | 附带推荐选项和理由 |

## Plannotator 审阅入口

以下阶段可选使用 Plannotator 做人工可视化批注：

- **review-plan**：`plannotator annotate $CHANGE_DIR/plan.md` 标注方案
- **review-code**：`plannotator review` 在浏览器中查看 diff 并标注
- **review-test**：`plannotator annotate <测试文件>` 标注测试文件
- **write-docs**：`plannotator annotate <文档文件>` 标注文档更新

Plannotator 标注的反馈直接作为下一步的输入（如标注代码后直接进入 fix-code）。

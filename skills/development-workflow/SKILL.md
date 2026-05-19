---
name: development-workflow
description: 9 阶段 AI 开发工作流（write-plan → review-plan → plan-to-tasks → write-code ⇄ review-code ⇄ fix-code → write-test ⇄ review-test → write-docs）。提供变更目录解析、阶段输入输出约定、Plannotator 审阅入口。当用户执行开发任务、创建变更、或使用 /new-change /switch-change 时使用。
---

# Development Workflow

9 阶段 plan → code → test → docs 开发工作流。每个变更在 `changes/YYYYMMDD-<简写>/` 下以 plan.md、tasks.md、change.md 三个核心文件驱动。

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

| 阶段 | 命令 | 输入 | 输出 | 说明 |
|------|------|------|------|------|
| 0 | `/new-change <简写>` | 变更简写 | `changes/YYYYMMDD-<简写>/` | 创建变更目录并设为 active |
| 1 | `/write-plan` | 对话需求 | `plan.md` + `change.md`(v1) | 逐层提问，产出方案 |
| 2 | `/review-plan` | `plan.md` | 审核结论追加到 `change.md` | 四类排查（范围/模糊/矛盾/疏漏） |
| 3 | `/plan-to-tasks` | `plan.md` | `tasks.md` + 追加 `change.md` | 拆解为可独立验证的子任务 |
| 4 | `/write-code` | `tasks.md` | 编码 + 追加 `change.md` | 按并行分层逐层执行 |
| 5 | `/review-code` | `change.md` | 审阅报告追加到 `change.md` | 范围/Hard Stops/format/lint，最多 3 轮 |
| 5a | `/fix-code` | review-code 报告 | 修复 + 追加 `change.md` | 修复 review-code 发现的问题 |
| 6 | `/write-test` | `change.md` | 测试 + 追加 `change.md` | 为变更代码编写测试 |
| 7 | `/review-test` | `change.md` | 审阅报告追加到 `change.md` | 审查测试质量，最多 2 轮 |
| 8 | `/write-docs` | `change.md` | 文档更新 + 追加 `change.md` | 更新 README/AGENTS/docs/ |

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

## Plannotator 审阅入口

以下阶段可选使用 Plannotator 做人工可视化批注：

- **review-plan**：`plannotator annotate $CHANGE_DIR/plan.md` 标注方案
- **review-code**：`plannotator review` 在浏览器中查看 diff 并标注
- **review-test**：`plannotator annotate <测试文件>` 标注测试文件
- **write-docs**：`plannotator annotate <文档文件>` 标注文档更新

Plannotator 标注的反馈直接作为下一步的输入（如标注代码后直接进入 fix-code）。

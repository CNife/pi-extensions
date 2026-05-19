---
description: 根据plan.md拆解变更计划为可独立验证的子任务，分析依赖关系，生成并行分层执行计划，并追加变更记录到change.md
argument-hint: "[变更目录]"
---

按 development-workflow skill 中的变更目录解析规则确定 `$CHANGE_DIR`。

读取 `plan.md`，将变更计划拆解为可独立验证的子任务，分析依赖关系，按拓扑分层，写入 `tasks.md`，然后追加变更摘要到 `change.md`。

### 最少操作规则

- 一个子任务 = 一个可独立验证的变更点，完成后能用一条命令确认
- 修改不同模块、无接口依赖的子任务可并行
- 不凭空制造依赖

完整拆解规则、输出格式模板请参见 SKILL.md → [references/plan-to-tasks.md](../skills/development-workflow/references/plan-to-tasks.md)。

### 停止条件

tasks.md 写入完毕且 change.md 追加完毕 → 停止，不进入执行。

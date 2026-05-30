---
status: 待开始
priority: 高
depends_on: [T01-check-work-skill, T02-init-skills]
---

# T3: 更新现有技能和文档

**目标**：将 cnife-pi-workflow 和 README/docs 同步为双 Agent 模型，删除 review-code，更新 plan-to-tasks / write-code 移除 tasks.md。

**涉及文件**：

- `packages/change-based-workflow/skills/cnife-pi-workflow/SKILL.md`（修改）
- `packages/change-based-workflow/skills/review-code/SKILL.md`（删除）
- `packages/change-based-workflow/README.md`（修改）
- `docs/cnife-pi-workflow.md`（修改）

**具体内容**：

## cnife-pi-workflow 更新

1. 流水线图改为双 Agent 模型（执行 Agent 侧 + 审查 Agent 侧）
2. 核心阶段表：移除 `/review-code`，新增 `/check-work`
3. 独立功能表不变
4. 辅助技能表：新增 `/init-builder`、`/init-checker`
5. 依赖关系图：增加审查 Agent 分支
6. 快速开始：更新为双会话流程
7. 操作约束：移除审查最多 3 轮约束

### review-code 删除

直接删除 `skills/review-code/SKILL.md`。

### README 和 docs 更新

- README 技能表：移除 review-code，新增 check-work、init-builder、init-checker
- README 典型流程：改为双 Agent 流程简述
- docs/cnife-pi-workflow.md：同步 cnife-pi-workflow 技能的变更

### plan-to-tasks / write-code 技能更新

- `plan-to-tasks/SKILL.md`：移除 tasks.md 输出要求、stop condition 中的 tasks.md 检查、change.md 模板中的 tasks.md 引用
- `write-code/SKILL.md`：移除第 15 行 `tasks.md` 汇总引用（「汇总：`$CHANGE_DIR/tasks.md`」）

**验证方式**：

- review-code 目录已删除
- cnife-pi-workflow 无 review-code 引用残留
- README 技能表与 packages/ 下实际技能文件一致
- docs/cnife-pi-workflow.md 与 cnife-pi-workflow SKILL.md 内容同步

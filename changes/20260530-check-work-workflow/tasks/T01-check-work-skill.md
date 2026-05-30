---
status: 待开始
priority: 高
depends_on: []
---

# T1: 创建 check-work 技能

**目标**：实现审查 Agent 入口技能 `check-work`，定义审查协议和三个审查阶段的执行流程。

**涉及文件**：

- `packages/change-based-workflow/skills/check-work/SKILL.md`（新建）

**具体内容**：

1. skill frontmatter：name=check-work, description=审查 Agent 入口
2. 角色约定章节：只挑刺不动手、引用证据、分级明确（🔴 🟡 🟢）
3. 工作流程章节：
   - 定位变更目录（读取 `.active_change`）
   - 读取 change.md 了解当前进度（最近一条记录及其 `[执行]/[审查]` 标记）
   - 读取 `checkpoints/` 下文件，交叉验证待审查阶段
   - 不一致时向用户确认；一致则直接进入审查
   - 加载 `/check` 技能执行审查
   - 追加审查结论到审查文件下半部分
   - 更新 change.md，追加 `[审查]` 标记记录
4. 审查阶段对照表：

| 阶段 | 审查对象 | 基线 |
|------|---------|------|
| plan | 审查 plan.md 方案 | CONTEXT.md、根 CONTEXT.md |
| tasks | 审查 tasks/*.md 任务文件 | plan.md |
| code | 审查代码 diff | plan.md + tasks/*.md |

5. 审查文件格式模板（上半 [执行]、下半 [审查]）
6. 停止条件：审查文件不存在 → 提示执行 Agent 先完成阶段

**验证方式**：

- 文件存在且格式符合 skill 规范（frontmatter + markdown）
- 审查阶段对照表覆盖 plan / tasks / code 三种

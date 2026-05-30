---
name: init-checker
description: 审查 Agent 初始化——自动推断待审查阶段，加载审查技能
---

# Init-Checker — 审查 Agent 初始化

双 Agent 模式下，审查 Agent 会话的就位入口。

## 工作流程

1. 读取 `changes/.active_change` 定位当前变更目录
2. 优先自动推断待审查阶段：
   - 读 `change.md` 最近记录（`[执行]/[审查]` 标记）
   - 读 `checkpoints/` 下文件状态（plan.md / tasks.md / code.md 哪个有执行上下文但无审查结论）
   - 交叉验证，自动确定当前待审查的阶段
3. 用户提示为辅：推断不确定或用户主动说明时，接受用户指定
4. 加载 `/check` 技能（Waza）
5. 输出审查就绪状态：当前变更目录、待审查阶段、审查文件路径、推荐命令 `/check-work`

## 停止条件

- `.active_change` 不存在 → 停止，提示用户先用 `/manage-change new`
- 没有待审查的阶段（所有 checkpoints 文件都已填写审查结论） → 停止，提示用户等执行 Agent 完成下一阶段
- `/check` 技能加载失败 → 停止，提示用户安装 Waza：`bunx skills add -g tw93/Waza`
- 初始化完成 → 停止

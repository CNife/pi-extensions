---
status: 待开始
priority: 高
depends_on: []
---

# T2: 创建 init-builder / init-checker 技能

**目标**：创建两个初始化技能，让双 Agent 会话快速就位。

**涉及文件**：

- `packages/change-based-workflow/skills/init-builder/SKILL.md`（新建）
- `packages/change-based-workflow/skills/init-checker/SKILL.md`（新建）

**具体内容**：

## init-builder

1. frontmatter：name=init-builder, description=执行 Agent 初始化
2. 定位变更目录（`.active_change`）
3. 读取 change.md 了解当前阶段
4. 检查是否存在待处理的审查文件（`checkpoints/` 下文件），如有则读取审查结论并提示用户先修正
5. 输出当前状态：变更当前阶段、产物列表、下一步操作建议

### init-checker

1. frontmatter：name=init-checker, description=审查 Agent 初始化
2. 定位变更目录（`.active_change`）
3. 优先自动推断：读 change.md 最近记录 + `checkpoints/` 文件状态 → 自动确定待审查阶段
4. 用户提示为辅：推断不确定或用户主动说明时，接受用户指定
5. 加载 `/check` 技能
6. 输出审查就绪状态：待审查阶段、审查文件路径

**验证方式**：

- 两个文件均存在且 frontmatter 正确
- init-builder 能正确识别待处理的审查文件
- init-checker 能正确加载 /check 技能

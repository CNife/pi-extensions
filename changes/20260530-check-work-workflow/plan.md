# 变更方案

## 目标

将双 Agent 审查模式（执行 + 审查）融入 change-based-workflow 技能包，替换现有的单 Agent `/review-code` 收尾审查。

## 背景

当前工作流是单 agent 串行：`grill → plan → plan-to-tasks → write-code → review-code`。其中 `/review-code` 只在编码完成后执行一次 AI 审查 + plannotator 人类审查。

实际使用中发现更有效的模式是「双 Agent 交替」：执行 Agent 完成每个阶段后，审查 Agent 独立审查产物，通过审查文件交互反馈。三层审查节点（plan / tasks / code）能在早期发现设计问题，避免代码写完后大返工。

## 最终方案

### 1. 双 Agent 模型

| 角色 | 技能 | 职责 |
|------|------|------|
| 执行 Agent（Builder） | grill, plan, plan-to-tasks, write-code | 产出：plan.md、tasks/、代码 |
| 审查 Agent（Checker） | check-work | 审查 plan / tasks / code，输出发现项 |

审查 Agent 使用 Waza 的 `check` 技能执行实际审查。

### 1.1 会话初始化

双 Agent 模式需要两个独立 pi 会话（如两个终端窗口），各用初始化技能快速就位：

| 技能 | 用途 | 关键动作 |
|------|------|---------|
| `init-builder` | 执行 Agent 初始化 | 定位变更目录、读取当前阶段、检查是否有待处理的审查文件 |
| `init-checker` | 审查 Agent 初始化 | 定位变更目录、优先自动推断待审查阶段（读 change.md + checkpoints/）、加载 /check 技能 |

### 2. 审查协议

两个 Agent 通过 `changes/<变更>/checkpoints/` 下的审查文件交互：

```text
changes/<变更>/checkpoints/
├── plan.md       # plan 阶段的审查文件
├── tasks.md      # tasks 阶段的审查文件
└── code.md       # code 阶段的审查文件
```

每个文件的生命周期：

1. **执行 Agent** 完成阶段后，写文件上半部分（阶段产出摘要、上下文、关键决策）
2. **审查 Agent** 加载文件，执行 `/check` 审查，追加下半部分（发现项分级、修正建议）
3. **执行 Agent** 读取审查结论，逐项修正，准备进入下一阶段

文件持久保留作为审查记录，不删除。

### 3. 审查文件格式

```markdown
# 审查：<stage> 阶段

## 执行上下文 [执行]

- 变更目标：xxx
- 产物文件：plan.md / tasks/ / 代码 diff
- 关键决策：...

## 审查结论 [审查]

### 🔴 硬性阻塞
| # | 位置 | 问题 | 建议 |
|---|------|------|------|

### 🟡 遗漏 / 歧义
| # | 位置 | 问题 | 建议 |
|---|------|------|------|

### 🟢 建议
...
```

`[执行]` 和 `[审查]` 标记区分两部分来源。

### 4. 技能变更

| 操作 | 文件 | 说明 |
|------|------|------|
| **新增** | `skills/check-work/SKILL.md` | 审查 Agent 入口技能 |
| **新增** | `skills/init-builder/SKILL.md` | 执行 Agent 初始化技能 |
| **新增** | `skills/init-checker/SKILL.md` | 审查 Agent 初始化技能 |
| **修改** | `skills/cnife-pi-workflow/SKILL.md` | 更新流水线为双 Agent 模型，补充技能表、依赖图 |
| **修改** | `skills/plan-to-tasks/SKILL.md` | 移除 tasks.md 输出要求 |
| **修改** | `skills/write-code/SKILL.md` | 移除 tasks.md 汇总引用 |
| **删除** | `skills/review-code/SKILL.md` | 被 check-work 吸收 |
| **修改** | `README.md` | 技能表更新 |
| **修改** | `docs/cnife-pi-workflow.md` | 同步更新 |

### 5. check-work 技能

详见 `skills/check-work/SKILL.md`（待创建）。核心流程：

1. 读取 change.md 了解当前进度（最近一条记录及其 `[执行]/[审查]` 标记），读取 `checkpoints/` 下文件交叉验证待审查阶段
2. 加载 `/check` 技能（Waza）执行审查——如未安装 Waza，pi 会提示 skill not found
3. 追加审查结论到审查文件的下半部分
4. 更新 change.md，追加带 `[审查]` 标记的记录

| 审查阶段 | 审查对象 | 对照基线 |
|---------|---------|---------|
| plan | plan.md | CONTEXT.md、根 CONTEXT.md |
| tasks | tasks/*.md | plan.md |
| code | 代码 diff | plan.md + tasks/*.md |

### 6. 双 Agent 工作流示例

用户操作流程（两个 pi 会话窗口同时打开）：

```text
窗口 A（执行 Agent）                   窗口 B（审查 Agent）
─────────────────                     ─────────────────
/manage-change new xxx
/init-builder                         /init-checker
/grill → /plan
写 checkpoints/plan.md 上半
                                      /check-work（审查 plan）
                                      追加下半部分
读取审查结论，修正 plan.md
/plan-to-tasks
写 checkpoints/tasks.md 上半
                                      /check-work（审查 tasks）
                                      追加下半部分
读取审查结论，修正 tasks
/write-code
写 checkpoints/code.md 上半
                                      /check-work（审查 code）
                                      追加下半部分
读取审查结论，修正代码
完成
```

### 7. change.md 来源标记

追加记录用标签区分来源：

```markdown
# 变更 vN：xxx [执行]
# 变更 vM：xxx [审查]
```

## 关键决策

| # | 决策 | 理由 |
|---|------|------|
| 1 | 新增 check-work 技能而非修改现有技能 | 审查 Agent 是独立角色，独立入口便于用户区分会话 |
| 2 | 审查文件放在变更目录而非 /tmp | 与变更绑定，不随重启丢失，便于追溯 |
| 3 | 审查文件不删除、持久保留 | 作为审查记录，后续可复盘 |
| 4 | 删除 review-code 技能 | AI 审查部分被 check-work 覆盖，plannotator 不与特定工具绑定 |
| 5 | 审查文件一个阶段一个文件 | plan/tasks/code 审查内容不同，合并会混乱 |
| 6 | change.md 追加 [执行]/[审查] 标记 | 区分双 Agent 的贡献，方便追踪 |
| 7 | handoff 技能保持不变 | 跨会话继续场景与审查流程是独立用例 |
| 8 | 新增 init-builder / init-checker 技能 | 双会话模式下快速初始化角色，减少手动定位的成本 |
| 9 | check-work 直接加载 /check 技能，不做前置依赖检查 | pi 的 skill not found 提示已足够，无需额外检查 |
| 10 | 用户手动管理双会话，不自动化 | pi 不支持多 agent 协同 API，手动切换是最小复杂度方案 |
| 11 | 从工作流中移除 tasks.md 汇总文件 | tasks/ 目录下各 task 文件的 frontmatter 已包含依赖关系，tasks.md 冗余 |
| 12 | check-work 通过 change.md + checkpoints 文件状态确定阶段 | 两个文件是可靠的状态源，比自动判断更精确，不一致时向用户确认 |
| 13 | init-checker 优先上下文推断，用户提示为辅 | 减少用户操作，自动识别待审查阶段；推断失败时才接受用户指定 |
| 14 | 双 Agent 通过 change.md 和 checkpoints/ 同步状态 | 两个 agent 需要频繁读取最新状态，文件是唯一的状态同步机制 |
| 15 | plan-to-tasks / write-code 同步移除 tasks.md | 流程变更需两个技能同步更新，避免残留引用导致新 agent 困惑 |

## 用语

- **审查 Agent**（Checker）：挑刺角色，只审不动手，通过审查文件反馈
- **执行 Agent**（Builder）：干活角色，产出产物并响应审查反馈
- **审查文件**：`changes/<变更>/checkpoints/<stage>.md`，两个 Agent 共写的交互媒介
- **审查阶段**：plan / tasks / code 三个审查阶段
- **初始化技能**：`init-builder` / `init-checker`，双 Agent 会话的就位入口

## 假设

- 假设用户手动管理两个 Agent 会话的切换（同时开两个 pi 会话，一个执行一个审查）
- 假设审查 Agent 安装了 Waza（`bunx skills add -g tw93/Waza`）以使用 `/check` 技能

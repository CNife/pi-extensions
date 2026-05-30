# 20260530-check-work-workflow

本次变更新增或修改的项目用语。

## 新增

**审查 Agent**（Checker）：
挑刺角色，只审不动手。加载执行 Agent 的产物（plan / tasks / code），使用 `/check` 审查，通过审查文件反馈发现项。
_避免_：reviewer（太通用）、审计员

**执行 Agent**（Builder）：
干活角色，执行 grill → plan → plan-to-tasks → write-code 流水线，产出产物并响应审查反馈。
_避免_：developer、coder（太通用）

**审查文件**：
`changes/<变更>/checkpoints/<stage>.md`，两个 Agent 共写的交互媒介。上半部分由执行 Agent 填写（上下文），下半部分由审查 Agent 追加（发现项）。
_避免_：handoff 文档（handoff 是跨会话交接，审查文件是双 Agent 交互）

**审查阶段**：
plan / tasks / code 三个审查阶段，每个阶段完成后执行 Agent 触发审查 Agent。
_避免_：审查点、检查点（与审查文件命名区分）

**初始化技能**：
`init-builder` / `init-checker`，双 Agent 会话的就位入口，快速定位变更目录和当前阶段。
_避免_：setup、bootstrap

**双 Agent 模式**：
执行 Agent + 审查 Agent 交替工作模式，通过审查文件交互反馈。
_避免_：双人模式、对审模式

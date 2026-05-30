# 变更 v1：plan 方案 [执行]

## 方案摘要

- **双 Agent 模型**：执行 Agent（Builder）产出，审查 Agent（Checker）审查，通过审查文件交互
- **审查文件**：`changes/<变更>/checkpoints/{plan,tasks,code}.md`，共写、持久保留
- **技能变更**：新增 check-work / init-builder / init-checker，删除 review-code，更新 workflow 全景
- **change.md 标记**：[执行] / [审查] 区分来源

---

## 审查结论 v1：plan 方案 [审查]

### 审查范围

- **审查产物**：`plan.md`、`change.md`、`CONTEXT.md`
- **审查深度**：Standard（方案级审查）
- **范围漂移**：无

### 审查发现

#### 🔴 硬性阻塞

| # | 位置 | 问题 | 建议 |
|---|------|------|------|
| 1 | plan.md 假设 | 假设用户"同时开两个 pi 会话"手动管理双 Agent，但未说明如何实现 | 新增 `init-builder` 和 `init-checker` 技能，快速初始化角色 |

#### 🟡 遗漏 / 歧义

| # | 位置 | 问题 | 建议 |
|---|------|------|------|
| 1 | plan.md 技能依赖 | 假设审查 Agent 安装了 Waza，但未说明如何验证 | 改为直接加载 /check 技能，pi 自身提示 skill not found |
| 2 | plan.md 审查协议 | 未说明执行 Agent 如何接收审查结论 | 在初始化技能中补充读取审查文件的流程 |
| 3 | plan.md 技能变更 | 删除 review-code 的理由是"被 check-work 吸收"，但 check-work 尚未创建 | 用户确认可完全替代，无需额外操作 |
| 4 | plan.md 技能变更 | 新增 `init-builder` 和 `init-checker` 技能后，需要同步更新 `cnife-pi-workflow` 技能说明整体设计 | 在技能变更表中补充 `cnife-pi-workflow` 的更新 |

#### 🟢 建议

| # | 位置 | 建议 |
|---|------|------|
| 1 | plan.md 关键决策 | 添加双会话模式的使用示例 |
| 2 | CONTEXT.md 术语 | 添加"审查阶段"（plan/tasks/code）的术语定义 |

### 最终修改方案

1. **更新 `plan.md`**：
   - 添加双会话管理方案（`init-builder` 和 `init-checker` 技能）
   - 添加 Waza 依赖检查说明
   - 添加使用示例
   - 更新技能变更表，补充 `cnife-pi-workflow` 更新

2. **更新 `CONTEXT.md`**：
   - 添加"审查阶段"（plan/tasks/code）术语定义

3. **创建新技能**：
   - `init-builder`：执行 Agent 初始化技能
   - `init-checker`：审查 Agent 初始化技能

4. **确认替代关系**：
   - `check-work` 可完全替代 `review-code`

### 验证状态

- **工作树状态**：`main` 分支，3 个未追踪文件，1 个修改文件
- **验证命令**：无（方案审查，无代码可运行）
- **doc debt**：无

---

## 变更 v2：任务拆解 [执行]

### 产出文件

tasks.md, tasks/T01-check-work-skill.md, tasks/T02-init-skills.md, tasks/T03-update-existing.md

### 变更概述

将 plan.md 拆解为 3 个可独立验证的子任务，按 2 个并行层排列。新技能创建（T1/T2）可并行，文档同步（T3）依赖前两者。

### 任务摘要

| ID | 子任务 | 涉及文件 |
|----|--------|---------|
| T1 | 创建 check-work 技能 | skills/check-work/SKILL.md（新建） |
| T2 | 创建 init-builder / init-checker 技能 | skills/init-builder/, skills/init-checker/（新建） |
| T3 | 更新现有技能和文档 | cnife-pi-workflow, review-code, README, docs/ |

### 并行分层

| 层 | 包含任务 | 依赖 |
|----|---------|------|
| 1 | T1, T2 | 无 |
| 2 | T3 | T1, T2 |

---

## 审查结论 v2：任务拆解 [审查]

### 审查范围

- **审查产物**：`tasks.md`、`tasks/T01-check-work-skill.md`、`tasks/T02-init-skills.md`、`tasks/T03-update-existing.md`
- **对照基线**：`plan.md`（含审查修改方案）
- **审查深度**：Standard（任务级审查）

### 审查发现

#### 🔴 硬性阻塞

无。

#### 🟡 遗漏 / 歧义

| # | 位置 | 问题 | 建议 |
|---|------|------|------|
| 1 | T01 工作流程第2步 | "根据哪个文件存在判断当前阶段"——应通过 change.md 和 checkpoints 下的文件状态确定 | 改为"通过 change.md 和 checkpoints 下的文件状态确定当前阶段" |
| 2 | T03 handoff 更新 | 描述为"补充说明 handoff 的双向用途"，但 plan.md 决策 7 说"handoff 技能保持不变" | 移除 T03 中 handoff 部分，保留 handoff 作为单独技能不修改 |

#### 🟢 建议

| # | 位置 | 建议 |
|---|------|------|
| 1 | T01 审查阶段对照表 | 简化表格，直接列出审查对象，不用路径格式 |
| 2 | T02 init-checker 第6步 | 补充说明：上下文推断为主，用户提示为辅 |
| 3 | tasks.md 并行分层 | 补充可参考的 frontmatter 模板说明 |

### 最终修改方案

1. **删除 tasks.md**：从技能流程中移除 tasks.md 汇总文件（现有变更目录不动），tasks/ 目录下各 task 的 frontmatter 已含依赖关系
2. **更新 T01**：check-work 通过 change.md + checkpoints 文件状态交叉验证阶段（非自动判断）；简化审查阶段对照表
3. **更新 T02**：init-checker 上下文推断为主（读 change.md + checkpoints/），用户提示为辅
4. **更新 T03**：移除 handoff 修改（handoff 保持不变）；新增 plan-to-tasks / write-code 移除 tasks.md 的变更
5. **同步 plan.md**：追加关键决策 #11~#15，技能变更表移除 handoff、新增 plan-to-tasks / write-code

### 验证状态

- **工作树状态**：`main` 分支，3 个未追踪文件，1 个修改文件
- **验证命令**：无（任务审查，无代码可运行）
- **doc debt**：无

---

## 变更 v3：方案补充 [执行]

### 产出文件

plan.md（新增关键决策 #11~#15）

### 变更概述

根据审查修改方案补充 plan.md，新增关键决策 #11~#15，涵盖 tasks.md 移除、check-work 阶段确定、init-checker 推断策略、状态同步机制、plan-to-tasks/write-code 同步更新。

---

## 审查结论 v3：方案补充 [审查]

### 审查范围

- **审查产物**：`plan.md`、`change.md`
- **对照基线**：上一轮审查修改方案
- **审查深度**：Quick（验证补充是否完整）

### 审查发现

#### ✅ 已落实

| 修改项 | 文件 | 状态 |
|--------|------|------|
| 新增关键决策 #11~#15 | plan.md | ✅ |
| 移除 tasks.md 汇总文件 | plan.md 决策 #11 | ✅ |
| check-work 通过文件状态确定阶段 | plan.md 决策 #12 | ✅ |
| init-checker 优先上下文推断 | plan.md 决策 #13 | ✅ |
| plan-to-tasks/write-code 同步移除 tasks.md | plan.md 决策 #15 | ✅ |

#### 🔴 硬性阻塞

无。

#### 🟡 遗漏

无。tasks.md 保留不删（决策 #11 明确"现有变更目录不动"）。

### 验证状态

- **工作树状态**：`main` 分支
- **验证命令**：无（方案审查，无代码可运行）
- **doc debt**：无

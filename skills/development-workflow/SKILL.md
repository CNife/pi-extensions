---
name: development-workflow
description: AI 开发工作流——围绕 Plan/Code/Test/Docs 三个半工件做 write-review 循环，支持 quick/feature/arch 入口分类。提供变更目录解析、阶段输入输出约定、Plannotator 审阅入口。当用户执行开发任务、创建变更、或使用 /new-change /switch-change /hunt 时使用。
---

# Development Workflow — 入口文档

变更 = **Plan** + **Code** + **Test** + **Docs**，三个半工件各做 write → review 循环。
入口分类（quick/feature/arch）决定路径深度，所有阶段均为可选。

每个变更在 `changes/YYYYMMDD-<简写>/` 下以 plan.md、tasks.md、change.md 三个核心文件驱动。

**各阶段完整操作说明请参见 [`references/`](./references/) 下对应文件。**

## 入口分类

```
/new-change <简写> [类型]

类型：
  quick   — 小修小改（<5 文件，无 schema 变更）
           默认路径：write-plan → write-code → write-test
  feature — 新功能开发
           默认路径：write-plan → review-plan → plan-to-tasks →
                    write-code → review-code ⇄ fix-code →
                    write-test → review-test → write-docs
  arch    — 架构变更/重构/迁移
           默认路径：完整流程 + 可选 hunt 调试入口

不指定时默认 feature。

在任意阶段均可调整路径深度：
  降级: "简化" → 跳过当前及后续 review/测试/docs 阶段
  升级: "需要 review" → 补上 review 阶段
  改类型: "这是 arch 级变更" → 重新映射默认路径
```

## 阶段总览

### Plan（文档）

| 命令 | 说明 | 默认启用 |
|------|------|---------|
| `/write-plan` | 写方案 + glossary + 假设声明 | quick/feature/arch |
| `/review-plan` | 审阅方案 + 术语 + 假设 | feature/arch |
| `/plan-to-tasks` | 垂直切片拆解任务 | feature/arch |

### Code（代码 + 单元验证）

| 命令 | 说明 | 默认启用 |
|------|------|---------|
| `/write-code` | 编码 + 反馈环优先 + 每片自验证 | quick/feature/arch |
| `/review-code` | 审阅代码 + 完整性 + 调试质量 | feature/arch |
| `/fix-code` | 修复 + 根因断言 | feature/arch |
| `/hunt` | 调试入口（根因定位 + 反馈环）| arch |

### Test（验收/集成测试）

| 命令 | 说明 | 默认启用 |
|------|------|---------|
| `/write-test` | 集成测试 + E2E 验收 | quick/feature/arch |
| `/review-test` | 审阅测试质量 | feature/arch |

### Docs（发布文档）

| 命令 | 说明 | 默认启用 |
|------|------|---------|
| `/write-docs` | 更新 README 等发布文档 | feature/arch |

各阶段完整操作说明请参见 [`references/`](./references/) 下对应文件。

---

## 默认路径一览

| 入口类型 | 自动执行的阶段 |
|---------|--------------|
| **quick** | write-plan → write-code → write-test |
| **feature** | write-plan → review-plan → plan-to-tasks → write-code → review-code ⇄ fix-code → write-test → review-test → write-docs |
| **arch** | feature 路径 + 可选 /hunt 入口 |

---

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
| `plan.md` | 变更方案（目标、结构、关键决策、实施要点 + 假设声明） | 覆盖写入 |
| `tasks.md` | 子任务拆解与并行分层计划（垂直切片） | 覆盖写入 |
| `change.md` | 全流程变更日志（顶部 STATE 段 + 版本号顺延 v1→v2→...） | 追加写入 |
| `glossary.md` | 术语表（有歧义的术语记录，write-plan 阶段维护） | 追加写入 |

## 阶段跳转索引

各阶段的完整操作说明、输出格式模板、编码/验证/审阅规则等详见 `references/` 下的对应文件：

| 阶段 | reference 文件 | 主要内容 |
|------|---------------|---------|
| write-plan | [references/write-plan.md](./references/write-plan.md) | 逐层提问 + glossary 维护 + 假设声明 + 辨证框架 |
| review-plan | [references/review-plan.md](./references/review-plan.md) | 六类排查（含术语一致 + 假设合理）、审核后同步 plan.md |
| plan-to-tasks | [references/plan-to-tasks.md](./references/plan-to-tasks.md) | 垂直切片拆解、来源决策引用 |
| write-code | [references/write-code.md](./references/write-code.md) | 反馈环优先 + 每片自验证 + 垂直切片执行 |
| review-code | [references/review-code.md](./references/review-code.md) | 范围审阅 + 切片完整性 + 调试质量检查 |
| fix-code | [references/fix-code.md](./references/fix-code.md) | 根因断言 + 可证伪假设 + handoff 保护 |
| write-test | [references/write-test.md](./references/write-test.md) | 验收/集成测试、测试范围界定 |
| review-test | [references/review-test.md](./references/review-test.md) | 测试质量审查、断言检查、覆盖率 |
| write-docs | [references/write-docs.md](./references/write-docs.md) | 文档分类（内联 vs 发布）、逐文件更新 |

### 操作约束精简版

各 Agent 实现时必须遵守的硬性约束，完整版见对应 references 文件：

| 约束 | 适用范围 | 说明 |
|------|---------|------|
| 入口类型决定默认路径 | /new-change | quick/feature/arch 三种类型，不指定默认 feature |
| 审查最多 3 轮 | review-code | 含 fix-code 来回，第 3 轮为最终审阅 |
| 修复最多 3 次 | write-code, write-test | 验证失败后最多重试 3 次 |
| format/lint 修复最多 2 轮 | review-code | 2 轮后未解决的问题记录到残留清单 |
| 测试最多 2 轮审查 | review-test | 第 2 轮为最终测试审查 |
| 每层任务按 ID 顺序执行 | write-code | 每层内顺序执行，全部通过进入下一层 |
| 每次只问一个问题 | write-plan | 附带推荐选项和理由 |
| 根因断言后才能修复 | fix-code | 修 bug 前必须写 Root cause: 文件:行号 |
| 三次修复失败→handoff | fix-code | 同一问题 3 次不通过，自动产出状态快照 |
| tasks 优先垂直切片 | plan-to-tasks | 每片端到端穿透所有层，而非按技术层水平拆 |

## Plannotator 审阅入口

以下阶段可选使用 Plannotator 做人工可视化批注：

- **review-plan**：`plannotator annotate $CHANGE_DIR/plan.md` 标注方案
- **review-code**：`plannotator review` 在浏览器中查看 diff 并标注
- **review-test**：`plannotator annotate <测试文件>` 标注测试文件
- **write-docs**：`plannotator annotate <文档文件>` 标注文档更新

Plannotator 标注的反馈直接作为下一步的输入（如标注代码后直接进入 fix-code）。

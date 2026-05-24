# 变更方案

## 目标

将 Matt Pocock engineering 技能融入现有 `changes/` 文件驱动工作流，用文件替代 GitHub Issue 作为计划—任务—状态追踪载体。

## 背景

现有工作流 9 个阶段（write-plan → review-plan → plan-to-tasks → write-code → review-code ⇄ fix-code → write-test → review-test → write-docs），已有一整套 `/command` 体系和 reference 文档。Matt Pocock 的 engineering 技能中有几个不依赖 GitHub Issue 的核心方法论（领域文档对齐、TDD、垂直切片），可以融入增强现有流水线。

## 最终流水线

```
/new-change <简写>
    │
    ├─ /grill                   ← 追问 + 领域对齐
    │   changes/<name>/CONTEXT.md, changes/<name>/adr/
    │
    ├─ /plan                    ← 写 plan.md（基于 grilled 结论）
    │
    ├─ /plan-to-tasks            ← 垂直切片拆解
    │   tasks/T01-xxx.md ...
    │
    ├─ /write-code = tdd         ← 红绿重构
    │
    ├─ /review-code              ← AI 审查 + 修复
    │   │
    │   └─ plannotator review    ← 人类审查
    │
    └─ /improve-architecture     ← 手动触发：扫描 → 改进列表 → 你选择 → 创建新变更

辅助技能（不入流水线，随时调用）：
    /prototype                   ← 可丢弃原型，验证代码层不确定性
    /zoom-out                    ← 提升抽象层级，给出模块全景地图
    /grill-me                    ← 纯追问，不写文件；确认每个决策分支都理清

诊断入口（按需触发）：
    /hunt                        ← 根因诊断，出问题时调用
```

**6 个核心命令**：`grill` `plan` `plan-to-tasks` `write-code` `review-code` `improve-architecture`

**4 个辅助**：`prototype` `zoom-out` `hunt` `grill-me`

## 版本对比

| 旧版本（9 阶段） | 新版本 | 变更 |
|-----------------|--------|------|
| `/write-plan` | `/grill` + `/plan` | 拆成两个命令：先 grill 追问对齐，再 plan 写方案 |
| `/review-plan` | — | 去掉：plan 的对错你直接看 |
| `/plan-to-tasks` | `/plan-to-tasks` | 不变：已覆盖 Matt 垂直切片理念 |
| `/write-code` | `/write-code` | 内容替换为 tdd 红绿重构 |
| `/review-code` ⇄ `/fix-code` | `/review-code` | AI 审 + autofix + plannotator 人类审；范围参考 check + diagnose |
| `/write-test` ⇄ `/review-test` | — | 去掉：tdd 中测试和实现同循环产出 |
| `/write-docs` | — | 去掉：grill-with-docs 已前置更新文档 |
| — | `/improve-architecture` | 新增：improve-codebase-architecture |
| — | `/prototype` | 新增：独立辅助技能，可丢弃原型验证代码不确定性 |
| — | `/zoom-out` | 新增：提升抽象层级，给出模块全景地图 |
| `/hunt` | `/hunt` | 不变 |

## 技能去留对照

| Matt 技能 | 决定 | 去向 |
|-----------|------|------|
| grill-me | ✅ 保留 | 新命令 `/grill-me`（独立辅助，纯追问不写文件） |
| grill-with-docs | ✅ 保留 | `/grill`（追问 + 领域对齐） + `/plan`（写方案） |
| tdd | ✅ 保留 | 替换 `/write-code` 内容 |
| prototype | ✅ 保留 | 新命令 `/prototype` |
| improve-codebase-architecture | ✅ 保留 | 新命令 `/improve-architecture` |
| zoom-out | ✅ 保留 | 新命令 `/zoom-out` |
| diagnose | ❌ 丢弃 | `/hunt` 已覆盖，且多了 Scope Blast、Gotchas、Runtime Evidence Ladder |
| to-issues | ♻️ 逻辑吸收 | `/plan-to-tasks` 已吸收垂直切片理念 |
| to-prd | ♻️ 逻辑吸收 | `plan.md` 已覆盖 |
| triage | ❌ 丢弃 | 无需 Issue 分类分流 |
| setup-matt-pocock-skills | ❌ 丢弃 | 无需 GitHub 脚手架 |

## 变更目录最终结构

```
changes/YYYYMMDD-<简写>/
├── plan.md              # 变更方案（目标、关键决策、术语、假设）
├── CONTEXT.md           # 本次变更新增/修改的术语 → 变更完成后同步到根 CONTEXT.md
├── tasks/               # 可执行任务切片（每个 = ready-for-agent）
│   ├── T01-xxx.md                  # status: 待开始
│   ├── T02-xxx.md                  # status: 待开始, depends_on: [T01-xxx]
│   └── T03-xxx.md                  # status: 待开始, depends_on: [T02-xxx]
├── adr/                 # 本变更产生的架构决策 → 变更完成后一次性同步到 docs/adr/
│   └── xxx.md
└── change.md            # 全流程日志（追加写入，v1→v2→...）
```

### 任务文件 frontmatter

```yaml
---
status: 待开始 | 进行中 | 完成
priority: 高 | 中 | 低
depends_on: [T01-xxx]
---
```

### 变更级别状态

记录在 change.md 顶部，或直接看目录文件判定：

| 状态 | 含义 | 判定方式 |
|------|------|---------|
| 构思 | 方案还在写 | 只有 plan.md，无 tasks/ |
| 就绪 | 方案定了，可以开干 | plan.md + tasks/ 都有 |
| 进行中 | 正在实现 | 有 task 为「进行中」 |
| 完成 | 全部做完 | 所有 task 为「完成」 |
| 搁置 | 暂不推进 | 主动标记 |

## 关键决策

| # | 决策 | 理由 |
|---|------|------|
| 1 | 状态标签去掉 Matt 的 needs-triage / needs-info / ready-for-human | 个人本地 + AI 协作场景不需要多人协作的状态，精简为构思/就绪/进行中/完成/搁置 |
| 2 | 状态标签全用中文 | 个人工作流，中文更自然 |
| 3 | 不使用 Matt 的 diagnose | /hunt 已覆盖其核心能力，且多了 Scope Blast（举一反三）和 Gotchas 表等实战功能 |
| 4 | `/write-code` 内容替换为 tdd，不保留旧行为 | TDD 的红绿重构自然覆盖了测试编写，不需要独立的 write-test 和 review-test 阶段 |
| 5 | 保留 `/review-code`，但流程改为 AI 审→fix→plannotator 人类审 | AI 先过一遍低级问题，人类只看需要判断的地方 |
| 6 | `/grill` 和 `/plan` 拆分为两个命令 | Matt 原版 grill 和 to-prd 是分开的，职责不同：先追问想清楚，再写方案 |
| 7 | 引入 `changes/<name>/adr/` 和 `changes/<name>/CONTEXT.md` | 变更内产出决策和术语；变更完成后一次性同步到根；搁置的不同步 |
| 8 | `/review-code` 审查范围参考 check + diagnose | check 提供：范围偏差、硬性阻断、模式补全、文档债、autofix 分级；diagnose 提供：修复后追问根因 → 触发 /improve-architecture |

## 实施要点

### 需修改的文件

| 文件 | 操作 | 说明 |
|------|------|------|
| `skills/development-workflow/SKILL.md` | 修改 | 更新入口文档：新流水线、新命令清单、新文件结构 |
| `skills/development-workflow/references/grill.md` | 新建 | /grill 的完整操作说明（追问规则、CONTEXT.md 更新、ADR 创建条件） |
| `skills/development-workflow/references/plan.md` | 新建 | /plan 的完整操作说明（plan.md 写作模板、基于 grilled 结论的写入规则） |
| `skills/development-workflow/references/plan-to-tasks.md` | 修改 | 加入 Matt 垂直切片理念、task 文件模板 |
| `skills/development-workflow/references/write-code.md` | 修改 | 替换为 TDD 红绿重构完整说明 |
| `skills/development-workflow/references/review-code.md` | 修改 | 更新为 AI 审→fix→plannotator 人类审流程 |
| `skills/development-workflow/references/improve-architecture.md` | 新建 | /improve-architecture 完整说明 |
| `skills/development-workflow/references/prototype.md` | 新建 | /prototype 完整说明（独立辅助技能） |
| `skills/development-workflow/references/grill-me.md` | 新建 | /grill-me 完整说明（独立辅助技能） |
| `skills/development-workflow/references/zoom-out.md` | 新建 | /zoom-out 完整说明 |

### 需删除的文件

| 文件 | 理由 |
|------|------|
| `skills/development-workflow/references/review-plan.md` | /review-plan 已移除 |
| `skills/development-workflow/references/fix-code.md` | /fix-code 已移除，逻辑由 TDD 红绿循环覆盖 |
| `skills/development-workflow/references/write-test.md` | /write-test 已移除 |
| `skills/development-workflow/references/review-test.md` | /review-test 已移除 |
| `skills/development-workflow/references/write-docs.md` | /write-docs 已移除 |

### 需修改的 prompt 模板

| 文件 | 操作 | 说明 |
|------|------|------|
| `prompts/grill.md` | 新建 | /grill 驱动指令 |
| `prompts/plan.md` | 新建 | /plan 驱动指令 |
| `prompts/write-code.md` | 修改 | 替换为 TDD 驱动指令 |
| `prompts/review-code.md` | 修改 | 加入 plannotator review 步骤 |
| `prompts/improve-architecture.md` | 新建 | 新命令 |
| `prompts/prototype.md` | 新建 | 新命令 |
| `prompts/grill-me.md` | 新建 | /grill-me 驱动指令 |
| `prompts/zoom-out.md` | 新建 | 新命令 |

### 需删除的 prompt 模板

| 文件 | 理由 |
|------|------|
| `prompts/write-plan.md` | 替换为 prompts/grill.md 和 prompts/plan.md |
| `prompts/review-plan.md` | /review-plan 已移除 |
| `prompts/fix-code.md` | /fix-code 已移除 |
| `prompts/write-test.md` | /write-test 已移除 |
| `prompts/review-test.md` | /review-test 已移除 |
| `prompts/write-docs.md` | /write-docs 已移除 |

### 需修改的 extension

| 文件 | 操作 | 说明 |
|------|------|------|
| `extensions/dev-workflow.ts` | 修改 | 注册新命令，移除旧命令；更新变更目录解析以支持 tasks/ 和 adr/ |

### 需更新的测试

| 文件 | 操作 | 说明 |
|------|------|------|
| `tests/dev-workflow.test.sh` | 修改 | 适配新命令清单、新 reference 文件、prompt 模板变更 |

### 需更新的文档

| 文件 | 操作 | 说明 |
|------|------|------|
| `AGENTS.md` | 修改 | 更新命令清单、目录约定 |
| `README.md` | 修改 | 更新功能说明 |

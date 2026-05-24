---
name: development-workflow
description: AI 开发工作流——围绕变更目录、grill/plan/tasks/code/review 五阶段做增量推进。提供变更目录解析、阶段输入输出约定、Plannotator 审阅入口。当用户执行开发任务、创建变更、或使用 /new-change /switch-change 时使用。
---

# Development Workflow — 入口文档

变更 = **grill** → **plan** → **tasks** → **code** → **review**，五阶段增量推进。
所有变更走相同流程，不区分入口类型。

每个变更在 `changes/YYYYMMDD-<简写>/` 下以 `plan.md`、`CONTEXT.md`、`tasks/` 目录、`adr/` 目录、`change.md` 五个部分驱动。

**各阶段完整操作说明请参见 [`references/`](./references/) 下对应文件。**

## 流水线

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
    └─ /review-code              ← AI 审查 + 修复
        │
        └─ plannotator review    ← 人类审查

独立入口：
    /improve-architecture        ← 手动触发：扫描 → 改进列表 → 创建新变更

诊断入口（按需触发）：
    /hunt                        ← 根因诊断

辅助技能（不入流水线，随时调用）：
    /prototype                   ← 可丢弃原型
    /zoom-out                    ← 提升抽象层级，模块全景地图
    /grill-me                    ← 纯追问，不写文件
```

## 阶段总览

### 方案准备

| 命令 | 说明 |
|------|------|
| `/grill` | 逐条追问澄清变更范围和用语，对照 CONTEXT.md 和 ADR 消除歧义，即时更新变更内 CONTEXT.md，创建 ADR |
| `/plan` | 基于 grilled 结论一次性写入 plan.md |

### 任务拆解

| 命令 | 说明 |
|------|------|
| `/plan-to-tasks` | 垂直切片拆解为 task 文件，写入 `tasks/T01-xxx.md` 等 |

### 实现

| 命令 | 说明 |
|------|------|
| `/write-code` | TDD 红绿重构：逐 task 执行 RED→GREEN→REFACTOR，更新 task frontmatter 状态 |

### 审查

| 命令 | 说明 |
|------|------|
| `/review-code` | AI 审查（范围偏差/硬性阻断/模式补全/文档债/autofix）→ plannotator 人类审查 |

### 独立入口

| 命令 | 说明 |
|------|------|
| `/improve-architecture` | 手动触发，扫描代码库发现改进机会，产列表供选择后创建变更 |
| `/hunt` | 根因诊断，出问题时按需调用 |

### 辅助技能

| 命令 | 说明 |
|------|------|
| `/prototype` | 可丢弃原型验证代码层不确定性 |
| `/zoom-out` | 提升抽象层级，给出模块全景地图 |
| `/grill-me` | 纯追问，不绑定变更，不写文件 |

各阶段完整操作说明请参见 [`references/`](./references/) 下对应文件。

---

## 变更目录解析

各阶段 prompt 均遵守以下规则确定当前变更目录（记为 `$CHANGE_DIR`）：

1. `$ARGUMENTS` 非空 → 直接作为目录名使用
2. `changes/.active_change` 存在 → 读取其内容作为目录名（去掉首尾空白）
3. 执行 `ls changes/` 找到最近 `YYYYMMDD-*` 子目录 → 向用户确认
4. 以上均无 → 提示用户先执行 `/new-change <简写>`

`$CHANGE_DIR` 确定后，所有文件路径均相对于项目根目录。

## 变更目录结构

```
changes/YYYYMMDD-<简写>/
├── plan.md              # 变更方案（目标、关键决策、用语）、/plan 覆盖写入
├── CONTEXT.md           # 本次变更新增/修改的项目用语 → 变更完成后同步到根 CONTEXT.md
├── tasks/               # 可执行任务切片
│   ├── T01-xxx.md                  # frontmatter: status: 待开始
│   ├── T02-xxx.md                  # frontmatter: status: 待开始, depends_on: [T01-xxx]
│   └── ...
├── adr/                 # 本变更产生的架构决策 → 变更完成后一次性同步到 docs/adr/
│   └── xxx.md
└── change.md            # 全流程日志（追加写入，v1→v2→...）
```

### 核心文件约定

| 文件 | 角色 | 写入方式 |
|------|------|---------|
| `plan.md` | 变更方案（目标、关键决策、用语、假设声明） | `/plan` 覆盖写入 |
| `CONTEXT.md` | 变更新增/修改的项目用语 | `/grill` 追加/修改，完成后同步根 |
| `tasks/T01-xxx.md` | 单个可执行任务（目标、涉及文件、验证方式） | `/plan-to-tasks` 新建 |
| `adr/xxx.md` | 架构决策记录（背景、决定、理由） | `/grill` 创建，完成后同步 docs/adr/ |
| `change.md` | 全流程变更日志 | 各阶段追加写入，v1→v2→... |

### 变更级别状态

| 状态 | 含义 | 判定方式 |
|------|------|---------|
| 构思 | 方案还在写 | 只有 plan.md，无 tasks/ |
| 就绪 | 方案定了，可以开干 | plan.md + tasks/ 都有 |
| 进行中 | 正在实现 | 有 task frontmatter 为「进行中」 |
| 完成 | 全部做完 | 所有 task frontmatter 为「完成」 |
| 搁置 | 暂不推进 | 主动标记 |

### 任务文件格式

```markdown
---
status: 待开始 | 进行中 | 完成
priority: 高 | 中 | 低
depends_on: [T01-xxx]
---
# T01: <标题>

**目标**：<一句话描述>

**涉及文件**：<文件列表>

**验证方式**：<验证命令或检查方法>
```

> 依赖使用完整 slug；更新任务文件名时需同步检查 `depends_on` 引用。

---

## 阶段跳转索引

| 命令 | reference 文件 | 主要内容 |
|------|---------------|---------|
| grill | [references/grill.md](./references/grill.md) | 追问规则、CONTEXT.md 更新、ADR 创建条件 |
| plan | [references/plan.md](./references/plan.md) | plan.md 写作模板、基于 grilled 结论的写入规则 |
| grill-me | [references/grill-me.md](./references/grill-me.md) | 纯追问规则，不写文件不绑变更 |
| plan-to-tasks | [references/plan-to-tasks.md](./references/plan-to-tasks.md) | 垂直切片拆解、task 文件模板 |
| write-code | [references/write-code.md](./references/write-code.md) | TDD 红绿重构、task 状态更新 |
| review-code | [references/review-code.md](./references/review-code.md) | AI 审查 + plannotator 人类审 |
| improve-architecture | [references/improve-architecture.md](./references/improve-architecture.md) | 扫描流程、列表输出、创建变更 |
| prototype | [references/prototype.md](./references/prototype.md) | 可丢弃原型、结论写入 plan.md |
| zoom-out | [references/zoom-out.md](./references/zoom-out.md) | 提升抽象层级、模块全景地图 |

### 操作约束精简版

| 约束 | 适用范围 | 说明 |
|------|---------|------|
| 每次只问一个问题 | grill, grill-me | 附带推荐选项和理由 |
| 用语确定即时更新 | grill | 写入 CONTEXT.md，不攒批 |
| ADR 仅满足三条件才创建 | grill | 难以逆转 + 无上下文看不懂 + 有真实取舍 |
| 优先垂直切片 | plan-to-tasks | 每片端到端穿透，非按技术层水平拆 |
| 红→绿→重构 | write-code | 先测试→最小实现→重构，不跨 task |
| 审查最多 3 轮 | review-code | 含修复来回，第 3 轮最终审阅 |
| 修复最多 3 次 | write-code | 验证失败后最多重试 3 次 |
| 根因断言后才能修复 | hunt | Root cause: 文件:行号 |

## Plannotator 审阅入口

以下阶段可选使用 Plannotator 做人工可视化批注：

- **plan（grill 完成后）**：`plannotator annotate $CHANGE_DIR/plan.md` 标注方案
- **review-code**：`plannotator review` 在浏览器中查看 diff 并标注
- **test（write-code 中）**：`plannotator annotate <测试文件>` 标注测试

Plannotator 标注的反馈直接作为下一步的输入。

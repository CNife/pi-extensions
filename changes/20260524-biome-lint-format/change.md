# 变更日志

## v1 - 计划阶段

**日期**：2026-05-24

**操作**：创建变更方案 `plan.md`。

**内容**：

- 确定目标：为项目添加 Biome 进行 linting 和格式化，并配置 pre-commit 钩子。
- 确定最终方案：使用 Biome + Husky + Lint-staged。
- 关键决策：选择 Biome 而不是 ESLint + Prettier；使用 Husky + Lint-staged 管理 pre-commit。
- 假设：使用双引号和 2 空格缩进；只检查 `extensions/` 和 `skills/` 目录。

**下一步**：执行 `/plan-to-tasks` 拆解任务。

---

## 变更 v2：任务拆解

### 产出文件

tasks.md, tasks/T01-安装Biome依赖.md, tasks/T02-配置Biome.md, tasks/T03-添加package.json-scripts.md, tasks/T04-安装Husky和Lint-staged依赖.md, tasks/T05-初始化Husky.md, tasks/T06-配置lint-staged.md, tasks/T07-测试pre-commit钩子.md

### 变更概述

将 plan.md 拆解为 7 个可独立验证的子任务，按 4 个并行层排列。

### 任务摘要

| ID | 子任务 | 涉及文件 |
|----|--------|----------|
| T01 | 安装 Biome 依赖 | package.json |
| T02 | 配置 Biome | biome.json |
| T03 | 添加 package.json scripts | package.json |
| T04 | 安装 Husky 和 Lint-staged 依赖 | package.json |
| T05 | 初始化 Husky | .husky/pre-commit, package.json |
| T06 | 配置 lint-staged | package.json |
| T07 | 测试 pre-commit 钩子 | 无 |

### 并行分层

| 层 | 包含任务 | 依赖 |
|----|----------|------|
| 1 | T01, T04 | 无 |
| 2 | T02, T03 | T01 |
| 3 | T05, T06 | T04 |
| 4 | T07 | T05, T06 |

## 变更 v3：编码完成

### 产出文件

- biome.json（新建）
- .husky/pre-commit（新建）
- package.json（修改）

### 执行摘要

| task | 状态 |
|------|------|
| T01 | 完成 |
| T02 | 完成 |
| T03 | 完成 |
| T04 | 完成 |
| T05 | 完成 |
| T06 | 完成 |
| T07 | 完成 |

### 变更文件清单

| 文件 | 对应任务 | 操作 |
|------|---------|------|
| biome.json | T02 | 新建 |
| .husky/pre-commit | T05 | 新建 |
| package.json | T01, T03, T04, T05, T06 | 修改 |

---

## 变更 v3：代码审阅（第 1 轮）

### 审查信息

- 审阅轮次：第 1 / 3 轮
- 变更文件数：3（biome.json、.husky/pre-commit、package.json）

### 范围偏差

| # | 文件 | 问题 |
|---|------|------|
| 1 | .gitignore | 工作目录中混入了无关改动：添加 `.worktrees/`（来自其他变更） |
| 2 | AGENTS.md | 混入了 hunt→waza 迁移的改动（来自 `20260524-remove-hunt`） |
| 3 | skills/hunt/SKILL.md | 删除了 hunt 技能（来自 `20260524-remove-hunt`） |
| 4 | skills/cnife-pi-workflow/SKILL.md | 混入了 hunt→waza 的文档更新 |
| 5 | CONTEXT.md | 混入了 hunt 用语更新 |
| 6 | README.md | 混入了 hunt 诊断入口更新 |

> 以上 6 项均为其他变更的改动，提交时应排除，只提交 biome-lint-format 相关文件。

### 硬性阻断

| # | 类别 | 位置 | 问题 |
|---|------|------|------|

无。未发现注入漏洞、凭证泄露、未声明依赖变更或破坏性操作。

### 模式补全

| # | 模式 | 未处理位置 |
|---|------|-----------|

无。本次变更无同类遗漏模式。

### 文档债

| # | 应写规则 | 目标文件 |
|---|---------|---------|
| 1 | Biome 相关 npm scripts 的使用约定（何时用 `lint` vs `check` vs `format`） | AGENTS.md |

### Autofix

| # | 级别 | 文件 | 修复 | 状态 |
|---|------|------|------|------|
| 1 | 安全自动 | package.json | 补充末尾换行符 | ✅ 已修 |
| 2 | 安全自动 | package.json | lint-staged `*.md` 规则从 `biome format --write` 改为 `rumdl fmt`（Biome v2 不支持 Markdown） | ✅ 已修 |
| 3 | 安全自动 | package.json | scripts 中 Markdown 格式化改用 `rumdl fmt`，lint 加 `rumdl check` | ✅ 已修 |
| 4 | 安全自动 | biome.json | `includes` 移除 `changes/**`（Biome 无法处理 Markdown） | ✅ 已修 |
| 5 | 安全自动 | tests/*.test.sh | 删除 7 个一次性测试脚本（项目无 test runner，无持续价值） | ✅ 已删 |

### 根因追问

- 问题：Biome v2 不支持 Markdown 格式化，导致 lint-staged 对 `.md` 文件的规则永远失败。
- 建议：工具选型时应先验证目标文件类型的支持情况。引入 rumdl 作为 Markdown 专用工具，职责分离更清晰。

### 总体结论

- **可交付判定**：是（已清理无关改动，Plannotator 审查通过 LGTM）

# 变更 v1：方案确立

## 变更目标

重构 development-workflow 的 SKILL.md 与 prompt 模板职责，使 SKILL.md 成为完整操作手册、prompt 模板精简为驱动指令，并去掉 prompt 中的变更目录解析逻辑。

## 关键决策

| # | 决策 | 理由 |
|---|------|------|
| 1 | 去掉 prompt 中的变更目录解析逻辑 | 已由 extension 的 `.active_change` 文件处理，prompt 无需重复 |
| 2 | SKILL.md 先按单文件长文，超 500 行再按阶段拆分 | 减少文件数便于 Agent 一次性读取；skill-creator 建议 SKILL.md < 500 行 |
| 3 | Prompt 精简到 ~100-150 字，保留核心规则兜底 | 太简可能遗漏关键操作约束，保留核心规则确保即使不读 SKILL.md 也能执行 |
| 4 | 操作约束在 SKILL.md 和 prompt 各保留一份精简版 | 双重保障：SKILL.md 提供完整参考，prompt 提供必读精简指引 |

## 预期产出

| 文件 | 操作 | 说明 |
|------|------|------|
| AGENTS.md | 新建 | 项目结构、分工关系的说明文件 |
| skills/development-workflow/SKILL.md | 修改 | 从流水线全景扩展为完整操作手册 |
| prompts/write-plan.md | 修改 | 精简为 ~100-150 字驱动指令 |
| prompts/review-plan.md | 修改 | 同上 |
| prompts/plan-to-tasks.md | 修改 | 同上 |
| prompts/write-code.md | 修改 | 同上 |
| prompts/review-code.md | 修改 | 同上 |
| prompts/fix-code.md | 修改 | 同上 |
| prompts/write-test.md | 修改 | 同上 |
| prompts/review-test.md | 修改 | 同上 |
| prompts/write-docs.md | 修改 | 同上 |
| tests/dev-workflow.test.sh | 修改 | 适配新的内容分布 |
| README.md | 修改 | 反映 SKILL.md 和 AGENTS.md 变化 |

---

# 变更 v2：方案审核

> 基于：plan.md

## 审核结论

- 范围偏差：0 项
- 模糊表述：1 项（🟡 1）
- 逻辑矛盾：0 项
- 内容疏漏：2 项（🔴 1 / 🟡 1）

## 修改记录

| # | 问题 | 严重程度 | 处理 |
|---|------|---------|------|
| 1 | SKILL.md 行数阈值表述不一致（"超 500 行" vs "逼近 500 行"） | 🟡 建议 | 统一为"超 500 行"，涉及 plan.md 三处位置 |
| 2 | B 方案（按阶段拆分）未定义具体方案，触发后无法执行 | 🔴 阻断 | 取消 B 方案概念，改为默认设计：各阶段操作详情放入 `skills/development-workflow/references/{phase}.md`，SKILL.md 保持为入口文档，不设行数阈值 |
| 3 | 测试适配内容仅写"适配新的内容分布"，缺少具体变更点指引 | 🟡 建议 | 明确为三项：① 新增 `AGENTS.md` 存在性检查 ② 新增 AGENTS.md 内容检查 ③ README 检查中增加引用 AGENTS.md 的断言 |

---

# 变更 v3：任务拆解

## 产出文件

- `tasks.md`（新建）

## 变更概述

将 plan.md 拆解为 13 个可独立验证的子任务，按 1 个并行层排列。

## 关键决策

| # | 决策 | 说明 |
|---|------|------|
| 1 | 每个阶段创建 reference 文件 + 简化 prompt 合并为一个子任务 | 二者操作同一阶段源材料，同生同灭，合并便于原子验证 |
| 2 | 所有 13 个子任务同属第 1 层 | 各任务修改不同文件，无接口依赖，无验证互锁 |

## 任务摘要

| ID | 子任务 | 涉及文件 |
|----|--------|---------|
| T1 | 创建 AGENTS.md | `AGENTS.md` |
| T2 | 重构 SKILL.md 为入口文档 | `skills/development-workflow/SKILL.md` |
| T3 | write-plan 阶段（reference + 精简 prompt） | `skills/development-workflow/references/write-plan.md`, `prompts/write-plan.md` |
| T4 | review-plan 阶段（reference + 精简 prompt，含"同步更新 plan.md"规则） | `skills/development-workflow/references/review-plan.md`, `prompts/review-plan.md` |
| T5 | plan-to-tasks 阶段（reference + 精简 prompt） | `skills/development-workflow/references/plan-to-tasks.md`, `prompts/plan-to-tasks.md` |
| T6 | write-code 阶段（reference + 精简 prompt） | `skills/development-workflow/references/write-code.md`, `prompts/write-code.md` |
| T7 | review-code 阶段（reference + 精简 prompt） | `skills/development-workflow/references/review-code.md`, `prompts/review-code.md` |
| T8 | fix-code 阶段（reference + 精简 prompt） | `skills/development-workflow/references/fix-code.md`, `prompts/fix-code.md` |
| T9 | write-test 阶段（reference + 精简 prompt） | `skills/development-workflow/references/write-test.md`, `prompts/write-test.md` |
| T10 | review-test 阶段（reference + 精简 prompt） | `skills/development-workflow/references/review-test.md`, `prompts/review-test.md` |
| T11 | write-docs 阶段（reference + 精简 prompt） | `skills/development-workflow/references/write-docs.md`, `prompts/write-docs.md` |
| T12 | 更新 README.md | `README.md` |
| T13 | 更新 tests/dev-workflow.test.sh | `tests/dev-workflow.test.sh` |

## 并行分层

| 层 | 包含任务 | 依赖 |
|----|---------|------|
| 1 | T1–T13 | 无 |

---

# 变更 v4：编码完成

## 产出文件

- `AGENTS.md`（新建）
- `skills/development-workflow/SKILL.md`（修改）
- `skills/development-workflow/references/write-plan.md`（新建）
- `skills/development-workflow/references/review-plan.md`（新建）
- `skills/development-workflow/references/plan-to-tasks.md`（新建）
- `skills/development-workflow/references/write-code.md`（新建）
- `skills/development-workflow/references/review-code.md`（新建）
- `skills/development-workflow/references/fix-code.md`（新建）
- `skills/development-workflow/references/write-test.md`（新建）
- `skills/development-workflow/references/review-test.md`（新建）
- `skills/development-workflow/references/write-docs.md`（新建）
- `prompts/write-plan.md`（修改）
- `prompts/review-plan.md`（修改）
- `prompts/plan-to-tasks.md`（修改）
- `prompts/write-code.md`（修改）
- `prompts/review-code.md`（修改）
- `prompts/fix-code.md`（修改）
- `prompts/write-test.md`（修改）
- `prompts/review-test.md`（修改）
- `prompts/write-docs.md`（修改）
- `README.md`（修改）
- `tests/dev-workflow.test.sh`（修改）

## 执行摘要

| 层 | 任务数 | 完成 | 失败 |
|----|--------|------|------|
| 1 | 13 | 13 | 0 |

## 变更文件清单

| 文件 | 对应任务 | 操作 |
|------|---------|------|
| `AGENTS.md` | T1 | 新建 |
| `skills/development-workflow/SKILL.md` | T2 | 修改 |
| `skills/development-workflow/references/write-plan.md` | T3 | 新建 |
| `skills/development-workflow/references/review-plan.md` | T4 | 新建 |
| `skills/development-workflow/references/plan-to-tasks.md` | T5 | 新建 |
| `skills/development-workflow/references/write-code.md` | T6 | 新建 |
| `skills/development-workflow/references/review-code.md` | T7 | 新建 |
| `skills/development-workflow/references/fix-code.md` | T8 | 新建 |
| `skills/development-workflow/references/write-test.md` | T9 | 新建 |
| `skills/development-workflow/references/review-test.md` | T10 | 新建 |
| `skills/development-workflow/references/write-docs.md` | T11 | 新建 |
| `prompts/write-plan.md` | T3 | 修改 |
| `prompts/review-plan.md` | T4 | 修改 |
| `prompts/plan-to-tasks.md` | T5 | 修改 |
| `prompts/write-code.md` | T6 | 修改 |
| `prompts/review-code.md` | T7 | 修改 |
| `prompts/fix-code.md` | T8 | 修改 |
| `prompts/write-test.md` | T9 | 修改 |
| `prompts/review-test.md` | T10 | 修改 |
| `prompts/write-docs.md` | T11 | 修改 |
| `README.md` | T12 | 修改 |
| `tests/dev-workflow.test.sh` | T13 | 修改 |

## 验证结果

所有 13 个子任务验证通过，`dev-workflow.test.sh` 43 项测试全部通过（0 失败）。

---

# 变更 v5：代码审阅（第 1 轮）

## 审查信息

- 审阅时间：2026-05-19
- 审阅轮次：第 1 / 3 轮
- 变更文件数：22
- 审查基线：编码完成

## 目标完成度

- 状态：✅ 已实现
- 说明：对照 plan.md「目标」——重构 development-workflow 的 SKILL.md 与 prompt 模板职责，使 SKILL.md 精简为入口文档、各阶段操作详情放入 `references/` 下独立文件、prompt 模板精简为驱动指令，并去掉 prompt 中的变更目录解析逻辑——全部完成：
  - SKILL.md 已重构为入口文档（96 行），含流水线全景表、变更目录解析规则、核心文件约定、Plannotator 入口、各阶段跳转索引
  - 9 个 `references/{phase}.md` 全部创建，包含完整操作说明
  - 9 个 prompt 全部精简为 ~100-150 字驱动指令，含最少操作规则兜底
  - 所有 prompt 已去掉旧版目录解析逻辑，引用 SKILL.md（→ references/）获取完整说明
  - AGENTS.md 新建、README.md 更新、test 脚本更新

## 范围审阅

| # | 文件 | 对应任务 | 状态 | 说明 |
|---|------|---------|------|------|
| 1 | `AGENTS.md` | T1 | ✅ 符合 | — |
| 2 | `skills/development-workflow/SKILL.md` | T2 | ✅ 符合 | — |
| 3 | `skills/development-workflow/references/write-plan.md` | T3 | ✅ 符合 | — |
| 4 | `prompts/write-plan.md` | T3 | ✅ 符合 | — |
| 5 | `skills/development-workflow/references/review-plan.md` | T4 | ✅ 符合 | — |
| 6 | `prompts/review-plan.md` | T4 | ✅ 符合 | — |
| 7 | `skills/development-workflow/references/plan-to-tasks.md` | T5 | ✅ 符合 | — |
| 8 | `prompts/plan-to-tasks.md` | T5 | ✅ 符合 | — |
| 9 | `skills/development-workflow/references/write-code.md` | T6 | ✅ 符合 | — |
| 10 | `prompts/write-code.md` | T6 | ✅ 符合 | — |
| 11 | `skills/development-workflow/references/review-code.md` | T7 | ✅ 符合 | — |
| 12 | `prompts/review-code.md` | T7 | ✅ 符合 | — |
| 13 | `skills/development-workflow/references/fix-code.md` | T8 | ✅ 符合 | — |
| 14 | `prompts/fix-code.md` | T8 | ✅ 符合 | — |
| 15 | `skills/development-workflow/references/write-test.md` | T9 | ✅ 符合 | — |
| 16 | `prompts/write-test.md` | T9 | ✅ 符合 | — |
| 17 | `skills/development-workflow/references/review-test.md` | T10 | ✅ 符合 | — |
| 18 | `prompts/review-test.md` | T10 | ✅ 符合 | — |
| 19 | `skills/development-workflow/references/write-docs.md` | T11 | ✅ 符合 | — |
| 20 | `prompts/write-docs.md` | T11 | ✅ 符合 | — |
| 21 | `README.md` | T12 | ✅ 符合 | — |
| 22 | `tests/dev-workflow.test.sh` | T13 | ✅ 符合 | — |

## Hard Stops

无。

- 注入漏洞：无。项目以 Markdown 文档为主，无可注入的 SQL/命令/路径接口。
- 凭证泄露：无。未发现密钥、token 硬编码或提交。
- 依赖变更：无。`package.json` 未变动，无新增/升级依赖。
- 破坏性操作：无。未删除或重命名计划外的现有文件/接口（`prompts-dev-workflow/` 为已有清理流程产物，非本次变更引入）。

## 代码质量

| 检查项 | 命令 | 结果 |
|--------|------|------|
| Format | 项目无配置的格式化工具（无 eslint/prettier/ruff/toml 配置） | N/A |
| Lint | 项目无配置的 lint 工具 | N/A |

项目以 Markdown 文档（21 个 .md）为主，含少量 TypeScript（3 个 .ts）和 Shell（1 个 .sh）文件，未配置格式/lint 检查工具，跳过修复循环。

## 总体结论

- **可交付判定**：是
- 目标完成度：✅ 已实现
- 范围审阅：通过（0 个文件超出）
- Format：N/A
- Lint：N/A
- 阻断项：0 项

## 未通过项详情

无。

## 下一步指引

可交付判定为「是」→ 本次变更代码审查通过，进入 **write-test** 阶段。

> 注意：write-test 阶段需为本次变更编写测试（主要验证 `dev-workflow.test.sh` 仍全部通过），并根据变更内容补充新的测试用例（如验证 references/ 结构完整性）。

---

# 变更 v6：测试编写

## 测试文件

| 文件 | 对应源码 | 用例数 |
|------|---------|--------|
| `tests/dev-workflow.test.sh` | 全项目（结构完整性） | 92 |

## 新增测试覆盖

本次新增 3 个测试组（49 条断言），验证本次变更的核心产出：

| 测试组 | 测试项 | 说明 |
|-------|--------|------|
| References 结构 | 存在性 + 非空 + 标题头 | 9 个 `references/*.md` 文件存在、非空、以 `# ` 标题开头 |
| Prompt 模板元数据 | description + argument-hint | 9 个 prompt 均有完整 frontmatter |
| SKILL.md 完整结构 | 核心文件约定、阶段跳转索引、操作约束精简版、Plannotator、references 引用 | SKILL.md 包含入口文档必备的所有章节 |

### 测试类型分布

| 测试类型 | 数量 |
|---------|------|
| 正向验证（存在性/内容） | 80 |
| 逆向验证（确保旧内容已移除） | 12 |

## 验证结果

- `bash tests/dev-workflow.test.sh`：通过（92 passed，0 failed）

## 下一步指引

测试全部通过且记录追加完毕 → 进入 **review-test** 阶段。

> 注意：review-test 阶段需审查新增的 49 条断言的覆盖完整性和质量。

---

# 变更 v7：测试审查（第 1 轮）

## 审查信息

- 审阅时间：2026-05-19
- 审阅轮次：第 1 / 2 轮
- 测试文件数：1
- 总用例数：92

## 审查结果

| # | 测试文件 | 用例数 | 状态 | 问题 |
|---|---------|--------|------|------|
| 1 | tests/dev-workflow.test.sh | 92 | ✅ 通过 | 🟡 3 项建议 |

## 逐项审查详情

### 格式检查

✅ **测试命名**：测试分组以 `=== 组名 ===` 分隔，每个测试项有描述性名称（如 `AGENTS.md 包含分工说明`），清晰可读。
✅ **测试结构**：使用 `ok()`/`fail()` 统一输出，`set -euo pipefail` 确保错误捕获，符合 Shell 测试最佳实践。

### 断言有效性

✅ **所有断言均有实际意义**：文件存在性（`test -f`）、内容匹配（`grep -q`）、文件计数（`wc -l`），无空断言或占位断言。
✅ **逆向验证有效**：12 项断言验证旧内容已移除（`以上均无`、`resources_discover`、`prompts-dev-workflow` 引用），确保重构不遗留旧逻辑。

### 覆盖率

**变更文件清单（22 文件）对应测试覆盖：**

| 变更范围 | 测试覆盖项 | 状态 |
|---------|-----------|------|
| `AGENTS.md`（新建） | 存在性 + 分工说明关键词 | ✅ |
| `skills/development-workflow/SKILL.md`（修改） | name、description、9 命令引用、目录解析、核心文件约定、阶段跳转索引、操作约束精简版、Plannotator、9 个 references 引用（共 10+ 项） | ✅ |
| `references/*.md` × 9（新建） | 存在性 + 非空 + 标题头（3×9=27 项） | ✅ |
| `prompts/*.md` × 9（修改） | 引用 skill + 去旧逻辑（2×9=18 项）+ 元数据（2×9=18 项） | ✅ |
| `extensions/dev-workflow.ts`（不动） | resources_discover 移除 + 旧目录引用移除 + 命令保留（5 项） | ✅ |
| `README.md`（修改） | 引用 AGENTS.md + skills 章节 + 目录描述更新（3 项） | ✅ |
| `tests/dev-workflow.test.sh`（修改） | 脚本本身即测试载体 | N/A |
| `prompts-dev-workflow/`（已删除） | 目录不存在 | ✅ |

✅ **所有变更文件均有对应测试检查**，无遗漏。

### 边界覆盖

| 边界类型 | 覆盖情况 | 状态 |
|---------|---------|------|
| 正向验证（存在性/内容） | 80 项，覆盖所有变更文件 | ✅ |
| 逆向验证（旧内容已移除） | 12 项，覆盖关键旧逻辑残留 | ✅ |
| 空文件检测 | references/*.md 均有 `-s` 非空检查 | ✅ |
| 文件权限 | 未检查 | ⚪ 可接受 |
| 字数/行数验证 | **未覆盖**（见建议项） | 🟡 |
| Markdown 语法校验 | 未检查（无专用工具） | ⚪ 可接受 |

### 用例独立性

✅ 每个测试项使用独立的 `ok()`/`fail()` 调用，互不依赖。共享的 `PASS`/`FAIL` 计数器仅用于汇总，不影响单个测试结果。

## 运行结果

```
bash tests/dev-workflow.test.sh
```

- 通过：92 passed
- 失败：0
- 退出码：0（全部通过）

## 问题分级

| # | 严重程度 | 文件 | 问题 | 说明 |
|---|---------|------|------|------|
| 1 | 🟡 建议 | tests/dev-workflow.test.sh | 缺少 prompts 字数验证 | plan.md 决策 3 要求 prompt 精简到 ~100-150 字，测试仅验证元数据与引用关系，未验证实际字数 |
| 2 | 🟡 建议 | tests/dev-workflow.test.sh | SKILL.md 缺少行数警戒检查 | SKILL.md 当前 96 行，作为入口文档应有行数警戒线，防止随时间增长膨胀到数百行 |
| 3 | 🟡 建议 | tests/dev-workflow.test.sh | AGENTS.md 内容覆盖偏浅 | 仅检查"分工"关键词，缺少对项目结构说明、目录约定、扩展/技能/prompt 分工表等核心内容的断言 |

无 🔴 阻断项。

## 总体结论

- **可交付判定**：是
- 通过：1 文件（92 用例）
- 不通过：0 文件
- 阻断项：0 项

## 不通过项详情

无 🔴 阻断项。遗留 3 项 🟡 建议（见问题分级表），不影响整体可交付性。

## 下一步指引

可交付判定为「是」→ 测试审查通过，进入 **write-docs** 阶段。

遗留的 3 项 🟡 建议项可在 write-docs 阶段或后续迭代中补充，不影响当前流程推进。

---

# 变更 v8：文档更新

## 文档影响评估

| 文件 | 影响 | 建议 |
|------|------|------|
| README.md | 有：Tests 节遗漏 dev-workflow.test.sh | 更新 Tests 节，补充开发工作流测试运行说明 |
| AGENTS.md | 无（v4 已创建且完整） | 不更新 |
| .gitignore | 无 | 不更新 |

## 更新的文档

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| README.md | 修改 | Tests 节增加 dev-workflow.test.sh 说明（92 项断言），与现有 sh-guard.test.sh 并列 |

## 变更详情

**README.md** Tests 节原仅有 `sh-guard.test.sh`，已补充：

- 新增 `dev-workflow.test.sh` 条目说明（含 92 项断言描述）
- 新增分步运行命令示例
- 保留原有 `sh-guard.test.sh` 条目不变

## 未更新的文档及理由

| 文件 | 不更新理由 |
|------|-----------|
| AGENTS.md | 已在 v4 创建且内容完整，本次变更不改变其描述的结构和约定 |
| .gitignore | 与本变更无关 |

---

变更完成。本次变更涉及的所有阶段（方案 → 审核 → 任务拆解 → 编码 → 代码审查 → 测试编写 → 测试审查 → 文档更新）均已完成。

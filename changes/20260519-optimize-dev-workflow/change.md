# 变更 v1：方案确立

## 变更目标

将 prompts-dev-workflow 优化为 development-workflow skill + 轻薄 prompts，利用 pi convention 目录简化架构。

## 关键决策

| # | 决策 | 理由 |
|---|------|------|
| 1 | Convention 目录分离 | pi 自动发现 `prompts/` 和 `skills/`，extension 无需 `resources_discover` |
| 2 | fix-code 保留 | 与 write-code 语义区分（写新代码 vs 修复审阅发现的问题） |
| 3 | Plannotator 不绑流程 | 作为通用批注工具，审阅阶段可选调用 |
| 4 | `/new-change` 保持 extension | 已有可靠实现，不加 prompt template 版本 |

## 预期产出

| 文件 | 操作 | 说明 |
|------|------|------|
| skills/development-workflow/SKILL.md | 新建 | 全局工作流地图 |
| prompts/write-plan.md | 移动+修改 | 去掉重复解析逻辑 |
| prompts/review-plan.md | 移动+修改 | 同上 |
| prompts/plan-to-tasks.md | 移动+修改 | 同上 |
| prompts/write-code.md | 移动+修改 | 同上 |
| prompts/fix-code.md | 移动+修改 | 同上 |
| prompts/review-code.md | 移动+修改 | 同上 |
| prompts/write-test.md | 移动+修改 | 同上 |
| prompts/review-test.md | 移动+修改 | 同上 |
| prompts/write-docs.md | 移动+修改 | 同上 |
| extensions/dev-workflow.ts | 修改 | 精简，去掉 resources_discover |
| README.md | 修改 | 更新目录描述 |
| prompts-dev-workflow/ | 删除 | 迁移后清空 |

---

# 变更 v2：编码完成

## 产出文件

- skills/development-workflow/SKILL.md（新建）
- prompts/\*.md（移动+修改，9 个文件）
- extensions/dev-workflow.ts（修改）
- README.md（修改）
- prompts-dev-workflow/（删除）

## 执行摘要

| 层 | 任务数 | 完成 | 失败 |
|----|--------|------|------|
| 1 | 5 | 5 | 0 |

## 变更文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| skills/development-workflow/SKILL.md | 新建 | 全局工作流地图 + 变更目录解析规则 |
| prompts/write-plan.md | 移动+修改 | 去掉重复解析逻辑 |
| prompts/review-plan.md | 移动+修改 | 同上 |
| prompts/plan-to-tasks.md | 移动+修改 | 同上 |
| prompts/write-code.md | 移动+修改 | 同上 |
| prompts/fix-code.md | 移动+修改 | 同上 |
| prompts/review-code.md | 移动+修改 | 同上 |
| prompts/write-test.md | 移动+修改 | 同上 |
| prompts/review-test.md | 移动+修改 | 同上 |
| prompts/write-docs.md | 移动+修改 | 同上 |
| extensions/dev-workflow.ts | 修改 | 去掉 resources_discover 处理器 |
| README.md | 修改 | 更新目录描述，新增 skills 章节 |
| prompts-dev-workflow/ | 删除 | 迁移完毕 |

---

# 变更 v3：代码审阅（第 1 轮）

## 审查信息

- 审阅时间：2026-05-19
- 审阅轮次：第 1 / 3 轮
- 变更文件数：0（未进入文件审查）
- 审查基线：编码完成

## 停止原因

**tasks.md 不存在**。变更目录 `changes/20260519-optimize-dev-workflow/` 中仅有 `change.md` 和 `plan.md`，缺少 `tasks.md`。

按审阅流程约束，`tasks.md` 是范围审阅的唯一依据（「涉及文件」列），缺失时无法进行范围逐文件对照和 Hard Stops 检查，审阅流程中止。

## 下一步

请先补充 `tasks.md`（可通过 `/plan-to-tasks` 从 `plan.md` 生成），然后重新执行 `/review-code`。

---

# 变更 v4：代码审阅（第 1 轮）

## 审查信息

- 审阅时间：2026-05-19
- 审阅轮次：第 1 / 3 轮
- 变更文件数：13
- 审查基线：编码完成
- 范围依据：plan.md（tasks.md 缺失，用户指定以 plan.md 为范围基准）

## 目标完成度

- 状态：✅ 已实现
- 说明：plan.md「目标」——"将 prompts-dev-workflow 优化为 development-workflow：引入 skill 提供全局视野、prompt 轻薄化、利用 pi convention 目录简化架构"——五项实施要点全部完成：
  1. ✅ `skills/development-workflow/SKILL.md` 新建，含 9 阶段流水线全景、变更目录解析规则、Plannotator 介入点
  2. ✅ 9 个 prompt 从 `prompts-dev-workflow/` 移至 `prompts/`，各模板统一引用 skill 的变更目录解析规则，不再重复展开
  3. ✅ `extensions/dev-workflow.ts` 已精简：移除 `resources_discover` 处理器及相关 import（`fileURLToPath`、`dirname`）
  4. ✅ `README.md` 更新为新目录结构，新增 Skills 章节，移除对 `resources_discover` 的描述
  5. ✅ `prompts-dev-workflow/` 目录及其全部 9 个文件已删除

## 范围审阅

| # | 文件 | plan.md 预期 | 状态 | 说明 |
|---|------|-------------|------|------|
| 1 | skills/development-workflow/SKILL.md | 新建 | ✅ 符合 | — |
| 2 | prompts/write-plan.md | 移动+修改 | ✅ 符合 | 去掉重复解析逻辑，引用 skill |
| 3 | prompts/review-plan.md | 移动+修改 | ✅ 符合 | 同上 |
| 4 | prompts/plan-to-tasks.md | 移动+修改 | ✅ 符合 | 同上 |
| 5 | prompts/write-code.md | 移动+修改 | ✅ 符合 | 同上 |
| 6 | prompts/fix-code.md | 移动+修改 | ✅ 符合 | 同上 |
| 7 | prompts/review-code.md | 移动+修改 | ✅ 符合 | 同上 |
| 8 | prompts/write-test.md | 移动+修改 | ✅ 符合 | 同上 |
| 9 | prompts/review-test.md | 移动+修改 | ✅ 符合 | 同上 |
| 10 | prompts/write-docs.md | 移动+修改 | ✅ 符合 | 同上 |
| 11 | extensions/dev-workflow.ts | 修改 | ✅ 符合 | 精简：去掉 resources_discover，净减 21 行 |
| 12 | README.md | 修改 | ✅ 符合 | 目录描述更新，新增 skills 章节 |
| 13 | prompts-dev-workflow/ | 删除 | ✅ 符合 | 目录及 9 个文件已删除，`ls` 确认不存在 |

## Hard Stops

无阻断级问题。

| 检查项 | 结果 |
|--------|------|
| 注入漏洞 | 无。`/new-change` 接受用户输入构建目录名，使用 `resolve()` 规范化路径。作为本地开发工具，用户自输入风险可控 |
| 凭证泄露 | 无。所有文件中无密钥、token 或密码 |
| 依赖变更 | 无。`dev-workflow.ts` import 仅涉及 pi SDK 和 Node.js 内置模块，无新增依赖 |
| 破坏性操作 | 无。所有文件操作均在 plan.md「预期产出」中声明 |

## 代码质量

| 检查项 | 命令 | 结果 |
|--------|------|------|
| Format | N/A | 项目未配置格式化工具（无 tsconfig.json、.eslintrc、.prettierrc、biome.json）。TypeScript 源码格式一致（2 空格缩进、分号、统一 import 风格），无明显格式问题 |
| Lint | N/A | 同上。无 lint 工具链可运行 |

## 总体结论

- **可交付判定**：是
- 目标完成度：✅
- 范围审阅：通过（13/13 文件符合 plan.md 预期产出）
- Format：N/A（无工具链）
- Lint：N/A（无工具链）
- 阻断项：0 项

## 未通过项详情

无。

---

# 变更 v5：测试编写

## 测试文件

| 文件 | 对应源码 | 用例数 |
|------|---------|--------|
| tests/dev-workflow.test.sh | 全部变更文件 | 40 |

## 测试覆盖

| 测试类型 | 数量 |
|---------|------|
| 目录结构验证 | 4 |
| SKILL.md 内容验证 | 12 |
| Prompt 模板引用验证 | 18 |
| Extension 内容验证 | 4 |
| README 内容验证 | 2 |

## 验证结果

- bash tests/dev-workflow.test.sh：通过（40 passed）

---

# 变更 v7：文档更新

## 更新的文档

无。README.md 已在编码阶段同步更新，项目无 AGENTS.md 或 docs/ 目录。本次变更完成。

---

# 变更 v6：测试审查（第 1 轮）

## 审查信息

- 审阅时间：2026-05-19
- 审阅轮次：第 1 / 2 轮
- 测试文件数：1
- 总用例数：40

## 审查结果

| # | 测试文件 | 用例数 | 状态 | 问题 |
|---|---------|--------|------|------|
| 1 | tests/dev-workflow.test.sh | 40 | ✅ 通过 | — |

## 逐项分析

### 格式检查

- **命名规范**：`dev-workflow.test.sh` 与项目既有 `tests/sh-guard.test.sh` 命名风格一致 ✅
- **结构组织**：按 5 个清晰章节分组（目录结构 / SKILL.md 内容 / Prompt 模板 / Extension 内容 / README 内容），逻辑分明 ✅
- **Shell 规范**：使用 `set -euo pipefail`，安全严谨 ✅

### 断言有效性

- 每条断言均有明确含义和描述性消息（如「prompts/ 包含 9 个 .md 文件」），无 `assert True` 等占位断言 ✅
- 覆盖正向验证（文件存在、内容包含）和负向验证（旧目录已删除、旧引用已移除）两方向 ✅

### 覆盖率

| 变更文件 | 测试用例数 | 验证维度 |
|---------|-----------|---------|
| prompts/（9 文件） | 18 | 各文件引用 skill + 无重复解析逻辑 |
| skills/development-workflow/SKILL.md | 12 | frontmatter + 9 命令 + 解析规则 |
| extensions/dev-workflow.ts | 4 | 去 resources_discover + 2 命令保留 |
| README.md | 2 | skills 章节 + 目录描述更新 |
| prompts-dev-workflow/ | 1 | 目录已删除 |
| prompts/ 目录 | 1 | 文件数量正确 |
| skills/ 目录 | 1 | SKILL.md 路径正确 |
| extensions/ 目录 | 1 | dev-workflow.ts 存在 |

所有变更文件均有对应测试覆盖 ✅

### 边界覆盖

- 负向检查：旧目录不存在、旧引用已移除、`resources_discover` 已删除 ✅
- 数量校验：prompts/ 恰好 9 个 .md 文件，不多不少 ✅
- 模式匹配：检测「以上均无」关键词确保旧解析逻辑彻底移除 ✅

### 用例独立性

- 所有检查相互独立，无顺序依赖。`PASS`/`FAIL` 计数器为只累加共享状态，不影响各检查逻辑 ✅

## 运行结果

```
=== 结果 ===
通过: 40  失败: 0
✅ 全部通过
```

退出码：0 ✅

## 总体结论

- **可交付判定**：是
- 通过：1 文件（40 用例）
- 不通过：0 文件
- 阻断项：无

## 不通过项详情

无。

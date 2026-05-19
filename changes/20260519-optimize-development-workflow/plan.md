# 变更方案

## 目标

重构 development-workflow 的 SKILL.md 与 prompt 模板职责，使 SKILL.md 精简为入口文档、各阶段操作详情放入 `references/` 下独立文件、prompt 模板精简为驱动指令，并去掉 prompt 中的变更目录解析逻辑（由 `.active_change` 替代）。

## 最终结构

```
pi-extensions/
├── AGENTS.md                              # 新建：项目结构、扩展/技能/prompt的分工说明
├── skills/development-workflow/
│   ├── SKILL.md                           # 入口文档：流水线全景、变更目录解析、核心文件约定、
│   │                                     # Plannotator 入口 + 各阶段跳转索引
│   └── references/
│       ├── write-plan.md                  # write-plan 阶段：完整操作说明、输出格式模板、提问规则
│       ├── review-plan.md                 # review-plan 阶段：四类排查规则、审核输出格式
│       ├── plan-to-tasks.md               # plan-to-tasks 阶段：子任务拆解规则、并行分层模板
│       ├── write-code.md                  # write-code 阶段：编码规则、并行执行指引
│       ├── review-code.md                 # review-code 阶段：范围/Hard Stops/format/lint 审查
│       ├── fix-code.md                    # fix-code 阶段：修复流程指引
│       ├── write-test.md                  # write-test 阶段：测试编写规范
│       ├── review-test.md                 # review-test 阶段：测试审查规则
│       └── write-docs.md                  # write-docs 阶段：文档更新规范
├── prompts/
│   ├── write-plan.md                      # 精简：~100-150字，保留核心规则 + 引用 SKILL.md
│   ├── review-plan.md                     # 精简：同上
│   ├── plan-to-tasks.md                   # 精简：同上
│   ├── write-code.md                      # 精简：同上
│   ├── review-code.md                     # 精简：同上
│   ├── fix-code.md                        # 精简：同上
│   ├── write-test.md                      # 精简：同上
│   ├── review-test.md                     # 精简：同上
│   └── write-docs.md                      # 精简：同上
├── tests/dev-workflow.test.sh             # 更新：适配新的内容分布
├── README.md                              # 更新：反映 SKILL.md 和 AGENTS.md 变化
├── extensions/dev-workflow.ts             # 不动：已通过 .active_change 处理变更目录
└── .gitignore                             # 不动
```

## 关键决策

- 决策 1：**去掉 prompt 中的变更目录解析逻辑** — 已通过 extension 的 `.active_change` 文件处理，prompt 无需重复
- 决策 2：**SKILL.md 保持为入口文档，各阶段详情放入 `references/{phase}.md`** — 不设行数阈值，SKILL.md 只含全景、目录解析、跳转索引，完整操作说明下放到对应的 references 文件
- 决策 3：**Prompt 精简到 ~100-150 字** — 保留核心操作规则兜底（如 write-plan 的"每次只问一个问题"），其余操作说明引用 SKILL.md
- 决策 4：**操作约束（3 轮上限、format/lint 循环等）在 SKILL.md 保留精简版，完整版放入 references 对应文件** — SKILL.md 提供必读兜底，references 提供完整参考

## 实施要点

### 第 1 阶段：创建 AGENTS.md
- **输入**：项目目录结构、README.md、SKILL.md
- **处理**：撰写 AGENTS.md，描述项目结构、目录约定、扩展/技能/prompt 的分工关系
- **产出**：`AGENTS.md`

### 第 2 阶段：创建 SKILL.md 入口 + references/ 阶段详情
- **输入**：9 个现有 prompt 模板的内容、现有 SKILL.md
- **处理**：
  - SKILL.md 保留：流水线全景表、变更目录解析规则、核心文件约定、Plannotator 入口、各阶段跳转索引
  - 为每个阶段创建 `references/{phase}.md`，包含完整操作说明（输出格式模板、编码规则、验证规则、审阅规则等）
  - **特别注意**：`references/review-plan.md` 必须明确包含审核完成后同步更新 `plan.md` 的步骤（审计结论追加到 change.md 后，需将 plan.md 中对应的错误/遗漏一并修正），避免审核流于形式
  - 如果某个 references 文件超 300 行，在其头部加入目录
- **产出**：`skills/development-workflow/SKILL.md` + `skills/development-workflow/references/*.md` × 9

### 第 3 阶段：精简 9 个 prompt 模板
- **输入**：每个现有 prompt 模板 → SKILL.md 对应章节
- **处理**：每个 prompt 精简为 ~100-150 字，结构为：
  1. 引用 SKILL.md 变更目录解析规则
  2. 本阶段目标（一句话）
  3. 最少必要操作规则（兜底用）
  4. 引用 SKILL.md，SKILL.md 指引到 `references/` 对应文件获取完整说明
  5. 输出/停止条件指引
- **产出**：`prompts/*.md` × 9

### 第 4 阶段：更新测试和文档
- **输入**：变更后的文件
- **处理**：
  - 更新 `tests/dev-workflow.test.sh`：新增 3 项检查（AGENTS.md 存在性、AGENTS.md 内容、README 引用 AGENTS.md）
  - 更新 `README.md`，反映 SKILL.md 和 AGENTS.md 变化
- **产出**：`tests/dev-workflow.test.sh`（修改）、`README.md`（修改）

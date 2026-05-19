# 变更方案

## 目标

将 prompts-dev-workflow 优化为 development-workflow：引入 skill 提供全局视野、prompt 轻薄化、利用 pi convention 目录简化架构。

## 最终结构

```
pi-extensions/
├── extensions/
│   └── dev-workflow.ts          # 精简：仅 /new-change 和 /switch-change 命令
├── prompts/                     # pi 自动发现所有 .md 为 prompt template
│   ├── write-plan.md
│   ├── review-plan.md
│   ├── plan-to-tasks.md
│   ├── write-code.md
│   ├── fix-code.md
│   ├── review-code.md
│   ├── write-test.md
│   ├── review-test.md
│   └── write-docs.md
├── skills/                      # pi 递归发现 SKILL.md
│   └── development-workflow/
│       └── SKILL.md             # 全局工作流地图 + 变更目录解析规则
├── tests/
├── README.md
├── package.json
```

## 关键决策

- 方案 A：Convention 目录分离，`prompts/` + `skills/` 由 pi 自动发现，extension 去掉 `resources_discover` 处理器
- fix-code 保留独立命令，与 write-code 语义区分
- Plannotator 作为通用批注工具，审阅阶段可选调用，不改变流程结构
- `/new-change` 保持 extension 命令，不加 prompt template 版本

## 实施要点

1. 创建 `skills/development-workflow/SKILL.md`：9 阶段流水线全景、变更目录解析规则、Plannotator 介入点
2. 将 `prompts-dev-workflow/*.md` 移动到 `prompts/`，去掉各模板中重复的「变更目录解析」逻辑
3. 精简 `extensions/dev-workflow.ts`：去掉 `resources_discover` 处理器
4. 更新 `README.md` 反映新目录结构
5. 删除空目录 `prompts-dev-workflow/`

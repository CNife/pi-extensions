# @cnife/pi-change-based-workflow

基于变更的开发工作流技能集，提供从想法到代码的完整流水线。

## 包含技能

| 技能 | 说明 |
|------|------|
| `grill` | 逐条追问澄清变更范围和用语 |
| `grill-me` | 纯追问理清想法，不绑定变更 |
| `plan` | 基于 grill 结论写变更方案 |
| `plan-to-tasks` | 将方案拆解为可独立验证的子任务 |
| `write-code` | 按 task 文件执行 TDD 红绿重构 |
| `review-code` | AI 审查代码变更 |
| `manage-change` | 变更目录管理（new、switch、status、list） |
| `improve-architecture` | 扫描架构改进机会 |
| `prototype` | 构建可丢弃原型 |
| `zoom-out` | 模块全景地图 |
| `handoff` | 会话交接 |
| `cnife-pi-workflow` | 工作流全景：流水线顺序、技能关系 |

## 安装

```bash
pi install npm:@cnife/pi-change-based-workflow
```

## 使用

典型流程：`grill → plan → plan-to-tasks → write-code → review-code`

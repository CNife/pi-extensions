---
description: 扫描代码库发现架构改进机会，产出列表供选择
argument-hint: "[项目目录]"
---

手动触发。读取根 `CONTEXT.md` 和 `docs/adr/`，扫描源码目录识别架构改进机会（模块耦合、抽象缺失、决策违背、模式重复）。产改进列表供用户选择。

### 最少操作规则

- 对照 CONTEXT.md 用语描述问题
- 对照 ADR 检查决策一致性
- 不直接创建变更，先列列表等用户选择

完整流程请参见 development-workflow skill → [references/improve-architecture.md](../skills/development-workflow/references/improve-architecture.md)。

### 停止条件

改进列表输出完毕 → 等待用户选择。

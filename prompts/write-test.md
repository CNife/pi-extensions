---
description: 为变更的代码编写测试，确保覆盖核心逻辑和边界情况
argument-hint: "[变更目录]"
---

按 development-workflow skill 中的变更目录解析规则确定 `$CHANGE_DIR`。

读取 `change.md` 最新变更摘要获取文件清单，为变更代码编写测试，追加测试记录。

### 最少操作规则

- 每个被修改的函数至少一条正向用例
- 覆盖边界情况：空输入、极值、异常路径
- 测试必须全部通过（退出码 0），失败最多修复 3 次

完整测试流程、输出格式请参见 SKILL.md → [references/write-test.md](../skills/development-workflow/references/write-test.md)。

### 停止条件

测试全部通过且记录追加完毕 → 输出「进入 review-test」指引并停止。

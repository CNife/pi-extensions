---
description: 审查测试质量，检查覆盖率和断言有效性，最多2轮
argument-hint: "[变更目录]"
---

按 development-workflow skill 中的变更目录解析规则确定 `$CHANGE_DIR`。

读取 `change.md` 最新测试记录，审查测试质量，追加审查报告。每次变更最多 2 轮。

### 最少操作规则

- 逐文件审查：断言有效性、覆盖率、边界覆盖、用例独立性
- 运行项目测试命令确认全部通过
- 🔴 阻断：零用例/语法错误/全部失败；🟡 建议：缺少边界/断言不精确

完整审查流程、输出格式请参见 SKILL.md → [references/review-test.md](../skills/development-workflow/references/review-test.md)。

### 停止条件

所有检查完成、报告追加完毕 → 输出下一步指引并停止。

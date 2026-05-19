---
description: 通过对话收集变更需求，逐层深入挖掘，产出 plan.md 和 change.md
argument-hint: "[变更简写]"
---

按 development-workflow skill 中的变更目录解析规则确定 `$CHANGE_DIR`。

通过逐步对话收集需求，逐层深入挖掘，产出 `plan.md` 和 `change.md`。

### 最少操作规则

- 每次只问一个问题，附带推荐选项和理由
- 能通过读取项目文件获取的信息，不问用户
- 不跳过分支——一个决策点未澄清时不跳到下一个

完整操作说明、输出格式模板请参见 SKILL.md → [references/write-plan.md](../skills/development-workflow/references/write-plan.md)。

### 停止条件

所有分支追问完毕、plan.md 写入且 change.md(v1) 写入完毕 → 停止。

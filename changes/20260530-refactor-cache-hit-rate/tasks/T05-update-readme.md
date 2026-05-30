---
status: 待开始
priority: 中
depends_on: [T04-event-handlers]
---

# T5: 更新 README 文档

**目标**：将 README.md 从双指标格式更新为三均线指标体系文档。

**涉及文件**：

- `packages/cache-hit-rate/README.md`

**具体内容**：

1. 更新"功能"章节：
   - 描述三均线指标（Current / Recent N / Total）
   - Footer 格式示例
   - 颜色规则说明
2. 更新配置文件章节：
   - `cnife-cache-hit-rate.json` 位置和默认内容
   - 自定义 `recentN` 和 `colorRules` 的方法
3. 移除旧的双指标（累计 + delta）描述
4. 添加故障排查：`cache config error` 的含义和修复方法

**验证方式**：

- 阅读 README.md，确认无旧指标描述残留
- 验证 README 中的 footer 格式示例与代码实际输出一致

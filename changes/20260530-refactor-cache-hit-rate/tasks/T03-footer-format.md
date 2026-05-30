---
status: 待开始
priority: 高
depends_on: [T01-config-module, T02-core-state]
---

# T3: Footer 格式化与颜色

**目标**：实现三均线格式的 footer 字符串生成和颜色应用。

**涉及文件**：

- `packages/cache-hit-rate/extensions/cache-hit-rate.ts`

**具体内容**：

1. 新增 `formatStatus(ctx, state, config)` 函数：
   - 三条数据完整时：`Cache C:12.34 R10:56.78 T:99.99`
   - 0 条样本时：`Cache C:--.-- R0:--.-- T:--.--`
   - Recent 实际样本数 < recentN 时显示实际数量（如 `R3:56.78`）
2. 新增 `applyColor(ctx, text, percent, colorRules)` 函数：
   - 遍历 colorRules，匹配 `[low, high)` 区间
   - 最后一条规则 `high ≤ 100` 时用 `≤` 判断（保证 100% 着色）
   - `color: "default"` → 不应用主题色，返回原文
3. 移除旧函数：`colorizeByCumulativeRate`、`colorizeByDelta`、`formatDelta`
4. `publishCacheHitRate()` 改为调用 `formatStatus` + `applyColor`

**验证方式**：

- 构造不同的 `CacheMetrics` 状态，验证 footer 输出字符串格式
- 验证 100% 命中率被最后一条规则正确着色
- 验证 `--.--%` 状态三个指标均无数据时显示正确

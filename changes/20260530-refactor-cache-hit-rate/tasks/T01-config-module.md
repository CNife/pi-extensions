---
status: 待开始
priority: 高
depends_on: []
---

# T1: 配置文件加载与验证

**目标**：实现 `cnife-cache-hit-rate.json` 的加载、验证和默认值自动创建逻辑。配置在模块顶层同步加载为闭包变量，供后续 handler 使用。

**涉及文件**：

- `packages/cache-hit-rate/extensions/cache-hit-rate.ts`

**具体内容**：

1. 定义 `CacheHitRateConfig` 类型（`recentN: number`, `colorRules: Array<{low, high, color}>`）
2. 定义 `DEFAULT_CONFIG` 常量（recentN=10, 四条默认 colorRules）
3. 配置路径使用 `getAgentDir()`：

   ```ts
   import { getAgentDir } from "@earendil-works/pi-coding-agent";
   const CONFIG_PATH = join(getAgentDir(), "cnife-cache-hit-rate.json");
   ```

4. 实现 `loadConfig()`：
   - 文件不存在 → 调用 `saveDefaultConfig()` 创建并返回默认值
   - JSON 非法 → 返回 null，调用方显示 `cache config error`
   - colorRules 验证：必须覆盖 [0, 100]、无重叠、无空缺
     - **验证规则**：最后一条规则 `high ≤ 100` 时视为闭区间覆盖（与 T03 着色 `≤` 逻辑一致）
5. 实现 `saveDefaultConfig(path)` 辅助函数
6. 在 `export default function(pi)` 中调用 `loadConfig()` 将 `recentN` 和 `colorRules` 存为闭包变量

**验证方式**：

- 删除 `~/.pi/agent/cnife-cache-hit-rate.json`，启动 pi → 文件自动创建且内容匹配默认值
- 写入非法 JSON → footer 显示 `cache config error`
- colorRules 不覆盖 [0, 100] 或最后一条 high 100 但有空缺 → `cache config error`
- 设置 `PI_CODING_AGENT_DIR=/tmp/test-pi` → 配置文件写入该目录

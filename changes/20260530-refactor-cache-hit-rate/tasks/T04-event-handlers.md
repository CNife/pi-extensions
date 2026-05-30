---
status: 已完成
priority: 高
depends_on: [T02-core-state, T03-footer-format]
---

# T4: 事件处理重写

**目标**：重写 5 个事件 handler，用 T2 状态模型和 T3 格式化函数替换旧逻辑。

**涉及文件**：

- `packages/cache-hit-rate/packages.json`
- `packages/cache-hit-rate/extensions/cache-hit-rate.ts`

**具体内容**：

1. 重写 `session_start` handler：
   - `const state = buildState(ctx.sessionManager, recentN)`
   - `publishCacheHitRate(ctx, state)`
2. 重写 `session_tree` handler：
   - `const state = buildState(ctx.sessionManager, recentN)`
     （buildState 内部遇到 model_change/compaction 自动重置，遍历结束后 state 自然反映当前位置）
   - `publishCacheHitRate(ctx, state)`
3. 重写 `session_compact` handler：同 `session_tree`
4. 重写 `model_select` handler：
   - `const state = buildState(ctx.sessionManager, recentN)`
   - `publishCacheHitRate(ctx, state)`
5. 重写 `message_end` handler：
   - 提取 sample，无效则 return
   - Current: 更新为最新样本
   - recentSamples: push（超过 recentN 时 shift 最旧的）
   - Total: `totalCacheReadTokens += sample.cacheRead; totalPromptTokens += sample.promptTokens`
   - `publishCacheHitRate(ctx, state)`
6. 更新 `package.json` version 从 `0.1.0` → `0.2.0`（breaking change：指标格式和配置方式完全改变）
7. 移除废弃的事件监听逻辑（旧 handler 全部替换）

**验证方式**：

- 发送 assistant message → footer 实时更新
- `/model` 切换模型 → buildState 自动基于 getBranch() 重算，Total 反映当前分支累计
- 手动 compact → 同上
- 新 session 启动 → 三项指标从 session 历史重建
- 含 model_change entry 的分支 → buildState 自动处理重置

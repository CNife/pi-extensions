---
template_version: 2
date: 2026-06-04T11:05:31+08:00
author: 蔡涛
repository: pi-extensions
branch: fix/cache-miss-turn-boundary
commit: d40c54d
review_type: pr
scope: "fix/cache-miss-turn-boundary vs main (first-parent)"
scope_strategy: first-parent
in_scope_files_count: 5
status: needs_changes
severity: { critical: 0, important: 1, suggestion: 2 }
verification: { verified: 5, weakened: 1, falsified: 0 }
blockers_count: 0
tags: [code-review, cache-hit-rate]
---

# Code Review — 修复缓存失效计算：跨轮边界基线替代逐消息对比

**Commit:** `d40c54d` · **Status:** `needs_changes` · **Findings:** 0🔴 · 1🟡 · 2🔵 · **Verification:** 5✓ / 1− / 0✗

## Top Blockers

1. **Q1** — `packages/cache-hit-rate/extensions/cache-hit-rate.ts:410` — message_end 中 currentUserCount 与 state.userMsgCount 作用域不匹配，compaction 后误触发轮边界

---

## Legend

```text
Severity    🔴 fix before merge   🟡 fix soon   🔵 nice to have   💭 discuss
ID prefix   I interaction   Q quality   S security   G gap
Verify      ✓ verified   − weakened (demoted)   ✗ falsified (dropped)
Annotate    [precedent-weighted]   [cascade: <kind>]   [subsumed-by <ID>]
```

---

## 🟡 Important

### Q1 🟡 message_end 中 `currentUserCount` 与 `state.userMsgCount` 作用域不匹配

**Where**
`packages/cache-hit-rate/extensions/cache-hit-rate.ts:410`

## Code

```ts
// buildState (L209-215): compaction/model_change 时重置 userMsgCount = 0
// buildState (L251): 返回 post-reset 子集计数
if (currentUserCount > state.userMsgCount) {
    state.baselinePrompt = state.pendingPrompt;  // L412: 提前提升
    state.userMsgCount = currentUserCount;
}
```

**Why**
`buildState()` 在遇到 compaction 或 model_change 条目时将 `userMsgCount` 重置为 0（L215），返回的是**最后一个重置点之后的**用户消息子集计数。但 `message_end` 处理器的 L407-409 用 `branch.filter(...)` 从**完整 branch** 计算 `currentUserCount`。两者不可比：当 branch 中存在重置点之前的用户消息时，`currentUserCount > state.userMsgCount` 一定会触发，导致 `pendingPrompt` 被错误地提前提升为 `baselinePrompt`。这会使得下一个 assistant message 的 miss 计算使用错误的基线值。

## 可重现场景：

1. Branch 有 10 个条目（5 用户消息 + 5 助理消息），无 compaction
2. Compaction 发生 → `session_compact` 触发 → `buildState` 运行
3. `buildState` 遇到 compaction 标记 → reset `userMsgCount = 0`（L215）
4. 处理 post-compaction 条目（2 用户 + 2 助理）→ `userMsgCount = 2`
5. 返回状态：`state.userMsgCount = 2`，`state.branchLength = 14`
6. 新助理消息到达 → `message_end` 触发。`branch.length = 15 > 14` → 进入 L410
7. `currentUserCount = 7`（5 个 compaction 前 + 2 个 compaction 后），`state.userMsgCount = 2`
8. `7 > 2` → **TRUE** → 轮边界误检测
9. `state.baselinePrompt = state.pendingPrompt` 被错误提升

**Fix**
在 `message_end` 的轮边界检测（L410）前，使用与 `buildState` 相同的过滤逻辑（仅统计 post-compaction 用户消息），或将 `state.userMsgCount` 的语义对齐为完整 branch 计数。一个直接修复：在 buildState 的 compaction/model_change 重置块中不移除 `userMsgCount`，而是记下重置前的总数作为偏移量，或者让 `message_end` 也遍历 branch 查找最近的 compaction/model_change 标记来调整计数。

**Alt**
在 `CacheMetrics` 中增加一个 `lastResetIndex` 字段，记录 `buildState` 最后一次遇到重置点的 branch 索引。`message_end` 仅统计该索引之后的用户消息，确保与 `state.userMsgCount` 的作用域一致。

---

## 🔵 Suggestions

### Q2 🔵 新双路径算法无测试覆盖

**Where**
`packages/cache-hit-rate/extensions/cache-hit-rate.ts:208-224` (buildState 新的轮边界逻辑)；`403-419` (message_end 增量路径)

**Why**
changeset 为核心 miss 计算引入了新的跨轮边界算法（`baselinePrompt`/`pendingPrompt` 双字段、用户消息边界检测、branch 增长守卫），但 changeset 中不包含任何 `[test]` 文件。集成扫描确认整个 `packages/cache-hit-rate/` 下无测试文件。前例表明同类缺陷（cacheWrite 虚增 miss）穿透了 FRD→research→plan→review→validation 全部五道关卡。

**Fix**
为 `buildState` 和 `message_end` 添加单元测试，覆盖：正常跨轮场景、compaction 后场景、model_change 后场景、连续 asst msg 无新轮场景。

### Q3 🔵 四个 full-refresh handler 完全相同

**Where**
`packages/cache-hit-rate/extensions/cache-hit-rate.ts:373-395`

## Code

```ts
// session_start (L373)
pi.on("session_start", (_event, ctx) => {
    const fresh = buildState(ctx);
    Object.assign(state, fresh);
    publishCacheHitRate(ctx, state, colorRules);
});
// session_tree (L379) — 同上
// session_compact (L385) — 同上
// model_select (L391) — 同上
```

**Why**
四个事件处理器共享完全相同的 `buildState() + Object.assign(state, fresh) + publishCacheHitRate()` 三元组。任何未来对状态重建逻辑的变更（如新增字段、修改重置语义）都需要在所有四个位置同步更新，容易遗漏。

**Fix**
提取为 `rebuildState(ctx)` 辅助函数，四个 handler 统一调用。

---

## 💭 Discussion

### I1 💭 矛盾重置假设（双路径生命周期不一致）

**Where**
`packages/cache-hit-rate/extensions/cache-hit-rate.ts:208-216` (buildState 重置)；`396-428` (message_end 无条件累加)

**Why**
`buildState()` 对 `model_change`/`compaction` 条目有完整的重置语义（清零所有累计器含 `baselinePrompt`、`pendingPrompt`、`userMsgCount`）。而 `message_end` 处理器完全没有重置机制——它假定 `session_compact`/`model_select` 事件回调已经通过 `Object.assign` 覆盖了共享状态。当前运行靠 JS 事件循环顺序保证正确性，但代码中没有断言、版本标记或类型机制来强制执行这一不变式。如果未来引入异步事件发射或扩展注入 `model_change` 条目而不触发 `model_select` 事件，将导致无法检测的静默数据损坏。

### I2 💭 custom_message 类型的过滤器缺口

**Where**
`buildState:220` 和 `message_end:407-409` 均使用 `entry.type === "message"` 过滤器

**Why**
`SessionEntry` 联合类型包含 `CustomMessageEntry`（`type: "custom_message"`），由扩展注入的用户内容组成。当前双路径的轮边界检测均排除了这个类型。如果某个扩展（如 auto-naming-session）在用户消息之间注入了一个语义上的"轮边界" `custom_message`，其后的助理消息将使用过时的 `baselinePrompt` 计算 miss，导致 `totalMissTokens` 被错误放大。当前项目中尚无已知的注入场景，但这是一个理论上的盲点。

### G1 💭 SKILL.md CLI 标志文档风险 −

**Where**
`.agents/skills/extension-e2e-test/SKILL.md`

**Why**
新 E2E 测试技能文档记录了 pi CLI 标志（`--no-extensions`、`--no-skills`、`-e`、`--model`、`--thinking`）。这是一个通用的文档时效性风险，当前版本下未发现实际标志不匹配。建议在升级 pi 时同步审查该文档。

---

## Precedents

| Commit    | Subject          | Follow-ups                                              |
| --------- | ---------------- | ------------------------------------------------------- |
| `7c026c7` | 新增缓存命中率扩展 | `27f9ee9` (< 12h: 被完全重写) |
| `27f9ee9` | 三均线指标体系：重写cache-hit-rate插件 | `259fef5` (+10min: 审查后措辞修正); `66e0bb4` (+32min: lockfile 修复) |
| `fc0174c` | 移除 R10 滑动窗口，新增 M/R 缓存失效指标 | `3984b07` (+11h: 当前 fix — prevPromptTokens 逐消息对比缺陷); `f468d89` (lockfile 更新) |

## 经验教训（按频率排序）

1. **cacheWrite 虚增 miss 是最昂贵的盲点**（2026-06-04 凌晨引入，当天上午修复）：`prevPromptTokens = input + cacheRead + cacheWrite` 在同轮多条 assistant message 场景下将 `cacheWrite` 错误计为 miss。该缺陷穿透 FRD→research→plan→review→validation 全部关卡。Q1 发现的 `userMsgCount` 作用域不匹配恰恰是同类问题——双路径状态机的一致性是持续的软肋。
2. **lockfile 同步是反复出现的摩擦**（`66e0bb4`、`f468d89`）：每次 cache-hit-rate 版本变更后 lockfile 不同步。package.json 版本 bump 后必须立即 `npm install` 更新 lockfile。
3. **状态类型变更的连锁风险**：`CacheMetrics` 状态类型每次变更都触及多个消费者（createEmptyState、buildState、message_end handler、publishCacheHitRate）。当前 fix 新增 `baselinePrompt`、`pendingPrompt`、`branchLength`、`userMsgCount` 四个字段，已在所有消费者处同步更新。
4. **双路径一致性仍是核心风险**：`buildState()` 全量重建与 `message_end` 增量更新必须代数等价。Q1 的 `userMsgCount` 作用域不匹配是继 `prevPromptTokens` 出现后的第二种双路径桥接模式缺陷。

---

## Recommendation

| # | ID     | Action                      | Alt / Note        |
| - | ------ | --------------------------- | ----------------- |
| 1 | Q1     | 修复 L410 的 `currentUserCount` 与 `state.userMsgCount` 作用域不匹配：message_end 应使用与 buildState 一致的 post-reset 计数 | 增加 `lastResetIndex` 字段标记 buildState 最新重置位置 |
| 2 | Q2     | 为新的跨轮边界算法添加测试覆盖 | 至少覆盖 compaction 后轮边界、连续 asst msg 无新轮、正常跨轮三个场景 |
| 3 | Q3     | 提取 `rebuildState` 辅助函数消除四个 handler 的重复 | 单纯重构，不改变行为 |
| 4 | I1     | 在 message_end 入口处增加非防御性断言，验证无待处理的 model_change/compaction 条目 | 或用 version 标记在 `Object.assign` 时递增 |

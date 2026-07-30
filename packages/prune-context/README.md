# @cnife/pi-prune-context

确定性上下文裁剪：零 LLM 开销的 prune→format 管线替代 LLM 摘要压缩。

## 功能

- **`/prune` 命令**：手动触发确定性裁剪，产出结构化 Markdown summary 替代原始消息流
- **`session_before_compact` 钩子**：pi 自动阈值压缩时介入，用确定性裁剪替代默认 LLM 摘要
- **`/compact` 不受影响**：保持 pi 原生 LLM 摘要行为

## 裁剪规则（最小管线）

- user / assistant text：全留
- thinking / toolCall / toolResult 等：跳过

## 本地测试

```bash
pi -ne -ns -e packages/prune-context/extensions/prune-context.ts
```

## 单元测试

```bash
npx tsx --test packages/prune-context/test/pipeline.test.ts
```

## 已知问题

### `/prune` 后 TUI 显示两个 `[compaction]` 块

**这是 pi 上游 TUI 的显示 bug，不是本扩展的问题。** session jsonl 只写入 1 个 compaction entry，但 TUI 渲染了 2 个完全相同的 `[compaction]` 块（同 summary、同 tokensBefore）。

**根因**：pi `packages/coding-agent/src/modes/interactive/interactive-mode.ts` 的 `compaction_end` 事件处理（约 3104-3113 行）：

1. `rebuildChatFromMessages()` —— `buildContextEntries` 把 compaction entry 作为首元素返回，`sessionEntryToContextMessages` 将其转成 compactionSummary，渲染在历史位置（顶部）。
2. 紧接着 `addMessageToChat(createCompactionSummaryMessage(...))` 又在底部渲染一个。

两者重复。

**为何 `/prune` 特别明显**：`/prune` 是 compact-all（`firstKeptEntryId=""`），无 kept messages，两个块紧挨。`/compact`、`/pi-vcc` 等保留 tail 的压缩，两个块被 kept messages 分隔在顶/底，重复不易察觉——但同样存在（已实测）。

**上游历史**：

- #2617（commit `161ad182`，2026-03-27）曾修复：移除 synthetic `addMessageToChat`，只 `rebuildChatFromMessages`，CHANGELOG 写明“manual compaction no longer duplicates the summary block”。
- `f456a7a4d`（同日，#2617 后约 46 分钟，无 issue/PR、直接 push main）又加回 `addMessageToChat`，CHANGELOG 写明“so the latest compaction remains visible at the bottom”——为让最新 compaction 固定显示在底部，重新引入重复。
- 测试因 `vi.fn()` mock 了 `rebuildChatFromMessages`，未发现 rebuild 也渲染了 compactionSummary，重复被掩盖。此后无 issue 再讨论。

**Workaround**：无。扩展无法控制 `compaction_end` 的 TUI 渲染。prune-context 逻辑正确，无需改动。

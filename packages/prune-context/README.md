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

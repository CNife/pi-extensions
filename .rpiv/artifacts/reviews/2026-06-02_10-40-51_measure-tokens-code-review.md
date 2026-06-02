---
template_version: 2
date: 2026-06-02T10:40:51+0800
author: 蔡涛
repository: pi-extensions
branch: main
commit: f6d28d5
review_type: working
scope: "all uncommitted changes (modified + untracked)"
scope_strategy: working-tree
in_scope_files_count: 5
status: needs_changes
severity: { critical: 1, important: 5, suggestion: 7 }
verification: { verified: 13, weakened: 0, falsified: 0 }
blockers_count: 1
tags: [code-review, measure-tokens, pi-miscs]
---

# Code Review — measure-tokens 技能（所有未提交变更）

**Commit:** `f6d28d5` · **Status:** `needs_changes` · **Findings:** 1🔴 · 5🟡 · 7🔵 · **Verification:** 13✓ / 0− / 0✗

## Top Blockers

1. **I1** — SKILL.md 全篇使用 `PI_DEBUG_REQUEST`，但扩展和脚本读取 `PI_DEBUG_REQUEST_BODY`，按文档操作的用户得不到任何调试输出

---

## Legend

```text
Severity    🔴 fix before merge   🟡 fix soon   🔵 nice to have   💭 discuss
ID prefix   I interaction   Q quality   S security   G gap
Verify      ✓ verified   − weakened (demoted)   ✗ falsified (dropped)
Annotate    [precedent-weighted]   [cascade: <kind>]   [subsumed-by <ID>]
```

---

## 🔴 Critical

### I1 🔴 环境变量名在文档与实现之间矛盾

**Where**
`packages/miscs/skills/measure-tokens/SKILL.md:29,36,39,40` → `debug-request-body.ts:6` → `measure-tokens.py:103`

## Code (SKILL.md:36)

```markdown
设置环境变量 `PI_DEBUG_REQUEST=1` 运行任何 pi 命令，会将完整请求 payload 保存到临时文件
```

## Code (debug-request-body.ts:6)

```typescript
const debugDir = process.env.PI_DEBUG_REQUEST_BODY;
```

## Code (measure-tokens.py:103)

```python
f"export PI_DEBUG_REQUEST_BODY={DEBUG_DIR} && pi",
```

**Why**
SKILL.md 全篇 4 处使用 `PI_DEBUG_REQUEST`，但扩展 debug-request-body.ts 读取的是 `PI_DEBUG_REQUEST_BODY`，measure-tokens.py 导出也是 `PI_DEBUG_REQUEST_BODY`。用户在捕获 payload 阶段设置错误的变量名，调试目录不会有任何文件。FRD（discover artifact:53）正确记录了 `PI_DEBUG_REQUEST_BODY`——实现中丢失。

**Fix**
将 SKILL.md 中所有 `PI_DEBUG_REQUEST` 替换为 `PI_DEBUG_REQUEST_BODY`（4 处）

**Alt**
— Q12 `[subsumed-by I1]`: FRD 正确但实现偏离，证明设计阶段已知正确值，是过程缺陷

---

## 🟡 Important

### Q1 🟡 `--dir` 已文档化但未实现

**Where**
`packages/miscs/skills/measure-tokens/SKILL.md:54` → `measure-tokens.py:76-86`

## Code (SKILL.md:54)

```bash
uv run packages/miscs/skills/measure-tokens/measure-tokens.py --analyze-only --dir /path/to/payloads
```

**Code (measure-tokens.py:76-86 — parse_args())**

```python
if arg == "--analyze-only":
    args["analyze_only"] = True
elif arg == "--tokenizer":
    ...
# no --dir branch exists
```

**Why**
SKILL.md 展示了 `--dir` 用法示例，但 `parse_args()` 只处理 `--analyze-only` 和 `--tokenizer`，`--dir` 被静默忽略，脚本始终使用硬编码的 `/tmp/pi-token-measure`。

**Fix**
在 `parse_args()` 中添加 `--dir` 支持，覆盖 `DEBUG_DIR` 默认值

### Q2 🟡 `o200k_base` 分词器已列出但加载器不支持

**Where**
`packages/miscs/skills/measure-tokens/SKILL.md:56-57` → `measure-tokens.py:37-48`

## Code (SKILL.md:56)

```bash
# 使用特定 tokenizer（auto, cl100k_base, o200k_base）
```

**Code (measure-tokens.py:37-48 — _load_tokenizer())**

```python
if name == "deepseek":
    ...
elif name == "cl100k_base":
    ...
else:
    raise ValueError(f"Unknown tokenizer: {name}")
```

**Why**
SKILL.md 列出 `o200k_base` 为有效选项，但 `_load_tokenizer()` 会为它抛出 `ValueError`。用户按文档使用 `--tokenizer o200k_base` 会直接崩溃。

**Fix**
实现 `o200k_base` 分支（`tiktoken.get_encoding("o200k_base")`），或从 SKILL.md 移除 `o200k_base`

### Q3 🟡 `--tokenizer auto` 在捕获模式静默退化为 deepseek

**Where**
`packages/miscs/skills/measure-tokens/measure-tokens.py:265`

## Code (main(), non-analyze-only path)

```python
if args["tokenizer"] == "auto":
    pass  # Defer to after payload analysis — but never called outside analyze_only branch
```

同时 `t()` 函数在 `_ENCODER is None` 时静默回退：

```python
def t(s: str) -> int:
    if _ENCODER is None:
        _load_tokenizer("deepseek")
```

**Why**
`--tokenizer auto` 的模型自动检测逻辑只在 `--analyze-only` 分支中执行。在完整捕获模式下，`auto` 被静默忽略，`t()` 回退到 deepseek，报告中显示 `Tokenizer: deepseek` 而非用户预期的 `auto`。用户意图被静默忽略，无任何告警。

**Fix**
在非 `analyze_only` 模式下检测到 `--tokenizer auto` 时打印告警，或者也执行模型检测

### Q4 🟡 JSON 解析无 try/except，payload 损坏时崩溃

**Where**
`packages/miscs/skills/measure-tokens/measure-tokens.py:134,154,195`

## Code (measure-tokens.py:154)

```python
with open(files[0]) as f:
    base = json.load(f)
```

**Why**
`analyze()` 和 `compute()` 中的 `json.load(f)` 都没有 try/except。损坏或截断的 payload 文件会抛出 `json.JSONDecodeError`，向上传播为未处理异常。FRD 非功能需求明确要求"payload 文件缺失时应优雅回退"。

**Fix**
为每个 `json.load()` 添加 try/except，异常时优雅回退（使用示例字符串估算，或跳过该文件）

### Q5 🟡 模拟按键序列假设恰好 4 个问题

**Where**
`packages/miscs/skills/measure-tokens/measure-tokens.py:354`

## Code

```python
for _ in range(4):
    send("Enter")
    time.sleep(1)
    send("Tab")
    time.sleep(0.5)
```

**Why**
`ask_user_question` 可以问 1-4 个问题（技能约定是 "up to 4"）。如果 pi 只问 2 个问题，多余的 Enter+Tab 会发送到后续提示中，可能干扰测量甚至破坏测试会话。

**Fix**
改为轮询 pane 输出检测问答结束，或者基于 `wait_output` 动态调整按键次数

---

## 🔵 Suggestions

### Q6 🔵 `wait_output()` 返回 False 但调用者继续执行

**Where** `measure-tokens.py:346,351,365,369`
**Fix** 检查返回值，超时时优雅退出或重试，而非继续发送按键到不可预测的 pane 状态

### Q7 🔵 模式重复

**Where** `measure-tokens.py`
**Fix** `DEBUG_DIR.glob("*.json")` 3 处 → 提取变量；`subprocess.run(["tmux"..., ...])` 6 处 → 提取辅助函数；`t(json.dumps(...))` 4 处 → 提取 `t_json(obj)` 辅助函数

### Q8 🔵 `parse_args()` 无 `--help`

**Where** `measure-tokens.py:76-86`
**Fix** 添加 `--help`/`-h` 打印用法文档

### Q9 🔵 `sys_msg.find()` 依赖系统提示精确格式

**Where** `measure-tokens.py:180-186`
**Fix** 使用更健壮的分隔模式（如行号前缀匹配 `.find("\n-")`）或在匹配失败时回退到全系统提示 token 计数

### Q10 🔵 Decision Guide 中未解释的魔数 `+100`

**Where** `measure-tokens.py:307`
**Fix** 提取为有名字的常量（如 `ROUNDING_BUFFER`），或添加注释说明用途（例如：估算其他未计工具调用的开销）

### Q11 🔵 cl100k_base 的 vocab 硬编码值

**Where** `measure-tokens.py:246`
**Fix** 动态查询 `tiktoken.get_encoding("cl100k_base").max_token_value` 而非硬编码 `100277`

### Q12 🔵 FRD 正确但 SKILL.md 实现偏离 `[subsumed-by I1]`

**Where** `.rpiv/artifacts/discover/2026-06-02_10-02-34_debug-pi-request-skill.md:53` → `SKILL.md:36`
**Fix** 主要修复见 I1；此处作为过程缺陷记录：计划（Phase 2）的成功标准【读一遍文档，确认未接触过该工具的人能照着操作】未捕获 env var 命名错误，反映验证流程可改进

---

## Precedents

| Commit | Subject | Follow-ups |
|--------|---------|------------|
| `bb3acf8`→`c299280` | 修复 package.json 非法 JSON + 版本 bump | 12 分钟后紧急修复 (trailing comma) |
| `7c026c7`→`66e0bb4` | 新增缓存命中率扩展 → 修复 CI (lockfile) | ~23 小时后 |
| `230aa50`→`5fafd1f` | 添加 execute-python → 修复输出缓冲 | <1 天 |
| `63bde68` | 添加 handoff 技能 | 稳定，无 follow-up |
| `362f4af` | 补全 package.json skills/prompts 声明 | 稳定，无 follow-up |

## Recurring lessons (most → least frequent)

1. **package.json JSON 语法错误是最常见的 CI 破坏源** — 手动编辑产生的尾逗号 / 双逗号已出现两次。提交前必须用 `python3 -c "import json; json.load(...)"` 验证。
2. **Python 输出缓冲是反复出现的问题** — execute-python 需要强制无缓冲修复。`measure-tokens.py` 应早期测试 `uv run --script` 下的输出捕获行为。
3. **Skill 添加是低风险的成熟模式** — 4 次先例 (handoff, check-work, development-workflow, init-builder) 均无 post-merge bug。
4. **文档-代码同步失败是新功能最常见的缺陷** — 本次审查的 env var 不匹配、`--dir`/`o200k_base` 文档偏差均属此类。建议在实施计划中添加「文档与代码逐行交叉检查」环节。

---

## Recommendation

> 经 advisor 裁定，严重度分级全部确认。I1 是功能性缺陷：文档环境变量名错误使用户操作完全失效。Q1-Q5 全部正确加权。建议在提交前修复 I1 + Q1-Q5（约 15 分钟），避免上线后产生支持工单。

| # | ID | Action | Alt / Note |
| - | --- | ------ | ---------- |
| 1 | I1 | SKILL.md 中 `PI_DEBUG_REQUEST` → `PI_DEBUG_REQUEST_BODY`（4 处） | — |
| 2 | Q1 | `parse_args()` 添加 `--dir` 支持 | 也可从 SKILL.md 移除 `--dir` 示例 |
| 3 | Q2 | 实现 `o200k_base` 分支或从文档移除 | 添加 `tiktoken.get_encoding("o200k_base")` |
| 4 | Q3 | 非 `--analyze-only` 模式检测 `auto` 时打印告警 | 也可执行模型自动检测 |
| 5 | Q4 | `json.load()` 添加 try/except，优雅回退 | — |
| 6 | Q5 | 动态检测问答结束而非硬编码 4 次 | — |
| 7 | Q6-Q12 | 后续迭代中逐步优化 | 不阻塞合并 |

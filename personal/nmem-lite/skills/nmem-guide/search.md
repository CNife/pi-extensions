# 主动搜索与检索路由

## 什么时候搜

**强信号 — 直接搜：**

- 用户引用过去工作、先前修复、早期决策
- 任务恢复命名 feature/bug/refactor/incident/subsystem
- 调试模式似曾相识
- 用户问理性、偏好、流程、循环工作流细节
- 隐式回忆语言："那个方法"、"像之前"、"我们用过的模式"

**语境信号 — 考虑搜：**

- 复杂调试，先前上下文能缩小搜索空间
- 架构讨论，可能交叉过去决策
- 领域约定，用户之前建立过
- 当前结果模糊，过去上下文能让答案更尖锐

**不搜：**

- 全新话题，无历史
- 通用语法/API 问题
- 用户明确要新鲜视角

不要每条消息都搜。一次精准搜索胜过三次投机搜索。

## memory vs thread

- **memory** — 蒸馏出的知识点（`m search`/`m add`），原子、独立、有标题
- **thread** — 原始会话记录（`t search`/`t show`），保留对话结构

搜过去决策用 memory，搜过去对话用 thread。

## 检索路由

### 1. 搜 memories（蒸馏知识）

```bash
nmem --json m search "3-7 词语义查询"
```

### 2. 搜 threads（过去会话）

用户问过去会话、讨论或确切对话时：

```bash
nmem --json t search "query" --limit 5
```

### 3. 渐进加载 thread

如果 thread 相关，增量加载：

```bash
nmem --json t show <thread_id> --limit 8 --offset 0 --content-limit 1200
```

只在确实需要更多消息时增加 `--offset`。

### 4. Space-aware routing

- 如果运行时有自然 ambient space，传 `--space "<space name>"` 或设 `NMEM_SPACE="<space name>"`
- 没有自然 space 就待在默认 lane，不发明
- 共享或跨 space recall 应显式，不自动
- 存储边界是隐藏的 space key，人和 agent 都用 space name

### 5. Nowledge FS 渐进检索

当语义搜索结果不够、想按结构/路径/内容查时，用 FS 渐进：

```bash
nmem --json fs recall "query"     # 语义检索，返回 FS 路径
nmem --json fs find /memories     # 结构搜索（按 type/label/since 过滤）
nmem --json fs grep "pattern"    # 内容搜索（正则或字面）
nmem --json fs cat <path>        # 读具体路径
```

`recall` 返回路径不是内容，按路径再 `cat` 读。

### 6. 结果弱或概念性查询

初始结果弱或偏概念时用 `--mode deep`：

```bash
nmem --json m search "auth architecture rationale" --mode deep
```

## 解读结果

- **分数** 0.6-1.0 直接匹配，0.3-0.6 相关，低于 0.3 跳过
- **找到** 综合并在有帮助时引用
- **没找到** 明确说。如果当前讨论有价值，建议蒸馏保存

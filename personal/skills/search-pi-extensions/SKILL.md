---
name: search-pi-extensions
description: 按需求从 npm pi-package 生态检索符合的 Pi Agent 扩展/技能/主题/prompt 包，采集 npm 元数据与 GitHub 信号，质量评估后整理成表格。与 pi-trending 互补（后者做热度发现）。
disable-model-invocation: true
---

# Search Pi Extensions

按用户需求从 npm `pi-package` 生态中检索符合的 Pi Agent 包（extension / skill / theme / prompt），采集 npm 元数据与 GitHub 信号，经质量评估后整理成 Markdown 表格 + 风险提示。

与 [pi-trending](../pi-trending) 互补：pi-trending 回答「生态里火什么」（热度发现），本技能做**需求驱动检索**（「我要找做 X 的包」）。

## 工作流程

手动触发（`disable-model-invocation: true`）：键入技能名加载后，LLM 主导 grilling、质量评估与整理，脚本只负责检索与数据采集。

### 阶段 ① Grilling 澄清需求 + 生成关键词（LLM）

用户通常给模糊需求（如「找个能读 PDF 的 pi 扩展」）。LLM 先简短提问澄清：

- **具体用途**：要解决什么问题、预期行为
- **类型偏好**：extension / skill / theme / prompt，或不限
- **约束**：是否需要 GitHub 仓库、是否接受实验性/低下载包

澄清后生成 **2-5 个英文搜索关键词**，覆盖目标包在 name / description / keywords 中可能出现的用词（如 `pdf` `document` `reader`）。关键词是 npm 全文检索词，不必精确，脚本会取相关度 Top 窗口。每个关键词作为独立位置参数传入脚本；多词短语应拆成多个单词关键词，避免 shell 引号转义问题。

### 阶段 ② 检索 + 采集（脚本）

```bash
uv run --script scripts/search_pi_extensions.py <kw1> <kw2> ... [--max-candidates N]
```

脚本一次完成检索与采集：

1. 对每个关键词调 npm search API（`text=keywords:pi-package <kw>`），取相关度 Top 250 窗口，合并去重
2. 硬过滤：**无 repository** 或 **月下载 < 10**（统计分原因计数）
3. 按 命中关键词数 / 最高 searchScore / 月下载 初排，截断到 `--max-candidates`（默认 50）
4. 并发 `gh api` 取 GitHub 信号（stars / pushed_at / open_issues）；失败或非 GitHub repo 保留候选，`github` 置 null
5. stdout 输出 JSON，诊断与警告写 stderr

> ⚠️ **npm 检索特性**：附加全文词不缩小 `total`，仅改变排序（见 `query_stats.npm_total`，通常仍是全量 5304）。脚本只取相关度 Top 窗口，是**排序检索而非严格筛选**，语义相关度需 LLM 在阶段 ③ 判断。

### 阶段 ③ 质量评估（LLM）

读 JSON，结合字段综合判断相关度与质量，过滤低质或不相关包：

- **相关度**：`literal_keywords`（字面命中）> `matched_keywords`（进入窗口）> `description` 语义
- **使用量**：`downloads.monthly`（近 30 天）
- **社区活跃**：`github.stars` / `github.pushed_at` / `open_issues`（`github=null` 的包无法评估，降权或标注）
- **类型匹配**：`types` 是否符合用户偏好
- **npm 信誉**：`dependents`（被依赖数）、`npm_score`

脚本已硬过滤无 repository / 月下载 < 10 的包，LLM 在此基础上做**语义相关度与质量判断**。告知用户被过滤的数量（含硬过滤 + LLM 评估过滤）。

### 阶段 ④ 整理表格 + 风险提示（LLM）

按相关度排序（不打分），输出 Markdown 表格：

```text
| # | 包名 | 类型 | 一句话说明 | 安装命令 |
|---|------|------|-----------|----------|
| 1 | `pi-mcp-adapter` | extension | MCP 协议适配器 | bunx pi extension install pi-mcp-adapter |
```

- **一句话说明**：根据 `description` 翻译为中文并精简到 ≤20 字
- **类型**：取 `types`（多类型包用 `/` 连接，如 `extension/skill`；`package` 表示无明确类型 keyword）
- **安装命令**：按类型生成（见下方「安装命令」）
- 可选附月下载量列

**末尾风险提示**（按实际情况取舍）：

- 已过滤 N 个低质包（无 repository 或 月下载 < 10）+ M 个不相关包
- npm 检索为排序检索，`npm_total` 远大于返回数，可能漏掉未命中关键词但语义相关的包
- `github=null` 的包无法评估社区活跃度
- pi 生态很新（所有包近 6 个月内发布），质量参差，建议优先选有 repo、有 star、近期 push 的包
- 数据时效：下载量为近 30 天，GitHub 信号为查询时刻

## 安装命令

按 `types` 生成（参考 pi-trending）：

| 类型 | 安装命令 |
|------|----------|
| extension | `bunx pi extension install <name>` |
| skill | `bunx skills add <name>` |
| theme | `bunx pi theme install <name>` |
| prompt | `bunx pi prompt install <name>` |
| package（无类型） | 提示用户查看包说明确认类型后再安装 |

多类型包展示主要类型的命令。`<name>` 含 `@scope/` 前缀时原样保留。

## CLI 参考

```bash
uv run --script scripts/search_pi_extensions.py <kw>... [选项]
```

| 选项 | 作用 | 默认 |
|------|------|------|
| `keywords`（位置参数） | 搜索关键词，至少一个；重复词按大小写不敏感去重 | - |
| `--max-candidates N` | GitHub 请求前截断的候选数上限 | 50 |
| `--max-results-per-keyword N` | 每关键词采相关度窗口上限 | 250 |
| `--verbose` | 采集进度、分页、统计输出到 stderr | 关 |

stdout 仅输出 JSON（可管道给 jq），诊断与警告写 stderr。

## JSON 字段说明（供阶段 ③ 质量评估）

顶层：

| 字段 | 说明 |
|------|------|
| `keywords` | 去重后的查询关键词 |
| `query_stats` | 每关键词 `{npm_total, retrieved_unique}` |
| `found_unique` | 合并去重后的候选总数 |
| `quality_filtered` | 硬过滤掉的数量 |
| `filter_reasons` | `{no_repository, low_downloads}` 分原因计数 |
| `eligible_before_limit` | 硬过滤后、截断前的候选数 |
| `returned` | 实际返回的包数（截断后） |
| `truncated` | 是否因 `--max-candidates` 截断 |
| `github_stats` | `{success, failed, skipped}` GitHub 信号采集统计 |
| `packages` | 候选包数组 |

每个 package：

| 字段 | 说明 |
|------|------|
| `name` | npm 包名（含 scope） |
| `description` | npm 描述（英文原文） |
| `types` | 类型数组（`extension`/`skill`/`theme`/`prompt`，无类型为 `["package"]`） |
| `keywords` | npm keywords |
| `matched_keywords` | 该包进入了哪些关键词的相关度窗口（排序信号） |
| `literal_keywords` | 查询词字面出现在 name/description/keywords（相关度信号） |
| `version` / `date` | 最新版本与发布时间 |
| `downloads` | `{monthly, weekly}` 下载量 |
| `dependents` | 被依赖数 |
| `npm_score` | npm 综合评分 |
| `search_scores` | 各关键词的 searchScore |
| `repository` | 仓库 URL |
| `github` | `{stars, pushed_at, open_issues}`，失败/非 GitHub 为 `null` |

## 脚本位置

`scripts/search_pi_extensions.py` - 基于 uv 的 PEP 723 单文件脚本，零依赖（仅标准库 + `gh` CLI）。

**前置条件**：`gh` CLI 已认证（用于 GitHub 信号）。未认证时限流 60 req/hour，可能批量失败。检查：`gh auth status`。

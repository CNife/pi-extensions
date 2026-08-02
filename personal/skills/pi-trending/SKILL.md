---
name: pi-trending
description: 发现 npm 上热门和新锐的 Pi Agent 包（扩展/技能/主题/prompt 模板），计算趋势分并汇总展示。
disable-model-invocation: true
---

# Pi Trending

扫描 npm registry，发现最近🔥的 Pi Agent 包（extension / skill / theme / prompt template），计算趋势分并汇总展示，帮助用户追踪 pi 生态的最新进展。

输出两个独立榜单：

- **主流榜** - 按近 30 天月下载量（`monthly`）倒排，反映生态中当下最常用的包
- **新锐榜** - 按增速评分（`growth × ln(weekly+1)`）倒排，反映正在快速蹿升的包

## 快速开始

运行一次命令，同时拿到主流榜和新锐榜两张 Markdown 表格（LLM 友好）。不带参数时各展示 Top 30。

```bash
uv run --script scripts/pi_trending.py
```

**AI 展示环节**：获取脚本输出的表格后，AI 应自动将「一句话介绍」列的英文 description**翻译为中文并精简到 20 字以内**，再展示给用户。翻译失败的 description 保留原文。

脚本输出示例（description 为英文原文，展示前按上述规则翻译「一句话介绍」列）：

```text
# 🔥 Pi Agent 最新热门包 (2026-06-17)

## 主流榜
| # | 包名 | 作者 | 月下载量 | 一句话介绍 |
|---|------|------|---------|------------|
| 1 | `@pi/core` | user | 12,345 | A core framework for building pi extensions |

> Top 30 · 按月下载量排序

## 新锐榜
| # | 包名 | 作者 | 趋势分 | 一句话介绍 |
|---|------|------|--------|------------|
| 1 | `pi-context-map` | dev | 9 | Professional context profiler for Pi |
```

## 榜单说明

数据源：npm registry（含 `pi-package` keyword 的 npm 包）。搜索策略：`sort=popularity` 从 npm search API 按下载量排序采集 500 个候选包。核心类型：`extension` · `skill` · `theme` · `prompt`（通过 npm keywords 自动识别）。

### 主流榜

按 `downloads.monthly`（search API 返回的近 30 天月下载量）倒排，零额外 API 成本。反映**当下最常用的包**，适合回答"大家都在用什么"。

### 新锐榜

按增速评分倒排，反映**增长速度**而非绝对热度。算法仅用 search API 返回的 `weekly`/`monthly` 两个字段：

```text
recency = weekly / monthly                       # 本周在月度总量中的占比
growth  = (recency - 7/30) / (1 - 7/30)          # 归一化到 0~1，7/30 为均匀分布基线
score   = growth × ln(weekly + 1)                # 增速 × 信誉权重
```

- `recency ≤ 7/30`（本周占比不高于均匀分布基线）的包得 0 分，不入榜
- 候选门槛：`weekly ≥ 100`，低于此值不进入新锐榜候选池（避免低基数噪声）

分数量级参考（pi 生态 weekly 量级下，`growth ≤ 1` × `ln(weekly+1)` 上限约 11）：

| 趋势分 | 含义 |
|--------|------|
| ≥8 | 🚀 本周占比远超基线，爆发式增长 |
| ≥3 | 🔥 明显高于基线，快速上升 |
| >0 | 📈 略高于基线，温和增长 |
| 0 | 未入榜（`recency ≤ 7/30` 或 `weekly < 100`） |

⚠️ **注意事项**：

- 新包 `weekly` 小时趋势分偏低（`ln(weekly+1)` 项小），不代表没增长
- 成熟稳定的大包（如核心框架）主流榜排名靠前，但新锐榜趋势分可能不高
- **趋势分**反映增长速度，建议结合 JSON 输出的 `weekly_downloads` 一起评估（`--json`）
- 同一包可以同时出现在两个榜中（互不冲突）

## CLI 参考

```bash
uv run --script scripts/pi_trending.py [选项]
```

| 选项 | 作用 | 默认 |
|------|------|------|
| `--type <extension\|skill\|theme\|prompt>` | 按类型过滤候选池，两个榜单只显示该类型 | all |
| `--max N` | 同时设置主流榜和新锐榜的条数 | 30 |
| `--mainstream-max N` | 只设主流榜条数（覆盖 `--max`） | 同 `--max` |
| `--rising-max N` | 只设新锐榜条数（覆盖 `--max`）；设 0 可只读主流榜 | 同 `--max` |
| `--json` | JSON 输出（含 `list_type` 字段区分 `mainstream`/`rising`），可管道给 jq | 关 |
| `--verbose` | API 请求进度、分页、候选数等输出到 stderr | 关 |

JSON 管道示例：

```bash
# 只读主流榜包名
uv run --script scripts/pi_trending.py --json | jq '.[] | select(.list_type == "mainstream") | .name'

# 只读新锐榜包名
uv run --script scripts/pi_trending.py --json | jq '.[] | select(.list_type == "rising") | .name'
```

## 后续操作

趋势表里的包名是 npm 包，可直接用 npm/gh 追溯详情与变更。

**看包详情**：`npm view <包名> readme`（含 `@scope/` 前缀）。

**安装**（按包类型）：

- **pi-extension** -> `bunx pi extension install <name>`
- **pi-skill** -> `bunx skills add <name>` 或 `bunx skills add <gh-repo>`
- **pi-theme** -> `bunx pi theme install <name>` 或参照主题安装指南
- **prompt-template** -> `bunx pi prompt install <name>` 或写入 prompt-templates 目录

**看近期变更**（趋势表里上升快的包常值得追问）：用 `npm view <包名> time --json` 看发布节奏，`npm view <包名> repository` 找仓库，再用 `gh release view` / `gh api repos/<owner>/<repo>/commits` 看 release 说明与 commit。分析要点：

- 版本发布时间密集度 -> 开发活跃度信号
- 版本号跳跃（如 1.x -> 2.0）-> 重大重构或生产硬化
- 追问某个特定版本号 -> `npm view <包名> readme` 看 README 的 changelog 段落

## 脚本位置

`scripts/pi_trending.py` - 基于 uv 的 PEP 723 单文件脚本，自动托管依赖。

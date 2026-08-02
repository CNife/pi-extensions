#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///

"""
pi-trending — 发现 Pi Agent 生态中最近最火的包。

数据源：npm registry (pi 包本质是含 pi-package keyword 的 npm 包)
榜单：
- 主流榜 — 按月下载量 (monthly) 倒排，反映近 30 天最常用的包
- 新锐榜 — 按增速评分 (growth x ln(weekly+1)) 倒排，反映最近在上升的包
"""

from __future__ import annotations

import argparse
import json
import math
import random
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

# ── Constants ────────────────────────────────────────────────────────────────

NPM_SEARCH = "https://registry.npmjs.org/-/v1/search"
SEARCH_PAGE_SIZE = 250
RISING_MIN_WEEKLY = 100  # 新锐榜候选池最低周下载门槛

# Type keywords (in order of precedence)
TYPE_KEYWORDS: dict[str, list[str]] = {
    "extension": ["pi-extension", "extension"],
    "skill": ["pi-skill", "skill"],
    "theme": ["pi-theme", "theme"],
    "prompt": ["pi-prompt", "prompt", "prompt-template"],
}

# ── Logging ─────────────────────────────────────────────────────────────────

VERBOSE = False  # set by --verbose flag in main()


def _vlog(msg: str) -> None:
    """Log to stderr when --verbose is set."""
    if VERBOSE:
        print(f"[pi-trending] {msg}", file=sys.stderr)


def _warn(msg: str) -> None:
    """Print a warning/error to stderr (always visible)."""
    print(f"[pi-trending] ⚠ {msg}", file=sys.stderr)


# ── Data models ──────────────────────────────────────────────────────────────


@dataclass
class PiPackage:
    name: str
    description: str
    author: str
    weekly: int
    monthly: int
    pkg_type: str
    score: float = 0.0


# ── Network helpers ──────────────────────────────────────────────────────────


def _json_get(url: str, timeout: int = 15, retries: int = 3) -> dict[str, Any] | list | None:
    """GET a JSON endpoint with retries.

    HTTP 429 (rate limited) gets longer exponential backoff.
    Other failures use linear backoff.
    """
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url)
            req.add_header("Accept", "application/json")
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            if e.code == 429:
                # Rate limited — exponential backoff with random jitter
                if attempt == retries - 1:
                    return None
                time.sleep(2**attempt + random.random())
            else:
                if attempt == retries - 1:
                    return None
                time.sleep(0.5 * (attempt + 1))
        except (urllib.error.URLError, OSError, json.JSONDecodeError):
            if attempt == retries - 1:
                return None
            time.sleep(0.5 * (attempt + 1))
    return None


# ── Determine package type ────────────────────────────────────────────────────


def _determine_type(keywords: list[str] | None) -> str:
    """Determine pi package type from npm keywords."""
    if not keywords:
        return "package"
    kw_lower = [k.lower() for k in keywords]
    for ptype, type_kws in TYPE_KEYWORDS.items():
        for tk in type_kws:
            if tk in kw_lower:
                return ptype
    return "package"


def _get_author(pkg: dict) -> str:
    """Extract author name from npm package metadata.

    Prefer maintainers over publisher (publisher can be 'GitHub Actions').
    """
    maintainers = pkg.get("maintainers", [])
    if maintainers:
        return maintainers[0].get("username", "?")
    return pkg.get("publisher", {}).get("username", "?")


# ── Fetch phase 1: search API ────────────────────────────────────────────────


def fetch_top_packages(max_pages: int = 2) -> list[PiPackage]:
    """Fetch pi packages from npm search API, sorted by popularity.

    按下载量降序采集 pi 包，最多取 max_pages 页。
    """
    all_pkgs: list[PiPackage] = []
    total = 0
    page = 0

    while page < max_pages:
        offset = page * SEARCH_PAGE_SIZE
        url = f"{NPM_SEARCH}?text=keywords:pi-package&size={SEARCH_PAGE_SIZE}&from={offset}&sort=popularity"
        data = _json_get(url)
        if data is None:
            _warn(f"搜索 API 第 {page + 1} 页请求失败，终止")
            break

        objects = data.get("objects", [])
        if not objects:
            break

        if page == 0:
            total = data.get("total", 0)
            _vlog(f"npm 搜索到 {total} 个 pi 包 (sort=popularity)")

        for obj in objects:
            p = obj.get("package", {})
            dl = obj.get("downloads", {})
            pkg = PiPackage(
                name=p.get("name", "?"),
                description=p.get("description", ""),
                author=_get_author(p),
                weekly=dl.get("weekly", 0),
                monthly=dl.get("monthly", 0),
                pkg_type=_determine_type(p.get("keywords")),
            )
            all_pkgs.append(pkg)

        _vlog(f"  第 {page + 1} 页: {len(objects)} 个包 (累计 {len(all_pkgs)})")
        page += 1

    # Sort by monthly downloads descending for mainstream list
    all_pkgs.sort(key=lambda p: p.monthly, reverse=True)
    return all_pkgs


# ── Helpers ───────────────────────────────────────────────────────────────────


def _today_str() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%d")


# ── Rising score ─────────────────────────────────────────────────────────────


def _rising_score(pkg: PiPackage) -> float:
    """Growth-baseline-log score using search API data only.

    recency = weekly / monthly  -> 最近一周在月度总量中的占比
    stable_baseline = 7 / 30    -> 均匀分布时的基准线
    growth = (recency - baseline) / (1 - baseline)  -> 归一化到 0~1
    score = growth * ln(weekly + 1)  -> 增速 x 信誉权重
    """
    if pkg.weekly == 0 or pkg.monthly == 0:
        return 0.0
    recency = pkg.weekly / pkg.monthly
    stable_baseline = 7 / 30
    if recency <= stable_baseline:
        return 0.0
    growth = (recency - stable_baseline) / (1 - stable_baseline)
    return growth * math.log1p(pkg.weekly)


# ── Output ────────────────────────────────────────────────────────────────────


def render_markdown(mainstream: list[PiPackage], rising: list[PiPackage]) -> None:
    """Render two Markdown tables: mainstream (by monthly downloads) and rising (by growth score).

    The description column contains the raw English description from npm.
    When presenting to the user, the AI SHALL translate each description
    into Chinese and simplify it to ≤20 characters for readability.
    """
    today = _today_str()

    lines = [f"# 🔥 Pi Agent 最新热门包 ({today})"]

    # Mainstream table
    lines.append("\n## 主流榜")
    lines.append("| # | 包名 | 作者 | 月下载量 | 一句话介绍 |")
    lines.append("|---|---|---|---|---|")
    for rank, pkg in enumerate(mainstream, 1):
        desc = pkg.description if pkg.description else "（未提供描述）"
        lines.append(f"| {rank} | `{pkg.name}` | {pkg.author} | {pkg.monthly:,} | {desc} |")
    lines.append(f"\n> Top {len(mainstream)} · 按月下载量排序")

    # Rising table
    lines.append("\n## 新锐榜")
    lines.append("| # | 包名 | 作者 | 趋势分 | 一句话介绍 |")
    lines.append("|---|---|---|---|---|")
    for rank, pkg in enumerate(rising, 1):
        desc = pkg.description if pkg.description else "（未提供描述）"
        lines.append(f"| {rank} | `{pkg.name}` | {pkg.author} | {pkg.score:,.0f} | {desc} |")
    lines.append(f"\n> Top {len(rising)} · 更新于 {today} · 数据: npm registry")

    print("\n".join(lines))


def render_json(mainstream: list[PiPackage], rising: list[PiPackage]) -> None:
    """Render dual-list trending packages as JSON."""
    output = []
    for pkg in mainstream:
        output.append(
            {
                "list_type": "mainstream",
                "name": pkg.name,
                "type": pkg.pkg_type,
                "author": pkg.author,
                "weekly_downloads": pkg.weekly,
                "trending_score": None,
                "description": pkg.description,
            }
        )
    for pkg in rising:
        output.append(
            {
                "list_type": "rising",
                "name": pkg.name,
                "type": pkg.pkg_type,
                "author": pkg.author,
                "weekly_downloads": pkg.weekly,
                "trending_score": round(pkg.score, 1),
                "description": pkg.description,
            }
        )
    print(json.dumps(output, ensure_ascii=False, indent=2))


# ── CLI ──────────────────────────────────────────────────────────────────────


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="发现 Pi Agent 生态中最新的热门包",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  pi-trending.py                          # 输出 Top 30 Markdown 表格
  pi-trending.py --max 10                 # 只显示前 10
  pi-trending.py --type extension         # 只看扩展
  pi-trending.py --verbose                # 显示详细 API 调用日志
  pi-trending.py --json                   # JSON 格式输出
  pi-trending.py --mainstream-max 5 --rising-max 10  # 分别控制榜单条数
        """,
    )
    parser.add_argument(
        "--max", type=int, default=30, help="同时设置主流榜和新锐榜的显示条数 (默认 30)"
    )
    parser.add_argument(
        "--mainstream-max", type=int, default=None, help="主流榜显示条数 (默认同 --max)"
    )
    parser.add_argument(
        "--rising-max", type=int, default=None, help="新锐榜显示条数 (默认同 --max)"
    )
    parser.add_argument(
        "--type",
        dest="pkg_type",
        default="all",
        choices=["all", "extension", "skill", "theme", "prompt"],
        help="按包类型过滤: extension, skill, theme, prompt (默认 all)",
    )
    parser.add_argument("--json", action="store_true", help="以 JSON 格式输出 (替代 Markdown 表格)")
    parser.add_argument(
        "--verbose", action="store_true", help="显示详细的 API 调用和流程日志 (默认不显示)"
    )
    return parser.parse_args(argv)


def main() -> None:
    args = parse_args()
    global VERBOSE
    VERBOSE = args.verbose

    # Determine per-list counts from args
    mainstream_max = args.mainstream_max if args.mainstream_max is not None else args.max
    rising_max = args.rising_max if args.rising_max is not None else args.max

    # ── Phase 1: fetch candidate pool (fixed 2 pages, sort=popularity) ──
    candidates = fetch_top_packages(max_pages=2)
    if not candidates:
        _warn("未获取到任何 pi 包，请检查网络")
        sys.exit(1)

    # Apply type filter to shared pool before list splitting
    if args.pkg_type != "all":
        candidates = [p for p in candidates if p.pkg_type == args.pkg_type]

    # ── Phase 2: mainstream list (by monthly downloads) ──
    mainstream = sorted(candidates, key=lambda p: p.monthly, reverse=True)[:mainstream_max]

    # ── Phase 3: filter rising candidate pool by min weekly threshold ──
    rising_candidates = [p for p in candidates if p.weekly >= RISING_MIN_WEEKLY]
    dropped = len(candidates) - len(rising_candidates)
    if dropped:
        _vlog(
            f"新锐候选池过滤: {len(candidates)} → {len(rising_candidates)} (过滤 {dropped} 个低下载包)"
        )

    # ── Phase 4: score rising candidates (search API only) ──
    for pkg in rising_candidates:
        pkg.score = _rising_score(pkg)
    rising = sorted(rising_candidates, key=lambda p: p.score, reverse=True)[:rising_max]

    # ── Phase 5: output ──
    if args.json:
        render_json(mainstream, rising)
    else:
        render_markdown(mainstream, rising)


if __name__ == "__main__":
    main()

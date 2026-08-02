#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///

"""
search-pi-extensions - 按关键词检索 Pi Agent 生态扩展/包。

输入：LLM 给出的多个搜索关键词。
流程：
  1. 对每个关键词调 npm search API (text=keywords:pi-package <kw>)，只采相关度
     最高的 Top 窗口（--max-results-per-keyword，默认 250）。注意：附加全文词不
     缩小 npm total，仅改变排序，故这是排序检索而非严格筛选（见 query_stats）。
     合并时记录 matched_keywords（该包进入了哪些关键词的窗口）与各 searchScore。
  2. 硬过滤：无 repository 或 月下载 < 10（统计分原因计数，不输出被过滤包详情）。
  3. 初排：命中关键词数降序、最高 searchScore 降序、月下载降序；截断到
     --max-candidates（GitHub 请求前截断，报告截断前后数量）。
  4. 并发用 gh api 采 GitHub 信号 (stars/pushed_at/open_issues)；失败/非 GitHub
     repo 保留候选并将 github 置 null，记录统计，不作为额外硬过滤。
  5. stdout 输出 JSON 供 LLM 做质量评估与整理；诊断与警告写 stderr。

数据源：npm registry (pi 包本质是含 pi-package keyword 的 npm 包)。
"""

from __future__ import annotations

import argparse
import json
import random
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any

# ── Constants ────────────────────────────────────────────────────────────────

NPM_SEARCH = "https://registry.npmjs.org/-/v1/search"
PAGE_SIZE = 250
LOW_MONTHLY_THRESHOLD = 10
DEFAULT_MAX_CANDIDATES = 50
DEFAULT_MAX_RESULTS_PER_KEYWORD = 250
GH_WORKERS = 6

# 类型识别只认明确 pi-* keyword（不用通用 extension/skill 当强信号，避免误分类）
TYPE_KEYWORDS: dict[str, tuple[str, ...]] = {
    "extension": ("pi-extension",),
    "skill": ("pi-skill",),
    "theme": ("pi-theme",),
    "prompt": ("pi-prompt", "prompt-template"),
}

# ── Logging ─────────────────────────────────────────────────────────────────

VERBOSE = False


def _vlog(msg: str) -> None:
    if VERBOSE:
        print(f"[search-pi-ext] {msg}", file=sys.stderr)


def _warn(msg: str) -> None:
    print(f"[search-pi-ext] ⚠ {msg}", file=sys.stderr)


def _die(msg: str) -> None:
    print(f"[search-pi-ext] ✗ {msg}", file=sys.stderr)
    sys.exit(1)


# ── Network helpers ──────────────────────────────────────────────────────────


def _json_get(url: str, timeout: int = 15, retries: int = 3) -> dict[str, Any] | None:
    """GET a JSON endpoint with retries. HTTP 429 -> exponential backoff."""
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url)
            req.add_header("Accept", "application/json")
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            if attempt == retries - 1:
                return None
            if e.code == 429:
                time.sleep(2**attempt + random.random())
            else:
                time.sleep(0.5 * (attempt + 1))
        except (urllib.error.URLError, OSError, json.JSONDecodeError):
            if attempt == retries - 1:
                return None
            time.sleep(0.5 * (attempt + 1))
    return None


# ── Type detection ───────────────────────────────────────────────────────────


def _detect_types(keywords: list[str] | None) -> list[str]:
    """只认明确 pi-* 类型 keyword；无类型标 package，多类型全部保留。"""
    if not keywords:
        return ["package"]
    kl = {k.lower() for k in keywords}
    types = []
    for ptype, aliases in TYPE_KEYWORDS.items():
        if any(a in kl for a in aliases):
            types.append(ptype)
    return types or ["package"]


def _literal_keywords(pkg: dict[str, Any], query_keywords: list[str]) -> list[str]:
    """记录哪些查询关键词字面出现在 name/description/keywords 中。

    仅供 LLM 判断相关度的信号，不作为硬过滤条件。
    """
    if not query_keywords:
        return []
    blob = " ".join(
        [
            pkg.get("name", "") or "",
            pkg.get("description", "") or "",
            " ".join(pkg.get("keywords", []) or []),
        ]
    ).lower()
    return [kw for kw in query_keywords if kw.lower() in blob]


# ── Repository / GitHub helpers ──────────────────────────────────────────────


def _repo_url(pkg: dict[str, Any]) -> str | None:
    """从 npm search object 的 package 里取 repository URL。"""
    links = pkg.get("links") or {}
    repo = links.get("repository") or pkg.get("repository")
    if isinstance(repo, dict):
        repo = repo.get("url")
    return repo or None


def _parse_github(repo_url: str | None) -> tuple[str, str] | None:
    """解析 repository URL 得 (owner, repo)。

    覆盖：git+https://github.com/o/r.git、git+ssh://git@github.com/o/r.git、
    git@github.com:o/r.git。netloc 去掉 user@ 后再判 github.com。
    """
    if not repo_url:
        return None
    url = re.sub(r"^git\+", "", repo_url)
    url = re.sub(r"\.git$", "", url)
    m = re.match(r"git@github\.com:([^/]+)/(.+)", url)
    if m:
        return m.group(1), m.group(2)
    parsed = urllib.parse.urlparse(url)
    host = parsed.netloc.split("@")[-1]
    if host in ("github.com", "www.github.com"):
        parts = [p for p in parsed.path.split("/") if p]
        if len(parts) >= 2:
            return parts[0], parts[1]
    return None


def _gh_repo(owner: str, repo: str) -> dict[str, Any] | None:
    """用 gh api 取 GitHub 信号。失败/仓库不存在返回 None。"""
    path = f"repos/{urllib.parse.quote(owner)}/{urllib.parse.quote(repo)}"
    try:
        r = subprocess.run(
            [
                "gh",
                "api",
                path,
                "--jq",
                "{stars:.stargazers_count,pushed_at:.pushed_at,open_issues:.open_issues_count}",
            ],
            capture_output=True,
            text=True,
            timeout=15,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if r.returncode != 0 or not r.stdout.strip():
        return None
    try:
        d = json.loads(r.stdout)
    except json.JSONDecodeError:
        return None
    return {
        "stars": d.get("stars"),
        "pushed_at": d.get("pushed_at"),
        "open_issues": d.get("open_issues"),
    }


# ── Fetch: per-keyword search ────────────────────────────────────────────────


def _search_keyword(keyword: str, max_results: int) -> tuple[dict[str, dict[str, Any]], int]:
    """对单关键词采相关度 Top 窗口，返回 ({name: raw_object}, npm_total)。

    只采 min(total, max_results) 个，按相关度排序；by name 去重防越界重复。
    """
    found: dict[str, dict[str, Any]] = {}
    total: int | None = None
    limit = max_results
    offset = 0
    while offset < limit:
        request_size = min(PAGE_SIZE, limit - offset)
        if request_size <= 0:
            break
        params = {"text": f"keywords:pi-package {keyword}", "size": request_size, "from": offset}
        url = NPM_SEARCH + "?" + urllib.parse.urlencode(params)
        data = _json_get(url)
        if data is None:
            _warn(f"关键词 '{keyword}' offset={offset} 请求失败，停止该关键词")
            break
        if total is None:
            total = data.get("total", 0)
            limit = min(total, max_results)
            _vlog(f"关键词 '{keyword}': npm_total={total}, 采集上限={limit}")
            if offset >= limit:
                break
        objects = data.get("objects", [])
        if not objects:
            break
        for obj in objects:
            name = obj.get("package", {}).get("name")
            if name and name not in found:
                found[name] = obj
        offset += request_size
        if offset >= (total or 0):
            break
    # 兜底：确保不超过 max_results（防 API 返回略多）
    if len(found) > max_results:
        found = dict(list(found.items())[:max_results])
    return found, total or 0


def _collect(
    keywords: list[str], max_results_per_keyword: int
) -> tuple[dict[str, dict[str, Any]], dict[str, dict[str, int]]]:
    """合并所有关键词结果，记录 matched_keywords 与各关键词 searchScore。

    返回 (merged, query_stats)。matched_keywords 语义：该包进入了哪些关键词的
    npm 相关度窗口（非严格文本命中）。
    """
    merged: dict[str, dict[str, Any]] = {}
    query_stats: dict[str, dict[str, int]] = {}
    for kw in keywords:
        per_kw, total = _search_keyword(kw, max_results_per_keyword)
        query_stats[kw] = {"npm_total": total, "retrieved_unique": len(per_kw)}
        _vlog(f"关键词 '{kw}': 取 {len(per_kw)} 个 (npm_total={total})")
        for name, obj in per_kw.items():
            if name not in merged:
                merged[name] = {"obj": obj, "matched": set(), "scores": {}}
            merged[name]["matched"].add(kw)
            merged[name]["scores"][kw] = obj.get("searchScore", 0.0)
    return merged, query_stats


# ── Quality filter ───────────────────────────────────────────────────────────


def _quality_filter(
    merged: dict[str, dict[str, Any]],
) -> tuple[list[dict[str, Any]], int, dict[str, int]]:
    """硬过滤：无 repository 或 月下载 < 10。返回 (eligible, filtered_total, reasons)。"""
    eligible: list[dict[str, Any]] = []
    reasons = {"no_repository": 0, "low_downloads": 0}
    for entry in merged.values():
        pkg = entry["obj"].get("package", {})
        dl = entry["obj"].get("downloads", {}) or {}
        monthly = dl.get("monthly", 0) or 0
        repo = _repo_url(pkg)
        if not repo:
            reasons["no_repository"] += 1
            continue
        if monthly < LOW_MONTHLY_THRESHOLD:
            reasons["low_downloads"] += 1
            continue
        eligible.append(entry)
    return eligible, sum(reasons.values()), reasons


# ── Sort + truncate ──────────────────────────────────────────────────────────


def _sort_key(entry: dict[str, Any]) -> tuple[int, float, int]:
    matched_n = len(entry["matched"])
    max_score = max(entry["scores"].values()) if entry["scores"] else 0.0
    monthly = (entry["obj"].get("downloads", {}) or {}).get("monthly", 0) or 0
    return (-matched_n, -max_score, -monthly)


def _sort_and_truncate(
    eligible: list[dict[str, Any]], max_candidates: int
) -> tuple[list[dict[str, Any]], bool]:
    eligible.sort(key=_sort_key)
    truncated = len(eligible) > max_candidates
    if truncated:
        eligible = eligible[:max_candidates]
    return eligible, truncated


# ── GitHub signal fetch ──────────────────────────────────────────────────────


def _fetch_github(eligible: list[dict[str, Any]]) -> dict[str, int]:
    """对 eligible 采集 GitHub 信号，写回 entry['github']。返回统计。"""
    stats = {"success": 0, "failed": 0, "skipped": 0}
    tasks: list[tuple[dict[str, Any], str, str]] = []
    for entry in eligible:
        pkg = entry["obj"].get("package", {})
        gh = _parse_github(_repo_url(pkg))
        entry["github"] = None
        if gh:
            tasks.append((entry, gh[0], gh[1]))
    stats["skipped"] = len(eligible) - len(tasks)
    with ThreadPoolExecutor(max_workers=GH_WORKERS) as ex:
        futs = {ex.submit(_gh_repo, o, r): entry for entry, o, r in tasks}
        for fut in as_completed(futs):
            entry = futs[fut]
            try:
                result = fut.result()
            except Exception:
                result = None
            entry["github"] = result
            if result is not None:
                stats["success"] += 1
            else:
                stats["failed"] += 1
    return stats


# ── Output ───────────────────────────────────────────────────────────────────


def _build_output(
    keywords: list[str],
    merged: dict[str, dict[str, Any]],
    query_stats: dict[str, dict[str, int]],
    eligible_before_limit: int,
    eligible_after: list[dict[str, Any]],
    truncated: bool,
    filtered_total: int,
    reasons: dict[str, int],
    gh_stats: dict[str, int],
) -> dict[str, Any]:
    packages: list[dict[str, Any]] = []
    for entry in eligible_after:
        obj = entry["obj"]
        pkg = obj.get("package", {})
        dl = obj.get("downloads", {}) or {}
        score = obj.get("score", {}) or {}
        dependents = obj.get("dependents", 0)
        try:
            dependents = int(dependents)
        except (TypeError, ValueError):
            dependents = 0
        packages.append(
            {
                "name": pkg.get("name"),
                "description": pkg.get("description", ""),
                "types": _detect_types(pkg.get("keywords")),
                "keywords": pkg.get("keywords", []),
                "matched_keywords": sorted(entry["matched"]),
                "literal_keywords": _literal_keywords(pkg, keywords),
                "version": pkg.get("version"),
                "date": pkg.get("date"),
                "downloads": {
                    "monthly": dl.get("monthly", 0) or 0,
                    "weekly": dl.get("weekly", 0) or 0,
                },
                "dependents": dependents,
                "npm_score": score.get("final"),
                "search_scores": entry["scores"],
                "repository": _repo_url(pkg),
                "github": entry.get("github"),
            }
        )
    return {
        "keywords": keywords,
        "query_stats": query_stats,
        "found_unique": len(merged),
        "quality_filtered": filtered_total,
        "filter_reasons": reasons,
        "eligible_before_limit": eligible_before_limit,
        "returned": len(packages),
        "truncated": truncated,
        "github_stats": gh_stats,
        "packages": packages,
    }


# ── CLI ──────────────────────────────────────────────────────────────────────


def _dedup_preserve_order(items: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for x in items:
        key = x.lower()
        if key not in seen:
            seen.add(key)
            out.append(x)
    return out


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="按关键词检索 Pi Agent 生态扩展/包，输出 JSON 供 LLM 整理",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  search_pi_extensions.py mcp adapter           # 多关键词检索
  search_pi_extensions.py theme --verbose       # 显示采集日志
  search_pi_extensions.py subagent --max-candidates 20
  search_pi_extensions.py agent --max-results-per-keyword 500
        """,
    )
    parser.add_argument("keywords", nargs="+", help="搜索关键词（至少一个）")
    parser.add_argument(
        "--max-candidates",
        type=int,
        default=DEFAULT_MAX_CANDIDATES,
        help=f"GitHub 请求前截断的候选数上限 (默认 {DEFAULT_MAX_CANDIDATES})",
    )
    parser.add_argument(
        "--max-results-per-keyword",
        type=int,
        default=DEFAULT_MAX_RESULTS_PER_KEYWORD,
        help=(f"每关键词采相关度窗口上限 (默认 {DEFAULT_MAX_RESULTS_PER_KEYWORD})"),
    )
    parser.add_argument("--verbose", action="store_true", help="显示详细采集日志 (stderr)")
    return parser.parse_args(argv)


def main() -> None:
    args = parse_args()
    global VERBOSE
    VERBOSE = args.verbose

    if args.max_candidates < 1:
        _die("--max-candidates 必须为正整数")
    if args.max_results_per_keyword < 1:
        _die("--max-results-per-keyword 必须为正整数")

    args.keywords = _dedup_preserve_order(args.keywords)
    _vlog(f"检索关键词: {args.keywords}")

    merged, query_stats = _collect(args.keywords, args.max_results_per_keyword)
    if not merged:
        _die("未检索到任何 pi 包")

    eligible, filtered_total, reasons = _quality_filter(merged)
    eligible_before_limit = len(eligible)
    eligible, truncated = _sort_and_truncate(eligible, args.max_candidates)
    _vlog(
        f"唯一 {len(merged)} -> 过滤后 {eligible_before_limit}"
        f" -> 截断后 {len(eligible)} (truncated={truncated})"
    )

    gh_stats = _fetch_github(eligible)
    _vlog(f"GitHub 信号: {gh_stats}")

    output = _build_output(
        args.keywords,
        merged,
        query_stats,
        eligible_before_limit,
        eligible,
        truncated,
        filtered_total,
        reasons,
        gh_stats,
    )
    print(json.dumps(output, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

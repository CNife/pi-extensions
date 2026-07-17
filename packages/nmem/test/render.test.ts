/**
 * Tests for the TUI render helpers of nmem (spec #88, #87 resolution).
 *
 * Seam: the string-producing render functions in render.ts. These take a typed
 * result + a minimal ThemeLike and return the rendered text — no `Text`
 * component, no real TUI. Tests stub `fg` to `[token]s` so assertions pin both
 * the ThemeColor token and the text content, without coupling to call counts.
 *
 * Error state uses `isError` (the pi custom-tool contract: throw -> isError;
 * `result.details` is undefined there, so we read `result.content[0].text`).
 *
 * Run: npx tsx --test packages/nmem/test/render.test.ts
 */

import { ok } from "node:assert";
import { test } from "node:test";
import type { AgentToolResultLike, ThemeLike } from "../render.ts";
import {
  renderReadThreadResult,
  renderSaveMemoryResult,
  renderSearchResult,
} from "../render.ts";

// ============================================================================
// Theme stub: fg token marker + bold marker, so assertions see both
// ============================================================================

const theme: ThemeLike = {
  fg: (token, s) => `[${token}]${s}`,
  bold: (s) => `[bold]${s}`,
};

// ============================================================================
// Fixtures
// ============================================================================

const memoriesResult = {
  returned: 2,
  memories: [
    {
      id: "abc123",
      title: "Wayfinder 规划方法论",
      content: "计划，不执行",
      score: 0.9125,
      importance: 9,
      unit_type: "fact",
      created_at: "2026-07-13T11:02:56+00:00",
    },
    {
      id: "def456",
      title: "OneReason 全切",
      content: "全切到 GitLab",
      score: 0.8245,
      importance: 8,
      unit_type: "decision",
      created_at: "2026-07-08T01:48:58+00:00",
    },
  ],
};

const threadsResult = {
  total: 1,
  threads: [
    {
      id: "pi-thread-001",
      title: "nmem TOON 讨论",
      message_count: 34,
      matches: 5,
    },
  ],
};

const readThreadResult = {
  title: "nmem TOON 讨论",
  created_at: "2026-07-15",
  total_messages: 34,
  offset: 0,
  returned: 5,
  messages: [
    { index: 0, role: "user", content: "看看 token" },
    { index: 1, role: "assistant", content: "省 29%" },
    { index: 2, role: "system", content: "注" },
  ],
  hint: "还有 29 条未读，offset=5 继续",
};

const savedCreated = {
  action: "created" as const,
  id: "nmem-abc-123",
  title: "TUI 渲染决策",
};

const savedUpdatedWithWarnings = {
  action: "updated" as const,
  id: "nmem-abc-123",
  updated_fields: ["title", "content"],
  warnings: ["labels 未变更，nmem 后端限制"],
};

// ============================================================================
// search · memories
// ============================================================================

test("search memories collapsed: summary + numbered list + expand hint", () => {
  const result = { details: memoriesResult } as AgentToolResultLike;
  const text = renderSearchResult(
    result,
    { expanded: false, isError: false },
    theme,
    { query: "x" },
  );
  // summary line (text color), query-agnostic phrasing
  ok(text.includes('Search "x", 2 results'), `summary with query:\n${text}`);
  // numbered list, accent-colored rank
  ok(text.includes("[accent]1."), `rank 1 accent:\n${text}`);
  ok(text.includes("[accent]2."), `rank 2 accent:\n${text}`);
  // titles present
  ok(text.includes("Wayfinder 规划方法论"), `title 1:\n${text}`);
  // score dim, 4 decimals
  ok(text.includes("[dim]score"), `score label dim:\n${text}`);
  ok(text.includes("0.9125"), `score 4dp:\n${text}`);
  ok(text.includes("0.8245"), `score 2 4dp:\n${text}`);
  // expand hint
  ok(text.includes("Expand for details"), `expand hint:\n${text}`);
});

test("search memories expanded: field list per memory, footer count", () => {
  const result = { details: memoriesResult } as AgentToolResultLike;
  const text = renderSearchResult(
    result,
    { expanded: true, isError: false },
    theme,
    { query: "x" },
  );
  // labels dim + lowercase
  ok(text.includes("[dim]id"), `id label dim:\n${text}`);
  ok(text.includes("[dim]score"), `score label dim:\n${text}`);
  ok(text.includes("[dim]type"), `type label dim:\n${text}`);
  ok(text.includes("[dim]importance"), `importance label dim:\n${text}`);
  ok(text.includes("[dim]content"), `content label dim:\n${text}`);
  // value-type coloring: id muted, score number toolOutput, type enum accent
  ok(text.includes("[muted]abc123"), `id value muted:\n${text}`);
  ok(text.includes("[toolOutput]0.9125"), `score value toolOutput:\n${text}`);
  ok(text.includes("[accent]fact"), `type value accent:\n${text}`);
  ok(text.includes("[accent]decision"), `type2 value accent:\n${text}`);
  // importance numeric toolOutput
  ok(text.includes("[toolOutput]9/10"), `importance value 9/10:\n${text}`);
  // footer count
  ok(text.includes("[dim]2 results"), `footer count:\n${text}`);
});

// ============================================================================
// search · threads
// ============================================================================

test("search threads collapsed: found N threads + numbered list", () => {
  const result = { details: threadsResult } as AgentToolResultLike;
  const text = renderSearchResult(
    result,
    { expanded: false, isError: false },
    theme,
    { query: "y" },
  );
  ok(
    text.includes('Search "y", found 1 threads'),
    `threads summary with query:\n${text}`,
  );
  ok(text.includes("[accent]1."), `rank accent:\n${text}`);
  ok(text.includes("nmem TOON 讨论"), `title:\n${text}`);
  ok(text.includes("34") && text.includes("5"), `counts:\n${text}`);
  ok(text.includes("Expand for details"), `expand hint:\n${text}`);
});

test("search threads expanded: id/messages/matches fields", () => {
  const result = { details: threadsResult } as AgentToolResultLike;
  const text = renderSearchResult(
    result,
    { expanded: true, isError: false },
    theme,
    { query: "y" },
  );
  ok(text.includes("[dim]id"), `id label:\n${text}`);
  ok(text.includes("[dim]messages"), `messages label:\n${text}`);
  ok(text.includes("[dim]matches"), `matches label:\n${text}`);
  ok(text.includes("[muted]pi-thread-001"), `id value muted:\n${text}`);
  ok(text.includes("[toolOutput]34"), `messages value toolOutput:\n${text}`);
  ok(text.includes("[toolOutput]5"), `matches value toolOutput:\n${text}`);
  ok(text.includes("[dim]1 threads"), `footer:\n${text}`);
});

// ============================================================================
// read_thread
// ============================================================================

test("read_thread collapsed: title + paging footer + expand hint", () => {
  const result = { details: readThreadResult } as AgentToolResultLike;
  const text = renderReadThreadResult(
    result,
    { expanded: false, isError: false },
    theme,
  );
  // title shown (text color), not the tool-name prefix in collapsed
  ok(text.includes("nmem TOON 讨论"), `title:\n${text}`);
  // paging footer: middle-dot joined, dim
  ok(
    text.includes("[dim]34 messages · returned 5 · offset 0"),
    `paging footer:\n${text}`,
  );
  ok(text.includes("Expand for details"), `expand hint:\n${text}`);
});

test("read_thread expanded: tool-name title + created + role-colored messages + footer", () => {
  const result = { details: readThreadResult } as AgentToolResultLike;
  const text = renderReadThreadResult(
    result,
    { expanded: true, isError: false },
    theme,
  );
  // tool-name + title header (middle-dot separator)
  ok(text.includes("nmem_read_thread"), `tool name header:\n${text}`);
  ok(text.includes("·"), `middle-dot separator:\n${text}`);
  // created label dim
  ok(text.includes("[dim]created"), `created label:\n${text}`);
  // role coloring: user accent, assistant text, system muted
  ok(text.includes("[accent][user]"), `user role accent:\n${text}`);
  ok(text.includes("[text][assistant]"), `assistant role text:\n${text}`);
  ok(text.includes("[muted][system]"), `system role muted:\n${text}`);
  // message content present
  ok(text.includes("看看 token"), `msg content:\n${text}`);
  // paging footer present in expanded too
  ok(text.includes("34 messages · returned 5 · offset 0"), `footer:\n${text}`);
});

// ============================================================================
// save_memory
// ============================================================================

const saveArgs = { title: "TUI 渲染决策", content: "c" };

test("save_memory created collapsed: checkmark + action + id + title", () => {
  const result = { details: savedCreated } as AgentToolResultLike;
  const text = renderSaveMemoryResult(
    result,
    { expanded: false, isError: false },
    theme,
    saveArgs,
  );
  // success-colored checkmark + action
  ok(text.includes("[success]✓ created"), `checkmark + action:\n${text}`);
  // id muted, title text
  ok(text.includes("[muted]nmem-abc-123"), `id muted:\n${text}`);
  ok(text.includes("TUI 渲染决策"), `title:\n${text}`);
  // no warnings marker on clean create
  ok(!text.includes("warning"), `no warning on clean create:\n${text}`);
});

test("save_memory updated collapsed: appends (N warnings) in warning color", () => {
  const result = { details: savedUpdatedWithWarnings } as AgentToolResultLike;
  const text = renderSaveMemoryResult(
    result,
    { expanded: false, isError: false },
    theme,
    saveArgs,
  );
  ok(text.includes("[success]✓ updated"), `updated action:\n${text}`);
  ok(text.includes("[warning](1 warning)"), `warning count:\n${text}`);
});

test("save_memory expanded: field list (id/title/type/importance/updated/warning)", () => {
  const result = { details: savedUpdatedWithWarnings } as AgentToolResultLike;
  const text = renderSaveMemoryResult(
    result,
    { expanded: true, isError: false },
    theme,
    {
      ...saveArgs,
      unit_type: "decision",
      importance: 9,
    },
  );
  ok(text.includes("[dim]id"), `id label:\n${text}`);
  ok(text.includes("[dim]title"), `title label:\n${text}`);
  ok(text.includes("[dim]type"), `type label:\n${text}`);
  ok(text.includes("[dim]importance"), `importance label:\n${text}`);
  ok(text.includes("[dim]updated"), `updated label:\n${text}`);
  ok(text.includes("[dim]warning"), `warning label:\n${text}`);
  // value-type coloring
  ok(text.includes("[muted]nmem-abc-123"), `id value muted:\n${text}`);
  ok(text.includes("[accent]decision"), `type value accent:\n${text}`);
  ok(text.includes("[toolOutput]9/10"), `importance value 9/10:\n${text}`);
  // warning text shown as-is (not translated)
  ok(
    text.includes("labels 未变更，nmem 后端限制"),
    `warning text verbatim:\n${text}`,
  );
});

// ============================================================================
// error state (pi contract: throw -> isError; details undefined, text is
// the synthesized NmemError message. Render whole text under `error`.)
// ============================================================================

const errorResult = {
  content: [
    {
      type: "text",
      text: "[backend_unreachable] Connection refused. Check that the nmem backend is running and apiUrl is correct.",
    },
  ],
  // details is undefined on the error path (pi synthesizes the result)
} as AgentToolResultLike;

test("error state: search renders tool · error header + whole message in error color", () => {
  const text = renderSearchResult(
    errorResult,
    { expanded: false, isError: true },
    theme,
  );
  ok(text.includes("nmem_search"), `tool name:\n${text}`);
  ok(text.includes("· error"), `error state marker:\n${text}`);
  // whole synthesized message rendered under error color, no splitting
  ok(
    text.includes("[error][backend_unreachable] Connection refused"),
    `whole message under error:\n${text}`,
  );
  ok(text.includes("apiUrl is correct"), `hint not dropped:\n${text}`);
});

test("error state: read_thread and save_memory share the same error rendering", () => {
  const rt = renderReadThreadResult(
    errorResult,
    { expanded: true, isError: true },
    theme,
  );
  const sv = renderSaveMemoryResult(
    errorResult,
    { expanded: false, isError: true },
    theme,
  );
  ok(
    rt.includes("nmem_read_thread") && rt.includes("· error"),
    `read_thread error header:\n${rt}`,
  );
  ok(
    sv.includes("nmem_save_memory") && sv.includes("· error"),
    `save_memory error header:\n${sv}`,
  );
  // both carry the whole message under error color
  ok(
    rt.includes("[error][backend_unreachable]"),
    `read_thread error text:\n${rt}`,
  );
  ok(
    sv.includes("[error][backend_unreachable]"),
    `save_memory error text:\n${sv}`,
  );
});

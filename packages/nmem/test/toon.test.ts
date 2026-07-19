/**
 * Tests for the TOON text projection (toon.ts).
 *
 * Seam: `toToonText(result)` — a pure function that encodes a typed result into
 * the token-efficient TOON text shown to the LLM. No backend, no TUI. This is
 * the LLM-facing side of spec #88 (TOON 输出化); the TUI-facing renderResult
 * seam is covered by render.test.ts.
 *
 * Anti-regression focus: the old wrapper hand-spliced `note`/`warnings` as a
 * prefix AND left them inside the serialized body, duplicating them in the
 * text. TOON encoding includes those fields exactly once, so these tests pin
 * "exactly once" as the contract.
 *
 * Run: npx tsx --test packages/nmem/test/toon.test.ts
 */

import { ok, strictEqual } from "node:assert";
import { test } from "node:test";
import type {
  MemoriesSearchResult,
  ReadThreadResult,
  SavedMemoryResult,
  ThreadListResult,
  ThreadsSearchResult,
} from "../client.ts";
import { toToonText } from "../toon.ts";

// ============================================================================
// Fixtures (independent of the code under test — hand-written, not derived)
// ============================================================================

const memoriesResult: MemoriesSearchResult = {
  returned: 2,
  memories: [
    {
      id: "abc123",
      title: "Wayfinder 规划方法论",
      content: "计划，不执行",
      score: 0.9125,
      importance: 0.9,
      unit_type: "fact",
      created_at: "2026-07-13T11:02:56+00:00",
    },
    {
      id: "def456",
      title: "OneReason issue tracker 全切",
      content: "全切到 GitLab Issues",
      score: 0.8245,
      importance: 0.8,
      unit_type: "decision",
      created_at: "2026-07-08T01:48:58+00:00",
    },
  ],
  note: "0 results for 'x'",
};

const threadsResult: ThreadsSearchResult = {
  total: 1,
  threads: [
    {
      id: "pi-thread-001",
      title: "nmem TOON 优化方案讨论",
      message_count: 34,
      matches: 5,
    },
  ],
  note: "0 results for 'y'",
};

const readThreadResult: ReadThreadResult = {
  title: "nmem TOON 优化方案讨论",
  total_messages: 34,
  offset: 0,
  returned: 1,
  messages: [
    {
      index: 0,
      role: "user",
      content: "看看 token 消耗",
      timestamp: "2026-07-15T10:00:00Z",
    },
  ],
  hint: "33 more · offset 1",
  note: "分页提示",
};

const listResult: ThreadListResult = {
  returned: 2,
  threads: [
    {
      id: "pi-list-001",
      title: "线程一",
      summary: "摘要一",
      date: "Jul 18, 2026",
      source: "pi",
      message_count: 10,
    },
    {
      id: "pi-list-002",
      title: "线程二",
      summary: "",
      date: "Jul 17, 2026",
      source: "omp",
      message_count: 5,
    },
  ],
  total: 100,
  has_more: true,
  hint: "98 more · offset 2",
};

const savedCreated: SavedMemoryResult = {
  action: "created",
  id: "nmem-abc-123",
};

const savedUpdatedWithWarnings: SavedMemoryResult = {
  action: "updated",
  id: "nmem-abc-123",
  updated_fields: ["title", "content"],
  warnings: ["labels 未变更，nmem 后端限制"],
};

// ============================================================================
// Helpers
// ============================================================================

/** Count non-overlapping occurrences of `needle` in `haystack`. */
function count(haystack: string, needle: string): number {
  if (needle === "") return 0;
  let n = 0;
  let from = 0;
  for (;;) {
    const i = haystack.indexOf(needle, from);
    if (i === -1) break;
    n++;
    from = i + needle.length;
  }
  return n;
}

// ============================================================================
// TOON text: not pretty JSON, fields present, arrays compact
// ============================================================================

test("toToonText: memories result is TOON, not pretty JSON", () => {
  const text = toToonText(memoriesResult);
  // TOON header line lists the array shape, not a JSON array literal
  ok(text.includes("memories["), `expected TOON array header, got:\n${text}`);
  // No JSON pretty-print artifacts
  ok(!text.includes('  "'), `should not be pretty JSON:\n${text}`);
});

test("toToonText: memories scalar fields present in text", () => {
  const text = toToonText(memoriesResult);
  ok(text.includes("returned: 2"), `missing returned:\n${text}`);
  ok(text.includes("abc123"), `missing id:\n${text}`);
  ok(text.includes("Wayfinder 规划方法论"), `missing title:\n${text}`);
  ok(text.includes("0.9125"), `missing score:\n${text}`);
});

test("toToonText: threads result is TOON with array header", () => {
  const text = toToonText(threadsResult);
  ok(text.includes("threads["), `expected threads array header:\n${text}`);
  ok(text.includes("total: 1"), `missing total:\n${text}`);
  ok(text.includes("pi-thread-001"), `missing thread id:\n${text}`);
  ok(text.includes("34"), `missing message_count value:\n${text}`);
});

// ============================================================================
// note / warnings appear EXACTLY ONCE (the bug fix)
// ============================================================================

test("toToonText: note appears exactly once for memories", () => {
  // The old wrapper spliced note as a prefix AND serialized it in the body.
  const note = memoriesResult.note as string;
  strictEqual(count(toToonText(memoriesResult), note), 1);
});

test("toToonText: note appears exactly once for threads", () => {
  const note = threadsResult.note as string;
  strictEqual(count(toToonText(threadsResult), note), 1);
});

test("toToonText: note appears exactly once for read_thread", () => {
  const note = readThreadResult.note as string;
  strictEqual(count(toToonText(readThreadResult), note), 1);
});

test("toToonText: warnings appear exactly once for save_memory", () => {
  const warning = savedUpdatedWithWarnings.warnings?.[0] as string;
  strictEqual(count(toToonText(savedUpdatedWithWarnings), warning), 1);
});

test("toToonText: save_memory created has action + id, no warnings key", () => {
  const text = toToonText(savedCreated);
  ok(text.includes("action: created"), `missing action:\n${text}`);
  ok(text.includes("id: nmem-abc-123"), `missing id:\n${text}`);
  ok(
    !text.includes("warnings"),
    `created result must not emit warnings:\n${text}`,
  );
});

test("toToonText: read_thread message body present and TOON-shaped", () => {
  const text = toToonText(readThreadResult);
  ok(text.includes("messages["), `expected messages array header:\n${text}`);
  ok(text.includes("看看 token 消耗"), `missing message content:\n${text}`);
  ok(text.includes("total_messages: 34"), `missing total_messages:\n${text}`);
});

test("toToonText: list_threads result is TOON with threads array + flat pagination", () => {
  const text = toToonText(listResult);
  ok(text.includes("threads["), `expected threads array header:\n${text}`);
  ok(text.includes("total: 100"), `missing total:\n${text}`);
  ok(text.includes("has_more: true"), `missing has_more:\n${text}`);
  ok(text.includes("pi-list-001"), `missing thread id:\n${text}`);
  ok(text.includes("message_count"), `missing message_count column:\n${text}`);
  ok(text.includes("pi,10"), `missing message_count value:\n${text}`);
});

test("toToonText: hint appears exactly once for list_threads", () => {
  const hint = listResult.hint as string;
  strictEqual(count(toToonText(listResult), hint), 1);
});

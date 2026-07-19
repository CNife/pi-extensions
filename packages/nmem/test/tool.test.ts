/**
 * Integration: deep-module result -> TOON text (spec #88).
 *
 * Why this seam and not `execute`: the extension entry (extensions/nmem.ts)
 * imports `@earendil-works/pi-ai`, whose package `exports` map is gated, so it
 * cannot be imported by plain `tsx --test` (same constraint that keeps
 * client.test.ts / kernel.test.ts testing the deep module, not the entry). The
 * new logic in #88 lives in toon.ts (pure) anyway, so this test wires the real
 * deep-module outputs through toToonText to catch shaping -> TOON mismatches a
 * hand-written fixture never could. Backend-required tests skip on
 * unreachable, matching client.test.ts.
 *
 * Run: npx tsx --test packages/nmem/test/tool.test.ts
 */

import { ok } from "node:assert";
import { before, test } from "node:test";
import {
  nmemListThreads,
  nmemReadThread,
  nmemRequest,
  nmemSaveMemory,
  nmemSearch,
} from "../client.ts";
import { toToonText } from "../toon.ts";

let backendReachable = false;

before(async () => {
  try {
    await nmemRequest("GET", "/health", { retry: false });
    backendReachable = true;
  } catch {
    backendReachable = false;
  }
});

function backendTest(name: string, fn: () => Promise<void>): void {
  test(name, async (t) => {
    if (!backendReachable) {
      t.skip();
      return;
    }
    await fn();
  });
}

backendTest(
  "search memories -> toToonText is TOON, note not duplicated",
  async () => {
    const result = await nmemSearch("深度模块", "memories", 3);
    const text = toToonText(result);
    ok(text.includes("memories["), `TOON array header:\n${text}`);
    // Empty-state adds a note; non-empty has no note. Either way the note (if
    // present) appears at most once.
    if (result.note) {
      const occurrences = text.split(result.note).length - 1;
      ok(occurrences === 1, `note should appear once, got ${occurrences}`);
    }
  },
);

backendTest("search threads -> toToonText is TOON", async () => {
  const result = await nmemSearch("nmem", "threads", 3);
  const text = toToonText(result);
  ok(text.includes("threads["), `TOON array header:\n${text}`);
  ok(text.includes("total:"), `total field:\n${text}`);
});

backendTest(
  "read_thread -> toToonText is TOON with messages array",
  async () => {
    const search = await nmemSearch("a", "threads", 1);
    if (search.threads.length === 0) return;
    const result = await nmemReadThread(search.threads[0].id);
    const text = toToonText(result);
    ok(text.includes("messages["), `messages array header:\n${text}`);
    ok(text.includes("total_messages:"), `total_messages field:\n${text}`);
  },
);

backendTest(
  "list_threads -> toToonText is TOON with threads array",
  async () => {
    const result = await nmemListThreads({ limit: 3 });
    if (result.threads.length === 0) return;
    const text = toToonText(result);
    ok(text.includes("threads["), `threads array header:\n${text}`);
    ok(text.includes("total:"), `total field:\n${text}`);
    ok(text.includes("has_more:"), `has_more field:\n${text}`);
  },
);

backendTest(
  "save_memory create then update -> toToonText, warnings once",
  async () => {
    const created = await nmemSaveMemory("TOON integration probe", "probe", {
      unit_type: "fact",
    });
    ok(created.id);
    try {
      const updated = await nmemSaveMemory(
        "TOON integration probe",
        "updated",
        {
          id: created.id,
          labels: ["x"],
        },
      );
      const text = toToonText(updated);
      ok(text.includes("action: updated"), `action field:\n${text}`);
      ok(text.includes("id:"), `id field:\n${text}`);
      // labels-on-update yields a warning; it must appear exactly once.
      if (updated.warnings?.[0]) {
        const w = updated.warnings[0];
        ok(
          text.split(w).length - 1 === 1,
          `warning should appear once:\n${text}`,
        );
      }
    } finally {
      await nmemRequest(
        "DELETE",
        `/memories/${encodeURIComponent(created.id)}`,
      );
    }
  },
);

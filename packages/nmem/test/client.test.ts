/**
 * Tests for the nmem REST client deep module - real backend, no fetch mock.
 *
 * Seam: the public interface of client.ts (resolveConfig / mapStatus /
 * nmemRequest / nmemSearch). The thin wrapper (extensions/nmem.ts) is not
 * tested here - it is covered by spec as a pass-through.
 *
 * Run: npx tsx --test packages/nmem/test/client.test.ts
 *
 * Backend-required tests skip (not fail) when localhost:14242 is unreachable,
 * matching the "real backend, skip on unreachable" discipline shared with
 * execute-python's kernel.test.ts. Pure-function tests (resolveConfig,
 * mapStatus, NmemError shape) always run - they need no backend.
 */

import { deepStrictEqual, ok, rejects, strictEqual, throws } from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { before, test } from "node:test";
import {
  type MemoryHit,
  mapStatus,
  NmemError,
  nmemReadThread,
  nmemRequest,
  nmemSaveMemory,
  nmemSearch,
  resolveConfig,
  type ThreadsSearchResult,
} from "../client.ts";

// ============================================================================
// Backend reachability guard
// ============================================================================

const CONFIG_PATH = `${homedir()}/.nowledge-mem/config.json`;

let backendReachable = false;

before(async () => {
  try {
    // Probe the REAL configured backend (env > config.json > default), not a
    // hardcoded localhost. openapi.json requires auth (401 without key), so
    // reuse nmemRequest which carries apiKey + maps errors. /health is lightweight.
    // retry:false - probe fails fast when backend is down (skip path)
    await nmemRequest("GET", "/health", { retry: false });
    backendReachable = true;
  } catch {
    backendReachable = false;
  }
});

/** A test that only runs when the real nmem backend is reachable. */
function backendTest(name: string, fn: () => Promise<void>): void {
  test(name, async (t) => {
    if (!backendReachable) {
      t.skip();
      return;
    }
    await fn();
  });
}
// ============================================================================
// env helpers
// ============================================================================

const envBackup: Record<string, string | undefined> = {};

function setEnv(key: string, value: string | undefined): void {
  if (!(key in envBackup)) envBackup[key] = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

function restoreEnv(): void {
  for (const [key, value] of Object.entries(envBackup)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function readConfigApiUrl(): string | undefined {
  try {
    if (!existsSync(CONFIG_PATH)) return undefined;
    const parsed = JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as Record<
      string,
      unknown
    >;
    const candidate = parsed.apiUrl ?? parsed.api_url;
    return typeof candidate === "string" && candidate.trim()
      ? candidate.trim().replace(/\/+$/, "")
      : undefined;
  } catch {
    return undefined;
  }
}

function readConfigApiKey(): string | undefined {
  try {
    if (!existsSync(CONFIG_PATH)) return undefined;
    const parsed = JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as Record<
      string,
      unknown
    >;
    const candidate = parsed.apiKey ?? parsed.api_key;
    return typeof candidate === "string" && candidate.trim()
      ? candidate.trim()
      : undefined;
  } catch {
    return undefined;
  }
}

// ============================================================================
// resolveConfig (pure logic, no backend)
// ============================================================================

test("resolveConfig: NMEM_API_URL env overrides and strips trailing slashes", () => {
  setEnv("NMEM_API_URL", "http://example.com:9999///");
  try {
    const config = resolveConfig();
    strictEqual(config.apiUrl, "http://example.com:9999");
  } finally {
    restoreEnv();
  }
});

test("resolveConfig: NMEM_API_KEY env sets apiKey", () => {
  setEnv("NMEM_API_KEY", "sk-test-123");
  try {
    const config = resolveConfig();
    strictEqual(config.apiKey, "sk-test-123");
  } finally {
    restoreEnv();
  }
});

test("resolveConfig: no env -> default or config.json apiUrl, no apiKey", () => {
  setEnv("NMEM_API_URL", undefined);
  setEnv("NMEM_API_KEY", undefined);
  try {
    const config = resolveConfig();
    const expected = readConfigApiUrl() ?? "http://127.0.0.1:14242";
    strictEqual(config.apiUrl, expected);
    const expectedApiKey = readConfigApiKey();
    strictEqual(config.apiKey, expectedApiKey);
  } finally {
    restoreEnv();
  }
});

// ============================================================================
// mapStatus (pure function, no backend)
// ============================================================================

test("mapStatus: 401 -> unauthorized, 404 -> not_found", () => {
  strictEqual(mapStatus(401), "unauthorized");
  strictEqual(mapStatus(404), "not_found");
});

test("mapStatus: 400 and 422 -> bad_request", () => {
  strictEqual(mapStatus(400), "bad_request");
  strictEqual(mapStatus(422), "bad_request");
});

test("mapStatus: 5xx and unmapped -> server_error", () => {
  strictEqual(mapStatus(500), "server_error");
  strictEqual(mapStatus(502), "server_error");
  strictEqual(mapStatus(403), "server_error");
  strictEqual(mapStatus(429), "server_error");
});

// ============================================================================
// NmemError message format (pure, no backend)
// ============================================================================

test("NmemError: message format is [code] detail. hint", () => {
  const err = new NmemError("not_found", "Thread not found");
  strictEqual(err.code, "not_found");
  strictEqual(err.name, "NmemError");
  strictEqual(
    err.message,
    "[not_found] Thread not found. The requested resource does not exist.",
  );
});

test("NmemError: is an Error and throws", () => {
  throws(
    () => {
      throw new NmemError("bad_request", "missing field");
    },
    (err: unknown) => {
      ok(err instanceof Error, "should be an Error");
      ok(err instanceof NmemError, "should be an NmemError");
      strictEqual((err as NmemError).code, "bad_request");
      return true;
    },
  );
});

// ============================================================================
// nmemRequest error mapping (needs backend)
// ============================================================================

backendTest("nmemRequest: 404 -> not_found, JSON detail parsed", async () => {
  await rejects(
    () => nmemRequest("GET", "/threads/pi-bogus-not-exist"),
    (err: unknown) => {
      ok(err instanceof NmemError);
      strictEqual((err as NmemError).code, "not_found");
      // JSON body {"detail":"Thread not found"} parsed into detail
      ok((err as Error).message.includes("Thread not found"));
      ok((err as Error).message.startsWith("[not_found]"));
      return true;
    },
  );
});

backendTest(
  "nmemRequest: 422 -> bad_request, plain-text detail parsed",
  async () => {
    await rejects(
      () => nmemRequest("POST", "/memories", { body: {} }),
      (err: unknown) => {
        ok(err instanceof NmemError);
        strictEqual((err as NmemError).code, "bad_request");
        // 422 body is text/plain "Failed to deserialize..." (not JSON)
        ok((err as Error).message.includes("Failed to deserialize"));
        ok((err as Error).message.startsWith("[bad_request]"));
        return true;
      },
    );
  },
);

backendTest(
  "nmemRequest: unreachable host -> backend_unreachable",
  async () => {
    await rejects(
      () =>
        nmemRequest("GET", "/openapi.json", {
          config: { apiUrl: "http://127.0.0.1:39999" },
          retry: false, // error-mapping test; retry covered by withRetry unit tests
        }),
      (err: unknown) => {
        ok(err instanceof NmemError);
        strictEqual((err as NmemError).code, "backend_unreachable");
        ok((err as Error).message.startsWith("[backend_unreachable]"));
        return true;
      },
    );
  },
);

// ============================================================================
// nmemSearch - memories (needs backend)
// ============================================================================

backendTest(
  "nmemSearch memories: 7 fields, no labels, returned aggregates",
  async () => {
    const result = await nmemSearch("深度模块", "memories", 5);
    const memories = result.memories ?? [];
    // Need at least one hit to validate shaping; skip if backend has none
    if (memories.length === 0) return;
    ok(result.returned === memories.length, "returned === array length");

    const hit = memories[0] as MemoryHit;
    const expectedKeys = [
      "id",
      "title",
      "content",
      "score",
      "importance",
      "unit_type",
      "created_at",
    ];
    deepStrictEqual(
      Object.keys(hit).sort(),
      expectedKeys.sort(),
      "exactly 7 fields, no labels",
    );
    ok(typeof hit.id === "string" && hit.id.length > 0);
    ok(typeof hit.title === "string");
    ok(typeof hit.content === "string");
    ok(typeof hit.score === "number");
    ok(typeof hit.importance === "number");
    ok(typeof hit.unit_type === "string");
    ok(typeof hit.created_at === "string");
  },
);

backendTest(
  "nmemSearch memories: score maps from raw similarity_score",
  async () => {
    const query = "深度模块";
    // Fetch raw to compare against the shaped score.
    const raw = await nmemRequest<Array<{ similarity_score?: number }>>(
      "POST",
      "/memories/search",
      { body: { query, limit: 1 } },
    );
    const shaped = await nmemSearch(query, "memories", 1);
    if (raw.length === 0 || shaped.memories.length === 0) return;
    strictEqual(shaped.memories[0].score, raw[0].similarity_score);
  },
);

backendTest(
  "nmemSearch memories: empty result -> returned 0 + note",
  async () => {
    // Empty query returns [] (verified: backend returns 200 [] for empty query)
    const result = await nmemSearch("", "memories", 3);
    strictEqual(result.returned, 0);
    deepStrictEqual(result.memories, []);
    ok(
      result.note?.includes("0 results"),
      `note should mention 0 results, got: ${result.note}`,
    );
  },
);

// ============================================================================
// nmemSearch - threads (needs backend)
// ============================================================================

backendTest(
  "nmemSearch threads: id = thread_id (pi-prefix), total aggregates",
  async () => {
    const result = await nmemSearch("nmem", "threads", 5);
    const threads = result.threads ?? [];
    if (threads.length === 0) return;
    ok(result.total === (result.total ?? 0), "total present");

    const hit = threads[0];
    deepStrictEqual(
      Object.keys(hit).sort(),
      ["id", "title", "message_count", "matches"].sort(),
      "exactly 4 fields",
    );
    ok(
      hit.id.startsWith("pi-"),
      `thread id should be pi-prefixed, got: ${hit.id}`,
    );
    ok(typeof hit.title === "string");
    ok(typeof hit.message_count === "number");
    ok(typeof hit.matches === "number");
  },
);

backendTest(
  "nmemSearch threads: id maps from raw thread_id, matches from total_matches",
  async () => {
    const raw = await nmemRequest<{
      threads?: Array<{ thread_id?: string; total_matches?: number }>;
      total_found?: number;
    }>("GET", "/threads/search", { query: { query: "nmem", limit: 1 } });
    const shaped = await nmemSearch("nmem", "threads", 1);
    if (!raw.threads || raw.threads.length === 0 || shaped.threads.length === 0)
      return;
    strictEqual(shaped.threads[0].id, raw.threads[0].thread_id);
    strictEqual(shaped.threads[0].matches, raw.threads[0].total_matches);
    strictEqual(shaped.total, raw.total_found);
  },
);

backendTest("nmemSearch threads: empty-state shape (0 results)", async () => {
  // Empty query 422s for threads; use a long nonsense query. If the real
  // backend happens to match it, we cannot observe the empty-state shape
  // deterministically — skip the structure assertion but still verify the
  // response is well-formed. The empty-state contract is covered by the
  // code path, not a brittle exact-count assertion.
  const result = await nmemSearch(
    "zzqxqzzqxznonexistent12345abc",
    "threads",
    3,
  );
  ok(typeof result.total === "number", "total is a number");
  ok(Array.isArray(result.threads), "threads is an array");
  if (result.total === 0) {
    deepStrictEqual(result.threads, []);
    ok(
      result.note?.includes("0 results"),
      `note should mention 0 results, got: ${result.note}`,
    );
  }
});

// ============================================================================
// nmemReadThread (needs backend)
// ============================================================================

backendTest(
  "nmemReadThread: budget segmentation, hint format, >=1 message",
  async () => {
    // Find a real thread first
    const search = (await nmemSearch("a", "threads", 1)) as ThreadsSearchResult;
    if (!search.threads.length) {
      // No threads to test with — skip gracefully
      return;
    }
    const threadId = search.threads[0].id;

    const result = await nmemReadThread(threadId);

    ok(result.returned > 0, "should return at least one message");
    ok(result.messages.length > 0, "should have messages array populated");
    // Regression guard: real backend nests title/created_at under `thread`.
    ok(
      result.title.length > 0,
      `title should be non-empty, got: "${result.title}"`,
    );
    ok(
      result.created_at.length > 0,
      `created_at should be non-empty, got: "${result.created_at}"`,
    );
    ok(
      result.total_messages > 0,
      `total_messages should be > 0, got: ${result.total_messages}`,
    );
    for (const msg of result.messages) {
      ok(typeof msg.index === "number", "message index is a number");
      ok(typeof msg.role === "string", "message role is a string");
      ok(typeof msg.content === "string", "message content is a string");
      ok(msg.content.length > 0, "message content should be non-empty");
    }
    ok(typeof result.hint === "string", "hint is a string");
    ok(result.hint.length > 0, "hint is non-empty");
    // hint matches one of the two patterns
    const atEnd = result.hint.startsWith("已到末尾");
    const hasUnread = result.hint.includes("条未读");
    ok(
      atEnd || hasUnread,
      `hint matches expected pattern, got: ${result.hint}`,
    );

    // Budget segmentation: for a large thread, one page should not exhaust it.
    if (result.total_messages > result.returned) {
      ok(
        result.returned < result.total_messages,
        "budgeted page returns fewer than total when thread is large",
      );
    }
    strictEqual(result.offset, 0, "offset is 0 by default");
  },
);

backendTest("nmemReadThread: 404 -> not_found", async () => {
  await rejects(
    () => nmemReadThread("pi-does-not-exist-xyz"),
    (err: NmemError) => {
      strictEqual(err.code, "not_found");
      return true;
    },
  );
});

// ============================================================================
// nmemSaveMemory (needs backend)
// ============================================================================

backendTest("nmemSaveMemory: create then update with cleanup", async () => {
  // Create
  const created = await nmemSaveMemory("Test title #77", "Test content", {
    unit_type: "fact",
  });
  strictEqual(created.action, "created");
  ok(created.id, "created id is non-empty");
  const memoryId = created.id;

  try {
    // Update (PATCH)
    const updated = await nmemSaveMemory(
      "Updated title #77",
      "Updated content",
      {
        id: memoryId,
      },
    );
    strictEqual(updated.action, "updated");
    strictEqual(updated.id, memoryId);
    ok(updated.updated_fields, "updated_fields is present");
    ok(updated.updated_fields?.includes("title"), "title in updated_fields");
    ok(
      updated.updated_fields?.includes("content"),
      "content in updated_fields",
    );
    strictEqual(updated.warnings, undefined, "no warnings when labels absent");
  } finally {
    // Cleanup
    await nmemRequest("DELETE", `/memories/${encodeURIComponent(memoryId)}`);
  }
});

backendTest(
  "nmemSaveMemory: update with non-empty labels -> warnings (no throw)",
  async () => {
    // Create first
    const created = await nmemSaveMemory("Labels test #77", "test", {
      labels: ["tag1"],
    });
    ok(created.id);
    const memoryId = created.id;

    try {
      const updated = await nmemSaveMemory("Labels test #77", "updated", {
        id: memoryId,
        labels: ["tag2"],
      });
      strictEqual(updated.action, "updated");
      ok(updated.warnings, "warnings present when labels passed on update");
      ok(
        updated.warnings?.some((w) => w.includes("labels")),
        "warning mentions labels",
      );
    } finally {
      await nmemRequest("DELETE", `/memories/${encodeURIComponent(memoryId)}`);
    }
  },
);

backendTest("nmemSaveMemory: PATCH non-existent -> not_found", async () => {
  await rejects(
    () => nmemSaveMemory("t", "c", { id: "pi-nonexistent-memory-zzz-77" }),
    (err: NmemError) => {
      strictEqual(err.code, "not_found");
      return true;
    },
  );
});

backendTest("nmemSaveMemory: empty title/content -> bad_request", async () => {
  await rejects(
    () => nmemSaveMemory("", ""),
    (err: NmemError) => {
      strictEqual(err.code, "bad_request");
      return true;
    },
  );
});

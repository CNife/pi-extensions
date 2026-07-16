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
  nmemRequest,
  nmemSearch,
  resolveConfig,
} from "../client.ts";

// ============================================================================
// Backend reachability guard
// ============================================================================

const BACKEND_URL = "http://127.0.0.1:14242";
const CONFIG_PATH = `${homedir()}/.nowledge-mem/config.json`;

let backendReachable = false;

before(async () => {
  try {
    const res = await fetch(`${BACKEND_URL}/openapi.json`, {
      signal: AbortSignal.timeout(2000),
    });
    backendReachable = res.ok;
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
    strictEqual(config.apiKey, undefined);
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

backendTest("nmemSearch threads: empty result -> total 0 + note", async () => {
  // Nonsense query that matches no thread (empty query would 422 for threads)
  const result = await nmemSearch(
    "zzqxqzzqxznonexistent12345abc",
    "threads",
    3,
  );
  strictEqual(result.total, 0);
  deepStrictEqual(result.threads, []);
  ok(
    result.note?.includes("0 results"),
    `note should mention 0 results, got: ${result.note}`,
  );
});

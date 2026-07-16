/**
 * nmem deep-module backend regression baseline - real configured backend.
 *
 * Companion to client.test.ts. That file's backendTest guard skips when the
 * configured backend is unreachable (CI without a backend). This file runs a
 * fuller end-to-end sweep (CRUD chain, offset continuation, search-hit
 * verification) as a pre-release QA baseline against the REAL backend
 * (resolveConfig().apiUrl). It still skips cleanly when the backend is down,
 * so it is safe to run anywhere - it just refuses to pass without a backend.
 *
 * Run: npx tsx --test packages/nmem/test/client.backend.test.ts
 */

import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { before, test } from "node:test";
import {
  type MemoryHit,
  NmemError,
  nmemReadThread,
  nmemRequest,
  nmemSaveMemory,
  nmemSearch,
  resolveConfig,
} from "../client.ts";

// ============================================================================
// Backend reachability guard (probes the REAL configured backend, with auth)
// ============================================================================

let backendReachable = false;

before(async () => {
  try {
    await nmemRequest("GET", "/health");
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

// env helpers
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

// ============================================================================
// resolveConfig (pure, always run)
// ============================================================================

test("resolveConfig: NMEM_API_URL env overrides and strips trailing slashes", () => {
  setEnv("NMEM_API_URL", "http://example.com:9999///");
  try {
    strictEqual(resolveConfig().apiUrl, "http://example.com:9999");
  } finally {
    restoreEnv();
  }
});

test("resolveConfig: default reads ~/.nowledge-mem/config.json (remote URL + apiKey)", () => {
  setEnv("NMEM_API_URL", undefined);
  setEnv("NMEM_API_KEY", undefined);
  try {
    const c = resolveConfig();
    ok(c.apiUrl.startsWith("http"), `apiUrl=${c.apiUrl}`);
  } finally {
    restoreEnv();
  }
});

// ============================================================================
// nmemSearch memories (real backend)
// ============================================================================

backendTest(
  "search memories: 7 fields, no labels, returned === len",
  async () => {
    const r = await nmemSearch("深度模块", "memories", 5);
    const ms = r.memories ?? [];
    if (ms.length === 0) return; // skip field check if backend has no hits
    strictEqual(r.returned, ms.length);
    deepStrictEqual(Object.keys(ms[0] as MemoryHit).sort(), [
      "content",
      "created_at",
      "id",
      "importance",
      "score",
      "title",
      "unit_type",
    ]);
  },
);

backendTest("search memories: empty query -> returned 0 + note", async () => {
  const r = await nmemSearch("", "memories", 3);
  strictEqual(r.returned, 0);
  ok(r.note?.includes("0 results"), `note=${r.note}`);
});

// ============================================================================
// nmemSearch threads (real backend)
// ============================================================================

backendTest(
  "search threads: 4 fields, total number, id pi-prefixed",
  async () => {
    const r = await nmemSearch("nmem", "threads", 5);
    const ts = r.threads ?? [];
    if (ts.length === 0) return;
    ok(typeof r.total === "number");
    deepStrictEqual(Object.keys(ts[0]).sort(), [
      "id",
      "matches",
      "message_count",
      "title",
    ]);
    ok(ts[0].id.startsWith("pi-"), `id=${ts[0].id}`);
  },
);

// ============================================================================
// nmemReadThread (real backend)
// ============================================================================

const LONG_THREAD = "pi-019f25a4-94e9-7293-863f-ff5e0aaf4642"; // 211 msgs

backendTest("read 211-msg thread: budget segmentation + hint", async () => {
  const r = await nmemReadThread(LONG_THREAD);
  ok(r.returned > 0, "returned <= 0");
  strictEqual(r.total_messages, 211);
  ok(r.title.length > 0, `title empty`);
  ok(r.created_at.length > 0, "created_at empty");
  ok(
    r.hint.includes("未读") || r.hint.startsWith("已到末尾"),
    `hint=${r.hint}`,
  );
  strictEqual(r.offset, 0);
});

backendTest("read thread: offset continuation returns next page", async () => {
  const r = await nmemReadThread(LONG_THREAD, 7);
  strictEqual(r.offset, 7);
  ok(r.returned > 0, "no messages at offset 7");
});

backendTest("read thread: 404 -> not_found", async () => {
  try {
    await nmemReadThread("pi-does-not-exist-qa-verify");
    throw new Error("should have thrown");
  } catch (e) {
    ok(e instanceof NmemError);
    strictEqual(e.code, "not_found");
  }
});

// ============================================================================
// nmemSaveMemory CRUD chain (real backend)
// ============================================================================

let createdId = "";

backendTest("save create (POST) -> action=created, id non-empty", async () => {
  const c = await nmemSaveMemory(
    "QA-baseline 测试记忆",
    "由 client.backend.test 创建，稍后清理",
    {
      unit_type: "fact",
      importance: 3,
      labels: ["qa-baseline"],
    },
  );
  strictEqual(c.action, "created");
  ok(c.id, "empty id");
  createdId = c.id;
});

backendTest("save: search hits the created memory", async () => {
  if (!createdId) return;
  const r = await nmemSearch("QA-baseline 测试记忆", "memories", 10);
  const hit = (r.memories ?? []).find((m) => m.id === createdId);
  ok(hit, "created memory not found in search");
});

backendTest(
  "save update (PATCH) -> action=updated, updated_fields",
  async () => {
    if (!createdId) return;
    const u = await nmemSaveMemory("QA-baseline 更新后", "updated content", {
      id: createdId,
    });
    strictEqual(u.action, "updated");
    strictEqual(u.id, createdId);
    ok(u.updated_fields?.includes("title"), `fields=${u.updated_fields}`);
    ok(!u.warnings, `unexpected warnings: ${u.warnings}`);
  },
);

backendTest("save update with labels -> warnings (no throw)", async () => {
  if (!createdId) return;
  const u = await nmemSaveMemory("QA-baseline", "x", {
    id: createdId,
    labels: ["nope"],
  });
  ok(
    u.warnings?.some((w) => w.includes("labels")),
    `warnings=${u.warnings}`,
  );
});

backendTest("save PATCH non-existent -> not_found", async () => {
  try {
    await nmemSaveMemory("t", "c", { id: "pi-nonexistent-qa-baseline-zzz" });
    throw new Error("should have thrown");
  } catch (e) {
    ok(e instanceof NmemError);
    strictEqual(e.code, "not_found");
  }
});

backendTest("save empty title -> bad_request (422)", async () => {
  try {
    await nmemSaveMemory("", "");
    throw new Error("should have thrown");
  } catch (e) {
    ok(e instanceof NmemError);
    strictEqual(e.code, "bad_request");
  }
});

// cleanup created memory so the test is side-effect-free
test("cleanup: delete created test memory", async (t) => {
  if (!backendReachable || !createdId) {
    t.skip();
    return;
  }
  try {
    await nmemRequest("DELETE", `/memories/${encodeURIComponent(createdId)}`);
  } catch {
    // best-effort; not worth failing the suite
  }
});

// ============================================================================
// nmemRequest error mapping (real backend)
// ============================================================================

backendTest("nmemRequest unreachable host -> backend_unreachable", async () => {
  try {
    await nmemRequest("GET", "/openapi.json", {
      config: { apiUrl: "http://127.0.0.1:39999" },
    });
    throw new Error("should have thrown");
  } catch (e) {
    ok(e instanceof NmemError);
    strictEqual(e.code, "backend_unreachable");
  }
});

backendTest(
  "nmemRequest 404 -> not_found, detail parsed from JSON",
  async () => {
    try {
      await nmemRequest("GET", "/threads/pi-bogus-qa-baseline");
      throw new Error("should have thrown");
    } catch (e) {
      ok(e instanceof NmemError);
      strictEqual(e.code, "not_found");
      ok(e.message.includes("Thread not found"), `msg=${e.message}`);
    }
  },
);

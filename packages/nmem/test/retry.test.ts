/**
 * Tests for the retry pure functions - isRetryable / backoffMs / withRetry.
 *
 * Seam: the retry decision layer of client.ts, exercised in isolation. No
 * backend, no fetch mock - withRetry takes an injected fn that throws
 * NmemError, plus injected sleep (no-op / recording) and rand (constant) for
 * determinism. This covers retry-loop correctness; real-backend regression
 * (retry integrated, normal requests still work) lives in client.test.ts /
 * client.backend.test.ts.
 *
 * Run: npx tsx --test packages/nmem/test/retry.test.ts
 */

import { deepStrictEqual, ok, rejects, strictEqual } from "node:assert";
import { test } from "node:test";
import { backoffMs, isRetryable, NmemError, withRetry } from "../client.ts";

// ============================================================================
// isRetryable (pure)
// ============================================================================

test("isRetryable: transient codes (timeout / backend_unreachable / server_error) retry", () => {
  strictEqual(isRetryable("timeout"), true);
  strictEqual(isRetryable("backend_unreachable"), true);
  strictEqual(isRetryable("server_error"), true);
});

test("isRetryable: client errors (401 / 404 / 400-422) fail fast", () => {
  strictEqual(isRetryable("unauthorized"), false);
  strictEqual(isRetryable("not_found"), false);
  strictEqual(isRetryable("bad_request"), false);
});

// ============================================================================
// backoffMs (pure, deterministic given rand)
// ============================================================================

test("backoffMs: increases with attempt at max jitter (rand=1 -> ceiling)", () => {
  strictEqual(
    backoffMs(0, 500, 4_000, () => 1),
    500,
  );
  strictEqual(
    backoffMs(1, 500, 4_000, () => 1),
    1_000,
  );
  strictEqual(
    backoffMs(2, 500, 4_000, () => 1),
    2_000,
  );
  strictEqual(
    backoffMs(3, 500, 4_000, () => 1),
    4_000,
  );
});

test("backoffMs: capped at capMs for high attempts", () => {
  strictEqual(
    backoffMs(10, 500, 4_000, () => 1),
    4_000,
  );
  strictEqual(
    backoffMs(20, 500, 4_000, () => 1),
    4_000,
  );
});

test("backoffMs: full jitter stays within [0, ceiling] for any rand", () => {
  for (let attempt = 0; attempt < 6; attempt++) {
    const ceiling = Math.min(500 * 2 ** attempt, 4_000);
    for (const r of [0, 0.25, 0.5, 0.75, 1]) {
      const delay = backoffMs(attempt, 500, 4_000, () => r);
      ok(delay >= 0, `delay ${delay} < 0 at attempt ${attempt}, r=${r}`);
      ok(
        delay <= ceiling,
        `delay ${delay} > ceiling ${ceiling} at attempt ${attempt}, r=${r}`,
      );
    }
  }
});

test("backoffMs: rand=0 yields 0 (bottom of jitter range)", () => {
  for (let attempt = 0; attempt < 6; attempt++) {
    strictEqual(
      backoffMs(attempt, 500, 4_000, () => 0),
      0,
    );
  }
});

// ============================================================================
// withRetry (pure given injected fn / sleep / rand)
// ============================================================================

const noSleep = async (): Promise<void> => {};

test("withRetry: non-retryable error throws immediately (fn called once)", async () => {
  let calls = 0;
  const fn = async (): Promise<string> => {
    calls++;
    throw new NmemError("bad_request", "nope");
  };
  await rejects(withRetry(fn, { sleep: noSleep }), (err: unknown) => {
    ok(err instanceof NmemError);
    strictEqual((err as NmemError).code, "bad_request");
    return true;
  });
  strictEqual(calls, 1, "non-retryable error must not retry");
});

test("withRetry: transient error retried until success", async () => {
  let calls = 0;
  const fn = async (): Promise<string> => {
    calls++;
    if (calls < 3) throw new NmemError("server_error", "down");
    return "ok";
  };
  const result = await withRetry(fn, { sleep: noSleep });
  strictEqual(result, "ok");
  strictEqual(calls, 3, "two retries then success = 3 calls");
});

test("withRetry: retries exhausted -> throws last error", async () => {
  let calls = 0;
  const fn = async (): Promise<string> => {
    calls++;
    throw new NmemError("backend_unreachable", "down");
  };
  await rejects(withRetry(fn, { sleep: noSleep }), (err: unknown) => {
    ok(err instanceof NmemError);
    strictEqual((err as NmemError).code, "backend_unreachable");
    return true;
  });
  strictEqual(calls, 3, "1 attempt + 2 retries = 3 calls");
});

test("withRetry: backoff increases with attempts (delays [500, 1000])", async () => {
  const delays: number[] = [];
  const sleep = async (ms: number): Promise<void> => {
    delays.push(ms);
  };
  const fn = async (): Promise<string> => {
    throw new NmemError("server_error", "down");
  };
  await rejects(withRetry(fn, { sleep, rand: () => 1 }));
  // 3 attempts -> 2 sleeps; rand=1 -> backoffMs(0)=500, backoffMs(1)=1000
  deepStrictEqual(delays, [500, 1_000]);
});

test("withRetry: success on first try - no sleep", async () => {
  let slept = false;
  const fn = async (): Promise<string> => "ok";
  const result = await withRetry(fn, {
    sleep: async () => {
      slept = true;
    },
  });
  strictEqual(result, "ok");
  strictEqual(slept, false, "no backoff when first attempt succeeds");
});

test("withRetry: respects custom retries count (0 = single attempt)", async () => {
  let calls = 0;
  const fn = async (): Promise<string> => {
    calls++;
    throw new NmemError("server_error", "down");
  };
  await rejects(withRetry(fn, { retries: 0, sleep: noSleep }));
  strictEqual(calls, 1, "0 retries = 1 attempt, no retry");
});

test("withRetry: non-NmemError thrown is rethrown without retry", async () => {
  let calls = 0;
  const fn = async (): Promise<string> => {
    calls++;
    throw new Error("boom");
  };
  await rejects(withRetry(fn, { sleep: noSleep }), (err: unknown) => {
    ok(err instanceof Error);
    ok(!(err instanceof NmemError));
    strictEqual((err as Error).message, "boom");
    return true;
  });
  strictEqual(calls, 1, "non-NmemError must not retry");
});

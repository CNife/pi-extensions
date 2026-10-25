/**
 * nmem-lite REST 传输测试（移植自 OMP plugins/nmem/test/rest.test.ts）。
 *
 * 经注入的 fake fetch 断言 nmemRequest 的外部可观察行为：重试、错误映射、
 * backoff、超时、错误详情提取；计时通过临时替换全局 setTimeout 实现，
 * 测试后恢复。生产代码不含 sleep/now seam，也不 mock 内部协作对象。
 *
 * 机制说明（与 OMP 的差异）：
 * - OMP 测试用 node:test；仓库根 `npm test` 跑 vitest，故改用 vitest 的 test API。
 * - 断言仍用 node:assert。
 *
 * 运行：仓库根 `npm test`。
 */

import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { test } from "vitest";

import { nmemRequest } from "../extensions/rest.ts";

// ============================================================================
// Fixtures
// ============================================================================

const FAKE_API_URL = "http://nmem.test:9999";

interface FetchCall {
  url: string;
  init: RequestInit;
}

type GlobalFetch = typeof globalThis.fetch;

/** 依次返回给定结果的 fake fetch（每次调用消耗一个；耗尽后重复最后一个）。 */
function scriptedFetch(outcomes: Array<() => Response>) {
  const calls: FetchCall[] = [];
  const fetch = async (url: string | URL, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    return outcomes[Math.min(calls.length - 1, outcomes.length - 1)]();
  };
  return { fetch: fetch as unknown as GlobalFetch, calls };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** 一直返回同一状态码 JSON 响应的 fake fetch。 */
function statusFetch(status: number, body: unknown = {}) {
  return scriptedFetch([() => jsonResponse(status, body)]);
}

/** 拒绝的 fake fetch（网络不可达模拟）。 */
function rejectingFetch(error: unknown) {
  const calls: FetchCall[] = [];
  const fetch = async (url: string | URL, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    throw error;
  };
  return { fetch: fetch as unknown as GlobalFetch, calls };
}

/** 挂起直到请求被 abort 的 fake fetch（超时模拟，Promise 永不 resolve）。 */
function hangingFetch() {
  const calls: FetchCall[] = [];
  const fetch = (url: string | URL, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    return new Promise<Response>((_, reject) => {
      const onAbort = () => reject(new Error("This operation was aborted"));
      if (init.signal?.aborted) onAbort();
      else init.signal?.addEventListener("abort", onAbort, { once: true });
    });
  };
  return { fetch: fetch as unknown as GlobalFetch, calls };
}

/** 状态 200、正文一直不来的 fake fetch：只有请求被 abort 时正文才失败。
 *  用来断言「超时预算覆盖到读正文阶段」，而不是只看请求头之前的悬挂。 */
function stalledBodyFetch() {
  const calls: FetchCall[] = [];
  const fetch = (url: string | URL, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    const body = new ReadableStream({
      start(controller) {
        const fail = () =>
          controller.error(new Error("This operation was aborted"));
        if (init.signal?.aborted) fail();
        else init.signal?.addEventListener("abort", fail, { once: true });
      },
    });
    return Promise.resolve(
      new Response(body, {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  };
  return { fetch: fetch as unknown as GlobalFetch, calls };
}

interface FakeTimerHandle {
  callback: () => void;
  delay: number;
}

interface FakeTimers {
  timers: FakeTimerHandle[];
  delays: () => number[];
  restore: () => void;
}

/**
 * 临时替换全局 setTimeout：记录每次延迟。clearTimeout 不替换：原生实现对
 * 伪造句柄是 no-op，迟到的 abort 在响应已返回后无害。回调经微任务立即触发
 * （无真实等待）：
 * - 默认只触发短延迟定时器（backoff ≤ 4000，小于 8000ms 超时）——否则超时
 *   abort 会抢先于网络错误，backend_unreachable 被误映射为 timeout；
 * - fireAll: true 额外触发 8000ms 超时定时器，供超时用例驱动 abort。
 */
function fakeTimers(opts: { fireAll?: boolean } = {}): FakeTimers {
  const timers: FakeTimerHandle[] = [];
  const original = globalThis.setTimeout;
  globalThis.setTimeout = ((
    callback: (...args: unknown[]) => void,
    delay?: number,
  ) => {
    const timer: FakeTimerHandle = { callback, delay: delay ?? 0 };
    timers.push(timer);
    if (opts.fireAll || timer.delay < 8000) queueMicrotask(() => callback());
    return 0 as unknown as NodeJS.Timeout;
  }) as typeof setTimeout;
  return {
    timers,
    delays: () => timers.map((t) => t.delay),
    restore: () => {
      globalThis.setTimeout = original;
    },
  };
}

/** 固定 nmem 配置（env 优先级最高），返回恢复函数。 */
function useFakeConfig() {
  const savedUrl = process.env.NMEM_API_URL;
  const savedKey = process.env.NMEM_API_KEY;
  process.env.NMEM_API_URL = FAKE_API_URL;
  process.env.NMEM_API_KEY = "test-key";
  return () => {
    if (savedUrl === undefined) delete process.env.NMEM_API_URL;
    else process.env.NMEM_API_URL = savedUrl;
    if (savedKey === undefined) delete process.env.NMEM_API_KEY;
    else process.env.NMEM_API_KEY = savedKey;
  };
}

interface FixtureContext {
  timers: FakeTimers;
}

/** 统一夹具：fake config + fake timers，finally 恢复两者。 */
async function withFixtures(
  fn: (ctx: FixtureContext) => Promise<void>,
  timerOpts: { fireAll?: boolean } = {},
) {
  const restoreEnv = useFakeConfig();
  const timers = fakeTimers(timerOpts);
  try {
    await fn({ timers });
  } finally {
    timers.restore();
    restoreEnv();
  }
}

/** NmemError 类型守卫：只暴露测试关心的 code / status 面。 */
function isNmemError(
  error: unknown,
): error is Error & { code: string; status?: number } {
  return error instanceof Error && error.name === "NmemError";
}

interface RequestArgs {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  body?: unknown;
  options?: { fetch?: typeof fetch; timeoutMs?: number; retries?: number };
}

/** 运行 nmemRequest，捕获并返回抛出的 NmemError（不断言则失败）。 */
async function requestExpectingError(
  method: RequestArgs["method"],
  path: string,
  body?: unknown,
  options?: RequestArgs["options"],
): Promise<Error & { code: string; status?: number }> {
  let threw: unknown;
  try {
    await nmemRequest(method, path, body, options);
  } catch (error) {
    threw = error;
  }
  ok(isNmemError(threw), `期望 NmemError，实际：${threw}`);
  return threw;
}

// ============================================================================
// fetch 注入 seam
// ============================================================================

test("nmemRequest: 不传 options 时使用全局 fetch", async () => {
  const restoreEnv = useFakeConfig();
  const scripted = scriptedFetch([() => jsonResponse(200, { ok: true })]);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = scripted.fetch;
  try {
    const data = await nmemRequest("GET", "/health");
    deepStrictEqual(data, { ok: true });
    strictEqual(scripted.calls.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv();
  }
});

test("nmemRequest: options.fetch 注入优先生效，全局 fetch 不被调用", async () => {
  const restoreEnv = useFakeConfig();
  const scripted = scriptedFetch([() => jsonResponse(200, { ping: "pong" })]);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => {
    throw new Error(
      "global fetch must not be called when options.fetch is injected",
    );
  }) as unknown as GlobalFetch;
  try {
    const data = await nmemRequest("GET", "/ping", undefined, {
      fetch: scripted.fetch,
    });
    deepStrictEqual(data, { ping: "pong" });
    strictEqual(scripted.calls.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv();
  }
});

test("nmemRequest: 注入的 fake fetch 收到完整 URL + 鉴权头 + 请求体", async () => {
  const restoreEnv = useFakeConfig();
  const scripted = scriptedFetch([() => jsonResponse(200, {})]);
  try {
    await nmemRequest(
      "POST",
      "/threads",
      { title: "hi" },
      {
        fetch: scripted.fetch,
      },
    );
    strictEqual(scripted.calls.length, 1);
    strictEqual(scripted.calls[0].url, `${FAKE_API_URL}/threads`);
    strictEqual(scripted.calls[0].init.method, "POST");
    deepStrictEqual(scripted.calls[0].init.headers, {
      "Content-Type": "application/json",
      Authorization: "Bearer test-key",
      "X-NMEM-API-Key": "test-key",
    });
    strictEqual(scripted.calls[0].init.body, JSON.stringify({ title: "hi" }));
  } finally {
    restoreEnv();
  }
});

test("nmemRequest: 无 body 时不带 Content-Type", async () => {
  const restoreEnv = useFakeConfig();
  const scripted = scriptedFetch([() => jsonResponse(200, {})]);
  try {
    await nmemRequest("GET", "/threads", undefined, { fetch: scripted.fetch });
    const headers = new Headers(scripted.calls[0].init.headers);
    strictEqual(headers.get("Content-Type"), null);
    strictEqual(headers.get("Authorization"), "Bearer test-key");
  } finally {
    restoreEnv();
  }
});

// ============================================================================
// 瞬时故障触发重试（timeout / backend_unreachable / server_error）
// ============================================================================

test("nmemRequest: timeout 重试后成功", async () => {
  await withFixtures(
    async () => {
      const hanging = hangingFetch();
      let attempt = 0;
      const fakeFetch = async (url: string | URL, init: RequestInit = {}) => {
        attempt += 1;
        if (attempt === 1) return hanging.fetch(url, init);
        return jsonResponse(200, { recovered: true });
      };
      const data = await nmemRequest("GET", "/threads", undefined, {
        fetch: fakeFetch as unknown as GlobalFetch,
      });
      deepStrictEqual(data, { recovered: true });
      strictEqual(attempt, 2);
    },
    { fireAll: true },
  );
});

test("nmemRequest: backend_unreachable 重试后成功", async () => {
  await withFixtures(async () => {
    const { fetch, calls } = rejectingFetch(new TypeError("fetch failed"));
    let attempt = 0;
    const fakeFetch = async (url: string | URL, init: RequestInit = {}) => {
      attempt += 1;
      if (attempt === 1) return fetch(url, init);
      return jsonResponse(200, { done: 1 });
    };
    const data = await nmemRequest("GET", "/threads", undefined, {
      fetch: fakeFetch as unknown as GlobalFetch,
    });
    deepStrictEqual(data, { done: 1 });
    strictEqual(attempt, 2);
    strictEqual(calls.length, 1);
  });
});

test("nmemRequest: server_error (500) 重试至上限 3 次后抛出", async () => {
  await withFixtures(async () => {
    const { fetch, calls } = statusFetch(500, { detail: "boom" });
    const threw = await requestExpectingError("GET", "/threads", undefined, {
      fetch,
    });
    strictEqual(threw.code, "server_error");
    strictEqual(threw.status, 500);
    strictEqual(calls.length, 3); // MAX_RETRIES=2 → 首次 + 2 次重试
  });
});

test("nmemRequest: 其他 5xx（503）同样按 server_error 重试至上限", async () => {
  await withFixtures(async () => {
    const { fetch, calls } = statusFetch(503, {});
    const threw = await requestExpectingError("GET", "/threads", undefined, {
      fetch,
    });
    strictEqual(threw.code, "server_error");
    strictEqual(threw.status, 503);
    strictEqual(calls.length, 3);
  });
});

// ============================================================================
// 不可重试错误码：一次调用即抛
// ============================================================================

test("nmemRequest: 401 unauthorized 不重试", async () => {
  await withFixtures(async () => {
    const { fetch, calls } = statusFetch(401, { detail: "bad key" });
    const threw = await requestExpectingError("GET", "/threads", undefined, {
      fetch,
    });
    strictEqual(threw.code, "unauthorized");
    strictEqual(threw.status, 401);
    strictEqual(calls.length, 1);
  });
});

test("nmemRequest: 404 not_found 不重试", async () => {
  await withFixtures(async () => {
    const { fetch, calls } = statusFetch(404, { detail: "nope" });
    const threw = await requestExpectingError(
      "GET",
      "/threads/999",
      undefined,
      {
        fetch,
      },
    );
    strictEqual(threw.code, "not_found");
    strictEqual(threw.status, 404);
    strictEqual(calls.length, 1);
  });
});

test("nmemRequest: 400 bad_request 不重试", async () => {
  await withFixtures(async () => {
    const { fetch, calls } = statusFetch(400, { detail: "bad input" });
    const threw = await requestExpectingError(
      "POST",
      "/threads",
      {},
      { fetch },
    );
    strictEqual(threw.code, "bad_request");
    strictEqual(threw.status, 400);
    strictEqual(calls.length, 1);
  });
});

test("nmemRequest: 422 同样映射 bad_request 不重试", async () => {
  await withFixtures(async () => {
    const { fetch, calls } = statusFetch(422, {});
    const threw = await requestExpectingError(
      "POST",
      "/threads",
      {},
      { fetch },
    );
    strictEqual(threw.code, "bad_request");
    strictEqual(threw.status, 422);
    strictEqual(calls.length, 1);
  });
});

test("nmemRequest: 其余 4xx（403）按现状映射 server_error 并重试至上限", async () => {
  await withFixtures(async () => {
    const { fetch, calls } = statusFetch(403, {});
    const threw = await requestExpectingError("GET", "/threads", undefined, {
      fetch,
    });
    strictEqual(threw.code, "server_error");
    strictEqual(threw.status, 403);
    strictEqual(calls.length, 3);
  });
});

// ============================================================================
// 重试次数覆盖
// ============================================================================

test("nmemRequest: options.retries=0 时只尝试一次", async () => {
  await withFixtures(async () => {
    const { fetch, calls } = statusFetch(500, { detail: "boom" });
    const threw = await requestExpectingError("GET", "/threads", undefined, {
      fetch,
      retries: 0,
    });
    strictEqual(threw.code, "server_error");
    strictEqual(calls.length, 1);
  });
});

// ============================================================================
// backoff（fake timer：只看延迟数值，无真实等待）
// ============================================================================

test("nmemRequest: backoff 延迟按指数上限递增且受 BACKOFF_CAP_MS=4000 触顶约束", async () => {
  await withFixtures(async ({ timers }) => {
    const { fetch } = statusFetch(500, {});
    await requestExpectingError("GET", "/threads", undefined, { fetch });
    const delays = timers.delays().filter((d) => d < 8000); // 排除每轮尝试的 8000ms 超时定时器
    // 2 次重试 → 2 个 backoff；上限 Math.min(500 * 2^attempt, 4000) → 500 / 1000
    strictEqual(delays.length, 2);
    ok(
      delays[0] >= 0 && delays[0] < 500,
      `delay[0]=${delays[0]} 应落在 [0, 500)`,
    );
    ok(
      delays[1] >= 0 && delays[1] < 1000,
      `delay[1]=${delays[1]} 应落在 [0, 1000)`,
    );
    ok(
      delays.every((d) => Number.isInteger(d)),
      "backoff 取整",
    );
    ok(
      delays.every((d) => d <= 4000),
      "backoff 不超过 BACKOFF_CAP_MS=4000",
    );
  });
});

test("nmemRequest: 不重试的失败不产生 backoff", async () => {
  await withFixtures(async ({ timers }) => {
    const { fetch } = statusFetch(401, {});
    await requestExpectingError("GET", "/threads", undefined, { fetch });
    // 单次尝试仍设一个 8000ms 超时定时器，但没有任何 backoff 定时器（< 8000）
    deepStrictEqual(
      timers.delays().filter((d) => d < 8000),
      [],
    );
  });
});

// ============================================================================
// 超时中止
// ============================================================================

test("nmemRequest: 超时以 AbortSignal 中止请求并映射 timeout，定时器为 8000ms", async () => {
  await withFixtures(
    async ({ timers }) => {
      const { fetch, calls } = hangingFetch();
      const threw = await requestExpectingError("GET", "/slow", undefined, {
        fetch,
      });
      strictEqual(threw.code, "timeout");
      strictEqual(threw.message, "[timeout] request aborted after 8000ms");
      strictEqual(threw.status, undefined);
      strictEqual(calls.length, 3); // timeout 可重试 → 3 次尝试
      // 每次尝试各设一个 8000ms 超时定时器，两次重试间各夹一个 backoff
      const delays = timers.delays();
      strictEqual(delays.length, 5);
      deepStrictEqual(
        delays.filter((d) => d === 8000),
        [8000, 8000, 8000],
      );
      ok(
        delays[1] < 1000 && delays[3] < 1000,
        `backoff 延迟 ${delays[1]}/${delays[3]} 应小于 1000`,
      );
    },
    { fireAll: true },
  );
});

test("nmemRequest: 响应头已到、正文悬挂时 abort 归为 timeout", async () => {
  await withFixtures(
    async ({ timers }) => {
      const { fetch, calls } = stalledBodyFetch();
      const threw = await requestExpectingError("GET", "/stalled", undefined, {
        fetch,
        retries: 0,
      });
      strictEqual(threw.code, "timeout");
      strictEqual(threw.message, "[timeout] request aborted after 8000ms");
      strictEqual(calls.length, 1);
      ok(timers.delays().includes(8000), "正文读取阶段仍受超时预算约束");
    },
    { fireAll: true },
  );
});

test("nmemRequest: 正文阶段 timeout 属于可重试分类", async () => {
  await withFixtures(
    async () => {
      const { fetch, calls } = stalledBodyFetch();
      const threw = await requestExpectingError("GET", "/stalled", undefined, {
        fetch,
      });
      strictEqual(threw.code, "timeout");
      strictEqual(calls.length, 3, "timeout 可重试 → 3 次尝试");
    },
    { fireAll: true },
  );
});

test("nmemRequest: options.timeoutMs 覆盖超时预算", async () => {
  await withFixtures(
    async ({ timers }) => {
      const { fetch } = hangingFetch();
      const threw = await requestExpectingError("GET", "/slow", undefined, {
        fetch,
        timeoutMs: 250,
        retries: 0,
      });
      strictEqual(threw.code, "timeout");
      strictEqual(threw.message, "[timeout] request aborted after 250ms");
      deepStrictEqual(timers.delays(), [250]);
    },
    { fireAll: true },
  );
});

// ============================================================================
// 错误详情提取
// ============================================================================

test("nmemRequest: 响应体 detail 字段优先进 NmemError", async () => {
  await withFixtures(async () => {
    const { fetch } = statusFetch(404, { detail: "thread not found" });
    const threw = await requestExpectingError(
      "GET",
      "/threads/999",
      undefined,
      {
        fetch,
      },
    );
    strictEqual(threw.message, "[not_found] thread not found");
  });
});

test("nmemRequest: 响应体无 detail 字段时用原始文本", async () => {
  await withFixtures(async () => {
    const { fetch } = statusFetch(404, {});
    const threw = await requestExpectingError(
      "GET",
      "/threads/999",
      undefined,
      {
        fetch,
      },
    );
    strictEqual(threw.message, "[not_found] {}");
  });
});

test("nmemRequest: 响应体为空时回退 HTTP <status>", async () => {
  await withFixtures(async () => {
    const fetch = async () => new Response("", { status: 500 });
    const threw = await requestExpectingError("GET", "/threads", undefined, {
      fetch: fetch as unknown as GlobalFetch,
    });
    strictEqual(threw.message, "[server_error] HTTP 500");
  });
});

test("nmemRequest: 非法 JSON 响应体原样作为详情", async () => {
  await withFixtures(async () => {
    const fetch = async () => new Response("gateway exploded", { status: 502 });
    const threw = await requestExpectingError("GET", "/threads", undefined, {
      fetch: fetch as unknown as GlobalFetch,
    });
    strictEqual(threw.message, "[server_error] gateway exploded");
  });
});

test("nmemRequest: backend_unreachable 的详情取自底层错误 message", async () => {
  await withFixtures(async () => {
    const { fetch } = rejectingFetch(new TypeError("fetch failed"));
    const threw = await requestExpectingError("GET", "/threads", undefined, {
      fetch,
    });
    strictEqual(threw.code, "backend_unreachable");
    strictEqual(threw.message, "[backend_unreachable] fetch failed");
  });
});

// ============================================================================
// URL 拼接（apiUrl 尾斜杠剥离）
// ============================================================================

test("nmemRequest: apiUrl 尾斜杠被剥离后拼接 path", async () => {
  const restoreEnv = useFakeConfig();
  process.env.NMEM_API_URL = "http://nmem.test:9999///";
  const scripted = scriptedFetch([() => jsonResponse(200, {})]);
  try {
    await nmemRequest("GET", "/health", undefined, { fetch: scripted.fetch });
    strictEqual(scripted.calls[0].url, "http://nmem.test:9999/health");
  } finally {
    restoreEnv();
  }
});

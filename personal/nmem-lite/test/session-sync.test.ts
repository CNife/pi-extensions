/**
 * nmem-lite 同步语义测试 — 经扩展入口注册的真实 handler 观测落盘请求。
 *
 * 断言的是外部行为：注册了哪些 handler、落盘请求（URL、消息条数、
 * sync_reason、source、tool_version）、请求次数与每轮的超时预算、
 * 防抖与刚性的先后关系、快照新鲜度。不断言内部状态字段。
 *
 * 机制说明（与 OMP plugins/nmem/test/shutdown-sync.test.ts 的差异）：
 * - pi 的 ExtensionContext 没有 `ctx.setTimeout`/`clearTimer`（那是 OMP 宿主的
 *   隔离机制），所以定时器探针挂在全局；本文件只接管 750ms 的防抖定时器
 *   （其余延迟交给原生实现，让请求预算走真实时间）。
 * - pi 的 SessionShutdownEvent 带 `reason`（quit|reload|new|resume|fork），
 *   故 sync_reason 记为 `session_shutdown:<reason>`。
 * - OMP 宿主给 shutdown handler 2s 硬杀、预算用 800ms；pi 没有宿主硬杀，
 *   前台预算自己封（单请求 3s、整条队列最多等 6s、不重试）。
 *
 * 运行：仓库根 `npm test`。
 */

import { ok, strictEqual } from "node:assert";
import { readFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { test } from "vitest";
import nmemLite from "../extensions/nmem-lite.ts";

type Handler = (event: unknown, ctx: unknown) => unknown;

/** 捕获扩展入口注册的 handler（入口只做注册，无副作用）。 */
function registeredHandlers(): Record<string, Handler | undefined> {
  const handlers: Record<string, Handler | undefined> = {};
  const pi = {
    on: (name: string, handler: Handler) => {
      handlers[name] = handler;
    },
  };
  nmemLite(pi as unknown as ExtensionAPI);
  return handlers;
}

/** 防抖延迟（毫秒）。探针按此值区分「可手动触发的防抖定时器」与请求预算。 */
const DEBOUNCE_DELAY_MS = 750;

interface FakeCtx {
  ctx: unknown;
  notifications: string[];
  /** 让挂起的防抖定时器「到点」；已被 clearTimeout 取消的定时器不会被触发。 */
  fireTimer: () => void;
  /** 把会话改成 count 条消息（user/assistant 交替），用于制造会话在同步途中继续生长。 */
  setMessages: (count: number) => void;
}

/** 最小会话上下文：user + assistant 两条消息即可触发同步，防抖定时器由测试掌控。 */
function fakeCtx(sessionId: string): FakeCtx {
  const notifications: string[] = [];
  const messages = [
    { role: "user", content: "hi" },
    { role: "assistant", content: "hello" },
  ];
  return {
    notifications,
    setMessages: (count: number) => {
      messages.length = 0;
      for (let i = 0; i < count; i++) {
        messages.push({
          role: i % 2 === 0 ? "user" : "assistant",
          content: `${i % 2 === 0 ? "hi" : "hello"}-${i}`,
        });
      }
    },
    fireTimer: () => firePendingTimers(),
    ctx: {
      hasUI: true,
      ui: { notify: (message: string) => notifications.push(message) },
      sessionManager: {
        getBranch: () =>
          messages.map((message, index) => ({
            type: "message",
            id: `m${index + 1}`,
            timestamp: "2026-10-17T00:00:00.000Z",
            message,
          })),
        getSessionId: () => sessionId,
        getSessionFile: () => undefined,
        getSessionName: () => undefined,
        getCwd: () => "/tmp/demo",
      },
    },
  };
}

// ============================================================================
// Fixtures
// ============================================================================

const FAKE_API_URL = "http://nmem.test:9999";

type GlobalFetch = typeof globalThis.fetch;

interface FetchCall {
  url: string;
  init: RequestInit;
}

type Outcome = (
  call: number,
  init: RequestInit,
) => Response | Promise<Response>;

interface Probe {
  calls: FetchCall[];
  /** 所有全局 setTimeout 的延迟（防抖 750、请求预算、backoff、前台 waitMs）。 */
  delays: number[];
  /** 触发挂起的 750ms 防抖定时器。 */
  fireTimer: () => void;
  /** 是否还留着未取消的防抖定时器。 */
  hasPendingTimer: () => boolean;
  restore: () => void;
}

let firePendingTimers = (): void => {};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * 注入 fake fetch（记录每次请求）与 setTimeout 探针（记录每次延迟，并托管
 * 750ms 防抖定时器）。请求预算、backoff、前台 waitMs 仍交给原生 setTimeout，
 * 以便断言真实耗时。事件时序（body-start / clear）由 stalledBody 与这里共用。
 */
function probe(
  respond: Outcome,
  opts: { events?: Array<"body-start" | "clear"> } = {},
): Probe {
  const calls: FetchCall[] = [];
  const delays: number[] = [];
  const debounceHandles = new Set<{ callback: () => void }>();
  const events = opts.events;
  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const savedApiUrl = process.env.NMEM_API_URL;

  globalThis.setTimeout = ((
    callback: (...args: unknown[]) => void,
    delay?: number,
    ...rest: unknown[]
  ) => {
    delays.push(delay ?? 0);
    if (delay === DEBOUNCE_DELAY_MS) {
      const handle = { callback: callback as () => void };
      debounceHandles.add(handle);
      return handle as unknown as NodeJS.Timeout;
    }
    return originalSetTimeout(callback, delay, ...rest);
  }) as typeof setTimeout;
  globalThis.clearTimeout = ((handle?: NodeJS.Timeout) => {
    const debounce = handle as unknown as { callback: () => void };
    if (debounce && debounceHandles.has(debounce)) {
      debounceHandles.delete(debounce);
      return;
    }
    if (handle !== undefined && events) events.push("clear");
    return originalClearTimeout(handle);
  }) as typeof clearTimeout;
  globalThis.fetch = (async (url: string | URL, init: RequestInit = {}) => {
    const call = calls.length + 1;
    calls.push({ url: String(url), init });
    return await respond(call, init);
  }) as unknown as GlobalFetch;
  process.env.NMEM_API_URL = FAKE_API_URL;

  firePendingTimers = () => {
    for (const handle of [...debounceHandles]) {
      debounceHandles.delete(handle);
      handle.callback();
    }
  };

  return {
    calls,
    delays,
    fireTimer: () => firePendingTimers(),
    hasPendingTimer: () => debounceHandles.size > 0,
    restore: () => {
      globalThis.fetch = originalFetch;
      globalThis.setTimeout = originalSetTimeout;
      globalThis.clearTimeout = originalClearTimeout;
      if (savedApiUrl === undefined) delete process.env.NMEM_API_URL;
      else process.env.NMEM_API_URL = savedApiUrl;
    },
  };
}

/** 状态 200、正文一直不来的响应：只有请求被 abort 时正文才失败。 */
function stalledBody(events: Array<"body-start" | "clear">) {
  return (init: RequestInit): Response => {
    const body = new ReadableStream({
      start(controller) {
        events.push("body-start");
        const fail = () =>
          controller.error(new Error("This operation was aborted"));
        if (init.signal?.aborted) fail();
        else init.signal?.addEventListener("abort", fail, { once: true });
      },
    });
    return new Response(body, {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
}

/** 门控：在 release() 之前请求一直不返回，用来让请求停留在飞行中。 */
function gate(): { release: () => void; opened: Promise<void> } {
  let release = (): void => {};
  const opened = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { release, opened };
}

/** 等到条件成立（fetch 由微任务链驱动，不能靠同步断言）。 */
async function until(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 400; i++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("等待条件超时");
}

/** 落盘请求体（顶层字段）。 */
function responseBodyOf(call: FetchCall): Record<string, unknown> {
  const posted: unknown =
    typeof call.init.body === "string"
      ? JSON.parse(call.init.body)
      : call.init.body;
  if (posted === null || typeof posted !== "object") {
    throw new Error(`请求体不是对象：${JSON.stringify(posted)}`);
  }
  return posted as Record<string, unknown>;
}

/** 从落盘请求体里取出 metadata.sync_reason；形态不对即失败。 */
function syncReasonOf(body: Record<string, unknown>): unknown {
  const metadata = body.metadata;
  if (
    metadata === null ||
    typeof metadata !== "object" ||
    !("sync_reason" in metadata)
  ) {
    throw new Error(`metadata 里没有 sync_reason：${JSON.stringify(metadata)}`);
  }
  return (metadata as Record<string, unknown>).sync_reason;
}

/** 取出落盘请求体里的消息条数。 */
function messageCountOf(call: FetchCall): number {
  const { messages } = responseBodyOf(call);
  if (!Array.isArray(messages)) {
    throw new Error(`messages 不是数组：${JSON.stringify(messages)}`);
  }
  return messages.length;
}

/** 只挑创建线程的请求：append 的请求体没有 metadata（sync_reason 只在 create 上）。 */
function createCalls(calls: FetchCall[]): FetchCall[] {
  return calls.filter((call) => new URL(call.url).pathname === "/threads");
}

// ============================================================================
// sync_reason 落点与前台预算
// ============================================================================

test("session_shutdown: 落盘请求的 sync_reason 带 reason，且请求体不含 undefined", async () => {
  const p = probe(() => jsonResponse(200, { ok: true }));
  try {
    const handler = registeredHandlers().session_shutdown;
    ok(handler, "入口应注册 session_shutdown");
    const chat = fakeCtx("shutdown-reason-session");
    await handler({ type: "session_shutdown", reason: "quit" }, chat.ctx);

    strictEqual(p.calls.length, 1);
    const body = responseBodyOf(p.calls[0]);
    strictEqual(syncReasonOf(body), "session_shutdown:quit");
    strictEqual(body.source, "pi");
    const serialized = String(p.calls[0].init.body);
    strictEqual(
      serialized.includes("undefined"),
      false,
      `请求体里不该出现 undefined：${serialized}`,
    );
  } finally {
    p.restore();
  }
});

test("session_shutdown: 单请求只尝试一次且退出等待落在前台预算内", async () => {
  const p = probe(() => jsonResponse(500, { detail: "budget-boom" }));
  try {
    const handler = registeredHandlers().session_shutdown;
    ok(handler, "入口应注册 session_shutdown");
    const chat = fakeCtx("shutdown-budget-session");
    const started = Date.now();
    await handler({ type: "session_shutdown", reason: "quit" }, chat.ctx);
    const elapsed = Date.now() - started;

    // create 失败后还有一次 append 兜底 → 两次请求；重试关闭 → 每次请求只挂一个超时定时器
    strictEqual(
      p.calls.length,
      2,
      "退出时最多两次请求（create + append 兜底）",
    );
    strictEqual(
      p.delays.filter((d) => d === 3000).length,
      2,
      "每次请求挂 3000ms 预算",
    );
    ok(
      p.delays.every((d) => d >= 3000),
      `退出路径只应有前台预算定时器，实际：${JSON.stringify(p.delays)}`,
    );
    ok(
      elapsed <= 6000,
      `退出 handler 实际耗时 ${elapsed}ms 应落在 6000ms 前台窗口内`,
    );
  } finally {
    p.restore();
  }
});

test("session_before_compact: 用前台预算并把 reason 记为 session_before_compact", async () => {
  const p = probe(() => jsonResponse(200, { ok: true }));
  try {
    const handler = registeredHandlers().session_before_compact;
    ok(handler, "入口应注册 session_before_compact");
    const chat = fakeCtx("compact-reason-session");
    await handler({ type: "session_before_compact" }, chat.ctx);

    strictEqual(p.calls.length, 1);
    strictEqual(
      syncReasonOf(responseBodyOf(p.calls[0])),
      "session_before_compact",
    );
    strictEqual(p.delays.filter((d) => d === 3000).length, 1);
  } finally {
    p.restore();
  }
});

test("session_shutdown: 响应头已到、正文不来时也按预算截断", async () => {
  // 不伪造「定时器已到点」：让真实的 3000ms 前台预算去中止悬挂的正文，
  // 断言的是「预算覆盖到正文读取阶段」，而不是「abort 之后如何分类」。
  const events: Array<"body-start" | "clear"> = [];
  let mode: "ok" | "stall" = "ok";
  const p = probe(
    (_call, init) =>
      mode === "ok"
        ? jsonResponse(200, { ok: true })
        : stalledBody(events)(init),
    { events },
  );
  try {
    const handlers = registeredHandlers();
    const compact = handlers.session_before_compact;
    const shutdown = handlers.session_shutdown;
    ok(
      compact && shutdown,
      "入口应注册 session_before_compact 与 session_shutdown",
    );
    const chat = fakeCtx("shutdown-stall-session");

    // 先用一次前台同步把线程建好（并等它彻底落定），让悬挂的那次只发一条 append
    await compact({ type: "session_before_compact" }, chat.ctx);
    strictEqual(p.calls.length, 1);

    mode = "stall";
    events.length = 0;
    const started = Date.now();
    await shutdown({ type: "session_shutdown", reason: "quit" }, chat.ctx);
    const elapsed = Date.now() - started;

    strictEqual(p.calls.length, 2, "正文悬挂也应按预算结束本次尝试");
    ok(
      chat.notifications.some((n) => n.includes("[timeout]")),
      `正文读取超时应告警为 timeout，实际：${JSON.stringify(chat.notifications)}`,
    );
    ok(elapsed <= 4000, `退出 handler 实际耗时 ${elapsed}ms 应落在前台窗口内`);
    // 时序：先开始读正文，之后才清预算定时器（提前 clear 会让正文永久悬挂）
    const firstBody = events.indexOf("body-start");
    const firstClear = events.indexOf("clear");
    ok(
      firstBody !== -1 && firstClear !== -1,
      `缺少事件：${JSON.stringify(events)}`,
    );
    ok(
      firstBody < firstClear,
      `清定时器发生在读正文之前：${JSON.stringify(events)}`,
    );
  } finally {
    p.restore();
  }
});

// ============================================================================
// 防抖与快照新鲜度
// ============================================================================

test("agent_settled 防抖: 到点时按最新会话落盘，窗口内新消息不丢", async () => {
  // 快照在定时器到点时构建。若在排定时器时就构建，750ms 窗口内追加的消息会被漏掉。
  const p = probe(() => jsonResponse(200, { ok: true }));
  try {
    const agent = registeredHandlers().agent_settled;
    ok(agent, "入口应注册 agent_settled");
    const chat = fakeCtx("debounce-fresh-snapshot-session");

    await agent({ type: "agent_settled", aborted: false }, chat.ctx);
    // 定时器还没到点，会话又长了两条
    chat.setMessages(4);
    chat.fireTimer();
    await until(() => p.calls.length === 1);

    strictEqual(
      messageCountOf(p.calls[0]),
      4,
      "防抖到点应带上窗口内新增的消息",
    );
  } finally {
    p.restore();
  }
});

test("session_shutdown: 取消挂起的防抖不会丢掉只在防抖快照里的消息", async () => {
  // 防抖快照在到点时构建，因此退出 flush 构建的即时快照至少与它等宽。
  const p = probe(() => jsonResponse(200, { ok: true }));
  try {
    const handlers = registeredHandlers();
    const agent = handlers.agent_settled;
    const shutdown = handlers.session_shutdown;
    ok(agent && shutdown, "入口应注册 agent_settled 与 session_shutdown");
    const chat = fakeCtx("shutdown-cancel-debounce-session");

    // agent_settled 排了防抖；到点前会话又长了消息，然后退出
    await agent({ type: "agent_settled", aborted: false }, chat.ctx);
    chat.setMessages(4);
    await shutdown({ type: "session_shutdown", reason: "quit" }, chat.ctx);

    // 该防抖已被取消：只剩退出这一次 create
    const creates = createCalls(p.calls);
    strictEqual(
      creates.length,
      1,
      `被取消的防抖不应落盘，实际请求：${JSON.stringify(p.calls.map((c) => c.url))}`,
    );
    strictEqual(
      syncReasonOf(responseBodyOf(creates[0])),
      "session_shutdown:quit",
    );
    // 退出这次携带的是四条消息（防抖被取消也没丢）
    strictEqual(messageCountOf(creates[0]), 4);
  } finally {
    p.restore();
  }
});

test("session_shutdown: 无可同步内容时也取消挂起的防抖，不留过期定时器", async () => {
  const p = probe(() => jsonResponse(200, { ok: true }));
  try {
    const handlers = registeredHandlers();
    const agent = handlers.agent_settled;
    const shutdown = handlers.session_shutdown;
    ok(agent && shutdown, "入口应注册 agent_settled 与 session_shutdown");
    const chat = fakeCtx("shutdown-empty-session");
    // 只有 user 消息：没有 user+assistant 对，构建不出快照
    chat.setMessages(1);

    await agent({ type: "agent_settled", aborted: false }, chat.ctx);
    // scheduleFlush 不预判 payload，防抖照排
    strictEqual(p.hasPendingTimer(), true, "agent_settled 应排一个防抖");
    await shutdown({ type: "session_shutdown", reason: "quit" }, chat.ctx);

    strictEqual(p.calls.length, 0, "无可同步内容时不该发请求");
    strictEqual(
      p.hasPendingTimer(),
      false,
      "退出后不该留着会用失效上下文开火的防抖定时器",
    );
  } finally {
    p.restore();
  }
});

test("session_shutdown: 退出期间到点的防抖不再多跑一轮", async () => {
  // 后端每次都 500：每次 flush 两阶段共两次请求
  const p = probe(() => jsonResponse(500, { detail: "debounce-boom" }));
  try {
    const handlers = registeredHandlers();
    const agent = handlers.agent_settled;
    const shutdown = handlers.session_shutdown;
    ok(agent && shutdown, "入口应注册 agent_settled 与 session_shutdown");
    const chat = fakeCtx("shutdown-debounce-session");

    // agent_settled 先排了一个 750ms 后触发的防抖同步
    await agent({ type: "agent_settled", aborted: false }, chat.ctx);
    // 防抖还没到点，用户就退出了
    const flushing = shutdown(
      { type: "session_shutdown", reason: "quit" },
      chat.ctx,
    );
    // 退出 flush 进行中，那个定时器到点（若未被取消，宿主会真的执行它）
    chat.fireTimer();
    await flushing;

    strictEqual(
      p.calls.length,
      2,
      `退出期间只应有两次请求，实际 ${p.calls.length}`,
    );
  } finally {
    p.restore();
  }
});

test("session_shutdown: 请求在飞时补发的是最新快照，而不是重发旧快照", async () => {
  const g = gate();
  const p = probe((call) =>
    call === 1
      ? g.opened.then(() => jsonResponse(200, { ok: true }))
      : jsonResponse(200, { ok: true }),
  );
  try {
    const handlers = registeredHandlers();
    const agent = handlers.agent_settled;
    const shutdown = handlers.session_shutdown;
    ok(agent && shutdown, "入口应注册 agent_settled 与 session_shutdown");
    const chat = fakeCtx("shutdown-latest-snapshot-session");

    // 基线：两条消息的防抖同步起飞并挂住
    await agent({ type: "agent_settled", aborted: false }, chat.ctx);
    chat.fireTimer();
    await until(() => p.calls.length === 1);
    strictEqual(messageCountOf(p.calls[0]), 2);

    // 请求在飞时，会话长到四条消息（用户继续说话）
    chat.setMessages(4);

    // 中途退出：退出 flush 立即快照四条消息；随后放行在飞的请求
    const flushing = shutdown(
      { type: "session_shutdown", reason: "quit" },
      chat.ctx,
    );
    g.release();
    await flushing;

    // 后续轮次必须发四条那份快照；重发两条说明排队的是旧 payload
    const counts = p.calls.map(messageCountOf);
    ok(
      counts.includes(4),
      `退出后应补发含四条消息的快照，实际每轮条数：${JSON.stringify(counts)}`,
    );
    const creates = createCalls(p.calls);
    strictEqual(
      creates.length,
      1,
      `线程只应创建一次，实际：${JSON.stringify(p.calls.map((c) => c.url))}`,
    );
    strictEqual(syncReasonOf(responseBodyOf(creates[0])), "agent_settled");
    strictEqual(
      p.calls.length,
      2,
      `在飞一轮 + 补发一轮，实际：${JSON.stringify(p.calls.map((c) => c.url))}`,
    );
  } finally {
    g.release();
    p.restore();
  }
});

test("session_shutdown: 排队的一轮用自己的前台预算，不继承前一轮的默认值", async () => {
  // agent_settled 的同步已在飞（默认 8s + 重试），此时退出。补发的那一轮必须仍按
  // 3000ms / 不重试跑：否则它继承了前一轮的 options，前台预算整个失效。
  const g = gate();
  const p = probe((call) =>
    call === 1
      ? g.opened.then(() => jsonResponse(200, { ok: true }))
      : jsonResponse(200, { ok: true }),
  );
  try {
    const handlers = registeredHandlers();
    const agent = handlers.agent_settled;
    const shutdown = handlers.session_shutdown;
    ok(agent && shutdown, "入口应注册 agent_settled 与 session_shutdown");
    const chat = fakeCtx("shutdown-queued-budget-session");

    await agent({ type: "agent_settled", aborted: false }, chat.ctx);
    chat.fireTimer();
    await until(() => p.calls.length === 1);

    // 会话在飞时又长了消息，然后退出：退出快照排进同一条链
    chat.setMessages(4);
    const flushing = shutdown(
      { type: "session_shutdown", reason: "quit" },
      chat.ctx,
    );
    g.release();
    await flushing;

    strictEqual(
      p.calls.length,
      2,
      `应有在飞一轮 + 补发一轮，实际：${JSON.stringify(p.calls.map((c) => c.url))}`,
    );
    strictEqual(messageCountOf(p.calls[1]), 4, "补发的一轮应是退出时的新快照");
    // 第一轮是 agent_settled 的默认预算；第二轮（退出补发）必须是 3000ms
    ok(
      p.delays.includes(8000),
      `在飞的后台轮应挂 8000ms 预算，实际：${JSON.stringify(p.delays)}`,
    );
    ok(
      p.delays.includes(3000),
      `退出补发应挂 3000ms 预算，实际：${JSON.stringify(p.delays)}`,
    );
  } finally {
    g.release();
    p.restore();
  }
});

// ============================================================================
// 触发点注册表
// ============================================================================

test("入口只注册 agent_settled / session_before_compact / session_shutdown", () => {
  const handlers = registeredHandlers();
  ok(handlers.agent_settled, "应注册 agent_settled");
  ok(handlers.session_before_compact, "应注册 session_before_compact");
  ok(handlers.session_shutdown, "应注册 session_shutdown");
  strictEqual(
    handlers.agent_end,
    undefined,
    "agent_end 不是最终空闲信号，不该注册",
  );
  strictEqual(
    handlers.session_before_switch,
    undefined,
    "shutdown 时刻快照更完整，不该再挂 session_before_switch",
  );
});

// ============================================================================
// 告警去重与版本一致性
// ============================================================================

test("同步失败只告警一次，不反复刷屏", async () => {
  const p = probe(() => jsonResponse(500, { detail: "dedup-boom" }));
  try {
    const handlers = registeredHandlers();
    const compact = handlers.session_before_compact;
    const shutdown = handlers.session_shutdown;
    ok(
      compact && shutdown,
      "入口应注册 session_before_compact 与 session_shutdown",
    );
    const chat = fakeCtx("warn-dedup-session");

    await compact({ type: "session_before_compact" }, chat.ctx);
    strictEqual(chat.notifications.length, 1, "第一次失败应告警一次");
    // 第二次同步仍失败：同一失败信息不再重复告警
    await shutdown({ type: "session_shutdown", reason: "quit" }, chat.ctx);
    strictEqual(
      chat.notifications.length,
      1,
      `同一失败只应告警一次，实际：${JSON.stringify(chat.notifications)}`,
    );
  } finally {
    p.restore();
  }
});

test("落盘的 tool_version 与 package.json 版本一致", async () => {
  const pkg = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  ) as { version: string };
  const p = probe(() => jsonResponse(200, { ok: true }));
  try {
    const handler = registeredHandlers().session_shutdown;
    ok(handler, "入口应注册 session_shutdown");
    const chat = fakeCtx("version-session");
    await handler({ type: "session_shutdown", reason: "quit" }, chat.ctx);

    strictEqual(
      responseBodyOf(p.calls[0]).tool_version,
      `pi-nmem-lite/${pkg.version}`,
    );
  } finally {
    p.restore();
  }
});

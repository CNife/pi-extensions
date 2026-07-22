/**
 * Integration tests for the startup Context Bundle gating in ambient.ts.
 *
 * Seam: installAmbient's public surface, exercised with a mock pi (capturing
 * event handlers) and a mock ctx (controllable session id). ambient.ts imports
 * the pi packages type-only (erased at runtime), so - unlike the entry nmem.ts
 * - it IS importable under plain `tsx --test`. The bundle endpoint is stubbed
 * via globalThis.fetch (client.ts uses global fetch); PI_CODING_AGENT_DIR is
 * redirected to a temp dir so the plugin config is isolated. Unique session ids
 * per test keep the module-level injection state (bundleEnabled /
 * startupContextCache) from colliding across tests.
 *
 * Run: npx tsx --test packages/nmem/test/ambient.test.ts
 */

import { match, ok, strictEqual } from "node:assert";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { installAmbient } from "../ambient.ts";

type Handler = (event: unknown, ctx: ExtensionContext) => Promise<unknown>;

let tempAgentDir: string;
let savedEnv: string | undefined;
let fetchCalls: number;
let fetchImpl: (url: unknown, opts: unknown) => Promise<Response>;
const realFetch = globalThis.fetch;
let sessionCounter = 0;

function setConfig(obj: unknown): void {
  writeFileSync(
    join(tempAgentDir, "cnife-nmem.json"),
    JSON.stringify(obj),
    "utf-8",
  );
}

function makePi(): { pi: ExtensionAPI; handlers: Map<string, Handler> } {
  const handlers = new Map<string, Handler>();
  const pi = {
    on(event: string, handler: Handler) {
      handlers.set(event, handler);
    },
  };
  return { pi: pi as unknown as ExtensionAPI, handlers };
}

function makeCtx(sessionId: string): ExtensionContext {
  return {
    hasUI: false,
    ui: { notify() {} },
    sessionManager: {
      getSessionId: () => sessionId,
      getBranch: () => [],
      getCwd: () => "/tmp",
    },
  } as unknown as ExtensionContext;
}

async function fireStart(
  handlers: Map<string, Handler>,
  ctx: ExtensionContext,
): Promise<void> {
  await handlers.get("session_start")?.({}, ctx);
}

async function fireBeforeStart(
  handlers: Map<string, Handler>,
  ctx: ExtensionContext,
): Promise<string> {
  const result = (await handlers.get("before_agent_start")?.(
    { systemPrompt: "BASE_PROMPT" },
    ctx,
  )) as { systemPrompt: string };
  return result.systemPrompt;
}

beforeEach(() => {
  savedEnv = process.env.PI_CODING_AGENT_DIR;
  tempAgentDir = mkdtempSync(join(tmpdir(), "nmem-ambient-test-"));
  process.env.PI_CODING_AGENT_DIR = tempAgentDir;
  fetchCalls = 0;
  fetchImpl = async () =>
    new Response(JSON.stringify({ rendered_markdown: "FAKE BUNDLE CONTENT" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  globalThis.fetch = (async (url: unknown, opts: unknown) => {
    fetchCalls++;
    return fetchImpl(url, opts);
  }) as typeof fetch;
});

afterEach(() => {
  if (savedEnv === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = savedEnv;
  globalThis.fetch = realFetch;
  rmSync(tempAgentDir, { recursive: true, force: true });
});

test("bundle off (explicit): guidance injected, no bundle section, zero fetches", async () => {
  setConfig({ injectContextBundle: false });
  const { pi, handlers } = makePi();
  installAmbient(pi);
  const ctx = makeCtx(`sess-off-${sessionCounter++}`);

  await fireStart(handlers, ctx);
  strictEqual(fetchCalls, 0, "no bundle fetch at session_start when disabled");

  const prompt = await fireBeforeStart(handlers, ctx);
  strictEqual(
    fetchCalls,
    0,
    "no bundle fetch at before_agent_start when disabled",
  );
  match(prompt, /BASE_PROMPT/);
  match(prompt, /## Nowledge Mem Guidance/);
  ok(
    !prompt.includes("## Nowledge Mem Context Bundle"),
    "no bundle section when disabled",
  );
  ok(
    !prompt.includes("Context Bundle is injected above"),
    "no bundle bullet when disabled",
  );
});

test("bundle off by default when config file is missing", async () => {
  const { pi, handlers } = makePi();
  installAmbient(pi);
  const ctx = makeCtx(`sess-missing-${sessionCounter++}`);

  await fireStart(handlers, ctx);
  const prompt = await fireBeforeStart(handlers, ctx);
  strictEqual(fetchCalls, 0, "default-off: no fetch");
  ok(!prompt.includes("## Nowledge Mem Context Bundle"));
  match(prompt, /## Nowledge Mem Guidance/);
});

test("bundle on: bundle section + content injected, bundle bullet present, cached", async () => {
  setConfig({ injectContextBundle: true });
  const { pi, handlers } = makePi();
  installAmbient(pi);
  const ctx = makeCtx(`sess-on-${sessionCounter++}`);

  await fireStart(handlers, ctx);
  ok(fetchCalls >= 1, "bundle fetched at session_start when enabled");
  const callsAfterStart = fetchCalls;

  const prompt = await fireBeforeStart(handlers, ctx);
  strictEqual(
    fetchCalls,
    callsAfterStart,
    "cache hit at before_agent_start (no extra fetch)",
  );
  match(prompt, /## Nowledge Mem Context Bundle/);
  match(prompt, /FAKE BUNDLE CONTENT/);
  match(prompt, /Context Bundle is injected above/);
  match(prompt, /## Nowledge Mem Guidance/);
});

test("bundle on but backend errors: degraded note, no bundle bullet", async () => {
  setConfig({ injectContextBundle: true });
  // 404 is non-retryable -> no backoff sleeps; readContextBundle degrades.
  fetchImpl = async () => new Response("not found", { status: 404 });
  const { pi, handlers } = makePi();
  installAmbient(pi);
  const ctx = makeCtx(`sess-degraded-${sessionCounter++}`);

  await fireStart(handlers, ctx);
  const prompt = await fireBeforeStart(handlers, ctx);
  match(prompt, /startup context unavailable/);
  ok(
    !prompt.includes("Context Bundle is injected above"),
    "no bundle bullet when degraded",
  );
  match(prompt, /## Nowledge Mem Guidance/);
});

test("mid-session config flip does not affect the current session (next-session semantics)", async () => {
  setConfig({ injectContextBundle: false });
  const { pi, handlers } = makePi();
  installAmbient(pi);
  const ctx = makeCtx(`sess-flip-${sessionCounter++}`);

  await fireStart(handlers, ctx); // snapshot taken: off
  setConfig({ injectContextBundle: true }); // flip mid-session

  const prompt = await fireBeforeStart(handlers, ctx);
  strictEqual(
    fetchCalls,
    0,
    "snapshot stays off; no fetch despite the config flip",
  );
  ok(
    !prompt.includes("## Nowledge Mem Context Bundle"),
    "bundle still off this session",
  );
});

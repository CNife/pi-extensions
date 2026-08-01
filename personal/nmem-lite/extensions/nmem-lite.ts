/**
 * nmem-lite — PI extension for ambient nmem thread sync + lean guidance.
 *
 * Personal-layer replacement for @cnife/pi-nmem on this machine:
 *   1. Ambient sync — auto-sync PI sessions as nmem threads (REST, no CLI)
 *   2. Guidance     — inject a compact Nowledge Mem capability hint into systemPrompt
 *
 * NOT in scope (vs packages/nmem): custom tools, /nmem-config, Context Bundle
 * auto-injection, plugin config file. Recall/save go through the official
 * `nmem` CLI via the search-memory / distill-memory skills.
 *
 * Ported from @cnife/pi-nmem (packages/nmem/ambient.ts + client.ts), same
 * lineage as the OMP-side nmem-sync plugin. Backend config:
 * ~/.nowledge-mem/config.json + NMEM_API_URL / NMEM_API_KEY env vars.
 *
 * 与 spec 的两处偏差（有意为之，记录如下）：
 * 1. package.json 的 pi.extensions 指向 ./extensions/nmem-lite.ts 而非
 *    ./extensions 目录：personal 层 auto-discover 会把 manifest 声明的路径
 *    原样交给 jiti 加载，目录条目只有在含 index.ts 时才能解析（advisor-adapter
 *    因此可用）；文件条目保留 spec 指定的入口文件名 nmem-lite.ts。
 * 2. 引导为一条精简段落 + 触发要点（与 OMP 侧 nmem-sync 同构），非字面一行；
 *    US6 的"一行提示"指能力引导本身而非完整 Context Bundle 注入。
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename } from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";

// ============================================================================
// Config (inlined from client.ts — slimmed: apiUrl + apiKey only)
// ============================================================================

const DEFAULT_API_URL = "http://127.0.0.1:14242";
const CONFIG_PATH = `${homedir()}/.nowledge-mem/config.json`;

type JsonObject = Record<string, unknown>;

interface NmemConfig {
  apiUrl: string;
  apiKey?: string;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value.trim() || undefined : undefined;
}

function readSharedConfig(): JsonObject {
  try {
    if (!existsSync(CONFIG_PATH)) return {};
    const parsed = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as JsonObject)
      : {};
  } catch (error) {
    console.warn(
      `[nmem-lite] failed to read ${CONFIG_PATH}: ${error instanceof Error ? error.message : error}; using defaults`,
    );
    return {};
  }
}

/** Priority: env > config.json > default. */
function resolveConfig(): NmemConfig {
  const config = readSharedConfig();
  const apiUrl = (
    process.env.NMEM_API_URL?.trim() ||
    stringValue(config.apiUrl) ||
    stringValue(config.api_url) ||
    DEFAULT_API_URL
  ).replace(/\/+$/, "");
  const apiKey =
    process.env.NMEM_API_KEY?.trim() ||
    stringValue(config.apiKey) ||
    stringValue(config.api_key);
  return { apiUrl, ...(apiKey ? { apiKey } : {}) };
}

// ============================================================================
// REST client + retry (inlined from client.ts)
// ============================================================================

const DEFAULT_TIMEOUT_MS = 8_000;
const MAX_RETRIES = 2;
const BACKOFF_BASE_MS = 500;
const BACKOFF_CAP_MS = 4_000;

type NmemErrorCode =
  | "timeout"
  | "backend_unreachable"
  | "unauthorized"
  | "not_found"
  | "bad_request"
  | "server_error";

class NmemError extends Error {
  readonly code: NmemErrorCode;
  readonly status?: number;

  constructor(code: NmemErrorCode, detail: string, status?: number) {
    super(`[${code}] ${detail}`);
    this.name = "NmemError";
    this.code = code;
    this.status = status;
  }
}

function mapStatus(status: number): NmemErrorCode {
  if (status === 401) return "unauthorized";
  if (status === 404) return "not_found";
  if (status === 400 || status === 422) return "bad_request";
  return "server_error";
}

function isRetryable(code: NmemErrorCode): boolean {
  return (
    code === "timeout" ||
    code === "backend_unreachable" ||
    code === "server_error"
  );
}

function backoffMs(attempt: number): number {
  const ceiling = Math.min(BACKOFF_BASE_MS * 2 ** attempt, BACKOFF_CAP_MS);
  return Math.floor(Math.random() * ceiling);
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt >= MAX_RETRIES) break;
      const code = error instanceof NmemError ? error.code : undefined;
      if (!code || !isRetryable(code)) break;
      await defaultSleep(backoffMs(attempt));
    }
  }
  throw lastError;
}

function buildUrl(
  apiUrl: string,
  path: string,
  query?: Record<string, string | number | undefined>,
): string {
  let url = `${apiUrl}${path}`;
  if (query) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) params.set(key, String(value));
    }
    const qs = params.toString();
    if (qs) url += `?${qs}`;
  }
  return url;
}

async function parseErrorDetail(response: Response): Promise<string> {
  const text = await response.text();
  try {
    const parsed = JSON.parse(text) as JsonObject;
    const detail = stringValue(parsed.detail);
    if (detail) return detail;
    return text || `HTTP ${response.status}`;
  } catch {
    return text || `HTTP ${response.status}`;
  }
}

/**
 * Shared REST base: one fetch with timeout, structured error mapping, body
 * parsing. Retries transient faults (timeout / backend_unreachable / 5xx).
 * Throws NmemError on any non-2xx or network failure; returns parsed JSON.
 */
async function nmemRequest<T = unknown>(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
): Promise<T> {
  const config = resolveConfig();
  const url = buildUrl(config.apiUrl, path);
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (config.apiKey) {
    headers.Authorization = `Bearer ${config.apiKey}`;
    headers["X-NMEM-API-Key"] = config.apiKey;
  }
  const serialized = body !== undefined ? JSON.stringify(body) : undefined;
  const timeoutMs = DEFAULT_TIMEOUT_MS;

  const doFetch = async (): Promise<T> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: serialized,
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new NmemError("timeout", `request aborted after ${timeoutMs}ms`);
      }
      throw new NmemError(
        "backend_unreachable",
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) {
      const detail = await parseErrorDetail(response);
      throw new NmemError(mapStatus(response.status), detail, response.status);
    }
    return (await response.json()) as T;
  };

  return withRetry(doFetch);
}

// ============================================================================
// Ambient sync (ported from ambient.ts — sync half only)
// ============================================================================

const MAX_MESSAGE_CHARS = 20_000;
const FLUSH_DELAY_MS = 750;
// tool_version 随 POST /threads 上报后端并持久化（见 packages/nmem r3）。
// source 固定为 "pi"（#78 决策：thread_id 的 pi- 前缀跨 nowledge-mem-pi →
// pi-nmem → pi-nmem-lite 保持稳定，改动会破坏既有线程连续性）；tool_version
// 是唯一区分点，带插件名前缀以标识来源版本。
const DEFAULT_PLUGIN_VERSION = "pi-nmem-lite/0.1.0";

// --- Source identity ---

function sourceApp(): string {
  // Spec #78: source_app is fixed to "pi" so thread_id (pi- prefix) stays
  // stable across the nowledge-mem-pi -> pi-nmem -> pi-nmem-lite lineage.
  // An env override would change the prefix and break existing threads.
  return "pi";
}

function hostLabel(): string {
  return process.env.NMEM_PLUGIN_HOST_LABEL?.trim() || "Pi";
}

function pluginVersion(): string {
  return process.env.NMEM_PLUGIN_VERSION?.trim() || DEFAULT_PLUGIN_VERSION;
}

// --- Types ---

interface ThreadMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp?: string;
  metadata?: Record<string, unknown>;
}

interface SyncState {
  created?: boolean;
  lastSyncedCount?: number;
  lastError?: string;
  inFlight?: Promise<void>;
  pending?: boolean;
  timer?: ReturnType<typeof setTimeout>;
}

interface SyncPayload {
  threadId: string;
  sessionId: string;
  messages: ThreadMessage[];
  body: JsonObject;
}

interface SessionManagerLike {
  getBranch?: () => JsonObject[];
  getEntries?: () => JsonObject[];
  getSessionId?: () => string;
  getSessionFile?: () => string | undefined;
  getSessionName?: () => string | undefined;
  getCwd?: () => string;
}

// --- Module state ---

const syncStates = new Map<string, SyncState>();
const syncNotifyWarnings = new Set<string>();

// --- Text helpers ---

function truncate(text: string): string {
  if (text.length <= MAX_MESSAGE_CHARS) return text;
  return `${text.slice(0, MAX_MESSAGE_CHARS)}\n\n[${hostLabel()} message truncated by nmem sync]`;
}

function partToText(part: unknown): string {
  if (typeof part === "string") return part;
  if (!part || typeof part !== "object") return "";
  const value = part as JsonObject;
  const type = stringValue(value.type) || "part";
  if (type === "text") {
    return stringValue(value.text) || stringValue(value.content) || "";
  }
  if (type === "image") return "[Image]";
  if (type === "toolUse" || type === "tool" || type === "toolCall") {
    const name = stringValue(value.name) || stringValue(value.tool) || "tool";
    return `[Tool: ${name}]`;
  }
  if (type === "file") {
    const label =
      stringValue(value.filename) || stringValue(value.path) || "attachment";
    return `[File: ${label}]`;
  }
  const text = stringValue(value.text) || stringValue(value.content);
  return text || `[${type}]`;
}

function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map(partToText).filter(Boolean).join("\n");
  }
  if (content && typeof content === "object") return partToText(content);
  return "";
}

function messageToText(message: JsonObject): string {
  const role = stringValue(message.role);
  if (role === "bashExecution") {
    const command = stringValue(message.command) || "";
    const output = stringValue(message.output) || "(no output)";
    const exitCode = message.exitCode;
    const suffix =
      typeof exitCode === "number" && exitCode !== 0
        ? `\n\nCommand exited with code ${exitCode}`
        : "";
    return `Ran \`${command}\`\n\`\`\`\n${output}\n\`\`\`${suffix}`;
  }
  if (role === "branchSummary") {
    return `${hostLabel()} branch summary:\n${stringValue(message.summary) || ""}`;
  }
  if (role === "compactionSummary") {
    return `${hostLabel()} compaction summary:\n${stringValue(message.summary) || ""}`;
  }
  return contentToText(message.content);
}

function normalizeRole(
  role: unknown,
): "user" | "assistant" | "system" | undefined {
  if (role === "user" || role === "bashExecution") return "user";
  if (
    role === "assistant" ||
    role === "toolResult" ||
    role === "branchSummary" ||
    role === "compactionSummary"
  ) {
    return "assistant";
  }
  return undefined;
}

function buildEntryMetadata(
  entry: JsonObject,
  index: number,
  ambient: JsonObject,
): JsonObject {
  return {
    external_id: `${sourceApp()}-entry-${stringValue(entry.id) || index}`,
    pi_entry_id: stringValue(entry.id),
    pi_entry_type: entry.type,
    ...ambient,
  };
}

function entryToMessage(
  entry: JsonObject,
  index: number,
  ambient: JsonObject,
): ThreadMessage | undefined {
  if (entry.type === "message") {
    const message = entry.message;
    if (!message || typeof message !== "object") return undefined;
    const msg = message as JsonObject;
    if (msg.role === "custom") return undefined;
    const role = normalizeRole(msg.role);
    if (!role) return undefined;
    const content = truncate(messageToText(msg).trim());
    if (!content) return undefined;
    return {
      role,
      content,
      timestamp: stringValue(entry.timestamp),
      metadata: {
        ...buildEntryMetadata(entry, index, ambient),
        pi_message_role: stringValue(msg.role),
      },
    };
  }

  if (entry.type === "custom_message") {
    const content = truncate(contentToText(entry.content).trim());
    if (!content) return undefined;
    return {
      role: "user",
      content: `${hostLabel()} custom context${stringValue(entry.customType) ? ` (${stringValue(entry.customType)})` : ""}:\n${content}`,
      timestamp: stringValue(entry.timestamp),
      metadata: {
        ...buildEntryMetadata(entry, index, ambient),
        pi_custom_type: stringValue(entry.customType),
        pi_custom_display:
          typeof entry.display === "boolean" ? entry.display : undefined,
      },
    };
  }

  if (entry.type === "compaction" || entry.type === "branch_summary") {
    const label =
      entry.type === "compaction"
        ? `${hostLabel()} compaction summary`
        : `${hostLabel()} branch summary`;
    const content = truncate(
      `${label}:\n${stringValue(entry.summary) || ""}`.trim(),
    );
    if (!content) return undefined;
    return {
      role: "assistant",
      content,
      timestamp: stringValue(entry.timestamp),
      metadata: buildEntryMetadata(entry, index, ambient),
    };
  }

  return undefined;
}

function buildMessages(ctx: ExtensionContext): ThreadMessage[] {
  const ambient: JsonObject = { source_app: sourceApp() };
  const manager = ctx.sessionManager as unknown as SessionManagerLike;
  const entries =
    typeof manager.getBranch === "function"
      ? manager.getBranch()
      : manager.getEntries?.() || [];
  return entries
    .map((entry, index) => entryToMessage(entry, index, ambient))
    .filter((msg): msg is ThreadMessage => !!msg);
}

function sessionId(ctx: ExtensionContext): string {
  const manager = ctx.sessionManager as unknown as SessionManagerLike;
  const id = manager.getSessionId?.();
  if (id) return id;
  const file = manager.getSessionFile?.();
  if (file) return basename(file).replace(/\.jsonl$/i, "");
  return "unknown";
}

function threadIdFor(ctx: ExtensionContext): string {
  return `${sourceApp()}-${sessionId(ctx)}`
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-");
}

function buildTitle(ctx: ExtensionContext, messages: ThreadMessage[]): string {
  const manager = ctx.sessionManager as unknown as SessionManagerLike;
  const name = manager.getSessionName?.()?.trim();
  if (name) return name;
  const firstUser = messages.find((msg) => msg.role === "user")?.content.trim();
  if (firstUser) return firstUser.slice(0, 120);
  const cwd = manager.getCwd?.();
  return cwd
    ? `${hostLabel()} session - ${basename(cwd)}`
    : `${hostLabel()} session`;
}

function shouldSync(messages: ThreadMessage[]): boolean {
  return (
    messages.some((msg) => msg.role === "user") &&
    messages.some((msg) => msg.role === "assistant")
  );
}

// --- Sync helpers ---

/**
 * Non-throwing POST: delegates to nmemRequest (retries transient faults) and
 * flattens any NmemError into {ok:false} so the caller never sees a throw.
 * POST /threads and /threads/{id}/append are idempotent (409 fallback /
 * idempotency_key), so retry is safe here.
 */
async function postJson(
  path: string,
  body: JsonObject,
): Promise<{ ok: boolean; status: number; data: unknown }> {
  try {
    const data = await nmemRequest("POST", path, body);
    return { ok: true, status: 200, data };
  } catch (error) {
    if (error instanceof NmemError) {
      return {
        ok: false,
        status: error.status ?? 0,
        data: { detail: error.message },
      };
    }
    return {
      ok: false,
      status: 0,
      data: { error: error instanceof Error ? error.message : String(error) },
    };
  }
}

function isThreadNotFound(result: { status: number; data: unknown }): boolean {
  if (result.status === 404) return true;
  const text = JSON.stringify(result.data).toLowerCase();
  return text.includes("thread not found");
}

function notifySyncError(ctx: ExtensionContext, message: string): void {
  if (syncNotifyWarnings.has(message)) return;
  syncNotifyWarnings.add(message);
  if (ctx.hasUI) {
    ctx.ui.notify(message, "warning");
  } else {
    console.warn(message);
  }
}

function buildSyncPayload(
  ctx: ExtensionContext,
  reason: string,
): SyncPayload | undefined {
  const messages = buildMessages(ctx);
  if (!shouldSync(messages)) return undefined;

  const threadId = threadIdFor(ctx);
  const id = sessionId(ctx);
  const manager = ctx.sessionManager as unknown as SessionManagerLike;
  const body: JsonObject = {
    thread_id: threadId,
    title: buildTitle(ctx, messages),
    messages,
    source: sourceApp(),
    project: manager.getCwd?.(),
    tool_version: pluginVersion(),
    metadata: {
      pi_session_id: id,
      pi_session_file: manager.getSessionFile?.(),
      sync_reason: reason,
    },
  };
  return { threadId, sessionId: id, messages, body };
}

async function flushOnce(
  ctx: ExtensionContext,
  payload: SyncPayload,
  state: SyncState,
): Promise<void> {
  let result = state.created
    ? { ok: false, status: 409, data: { detail: "append existing thread" } }
    : await postJson("/threads", payload.body);
  if (result.ok) {
    state.created = true;
    state.lastSyncedCount = payload.messages.length;
    state.lastError = undefined;
    return;
  }

  // Two-phase: POST /threads creates; on 2nd+ sync, append with dedup.
  result = await postJson(
    `/threads/${encodeURIComponent(payload.threadId)}/append`,
    {
      messages: payload.messages,
      deduplicate: true,
      idempotency_key: `${sourceApp()}:${payload.sessionId}:${payload.messages.length}`,
    },
  );
  if (!result.ok && state.created && isThreadNotFound(result)) {
    // Thread was deleted out-of-band; recreate.
    state.created = false;
    result = await postJson("/threads", payload.body);
  }
  if (!result.ok) {
    const detail = JSON.stringify(result.data);
    state.lastError = `${hostLabel()} thread sync failed (${result.status}): ${detail}`;
    notifySyncError(ctx, state.lastError);
    return;
  }
  state.created = true;
  state.lastSyncedCount = payload.messages.length;
  state.lastError = undefined;
}

async function flushPayload(
  ctx: ExtensionContext,
  payload: SyncPayload,
): Promise<void> {
  const key = payload.threadId;
  const state = syncStates.get(key) || {};
  syncStates.set(key, state);
  if (state.inFlight) {
    state.pending = true;
    await state.inFlight;
    return;
  }
  do {
    state.pending = false;
    state.inFlight = flushOnce(ctx, payload, state).finally(() => {
      state.inFlight = undefined;
    });
    await state.inFlight;
  } while (state.pending);
}

async function flush(ctx: ExtensionContext, reason: string): Promise<void> {
  const payload = buildSyncPayload(ctx, reason);
  if (!payload) return;
  await flushPayload(ctx, payload);
}

/** Debounced flush (agent_end) so consecutive operations don't fragment threads. */
function scheduleFlush(ctx: ExtensionContext, reason: string): void {
  const payload = buildSyncPayload(ctx, reason);
  if (!payload) return;
  const key = payload.threadId;
  const state = syncStates.get(key) || {};
  syncStates.set(key, state);
  if (state.timer) clearTimeout(state.timer);
  state.timer = setTimeout(() => {
    state.timer = undefined;
    void flushPayload(ctx, payload).catch(() => {});
  }, FLUSH_DELAY_MS);
}

// ============================================================================
// Guidance injection (lean: no Context Bundle, no tool list)
// ============================================================================

function startupGuidance(): string {
  return [
    "## Nowledge Mem Guidance",
    "",
    "Nowledge Mem is available through the installed skills and the `nmem` CLI. Use it when past context would make the work better. This extension automatically syncs your conversation as a thread; you need not save conversation history manually.",
    "",
    "- Search memory when the task resumes prior work, mentions an earlier decision, or would benefit from the user's established preferences and procedures.",
    "- Search threads when the user asks about a previous conversation or when a memory points back to source conversation history.",
    "- Save or update durable decisions, preferences, plans, procedures, learnings, events, or important context. Search first; keep one strong memory rather than several weak duplicates.",
    "- Create an explicit handoff thread only when the user asks for a checkpoint. The extension already syncs completed conversation history automatically.",
    "- Keep provenance as `source_app=pi`. Use `NMEM_AGENT_ID` only when this process is intentionally running as a named Nowledge AI Identity.",
    "",
  ].join("\n");
}

// ============================================================================
// Extension entry
// ============================================================================

export default function nmemLite(pi: ExtensionAPI): void {
  pi.on("before_agent_start", async (event) => {
    return { systemPrompt: `${event.systemPrompt}\n\n${startupGuidance()}` };
  });

  pi.on("agent_end", async (_event, ctx) => {
    scheduleFlush(ctx, "agent_end");
  });

  pi.on("session_before_compact", async (_event, ctx) => {
    await flush(ctx, "session_before_compact");
  });

  pi.on("session_before_switch", async (event, ctx) => {
    await flush(ctx, event.reason === "new" ? "session_new" : "session_resume");
  });

  pi.on("session_shutdown", async (event, ctx) => {
    await flush(ctx, `session_shutdown:${event.reason}`);
  });
}

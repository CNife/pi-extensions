/**
 * nmem REST client - deep module.
 *
 * Encapsulates nmem backend REST calls, config resolution, response shaping,
 * and structured errors. Three concerns, one module:
 *   1. resolveConfig - slimmed config (apiUrl/apiKey only)
 *   2. nmemRequest   - shared REST base (8s timeout, 6 error codes, retry transient faults, throw)
 *   3. shaping       - per-tool response shaping (nmemSearch/nmemReadThread/nmemListThreads/nmemSaveMemory)
 *
 * Two-layer separation (mirrors execute-python kernel.ts):
 *   1. This module: pure REST + shaping, knows nothing of TUI/LLM.
 *   2. Extension entry (extensions/nmem.ts): defineTool + registerTool +
 *      promptGuidelines, delegates here.
 *
 * Errors: pi custom tools convert a throw from execute into isError:true
 * (reported to LLM, session continues); a return is always isError:false.
 * So every error here throws NmemError - never returns a structured error.
 *
 * 6 error codes (do not depend on body format):
 *   timeout              request aborted (exceeded per-request timeout)
 *   backend_unreachable  fetch throw: connection refused / DNS / disconnect
 *   unauthorized         401
 *   not_found            404
 *   bad_request          400 and 422 (422 body is text/plain, not JSON)
 *   server_error         5xx and any unmapped status
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";

// ============================================================================
// Config
// ============================================================================

const DEFAULT_API_URL = "http://127.0.0.1:14242";
const CONFIG_PATH = `${homedir()}/.nowledge-mem/config.json`;

// Per-request timeout / retry defaults. nmemRequest callers (tools + ambient
// sync) do not tune retry parameters (count/backoff) - they only opt out of
// retry for non-idempotent calls (nmemSaveMemory create) and raise the timeout
// to absorb cold starts. The retry knobs themselves live on withRetry's opts,
// exposed only so the pure retry loop can be unit-tested in isolation.
const DEFAULT_TIMEOUT_MS = 8_000;
const CREATE_MEMORY_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 2;
const BACKOFF_BASE_MS = 500;
const BACKOFF_CAP_MS = 4_000;

export interface NmemConfig {
  apiUrl: string;
  apiKey?: string;
}

type JsonObject = Record<string, unknown>;

function readSharedConfig(): JsonObject {
  try {
    if (!existsSync(CONFIG_PATH)) return {};
    const parsed = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as JsonObject)
      : {};
  } catch (error) {
    console.warn(
      `[nmem] failed to read ${CONFIG_PATH}: ${error instanceof Error ? error.message : error}; using defaults`,
    );
    return {};
  }
}

export function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value.trim() || undefined : undefined;
}

/**
 * Slimmed config: only apiUrl + apiKey. Priority env > config.json > default.
 * Silently ignores space/agentId/hostAgentId keys (v1 does not touch space).
 */
export function resolveConfig(): NmemConfig {
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
// Errors
// ============================================================================

export type NmemErrorCode =
  | "timeout"
  | "backend_unreachable"
  | "unauthorized"
  | "not_found"
  | "bad_request"
  | "server_error";

const ERROR_HINTS: Record<NmemErrorCode, string> = {
  timeout:
    "The request took too long; the backend may be cold-starting or overloaded.",
  backend_unreachable:
    "Check that the nmem backend is running and apiUrl is correct.",
  unauthorized: "Verify apiKey in ~/.nowledge-mem/config.json or NMEM_API_KEY.",
  not_found: "The requested resource does not exist.",
  bad_request: "Check request parameters.",
  server_error: "Backend error, retry later.",
};

export class NmemError extends Error {
  readonly code: NmemErrorCode;
  /** HTTP status that produced this error, if any (undefined for timeout / backend_unreachable). */
  readonly status?: number;

  constructor(code: NmemErrorCode, detail: string, status?: number) {
    super(`[${code}] ${detail}. ${ERROR_HINTS[code]}`);
    this.name = "NmemError";
    this.code = code;
    this.status = status;
  }
}

/**
 * Maps HTTP status to NmemErrorCode. Exported for direct unit coverage of
 * 401/5xx, which the real nmem backend cannot trigger locally.
 */
export function mapStatus(status: number): NmemErrorCode {
  if (status === 401) return "unauthorized";
  if (status === 404) return "not_found";
  if (status === 400 || status === 422) return "bad_request";
  if (status >= 500) return "server_error";
  return "server_error";
}

// ============================================================================
// Retry (pure, exported for unit testing)
// ============================================================================

/**
 * Whether a structured error code is a transient fault worth retrying. Only
 * timeout / backend_unreachable / server_error (5xx) retry; client errors
 * (401 / 404 / 400 / 422) fail fast.
 */
export function isRetryable(code: NmemErrorCode): boolean {
  return (
    code === "timeout" ||
    code === "backend_unreachable" ||
    code === "server_error"
  );
}

/**
 * Exponential backoff with full jitter: a uniform sample in [0, cap], where
 * cap = min(baseMs * 2^attempt, capMs). Pure given `rand` (defaults to
 * Math.random); tests inject a deterministic rand.
 */
export function backoffMs(
  attempt: number,
  baseMs: number = BACKOFF_BASE_MS,
  capMs: number = BACKOFF_CAP_MS,
  rand: () => number = Math.random,
): number {
  const ceiling = Math.min(baseMs * 2 ** attempt, capMs);
  return Math.floor(rand() * ceiling);
}

/**
 * Tunables for withRetry. nmemRequest never sets these (it uses the defaults
 * above); they are exposed so retry.test.ts can inject deterministic sleep /
 * rand and exercise retry-count / backoff edges without a backend.
 */
export interface WithRetryOptions {
  /** Max retries (default 2 = 3 total attempts). */
  retries?: number;
  /** Backoff base ms (default 500). */
  baseMs?: number;
  /** Backoff cap ms (default 4000). */
  capMs?: number;
  /** Sleep between retries; tests inject a no-op or recording fake. */
  sleep?: (ms: number) => Promise<void>;
  /** Random source for jitter; tests inject a constant for determinism. */
  rand?: () => number;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry a fn that throws NmemError. Retries only transient codes
 * (isRetryable), backs off with full jitter between attempts, and rethrows
 * the last error when retries are exhausted or a non-retryable error hits.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: WithRetryOptions = {},
): Promise<T> {
  const retries = opts.retries ?? MAX_RETRIES;
  const baseMs = opts.baseMs ?? BACKOFF_BASE_MS;
  const capMs = opts.capMs ?? BACKOFF_CAP_MS;
  const sleep = opts.sleep ?? defaultSleep;
  const rand = opts.rand ?? Math.random;
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt >= retries) break;
      const code = error instanceof NmemError ? error.code : undefined;
      if (!code || !isRetryable(code)) break;
      await sleep(backoffMs(attempt, baseMs, capMs, rand));
    }
  }
  throw lastError;
}

// ============================================================================
// Shared REST base
// ============================================================================

export interface NmemRequestOptions {
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  config?: NmemConfig;
  /** Per-request timeout (default 8s). Raised to 30s for memory create (#83). */
  timeoutMs?: number;
  /** Retry transient errors (default true). Set false for non-idempotent calls (memory create). */
  retry?: boolean;
}

/**
 * Shared REST base: one fetch with 8s (or overridden) timeout, structured
 * error mapping, body parsing (JSON, falling back to raw text). Retries
 * transient faults (timeout / backend_unreachable / 5xx) by default; callers
 * opt out for non-idempotent calls. Throws NmemError on any non-2xx or
 * network failure; returns parsed JSON on success.
 */
export async function nmemRequest<T = unknown>(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  options: NmemRequestOptions = {},
): Promise<T> {
  const config = options.config ?? resolveConfig();
  const url = buildUrl(config.apiUrl, path, options.query);
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (config.apiKey) {
    headers.Authorization = `Bearer ${config.apiKey}`;
    headers["X-NMEM-API-Key"] = config.apiKey;
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const body =
    options.body !== undefined ? JSON.stringify(options.body) : undefined;

  // One attempt with its own timeout. The timeout-vs-network split lets
  // callers (and retry) tell cold-start aborts (#83) apart from unreachable
  // hosts (user story 7). Each retry gets a fresh timeout (not increasing).
  const doFetch = async (): Promise<T> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body,
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

  return options.retry === false ? doFetch() : withRetry(doFetch);
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

// ============================================================================
// nmemSearch
// ============================================================================

export type SearchKind = "memories" | "threads";

export interface MemoryHit {
  id: string;
  title: string;
  content: string;
  score: number;
  importance: number;
  unit_type: string;
  created_at: string;
}

export interface MemoriesSearchResult {
  returned: number;
  memories: MemoryHit[];
  note?: string;
}

export interface ThreadHit {
  id: string;
  title: string;
  message_count: number;
  matches: number;
}

export interface ThreadsSearchResult {
  total: number;
  threads: ThreadHit[];
  note?: string;
}

// Raw REST shapes (subset of fields actually consumed).
interface RawMemorySearchHit {
  memory?: JsonObject;
  similarity_score?: number;
}
interface RawThreadsSearchResponse {
  threads?: Array<{
    thread_id?: string;
    title?: string;
    message_count?: number;
    total_matches?: number;
  }>;
  total_found?: number;
}

/**
 * Search memories (default) or threads. Shapes the raw REST response into a
 * slim, token-efficient structure (no labels, no debug metadata).
 */
export async function nmemSearch(
  query: string,
  kind: SearchKind = "memories",
  limit = 10,
): Promise<MemoriesSearchResult | ThreadsSearchResult> {
  if (kind === "threads") {
    const data = await nmemRequest<RawThreadsSearchResponse>(
      "GET",
      "/threads/search",
      { query: { query, limit } },
    );
    const threads = (data.threads ?? []).map((t) => ({
      id: String(t.thread_id ?? ""),
      title: String(t.title ?? ""),
      message_count: Number(t.message_count ?? 0),
      matches: Number(t.total_matches ?? 0),
    }));
    if (threads.length === 0) {
      return {
        total: data.total_found ?? 0,
        threads,
        note: `0 results for '${query}'`,
      };
    }
    return { total: data.total_found ?? 0, threads };
  }

  const data = await nmemRequest<RawMemorySearchHit[]>(
    "POST",
    "/memories/search",
    {
      body: { query, limit },
    },
  );
  const memories = (data ?? []).map((hit) => {
    const memory = (hit.memory ?? {}) as JsonObject;
    return {
      id: String(memory.id ?? ""),
      title: String(memory.title ?? ""),
      content: String(memory.content ?? ""),
      score: Number(hit.similarity_score ?? 0),
      importance: Number(memory.importance ?? 0),
      unit_type: String(memory.unit_type ?? ""),
      created_at: String(memory.created_at ?? ""),
    };
  });
  if (memories.length === 0) {
    return { returned: 0, memories, note: `0 results for '${query}'` };
  }
  return { returned: memories.length, memories };
}

/** Format the paging hint shared by nmemReadThread and nmemListThreads. */
function formatPagingHint(opts: {
  total: number;
  remaining: number;
  nextOffset: number;
  hasMore: boolean;
}): string {
  if (!opts.hasMore) return `no more · ${opts.total} total`;
  if (opts.remaining > 0)
    return `${opts.remaining} more · offset ${opts.nextOffset}`;
  return `more · offset ${opts.nextOffset}`;
}

// ============================================================================
// nmemReadThread
// ============================================================================

export interface ThreadMessage {
  index: number;
  role: string;
  content: string;
  timestamp: string;
}

export interface ReadThreadResult {
  title: string;
  total_messages: number;
  offset: number;
  returned: number;
  messages: ThreadMessage[];
  hint: string;
  note?: string;
}

// Raw REST shape for thread detail endpoint.
interface RawThreadMessage {
  order_index?: number;
  role?: string;
  content?: string;
  timestamp?: string;
}
interface RawThreadResponse {
  thread?: {
    id?: string;
    title?: string;
    source?: string;
    space_id?: string;
    message_count?: number;
  };
  total_messages?: number;
  messages?: RawThreadMessage[];
}

/**
 * Read a thread's messages with character-length budget segmentation.
 *
 * Fetches messages batched (limit=10) starting at `offset`, accumulating whole
 * messages until the next message would exceed ~8000 total characters.
 * Always returns at least one message per page for forward progress.
 */
export async function nmemReadThread(
  threadId: string,
  offset = 0,
): Promise<ReadThreadResult> {
  const BUDGET = 8000;
  const LIMIT = 10;
  let currentOffset = offset;
  const messages: ThreadMessage[] = [];
  let totalChars = 0;
  let title = "";
  let totalMessages = 0;

  for (;;) {
    const data = await nmemRequest<RawThreadResponse>(
      "GET",
      `/threads/${encodeURIComponent(threadId)}`,
      { query: { offset: currentOffset, limit: LIMIT } },
    );

    const thread = data.thread ?? {};
    title = String(thread.title ?? "");
    totalMessages = Number(data.total_messages ?? 0);

    const rawMessages = data.messages ?? [];
    if (rawMessages.length === 0) break;

    let budgetHit = false;

    for (let i = 0; i < rawMessages.length; i++) {
      const raw = rawMessages[i];
      const content = String(raw.content ?? "");
      const contentLen = content.length;

      if (totalChars + contentLen > BUDGET && messages.length > 0) {
        budgetHit = true;
        break;
      }

      // Spec #77: index maps from REST order_index; fall back to the
      // position-relative index within the thread (currentOffset + batch index).
      const index =
        typeof raw.order_index === "number"
          ? raw.order_index
          : currentOffset + i;
      messages.push({
        index,
        role: String(raw.role ?? ""),
        content,
        timestamp: String(raw.timestamp ?? ""),
      });
      totalChars += contentLen;
    }

    currentOffset += rawMessages.length;
    if (budgetHit || rawMessages.length < LIMIT) break;
  }

  if (messages.length === 0 && totalMessages === 0) {
    return {
      title: "",
      total_messages: 0,
      offset,
      returned: 0,
      messages: [],
      hint: "",
      note: "no messages",
    };
  }

  const returned = messages.length;
  const remaining = totalMessages - offset - returned;
  const hint = formatPagingHint({
    total: totalMessages,
    remaining,
    nextOffset: offset + returned,
    hasMore: remaining > 0,
  });

  return {
    title,
    total_messages: totalMessages,
    offset,
    returned,
    messages,
    hint,
  };
}

// ============================================================================
// nmemListThreads
// ============================================================================

export interface ThreadListItem {
  id: string;
  title: string;
  summary: string;
  date: string;
  source: string;
  message_count: number;
}

export interface ThreadListResult {
  returned: number;
  threads: ThreadListItem[];
  total: number;
  has_more: boolean;
  hint: string;
  note?: string;
}

// Raw REST shape for GET /threads (OpenAPI ThreadListResponse).
interface RawThreadListItem {
  id?: string;
  title?: string;
  summary?: string;
  source?: string;
  messages?: number;
  date?: string;
}
interface RawThreadListResponse {
  threads?: RawThreadListItem[];
  pagination?: {
    limit?: number;
    offset?: number;
    total?: number;
    has_more?: boolean;
  };
}

/**
 * List threads by import time (newest first). `date` is the import date
 * (day-grained, e.g. "Jul 18, 2026"), NOT the session start time - use
 * `nmemReadThread`'s `messages[0].timestamp` for precise time splitting.
 * Defensive parsing tolerates field drift, mirroring nmemSearch's discipline.
 */
export async function nmemListThreads(opts?: {
  limit?: number;
  offset?: number;
  source?: string;
}): Promise<ThreadListResult> {
  const limit = opts?.limit ?? 20;
  const offset = opts?.offset ?? 0;
  const data = await nmemRequest<RawThreadListResponse>("GET", "/threads", {
    query: { limit, offset, source: opts?.source },
  });

  const threads = (data.threads ?? []).map((t) => ({
    id: String(t.id ?? ""),
    title: String(t.title ?? ""),
    summary: String(t.summary ?? ""),
    date: String(t.date ?? ""),
    source: String(t.source ?? ""),
    message_count: Number(t.messages ?? 0),
  }));

  const pagination = data.pagination ?? {};
  const total = Number(pagination.total ?? 0);
  const hasMore = Boolean(pagination.has_more ?? false);

  if (threads.length === 0) {
    return {
      returned: 0,
      threads,
      total,
      has_more: hasMore,
      hint: "",
      note: "no synced threads",
    };
  }

  const returned = threads.length;
  const remaining = total - offset - returned;
  const nextOffset = offset + returned;
  const hint = formatPagingHint({ total, remaining, nextOffset, hasMore });

  return {
    returned,
    threads,
    total,
    has_more: hasMore,
    hint,
  };
}

// ============================================================================
// nmemSaveMemory
// ============================================================================

interface RawMemoryResponse {
  id?: string;
  memory?: { id?: string };
}

export interface SavedMemoryResult {
  action: "created" | "updated";
  id: string;
  updated_fields?: string[];
  warnings?: string[];
}

/**
 * Upsert a memory: POST (create) when `id` is empty/missing, PATCH (update)
 * when `id` is non-empty. Labels are create-time init annotation only;
 * PATCH ignores them and emits a warning if non-empty labels were passed.
 * 404 -> throws NmemError("not_found"); 400/422 -> throws "bad_request".
 */
export async function nmemSaveMemory(
  title: string,
  content: string,
  opts?: {
    unit_type?: string;
    importance?: number;
    labels?: string[];
    id?: string;
  },
): Promise<SavedMemoryResult> {
  const id = (opts?.id ?? "").trim();

  if (!id) {
    // POST — create
    const body: Record<string, unknown> = { title, content };
    if (opts?.unit_type !== undefined) body.unit_type = opts.unit_type;
    if (opts?.importance !== undefined) body.importance = opts.importance;
    if (opts?.labels !== undefined && opts.labels.length > 0)
      body.labels = opts.labels;

    // POST /memories is non-idempotent (no idempotency_key per OpenAPI):
    // retrying would duplicate the memory. Opt out of retry and raise the
    // timeout to 30s to absorb synchronous embedding cold start (#83).
    const data = await nmemRequest<RawMemoryResponse>("POST", "/memories", {
      body,
      retry: false,
      timeoutMs: CREATE_MEMORY_TIMEOUT_MS,
    });
    return { action: "created", id: String(data.memory?.id ?? data.id ?? "") };
  }

  // PATCH — update
  const body: Record<string, unknown> = { title, content };
  if (opts?.unit_type !== undefined) body.unit_type = opts.unit_type;
  if (opts?.importance !== undefined) body.importance = opts.importance;
  // labels intentionally omitted on PATCH

  const updatedFields = Object.keys(body);

  const data = await nmemRequest<RawMemoryResponse>(
    "PATCH",
    `/memories/${encodeURIComponent(id)}`,
    { body },
  );

  const result: SavedMemoryResult = {
    action: "updated",
    id: String(data.id ?? id),
    updated_fields: updatedFields,
  };

  if (opts?.labels !== undefined && opts.labels.length > 0) {
    result.warnings = ["labels 未变更，nmem 后端限制"];
  }

  return result;
}

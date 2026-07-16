/**
 * nmem REST client - deep module.
 *
 * Encapsulates nmem backend REST calls, config resolution, response shaping,
 * and structured errors. Three concerns, one module:
 *   1. resolveConfig - slimmed config (apiUrl/apiKey only)
 *   2. nmemRequest   - shared REST base (8s timeout, 5 error codes, throw)
 *   3. nmemSearch    - the search tool (memories/threads shaping)
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
 * 5 error codes by HTTP status (do not depend on body format):
 *   backend_unreachable  fetch throw / status 0 (refused/timeout/DNS/bad URL)
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
const API_TIMEOUT_MS = 8_000;

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

function stringValue(value: unknown): string | undefined {
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
  | "backend_unreachable"
  | "unauthorized"
  | "not_found"
  | "bad_request"
  | "server_error";

const ERROR_HINTS: Record<NmemErrorCode, string> = {
  backend_unreachable:
    "Check that the nmem backend is running and apiUrl is correct.",
  unauthorized: "Verify apiKey in ~/.nowledge-mem/config.json or NMEM_API_KEY.",
  not_found: "The requested resource does not exist.",
  bad_request: "Check request parameters.",
  server_error: "Backend error, retry later.",
};

export class NmemError extends Error {
  readonly code: NmemErrorCode;

  constructor(code: NmemErrorCode, detail: string) {
    super(`[${code}] ${detail}. ${ERROR_HINTS[code]}`);
    this.name = "NmemError";
    this.code = code;
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
// Shared REST base
// ============================================================================

export interface NmemRequestOptions {
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  config?: NmemConfig;
}

/**
 * Shared REST base: one fetch with 8s timeout, structured error mapping,
 * body parsing (JSON, falling back to raw text). Throws NmemError on any
 * non-2xx or network failure; returns parsed JSON on success.
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

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body:
        options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });
  } catch (error) {
    throw new NmemError(
      "backend_unreachable",
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const detail = await parseErrorDetail(response);
    throw new NmemError(mapStatus(response.status), detail);
  }

  return (await response.json()) as T;
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

// ============================================================================
// nmemReadThread
// ============================================================================

export interface ThreadMessage {
  index: number;
  role: string;
  content: string;
}

export interface ReadThreadResult {
  title: string;
  created_at: string;
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
}
interface RawThreadResponse {
  thread?: {
    id?: string;
    title?: string;
    created_at?: string;
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
  let createdAt = "";
  let totalMessages = 0;

  for (;;) {
    const data = await nmemRequest<RawThreadResponse>(
      "GET",
      `/threads/${encodeURIComponent(threadId)}`,
      { query: { offset: currentOffset, limit: LIMIT } },
    );

    const thread = data.thread ?? {};
    title = String(thread.title ?? "");
    createdAt = String(thread.created_at ?? "");
    totalMessages = Number(data.total_messages ?? 0);

    const rawMessages = data.messages ?? [];
    if (rawMessages.length === 0) break;

    let budgetHit = false;

    for (const raw of rawMessages) {
      const content = String(raw.content ?? "");
      const contentLen = content.length;

      if (totalChars + contentLen > BUDGET && messages.length > 0) {
        budgetHit = true;
        break;
      }

      messages.push({
        index: currentOffset + messages.length,
        role: String(raw.role ?? ""),
        content,
      });
      totalChars += contentLen;
    }

    currentOffset += rawMessages.length;
    if (budgetHit || rawMessages.length < LIMIT) break;
  }

  if (messages.length === 0 && totalMessages === 0) {
    return {
      title: "",
      created_at: "",
      total_messages: 0,
      offset,
      returned: 0,
      messages: [],
      hint: "",
      note: "该线程无消息",
    };
  }

  const returned = messages.length;
  const remaining = totalMessages - offset - returned;
  const hint =
    remaining <= 0
      ? `已到末尾（共 ${totalMessages} 条）`
      : `还有 ${remaining} 条未读，offset=${offset + returned} 继续`;

  return {
    title,
    created_at: createdAt,
    total_messages: totalMessages,
    offset,
    returned,
    messages,
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

    const data = await nmemRequest<RawMemoryResponse>("POST", "/memories", {
      body,
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

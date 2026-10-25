/**
 * nmem-lite REST 传输 — config 解析 + 带 retry/backoff/超时的 fetch 基座。
 *
 * Ported from @cnife/pi-nmem (client.ts) / OMP plugins/nmem/extensions/rest.ts。
 * Backend config: ~/.nowledge-mem/config.json + NMEM_API_URL / NMEM_API_KEY env vars.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";

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

async function withRetry<T>(
  fn: () => Promise<T>,
  retries: number = MAX_RETRIES,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt >= retries) break;
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

/** 每次调用的传输覆盖参数。`timeoutMs` / `retries` 供必须落在预算内的
 *  调用方使用（见 session-sync 的前台 flush）。`fetch` 是测试注入点。 */
export interface NmemRequestOptions {
  fetch?: typeof fetch;
  timeoutMs?: number;
  retries?: number;
}

/**
 * Shared REST base: one fetch with timeout, structured error mapping, body
 * parsing. Retries transient faults (timeout / backend_unreachable / 5xx).
 * Throws NmemError on any non-2xx or network failure; returns parsed JSON.
 */
export async function nmemRequest<T = unknown>(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
  options?: NmemRequestOptions,
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
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const doFetch = async (): Promise<T> => {
    const fetchImpl = options?.fetch ?? fetch;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let response: Response;
      try {
        response = await fetchImpl(url, {
          method,
          headers,
          body: serialized,
          signal: controller.signal,
        });
      } catch (error) {
        if (controller.signal.aborted) {
          throw new NmemError(
            "timeout",
            `request aborted after ${timeoutMs}ms`,
          );
        }
        throw new NmemError(
          "backend_unreachable",
          error instanceof Error ? error.message : String(error),
        );
      }
      if (!response.ok) {
        const detail = await parseErrorDetail(response);
        throw new NmemError(
          mapStatus(response.status),
          detail,
          response.status,
        );
      }
      return (await response.json()) as T;
    } catch (error) {
      // 超时预算覆盖到正文读完：后端先回头、后慢发正文时同样在 timeoutMs 处中止
      if (controller.signal.aborted && !(error instanceof NmemError)) {
        throw new NmemError("timeout", `request aborted after ${timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  };

  return withRetry(doFetch, options?.retries ?? MAX_RETRIES);
}

export { NmemError };

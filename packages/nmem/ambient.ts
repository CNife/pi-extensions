/**
 * Ambient sync + start-context injection for nmem pi extension.
 *
 * Forked from nowledge-mem-pi/extensions/nowledge-mem.ts.
 * Sync half: non-throwing postJson with deduped UI notify.
 * Inject half: REST GET /context/bundle via nmemRequest (throws, caught).
 */

import { basename } from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
  type JsonObject,
  NmemError,
  nmemRequest,
  stringValue,
} from "./client.ts";

// ============================================================================
// Constants
// ============================================================================

const MAX_MESSAGE_CHARS = 20_000;
const FLUSH_DELAY_MS = 750;
// tool_version 随 POST /threads 上报后端并持久化（见 r3）。带工具名前缀以区分
// nowledge-mem-pi（裸号 0.8.3）与 nmem CLI：三者 source 均为 "pi"，tool_version
// 是唯一区分点，裸号会混淆（已实测后端只存储不解析，前缀安全）。与
// package.json version 保持同步。
const DEFAULT_PLUGIN_VERSION = "pi-nmem/0.4.0";

// ============================================================================
// Types
// ============================================================================

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

interface StartupContextEntry {
  context?: string;
  degradedReason?: string;
}

interface SessionManagerLike {
  getBranch?: () => JsonObject[];
  getEntries?: () => JsonObject[];
  getSessionId?: () => string;
  getSessionFile?: () => string | undefined;
  getSessionName?: () => string | undefined;
  getCwd?: () => string;
}

// ============================================================================
// Module state
// ============================================================================

const syncStates = new Map<string, SyncState>();
const startupContextCache = new Map<string, StartupContextEntry>();
const syncNotifyWarnings = new Set<string>();

// ============================================================================
// Helpers
// ============================================================================

function sourceApp(): string {
  // Spec #78: source_app is fixed to "pi" so thread_id (pi- prefix) stays
  // stable across the nowledge-mem-pi -> pi-nmem switch (data continuity).
  // An env override would change the prefix and break existing threads.
  return "pi";
}

function hostLabel(): string {
  return process.env.NMEM_PLUGIN_HOST_LABEL?.trim() || "Pi";
}

function pluginVersion(): string {
  return process.env.NMEM_PLUGIN_VERSION?.trim() || DEFAULT_PLUGIN_VERSION;
}

function truncate(text: string): string {
  if (text.length <= MAX_MESSAGE_CHARS) return text;
  return `${text.slice(0, MAX_MESSAGE_CHARS)}\n\n[${hostLabel()} message truncated by Nowledge Mem plugin]`;
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
  if (content && typeof content === "object") {
    return partToText(content);
  }
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
  const ambient: JsonObject = {
    source_app: sourceApp(),
  };
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

// ============================================================================
// Non-throwing postJson adapter (delegates to nmemRequest, inherits retry)
// ============================================================================

/**
 * Ambient sync POST, non-throwing: delegates to nmemRequest (which retries
 * transient faults) and flattens any NmemError into {ok:false, status, data} so
 * the caller never sees a throw. POST /threads and /threads/{id}/append are
 * idempotent (409 fallback / idempotency_key), so retry is safe here.
 */
async function postJson(
  path: string,
  body: JsonObject,
): Promise<{ ok: boolean; status: number; data: unknown }> {
  try {
    const data = await nmemRequest("POST", path, { body });
    // status is a placeholder on the ok path (nmemRequest returns only the
    // parsed body); consumers read status solely on the error path, where
    // NmemError.status carries the real HTTP code.
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

// ============================================================================
// Sync helpers
// ============================================================================

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

  result = await postJson(
    `/threads/${encodeURIComponent(payload.threadId)}/append`,
    {
      messages: payload.messages,
      deduplicate: true,
      idempotency_key: `${sourceApp()}:${payload.sessionId}:${payload.messages.length}`,
    },
  );
  if (!result.ok && state.created && isThreadNotFound(result)) {
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

function scheduleFlush(ctx: ExtensionContext, reason: string): void {
  const payload = buildSyncPayload(ctx, reason);
  if (!payload) return;
  const key = payload.threadId;
  const state = syncStates.get(key) || {};
  syncStates.set(key, state);
  if (state.timer) clearTimeout(state.timer);
  state.timer = setTimeout(() => {
    state.timer = undefined;
    void flushPayload(ctx, payload);
  }, FLUSH_DELAY_MS);
}

// ============================================================================
// Start-context injection (REST-ified, 1-level degrade)
// ============================================================================

function startupGuidance(): string {
  const label = hostLabel();
  const source = sourceApp();
  return [
    "## Nowledge Mem Guidance",
    "",
    `Nowledge Mem is available through the installed ${label} skills, the \`nmem\` CLI, and the four nmem tools (nmem_search, nmem_read_thread, nmem_list_threads, nmem_save_memory). Use it when past context would make the work better.`,
    "",
    "- Context Bundle may already be injected above. Do not re-read it unless the user asks or the session context changes.",
    "- Search memory when the task resumes prior work, mentions an earlier decision, or would benefit from the user's established preferences and procedures.",
    "- Search threads when the user asks about a previous conversation or when a memory points back to source conversation history.",
    "- Save or update durable decisions, preferences, plans, procedures, learnings, events, or important context. Search first; keep one strong memory rather than several weak duplicates.",
    `- Create an explicit handoff thread only when the user asks for a checkpoint. The ${label} extension already syncs completed ${label} conversation history automatically.`,
    `- Keep provenance as \`source_app=${source}\`.`,
    "",
  ].join("\n");
}

async function readContextBundle(): Promise<StartupContextEntry> {
  try {
    const data: unknown = await nmemRequest("GET", "/context/bundle");
    if (data && typeof data === "object") {
      const obj = data as Record<string, unknown>;
      const context =
        stringValue(obj.rendered_markdown as string) ||
        stringValue(obj.markdown as string) ||
        stringValue(obj.content as string);
      if (context) {
        return { context };
      }
    }
    return { degradedReason: "startup context bundle returned empty" };
  } catch (error) {
    if (error instanceof NmemError) {
      return { degradedReason: `startup context unavailable: ${error.code}` };
    }
    return {
      degradedReason: `startup context unavailable: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function startupContextCacheKey(ctx: ExtensionContext): string | undefined {
  const manager = ctx.sessionManager as unknown as SessionManagerLike;
  const id = manager.getSessionId?.();
  const normalizedId = id?.trim();
  if (normalizedId && normalizedId.toLowerCase() !== "unknown")
    return normalizedId;
  const file = manager.getSessionFile?.();
  return file ? basename(file).replace(/\.jsonl$/i, "") : undefined;
}

async function refreshStartupContext(ctx: ExtensionContext): Promise<void> {
  const key = startupContextCacheKey(ctx);
  if (!key) return;
  startupContextCache.set(key, await readContextBundle());
}

function evictStartupContext(ctx: ExtensionContext): void {
  const key = startupContextCacheKey(ctx);
  if (key) startupContextCache.delete(key);
}

async function appendMemoryContext(
  systemPrompt: string,
  ctx: ExtensionContext,
): Promise<string> {
  const key = startupContextCacheKey(ctx);
  if (key && !startupContextCache.has(key)) {
    await refreshStartupContext(ctx);
  }
  const entry = key ? startupContextCache.get(key) : await readContextBundle();
  const sections: string[] = [];
  if (entry?.context) {
    sections.push(`## Nowledge Mem Context Bundle\n\n${entry.context}`);
  } else if (entry?.degradedReason) {
    sections.push(
      `## Nowledge Mem Context Bundle\n\n[Nowledge Mem startup context unavailable: ${entry.degradedReason}.]`,
    );
  }
  sections.push(startupGuidance());
  return `${systemPrompt}\n\n${sections.join("\n\n")}`;
}

// ============================================================================
// Public API
// ============================================================================

export function installAmbient(pi: ExtensionAPI): void {
  pi.on("session_start", async (_event, ctx) => {
    await refreshStartupContext(ctx);
  });

  pi.on("before_agent_start", async (event, ctx) => {
    return { systemPrompt: await appendMemoryContext(event.systemPrompt, ctx) };
  });

  pi.on("agent_end", async (_event, ctx) => {
    scheduleFlush(ctx, "agent_end");
  });

  pi.on("session_before_compact", async (_event, ctx) => {
    await flush(ctx, "session_before_compact");
  });

  pi.on("session_compact", async (_event, ctx) => {
    await refreshStartupContext(ctx);
  });

  pi.on("session_before_switch", async (event, ctx) => {
    await flush(ctx, event.reason === "new" ? "session_new" : "session_resume");
    evictStartupContext(ctx);
  });

  pi.on("session_shutdown", async (event, ctx) => {
    await flush(ctx, `session_shutdown:${event.reason}`);
    evictStartupContext(ctx);
  });
}

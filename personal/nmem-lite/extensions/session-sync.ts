/**
 * nmem-lite 会话同步 — 把 pi 会话同步为 Nowledge Mem 线程。
 *
 * Ported from @cnife/pi-nmem (ambient sync) / OMP plugins/nmem/extensions/session-sync.ts。
 * 文本归一化、payload 构造、两阶段 create/append 状态机、线程重建、通知去重都是
 * implementation；对外只有 flush(ctx, reason[, options]) 与 scheduleFlush(ctx, reason)。
 *
 * 与 OMP 侧的显式宿主差异：
 * - 定时器用全局 setTimeout/clearTimeout：pi 的 ExtensionContext 没有
 *   ctx.setTimeout/clearTimer（那是 OMP 宿主的隔离机制）。
 * - 前台预算自己封（单请求 3s、整条队列最多等 6s）：pi 没有宿主级 shutdown 超时，
 *   handler 卡多久就等多久；OMP 靠宿主的 2s 硬杀，不能照抄它的 800ms。
 */

import { basename } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { NmemError, nmemRequest } from "./rest.ts";

type JsonObject = Record<string, unknown>;

/** 每轮同步的预算覆盖。`waitMs` 只约束调用者的等待，不约束 drain 本身。 */
export interface FlushOptions {
  timeoutMs?: number;
  retries?: number;
  /** 最多为整条队列等多久；到点停止等待并返回（drain 仍在后台继续）。 */
  waitMs?: number;
}

const MAX_MESSAGE_CHARS = 20_000;
const FLUSH_DELAY_MS = 750;
// tool_version 随 POST /threads 上报后端并持久化。source 固定 "pi"（thread_id 的
// pi- 前缀跨 nowledge-mem-pi → pi-nmem → pi-nmem-lite 保持稳定）。
const DEFAULT_PLUGIN_VERSION = "pi-nmem-lite/0.2.0";

/**
 * 前台预算（退出 / 换会话 / 压缩前统一）。
 *
 * 单请求 3s：本机轻量请求 13–25ms，远程后端另有网络来回与上传时间，3s 是远程
 * 一次落库的充足余量。前台**不重试**：重试的作用已被「同步永远写整份快照 +
 * 后端去重」取代——放弃的一轮会被下一次同步或下次打开该会话补齐；而它的成本
 * 是用户盯着一个已经停掉的界面翻倍等待。waitMs 是必须的：退出时若正好有一个
 * 后台轮次（8s + 2 重试）在飞，不封顶等待会退回后台的长预算。两轮跑满正好 6s。
 */
export const FOREGROUND_FLUSH_OPTIONS: FlushOptions = {
  timeoutMs: 3_000,
  retries: 0,
  waitMs: 6_000,
};

type SessionEntry = ReturnType<
  ExtensionContext["sessionManager"]["getBranch"]
>[number];

// --- Source identity ---

function sourceApp(): string {
  // 固定 "pi"：thread_id 的 pi- 前缀跨 nowledge-mem-pi → pi-nmem → pi-nmem-lite
  // 保持稳定，加环境变量覆盖会改变前缀、破坏既有线程连续性。
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
  /** 同一线程同一时间只跑一条请求链。 */
  draining?: Promise<void>;
  /** 等待链条腾出来的最新快照。不是布尔标记：旧快照永远不得被重放。 */
  queued?: { payload: SyncPayload; options?: FlushOptions };
  timer?: ReturnType<typeof setTimeout>;
}

interface SyncPayload {
  threadId: string;
  sessionId: string;
  messages: ThreadMessage[];
  body: JsonObject;
}

interface MessageLike {
  role: unknown;
  command?: unknown;
  output?: unknown;
  exitCode?: unknown;
  summary?: unknown;
  content?: unknown;
}

// --- Module state ---

const syncStates = new Map<string, SyncState>();
const syncNotifyWarnings = new Set<string>();

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value.trim() || undefined : undefined;
}

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

function messageToText(message: MessageLike): string {
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
  entry: SessionEntry,
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
  entry: SessionEntry,
  index: number,
  ambient: JsonObject,
): ThreadMessage | undefined {
  if (entry.type === "message") {
    const message = entry.message as MessageLike | undefined;
    if (!message || typeof message !== "object") return undefined;
    if (message.role === "custom") return undefined;
    const role = normalizeRole(message.role);
    if (!role) return undefined;
    const content = truncate(messageToText(message).trim());
    if (!content) return undefined;
    return {
      role,
      content,
      timestamp: stringValue(entry.timestamp),
      metadata: {
        ...buildEntryMetadata(entry, index, ambient),
        pi_message_role: stringValue(message.role),
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
  const entries = ctx.sessionManager.getBranch();
  return entries
    .map((entry, index) => entryToMessage(entry, index, ambient))
    .filter((msg): msg is ThreadMessage => !!msg);
}

function sessionId(ctx: ExtensionContext): string {
  const id = ctx.sessionManager.getSessionId();
  if (id) return id;
  const file = ctx.sessionManager.getSessionFile();
  if (file) return basename(file).replace(/\.jsonl$/i, "");
  return "unknown";
}

function threadIdFor(ctx: ExtensionContext): string {
  return `${sourceApp()}-${sessionId(ctx)}`
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-");
}

function buildTitle(ctx: ExtensionContext, messages: ThreadMessage[]): string {
  const name = ctx.sessionManager.getSessionName()?.trim();
  if (name) return name;
  const firstUser = messages.find((msg) => msg.role === "user")?.content.trim();
  if (firstUser) return firstUser.slice(0, 120);
  const cwd = ctx.sessionManager.getCwd();
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
 * Non-throwing POST: delegates to nmemRequest (retries transient faults, unless
 * `options` narrows that) and flattens any NmemError into {ok:false} so the
 * caller never sees a throw. POST /threads and /threads/{id}/append are
 * idempotent (409 fallback / idempotency_key), so retry is safe here.
 */
async function postJson(
  path: string,
  body: JsonObject,
  options?: FlushOptions,
): Promise<{ ok: boolean; status: number; data: unknown }> {
  try {
    const data = await nmemRequest("POST", path, body, options);
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
  // 退出路径上 TUI 已停，通知可能不可见；切会话后旧 ctx 也可能失效，
  // 所以告警本身裹上异常保护，绝不让它反过来打断同步/退出。
  try {
    if (ctx.hasUI) {
      ctx.ui.notify(message, "warning");
    } else {
      console.warn(message);
    }
  } catch {
    // best-effort：告警失败不影响同步语义
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
  const body: JsonObject = {
    thread_id: threadId,
    title: buildTitle(ctx, messages),
    messages,
    source: sourceApp(),
    project: ctx.sessionManager.getCwd(),
    tool_version: pluginVersion(),
    metadata: {
      pi_session_id: id,
      pi_session_file: ctx.sessionManager.getSessionFile(),
      sync_reason: reason,
    },
  };
  return { threadId, sessionId: id, messages, body };
}

async function flushOnce(
  ctx: ExtensionContext,
  payload: SyncPayload,
  state: SyncState,
  options?: FlushOptions,
): Promise<void> {
  let result = state.created
    ? { ok: false, status: 409, data: { detail: "append existing thread" } }
    : await postJson("/threads", payload.body, options);
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
    options,
  );
  if (!result.ok && state.created && isThreadNotFound(result)) {
    // Thread was deleted out-of-band; recreate.
    state.created = false;
    result = await postJson("/threads", payload.body, options);
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

/** 等到 promise 完成，或到 waitMs 上限后放弃等待（promise 仍在后台继续）。 */
function waitUpTo(promise: Promise<void>, waitMs: number): Promise<void> {
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(finish, waitMs);
    promise.then(finish, finish);
  });
}

/**
 * One request chain per thread. Callers enqueue their snapshot and await the
 * whole drain, so a caller that needs the write to land (shutdown) sees it land
 * — up to `options.waitMs`, after which it stops waiting and returns.
 */
async function flushPayload(
  ctx: ExtensionContext,
  payload: SyncPayload,
  options?: FlushOptions,
): Promise<void> {
  const state = syncStates.get(payload.threadId) || {};
  syncStates.set(payload.threadId, state);
  // 快照连同自己的预算入队：前台轮不得继承在飞的后台轮的默认值。
  state.queued = { payload, options };
  state.draining ??= drain(ctx, state);
  const draining = state.draining;
  if (options?.waitMs === undefined) {
    await draining;
    return;
  }
  await waitUpTo(draining, options.waitMs);
}

async function drain(ctx: ExtensionContext, state: SyncState): Promise<void> {
  try {
    while (state.queued) {
      const { payload, options } = state.queued;
      state.queued = undefined;
      await flushOnce(ctx, payload, state, options);
    }
  } finally {
    state.draining = undefined;
  }
}

/** 取消挂起的防抖：刚性 flush 压过它。防抖快照在到点时才构建，所以取消不丢
 *  消息——刚性 flush 从同一条分支构建等宽或更宽的快照。留着它反而会多跑一轮。 */
function cancelScheduledFlush(state: SyncState | undefined): void {
  if (state?.timer === undefined) return;
  clearTimeout(state.timer);
  state.timer = undefined;
}

export async function flush(
  ctx: ExtensionContext,
  reason: string,
  options?: FlushOptions,
): Promise<void> {
  // 先取消防抖：即使这一分支构建不出快照，也不能把「退出/换会话后仍在开火的
  // 过期定时器」留在那里（它会拿失效 ctx 去构建快照）。
  cancelScheduledFlush(syncStates.get(threadIdFor(ctx)));
  const payload = buildSyncPayload(ctx, reason);
  if (!payload) return;
  await flushPayload(ctx, payload, options);
}

/**
 * Debounced flush. 快照在定时器到点时才构建，不在排定时器时构建：
 * 提前 750ms 构建的快照会漏掉窗口内追加的消息。
 */
export function scheduleFlush(ctx: ExtensionContext, reason: string): void {
  const threadId = threadIdFor(ctx);
  const state = syncStates.get(threadId) || {};
  syncStates.set(threadId, state);
  if (state.timer !== undefined) clearTimeout(state.timer);
  state.timer = setTimeout(() => {
    state.timer = undefined;
    const payload = buildSyncPayload(ctx, reason);
    if (!payload) return;
    void flushPayload(ctx, payload).catch(() => {});
  }, FLUSH_DELAY_MS);
}

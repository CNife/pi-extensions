/**
 * advisor-adapter — Proxy adapter for @juicesharp/rpiv-advisor.
 *
 * Loads the original package as a library (not a Pi extension), intercepts
 * registerTool("advisor") to inject custom TUI rendering (renderCall +
 * renderResult) and replace completeSimple with streamSimple for live
 * streaming of thinking + Markdown body.
 *
 * Distributed via the monorepo root pi package (git install); the root
 * manifest exposes this entry via the personal-package extensions glob. Do not list
 * npm:@juicesharp/rpiv-advisor as a separate settings package - it is a root
 * runtime dependency, resolved from root node_modules in git-package mode
 * (or this package's node_modules under isolated `pi -e personal/advisor-adapter`).
 *
 * Brittleness: deep-imports upstream internal modules
 * (`@juicesharp/rpiv-advisor/advisor/*`). Upstream has no compatibility
 * promise on those paths.
 */

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type {
  Model,
  StopReason,
  ThinkingLevel,
  Usage,
} from "@earendil-works/pi-ai";
import { calculateCost } from "@earendil-works/pi-ai";
import type {
  AgentToolResult,
  AgentToolUpdateCallback,
  ExtensionAPI,
  ExtensionContext,
  ToolRenderContext,
  ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import {
  buildSessionContext,
  convertToLlm,
  getMarkdownTheme,
  keyHint,
} from "@earendil-works/pi-coding-agent";
import type { Component, Theme } from "@earendil-works/pi-tui";
import { Container, Markdown, Text } from "@earendil-works/pi-tui";

// ─── Original package (dependency + internal deep imports) ───────────────────

import {
  ensureUserTailForAdvisor,
  stripInflightAdvisorCall,
} from "@juicesharp/rpiv-advisor/advisor/context.ts";
import { getInventoryMessage } from "@juicesharp/rpiv-advisor/advisor/inventory.ts";
import { ADVISOR_TOOL_NAME } from "@juicesharp/rpiv-advisor/advisor/messages.ts";
import {
  getAdvisorEffort,
  getAdvisorModel,
} from "@juicesharp/rpiv-advisor/advisor/state.ts";
import originalFactory from "@juicesharp/rpiv-advisor/index.ts";

const require = createRequire(import.meta.url);
const ADVISOR_SYSTEM_PROMPT = readFileSync(
  require.resolve("@juicesharp/rpiv-advisor/prompts/advisor-system.txt"),
  "utf-8",
).trimEnd();

// ─── Details & Row state types ───────────────────────────────────────────────

interface AdvisorDetails {
  provider: string;
  model: string;
  effort: ThinkingLevel | undefined;
  thinking: string;
  body: string;
  startedAt: number;
  endedAt?: number;
  usage?: Usage;
  stopReason?: StopReason;
  errorMessage?: string;
}

interface RowState {
  startedAt?: number;
  endedAt?: number;
  interval?: ReturnType<typeof setInterval>;
  lastDetails?: AdvisorDetails;
  mdTheme?: ReturnType<typeof getMarkdownTheme>;
}

// ─── Format helpers ──────────────────────────────────────────────────────────

function formatElapsed(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatTokens(n: number): string {
  if (n >= 1000) {
    const k = n / 1000;
    return `${k >= 10 ? k.toFixed(0) : k.toFixed(1)}k`;
  }
  return String(n);
}

function formatCost(usd: number): string {
  if (usd <= 0) return "$0";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

function resolveStatus(
  state: RowState,
  isPartial: boolean,
  isError: boolean,
): string {
  if (!isPartial) {
    if (isError) {
      const d = state.lastDetails;
      if (d?.stopReason === "aborted") return "aborted";
      return "failed";
    }
    return "done";
  }
  return "running";
}

// ─── Header — identity only ──────────────────────────────────────────────────

function buildHeader(theme: Theme, d?: AdvisorDetails): string {
  return (
    theme.fg("toolTitle", theme.bold("Advisor")) +
    theme.fg(
      "muted",
      ` · ${d?.provider ?? "?"} · ${d?.model ?? "?"} · ${d?.effort ?? "high"}`,
    )
  );
}

// ─── Footer — status + elapsed + usage ───────────────────────────────────────

function buildFooter(
  theme: Theme,
  state: RowState,
  isPartial: boolean,
  isError: boolean,
): string {
  const d = state.lastDetails;
  const status = resolveStatus(state, isPartial, isError);
  const start = state.startedAt ?? d?.startedAt ?? Date.now();
  const end = state.endedAt ?? d?.endedAt ?? (isPartial ? Date.now() : start);
  const elapsed = formatElapsed(Math.max(0, end - start));
  const statusColor =
    status === "failed"
      ? "error"
      : status === "aborted"
        ? "warning"
        : status === "done"
          ? "success"
          : "warning";
  const parts: string[] = [
    theme.fg(statusColor, status),
    theme.fg("dim", elapsed),
  ];
  const u = d?.usage;
  if (u) {
    parts.push(theme.fg("dim", `in ${formatTokens(u.input)}`));
    parts.push(theme.fg("dim", `out ${formatTokens(u.output)}`));
    if (u.cacheRead > 0) {
      parts.push(theme.fg("dim", `cache ${formatTokens(u.cacheRead)}`));
    }
    parts.push(theme.fg("dim", formatCost(u.cost.total)));
  }
  return parts.join(theme.fg("muted", " · "));
}

// ─── Runtime streamSimple access (same pattern as original pi-compat.ts) ────

function getRuntimeStreamSimple(
  modelRegistry: unknown,
): ((model: Model<any>, context: any, options?: any) => any) | undefined {
  try {
    if (modelRegistry === null || typeof modelRegistry !== "object") return;
    const runtime = (modelRegistry as { runtime?: unknown }).runtime;
    if (runtime === null || typeof runtime !== "object") return;
    const fn = (runtime as { streamSimple?: unknown }).streamSimple;
    return typeof fn === "function" ? fn.bind(runtime) : undefined;
  } catch {
    return;
  }
}

async function loadCompatStreamSimple(): Promise<
  (model: Model<any>, context: any, options?: any) => any
> {
  const mod = await import("@earendil-works/pi-ai/compat");
  const fn = (mod as any).streamSimple;
  if (typeof fn !== "function") {
    throw new Error("pi-ai compat has no streamSimple export");
  }
  return fn;
}

// ─── renderCall ──────────────────────────────────────────────────────────────

function renderCall(
  _args: Record<string, never>,
  theme: Theme,
  context: ToolRenderContext<RowState>,
): Component {
  const state = context.state as RowState;
  if (context.executionStarted && state.startedAt === undefined) {
    state.startedAt = Date.now();
  }
  const text =
    (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
  text.setText(buildHeader(theme, state.lastDetails));
  return text;
}

// ─── renderResult ────────────────────────────────────────────────────────────

function renderResult(
  result: AgentToolResult<AdvisorDetails>,
  options: ToolRenderResultOptions,
  theme: Theme,
  context: ToolRenderContext<RowState>,
): Component {
  const { isPartial } = options;
  const state = context.state as RowState;

  // Merge: throw → final details empty, retain last onUpdate snapshot
  const details = (result.details ?? {}) as Partial<AdvisorDetails>;
  const prev = state.lastDetails;
  const errText =
    context.isError && result.content?.[0]?.type === "text"
      ? result.content[0].text
      : undefined;

  state.lastDetails = {
    provider: details.provider ?? prev?.provider ?? "?",
    model: details.model ?? prev?.model ?? "?",
    effort: details.effort ?? prev?.effort ?? "high",
    thinking: details.thinking ?? prev?.thinking ?? "",
    body: details.body ?? prev?.body ?? "",
    startedAt:
      details.startedAt ?? prev?.startedAt ?? state.startedAt ?? Date.now(),
    endedAt: details.endedAt ?? prev?.endedAt,
    usage: details.usage ?? prev?.usage,
    stopReason: details.stopReason ?? prev?.stopReason,
    errorMessage: details.errorMessage ?? prev?.errorMessage ?? errText,
  };

  if (context.executionStarted && state.startedAt === undefined) {
    state.startedAt = state.lastDetails.startedAt;
  }

  // Live footer — 100ms invalidate while running
  if (isPartial && !state.interval) {
    state.interval = setInterval(() => context.invalidate(), 100);
  }
  if (!isPartial || context.isError) {
    state.endedAt ??= details.endedAt ?? Date.now();
    if (state.interval) {
      clearInterval(state.interval);
      state.interval = undefined;
    }
  }

  const container =
    (context.lastComponent as Container | undefined) ?? new Container();
  container.clear();

  const d = state.lastDetails;
  const thinking = d.thinking;
  const body = d.body;
  const bodyStarted = body.length > 0;
  const hasThinking = thinking.length > 0;
  const expanded = context.expanded;
  const showThinking = hasThinking && (expanded || !bodyStarted);

  // ── Thinking block ──
  if (hasThinking) {
    if (showThinking) {
      const arrow = expanded ? "▾" : "▸";
      const label = theme.fg(
        "muted",
        `${arrow} thinking${isPartial && d.stopReason === undefined ? " …" : ""}`,
      );
      container.addChild(new Text(label, 0, 0));
      const dimmed = thinking
        .split("\n")
        .map((line) => theme.fg("dim", line.length ? `  ${line}` : ""))
        .join("\n");
      container.addChild(new Text(dimmed, 0, 0));
    } else {
      const hint = keyHint("app.tools.expand", "to expand thinking");
      container.addChild(
        new Text(theme.fg("muted", `▸ thinking (folded, ${hint})`), 0, 0),
      );
    }
  } else if (isPartial && !bodyStarted) {
    container.addChild(new Text(theme.fg("dim", "Waiting for advisor…"), 0, 0));
  }

  // ── Markdown body ──
  if (body) {
    if (!state.mdTheme) state.mdTheme = getMarkdownTheme();
    container.addChild(new Markdown(body, 0, 0, state.mdTheme));
  }

  // ── Footer (always) ──
  container.addChild(
    new Text(buildFooter(theme, state, isPartial, context.isError), 0, 0),
  );

  // ── Extra error detail line below footer ──
  if (
    !isPartial &&
    (context.isError || d.stopReason === "error") &&
    d.errorMessage &&
    d.stopReason !== "aborted"
  ) {
    container.addChild(
      new Text(theme.fg("error", `  ${d.errorMessage}`), 0, 0),
    );
  }

  container.invalidate();
  return container;
}

// ─── Extension entry ─────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  // Capture pi by closure for use in execute.
  // ToolDefinition.execute signature:
  //   execute(toolCallId, params, signal, onUpdate, ctx): Promise<AgentToolResult>
  const executeWithStream = async (
    _toolCallId: string,
    _params: Record<string, never>,
    signal: AbortSignal | undefined,
    onUpdate: AgentToolUpdateCallback<AdvisorDetails> | undefined,
    ctx: ExtensionContext,
  ): Promise<AgentToolResult<AdvisorDetails>> => {
    const effort = getAdvisorEffort();
    const advisor = getAdvisorModel();
    if (!advisor) {
      return {
        content: [{ type: "text", text: "No advisor model selected" }],
        details: {
          provider: "?",
          model: "?",
          effort,
          thinking: "",
          body: "",
          startedAt: Date.now(),
          errorMessage: "No advisor model selected",
        },
      };
    }
    const provider = advisor.provider;
    const modelId = advisor.id;

    // Auth check (same pattern as original executeAdvisor)
    const auth = await ctx.modelRegistry.getApiKeyAndHeaders(advisor);
    if (!auth.ok) {
      const text = `Advisor auth error for ${provider}:${modelId}: ${auth.error}`;
      return {
        content: [{ type: "text", text }],
        details: {
          provider,
          model: modelId,
          effort,
          thinking: "",
          body: "",
          startedAt: Date.now(),
          errorMessage: auth.error,
        },
      };
    }

    // Build messages (same as original executeAdvisor)
    const { messages: sessionMessages } = buildSessionContext(
      ctx.sessionManager.getEntries(),
      ctx.sessionManager.getLeafId(),
    );
    const branchMessages = ensureUserTailForAdvisor(
      stripInflightAdvisorCall(convertToLlm(sessionMessages)),
    );
    const inventoryMessage = getInventoryMessage(pi.getAllTools());
    const messages = inventoryMessage
      ? [inventoryMessage, ...branchMessages]
      : branchMessages;

    const startedAt = Date.now();
    let thinking = "";
    let body = "";
    let finalUsage: Usage | undefined;
    let finalStopReason: StopReason | undefined;
    let errorMessage: string | undefined;

    // Initial onUpdate — "Consulting…"
    onUpdate?.({
      content: [{ type: "text", text: `Consulting ${provider}:${modelId}…` }],
      details: {
        provider,
        model: modelId,
        effort,
        thinking: "",
        body: "",
        startedAt,
      },
    });

    // Resolve streamSimple: auth-aware runtime first, then compat global
    const runtimeStreamSimple = getRuntimeStreamSimple(ctx.modelRegistry);
    const streamFn = runtimeStreamSimple ?? (await loadCompatStreamSimple());
    const requestOptions = runtimeStreamSimple
      ? { signal, reasoning: effort }
      : {
          apiKey: auth.apiKey,
          headers: auth.headers,
          signal,
          reasoning: effort,
        };

    try {
      const stream = streamFn(
        advisor,
        { systemPrompt: ADVISOR_SYSTEM_PROMPT, messages, tools: [] },
        requestOptions,
      );

      for await (const event of stream) {
        if (event.type === "thinking_delta") {
          thinking += event.delta;
          onUpdate?.({
            content: [{ type: "text", text: thinking }],
            details: {
              provider,
              model: modelId,
              effort,
              thinking,
              body,
              startedAt,
            },
          });
        } else if (event.type === "text_delta") {
          body += event.delta;
          onUpdate?.({
            content: [{ type: "text", text: body }],
            details: {
              provider,
              model: modelId,
              effort,
              thinking,
              body,
              startedAt,
            },
          });
        } else if (event.type === "done") {
          const msg = event.message;
          finalUsage = msg.usage;
          finalStopReason = msg.stopReason;
          calculateCost(advisor, finalUsage);
          return {
            content: [{ type: "text", text: body || thinking || "" }],
            details: {
              provider,
              model: modelId,
              effort,
              thinking,
              body,
              startedAt,
              endedAt: Date.now(),
              usage: finalUsage,
              stopReason: finalStopReason,
            },
          };
        } else if (event.type === "error") {
          const msg = event.error;
          finalUsage = msg.usage;
          finalStopReason = msg.stopReason;
          errorMessage =
            msg.errorMessage ?? event.reason ?? "Advisor stream error";
          calculateCost(advisor, finalUsage);
          onUpdate?.({
            content: [{ type: "text", text: errorMessage }],
            details: {
              provider,
              model: modelId,
              effort,
              thinking,
              body,
              startedAt,
              endedAt: Date.now(),
              usage: finalUsage,
              stopReason: finalStopReason,
              errorMessage,
            },
          });
          throw new Error(errorMessage);
        }
      }

      // Stream ended without done/error
      return {
        content: [{ type: "text", text: "Advisor returned an empty response" }],
        details: {
          provider,
          model: modelId,
          effort,
          thinking,
          body,
          startedAt,
          endedAt: Date.now(),
          stopReason: "stop",
        },
      };
    } catch (err) {
      if (err instanceof Error && errorMessage !== undefined) throw err;
      if (err instanceof DOMException && err.name === "AbortError") {
        const endedAt = Date.now();
        onUpdate?.({
          content: [{ type: "text", text: "aborted" }],
          details: {
            provider,
            model: modelId,
            effort,
            thinking,
            body,
            startedAt,
            endedAt,
            stopReason: "aborted",
            errorMessage: "aborted by user",
          },
        });
        throw new Error("aborted by user");
      }
      const msg = err instanceof Error ? err.message : String(err);
      const endedAt = Date.now();
      onUpdate?.({
        content: [{ type: "text", text: msg }],
        details: {
          provider,
          model: modelId,
          effort,
          thinking,
          body,
          startedAt,
          endedAt,
          errorMessage: msg,
        },
      });
      throw err instanceof Error ? err : new Error(msg);
    }
  };

  // Proxy registerTool — intercept "advisor", pass through everything else
  const origRegisterTool = pi.registerTool.bind(pi) as (tool: any) => void;
  pi.registerTool = ((tool: any) => {
    if (tool?.name === ADVISOR_TOOL_NAME) {
      return origRegisterTool({
        ...tool,
        execute: executeWithStream,
        renderCall,
        renderResult,
      });
    }
    return origRegisterTool(tool);
  }) as ExtensionAPI["registerTool"];

  // Run original factory — all non-tool registrations pass through unchanged
  originalFactory(pi);
}

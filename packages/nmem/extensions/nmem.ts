/**
 * nmem extension - thin wrapper entry.
 *
 * Registers four tools (nmem_search, nmem_read_thread, nmem_list_threads, nmem_save_memory)
 * and delegates to the REST client deep module (../client.ts). Owns no logic
 * beyond parameter unpacking and shaping the AgentToolResult. The deep
 * module throws NmemError on any failure; per the pi custom-tool error
 * contract (throw -> isError:true, return -> isError:false) we let those
 * propagate instead of catching, so the LLM sees real errors.
 *
 * Sync and startup context injection (forked from nowledge-mem-pi) are wired
 * in via installAmbient (../ambient.ts).
 */

import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { installAmbient } from "../ambient.ts";
import {
  type MemoriesSearchResult,
  nmemListThreads,
  nmemReadThread,
  nmemSaveMemory,
  nmemSearch,
  type ReadThreadResult,
  resolveConfig,
  type SavedMemoryResult,
  type SearchKind,
  type ThreadListResult,
  type ThreadsSearchResult,
} from "../client.ts";
import {
  formatConfigShow,
  loadPluginConfig,
  parseConfigSetArgs,
  pluginConfigPath,
  savePluginConfig,
} from "../config.ts";
import {
  renderListThreadsResult,
  renderReadThreadResult,
  renderSaveMemoryResult,
  renderSearchResult,
  type SaveMemoryArgs,
  type SearchArgs,
} from "../render.ts";
import { toToonText } from "../toon.ts";

const nmemSearchTool = defineTool({
  name: "nmem_search",
  label: "Search nmem",
  description: [
    "Search the nmem backend for memories (kind=memories, default) or past",
    "conversation threads (kind=threads). Returns a slim, token-efficient",
    "structure - no debug metadata. Results are real, not mocked.",
  ].join(" "),
  promptGuidelines: [
    "After a threads hit, pass the returned id directly to nmem_read_thread's thread_id parameter to read the full thread",
  ],
  parameters: Type.Object({
    query: Type.String({
      description: "Search query string",
    }),
    kind: Type.Optional(
      Type.Union([Type.Literal("memories"), Type.Literal("threads")], {
        description:
          "What to search: memories (distilled knowledge, default) or threads (past conversations)",
      }),
    ),
    limit: Type.Optional(
      Type.Number({
        description: "Maximum results to return (default 5)",
      }),
    ),
  }),

  async execute(_toolCallId, params) {
    const { query, kind, limit } = params;
    // NmemError thrown by nmemSearch propagates -> pi sets isError:true.
    const result = await nmemSearch(
      query,
      kind as SearchKind | undefined,
      limit,
    );
    return {
      content: [
        {
          type: "text" as const,
          text: toToonText(result),
        },
      ],
      details: result as MemoriesSearchResult | ThreadsSearchResult,
    };
  },

  renderCall(args, theme) {
    const kind = args.kind ? ` · ${args.kind}` : "";
    return new Text(
      `${theme.fg("toolTitle", theme.bold("nmem_search"))}${kind} ${theme.fg("dim", `"${args.query}"`)}`,
      0,
      0,
    );
  },

  renderResult(result, { expanded }, theme, context) {
    return new Text(
      renderSearchResult(
        result,
        { expanded, isError: context.isError },
        theme,
        context.args as SearchArgs | undefined,
      ),
      0,
      0,
    );
  },
});

const nmemReadThreadTool = defineTool({
  name: "nmem_read_thread",
  label: "Read thread",
  description: [
    "Read the full content of a conversation thread by its thread_id.",
    "Auto-paginates with character-budget segmentation (fetches messages",
    "until ~8000 chars total). Each message carries a `timestamp` (ISO 8601",
    "session-occurrence time); `messages[0].timestamp` is the session start.",
    "Follow the returned `offset=N` hint to continue reading. Do not guess",
    "or fabricate message counts.",
  ].join(" "),
  promptGuidelines: [],
  parameters: Type.Object({
    thread_id: Type.String({
      description: "Thread ID (pi- prefix) to read",
    }),
    offset: Type.Optional(
      Type.Number({
        description: "Message offset to start from (default 0)",
      }),
    ),
  }),

  async execute(_toolCallId, params) {
    // NmemError propagates -> pi sets isError:true.
    const result = await nmemReadThread(params.thread_id, params.offset);
    const text = toToonText(result);
    return {
      content: [{ type: "text" as const, text }],
      details: result as ReadThreadResult,
    };
  },

  renderCall(args, theme) {
    return new Text(
      `${theme.fg("toolTitle", theme.bold("nmem_read_thread"))} ${theme.fg("dim", `· ${args.thread_id}`)}`,
      0,
      0,
    );
  },

  renderResult(result, { expanded }, theme, context) {
    return new Text(
      renderReadThreadResult(
        result,
        { expanded, isError: context.isError },
        theme,
      ),
      0,
      0,
    );
  },
});

const nmemListThreadsTool = defineTool({
  name: "nmem_list_threads",
  label: "List threads",
  description: [
    "List conversation threads by import time (newest first), with pagination.",
    "Returns a slim list (id/title/summary/date/source/message_count) - use",
    "nmem_read_thread to read a thread's full messages. Unlike nmem_search",
    "this lists by time without a query. `date` is the import date",
    "(day-grained), not the session start time.",
  ].join(" "),
  promptGuidelines: [
    "Use nmem_list_threads to browse recent threads by time; use nmem_search(kind=threads) to find threads by topic (list needs no query, search needs one)",
    "Screen by `summary` to pick threads worth reading, then pass the id to nmem_read_thread for full messages",
    "For precise time splitting (e.g. a 04:00 workday window), use nmem_read_thread's `messages[0].timestamp`.",
  ],
  parameters: Type.Object({
    limit: Type.Optional(
      Type.Number({
        description: "Maximum threads to return (default 20)",
      }),
    ),
    offset: Type.Optional(
      Type.Number({
        description: "Thread offset for pagination (default 0)",
      }),
    ),
    source: Type.Optional(
      Type.String({
        description: "Filter by source integration (e.g. pi, omp)",
      }),
    ),
  }),

  async execute(_toolCallId, params) {
    // NmemError propagates -> pi sets isError:true.
    const result = await nmemListThreads({
      limit: params.limit,
      offset: params.offset,
      source: params.source,
    });
    const text = toToonText(result);
    return {
      content: [{ type: "text" as const, text }],
      details: result as ThreadListResult,
    };
  },

  renderCall(args, theme) {
    const parts = [theme.fg("toolTitle", theme.bold("nmem_list_threads"))];
    if (args.limit) parts.push(theme.fg("dim", ` · limit ${args.limit}`));
    if (args.source) parts.push(theme.fg("dim", ` · source ${args.source}`));
    return new Text(parts.join(""), 0, 0);
  },

  renderResult(result, { expanded }, theme, context) {
    return new Text(
      renderListThreadsResult(
        result,
        { expanded, isError: context.isError },
        theme,
      ),
      0,
      0,
    );
  },
});

const nmemSaveMemoryTool = defineTool({
  name: "nmem_save_memory",
  label: "Save memory",
  description: [
    "Save a durable memory (or update an existing one) to the nmem backend.",
    "Creates a new memory when id is empty/missing; updates (PATCH) when id",
    "is provided. Labels are create-time init annotation only - existing",
    "memory labels will not change on update.",
  ].join(" "),
  promptGuidelines: [],
  parameters: Type.Object({
    title: Type.String({
      description: "Memory title",
    }),
    content: Type.String({
      description: "Memory content body",
    }),
    unit_type: Type.Optional(
      Type.String({
        description: "Unit type (e.g. fact, decision, procedure)",
      }),
    ),
    importance: Type.Optional(
      Type.Number({
        description: "Importance score (0.0-1.0)",
      }),
    ),
    labels: Type.Optional(
      Type.Array(Type.String(), {
        description: "Labels/tags (create-time only, ignored on update)",
      }),
    ),
    id: Type.Optional(
      Type.String({
        description: "Memory ID for updating an existing memory",
      }),
    ),
  }),

  async execute(_toolCallId, params) {
    const { title, content, unit_type, importance, labels, id } = params;
    // NmemError propagates -> pi sets isError:true.
    const result = await nmemSaveMemory(title, content, {
      unit_type,
      importance,
      labels,
      id,
    });
    const text = toToonText(result);
    return {
      content: [{ type: "text" as const, text }],
      details: result as SavedMemoryResult,
    };
  },

  renderCall(args, theme) {
    return new Text(
      `${theme.fg("toolTitle", theme.bold("nmem_save_memory"))} ${theme.fg("dim", `· ${args.title}`)}`,
      0,
      0,
    );
  },

  renderResult(result, { expanded }, theme, context) {
    return new Text(
      renderSaveMemoryResult(
        result,
        { expanded, isError: context.isError },
        theme,
        context.args as SaveMemoryArgs | undefined,
      ),
      0,
      0,
    );
  },
});

/**
 * /nmem-config - show or set the plugin config (cnife-nmem.json).
 *
 * No args prints the current config (plus the read-only backend apiUrl).
 * `<key> <value>` sets a key (v1: injectContextBundle true/false) and
 * persists it; the change takes effect at the next session start. Parsing
 * and formatting live in config.ts (pure, unit-tested); this handler only
 * does I/O and user feedback.
 */
function registerNmemConfigCommand(pi: ExtensionAPI): void {
  pi.registerCommand("nmem-config", {
    description:
      "Show or set nmem plugin config (usage: /nmem-config [injectContextBundle <true|false>])",
    handler: async (args, ctx) => {
      const trimmed = args.trim();

      if (!trimmed) {
        const config = loadPluginConfig();
        const { apiUrl } = resolveConfig();
        ctx.ui.notify(
          formatConfigShow(config, { apiUrl, path: pluginConfigPath() }),
        );
        return;
      }

      const parsed = parseConfigSetArgs(trimmed);
      if (!parsed.ok) {
        ctx.ui.notify(parsed.error, "error");
        return;
      }

      const next = { ...loadPluginConfig(), [parsed.key]: parsed.value };
      try {
        savePluginConfig(next);
      } catch (error) {
        ctx.ui.notify(
          `保存配置失败：${error instanceof Error ? error.message : String(error)}`,
          "error",
        );
        return;
      }
      ctx.ui.notify(
        `${parsed.key} → ${parsed.value}（下次会话启动生效）`,
        "info",
      );
    },
  });
}

export default function (pi: ExtensionAPI) {
  pi.registerTool(nmemSearchTool);
  pi.registerTool(nmemReadThreadTool);
  pi.registerTool(nmemListThreadsTool);
  pi.registerTool(nmemSaveMemoryTool);
  installAmbient(pi);
  registerNmemConfigCommand(pi);
}

/**
 * nmem extension - thin wrapper entry.
 *
 * Registers three tools (nmem_search, nmem_read_thread, nmem_save_memory)
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
  nmemReadThread,
  nmemSaveMemory,
  nmemSearch,
  type ReadThreadResult,
  type SavedMemoryResult,
  type SearchKind,
  type ThreadsSearchResult,
} from "../client.ts";
import {
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
    "Search before resuming prior work, retrospectives, asking 'why did we choose X', or debugging that resembles a past root cause",
    "Use kind=threads to find past conversations (the current session is also synced as a thread); use kind=memories (default) for distilled knowledge",
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
        description: "Maximum results to return (default 10)",
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
    "until ~8000 chars total). Follow the returned `offset=N` hint to",
    "continue reading. Do not guess or fabricate message counts.",
  ].join(" "),
  promptGuidelines: [
    "Read full threads surfaced by nmem_search; auto-paginated, follow the returned offset=N hint, do not guess counts",
    "Use when a thread hit in nmem_search contains useful information that was not fully shown",
  ],
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

const nmemSaveMemoryTool = defineTool({
  name: "nmem_save_memory",
  label: "Save memory",
  description: [
    "Save a durable memory (or update an existing one) to the nmem backend.",
    "Creates a new memory when id is empty/missing; updates (PATCH) when id",
    "is provided. Labels are create-time init annotation only - existing",
    "memory labels will not change on update.",
  ].join(" "),
  promptGuidelines: [
    "Save durable decisions, preferences, procedures, and learnings when the session yields them - not routine fixes or in-progress work",
    "Search first (nmem_search) to avoid creating duplicate memories",
    "Non-empty id updates, empty/missing id creates",
    "One strong memory beats many weak ones - consolidate related knowledge",
    "Labels are create-time init annotation only; existing memory labels will not change on update",
  ],
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
        description: "Importance score (0-10)",
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

export default function (pi: ExtensionAPI) {
  pi.registerTool(nmemSearchTool);
  pi.registerTool(nmemReadThreadTool);
  pi.registerTool(nmemSaveMemoryTool);
  installAmbient(pi);
}

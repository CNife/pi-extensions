/**
 * nmem extension - thin wrapper entry.
 *
 * Registers the nmem_search tool and delegates to the REST client deep module
 * (../client.ts). Owns no logic beyond parameter unpacking and shaping the
 * AgentToolResult. The deep module throws NmemError on any failure; per the pi
 * custom-tool error contract (throw -> isError:true, return -> isError:false)
 * we let those propagate instead of catching, so the LLM sees real errors.
 *
 * Sync and startup context injection (forked from nowledge-mem-pi) land in a
 * later ticket (#78); this entry only registers the search tool.
 */

import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  type MemoriesSearchResult,
  nmemSearch,
  type SearchKind,
  type ThreadsSearchResult,
} from "../client.ts";

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
    const text = result.note
      ? `${result.note}\n${JSON.stringify(result, null, 2)}`
      : JSON.stringify(result, null, 2);
    return {
      content: [
        {
          type: "text" as const,
          text,
        },
      ],
      details: result as MemoriesSearchResult | ThreadsSearchResult,
    };
  },
});

export default function (pi: ExtensionAPI) {
  pi.registerTool(nmemSearchTool);
}

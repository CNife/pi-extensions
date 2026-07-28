/**
 * Test suite for auto-naming-session pure transcript/refresh logic.
 *
 * Tests the two pure functions exported from the extension:
 *   - buildFullTranscript(branch): full-arc transcript string
 *   - shouldRefresh(branch, autoRefreshTurns): position-based refresh gate
 *
 * Uses real `SessionEntry` fixtures (builders fill boilerplate fields).
 * Aligns with packages/execute-python/test/kernel.test.ts precedent:
 * `node:test` + `npx tsx --test`, observable behavior only.
 *
 * Run: npx tsx --test packages/auto-naming-session/test/transcript.test.ts
 */

import { ok, strictEqual } from "node:assert";
import { test } from "node:test";
import type {
  ImageContent,
  TextContent,
  ThinkingContent,
  ToolCall,
} from "@earendil-works/pi-ai";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import {
  type AgentMessage,
  buildFullTranscript,
  buildFullTranscriptWithPending,
  hasAutoNamingTitle,
  shouldRefresh,
} from "../extensions/transcript.ts";

// ============================================================================
// Builder helpers — construct real SessionEntry fixtures with boilerplate filled
// ============================================================================

let _seq = 0;
function uid(prefix: string): string {
  _seq += 1;
  return `${prefix}${_seq}`;
}
function ts(): string {
  return new Date().toISOString();
}

type AssistantContent = (TextContent | ThinkingContent | ToolCall)[];

function userMsg(
  content: string | (TextContent | ImageContent)[],
): SessionEntry {
  return {
    type: "message",
    id: uid("u"),
    parentId: null,
    timestamp: ts(),
    message: {
      role: "user",
      content,
      timestamp: Date.now(),
    },
  };
}

function assistantMsg(content: string | AssistantContent): SessionEntry {
  const blocks: AssistantContent =
    typeof content === "string" ? [{ type: "text", text: content }] : content;
  return {
    type: "message",
    id: uid("a"),
    parentId: null,
    timestamp: ts(),
    message: {
      role: "assistant",
      content: blocks,
      api: "openai-completions",
      provider: "openai",
      model: "test-model",
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          total: 0,
        },
      },
      stopReason: "stop",
      timestamp: Date.now(),
    },
  };
}

function autoNamingTitleEntry(title: string): SessionEntry {
  return {
    type: "custom",
    id: uid("t"),
    parentId: null,
    timestamp: ts(),
    customType: "auto-naming-title",
    data: { title, timestamp: Date.now() },
  };
}

function foreignCustomEntry(customType = "bookmark"): SessionEntry {
  return {
    type: "custom",
    id: uid("x"),
    parentId: null,
    timestamp: ts(),
    customType,
    data: {},
  };
}

function compactionEntry(summary: string): SessionEntry {
  return {
    type: "compaction",
    id: uid("c"),
    parentId: null,
    timestamp: ts(),
    summary,
    firstKeptEntryId: "x",
    tokensBefore: 100,
  };
}

function branchSummaryEntry(summary: string): SessionEntry {
  return {
    type: "branch_summary",
    id: uid("b"),
    parentId: null,
    timestamp: ts(),
    fromId: "x",
    summary,
  };
}

function customMessageEntry(customType = "note"): SessionEntry {
  return {
    type: "custom_message",
    id: uid("m"),
    parentId: null,
    timestamp: ts(),
    customType,
    content: "injected text",
    display: false,
  };
}

function modelChangeEntry(): SessionEntry {
  return {
    type: "model_change",
    id: uid("mc"),
    parentId: null,
    timestamp: ts(),
    provider: "openai",
    modelId: "gpt-4",
  };
}

function thinkingLevelChangeEntry(): SessionEntry {
  return {
    type: "thinking_level_change",
    id: uid("tl"),
    parentId: null,
    timestamp: ts(),
    thinkingLevel: "medium",
  };
}

// ============================================================================
// buildFullTranscript
// ============================================================================

test("buildFullTranscript: empty branch returns null", () => {
  strictEqual(buildFullTranscript([]), null);
});

test("buildFullTranscript: single user message (string content)", () => {
  const branch = [userMsg("hello world")];
  strictEqual(buildFullTranscript(branch), "user: hello world");
});

test("buildFullTranscript: single assistant message (array content)", () => {
  const branch = [assistantMsg("I can help with that")];
  strictEqual(buildFullTranscript(branch), "assistant: I can help with that");
});

test("buildFullTranscript: user/assistant alternation joined by blank line", () => {
  const branch = [
    userMsg("build a web server"),
    assistantMsg("setting up express"),
    userMsg("add auth"),
    assistantMsg("added jwt"),
  ];
  strictEqual(
    buildFullTranscript(branch),
    "user: build a web server\n\nassistant: setting up express\n\nuser: add auth\n\nassistant: added jwt",
  );
});

test("buildFullTranscript: skips custom entries (auto-naming-title + foreign)", () => {
  const branch = [
    userMsg("start"),
    autoNamingTitleEntry("start"),
    assistantMsg("ok"),
    foreignCustomEntry("bookmark"),
  ];
  strictEqual(buildFullTranscript(branch), "user: start\n\nassistant: ok");
});

test("buildFullTranscript: skips compaction entry", () => {
  const branch = [
    userMsg("early work"),
    assistantMsg("done"),
    compactionEntry("early work summary"),
    userMsg("after compaction"),
    assistantMsg("continued"),
  ];
  strictEqual(
    buildFullTranscript(branch),
    "user: early work\n\nassistant: done\n\nuser: after compaction\n\nassistant: continued",
  );
});

test("buildFullTranscript: skips branch_summary entry", () => {
  const branch = [
    userMsg("main"),
    branchSummaryEntry("fork summary"),
    assistantMsg("reply"),
  ];
  strictEqual(buildFullTranscript(branch), "user: main\n\nassistant: reply");
});

test("buildFullTranscript: skips custom_message entry", () => {
  const branch = [
    userMsg("q"),
    customMessageEntry("injected"),
    assistantMsg("a"),
  ];
  strictEqual(buildFullTranscript(branch), "user: q\n\nassistant: a");
});

test("buildFullTranscript: skips non-message entries (model_change, thinking_level_change)", () => {
  const branch = [
    userMsg("q"),
    modelChangeEntry(),
    thinkingLevelChangeEntry(),
    assistantMsg("a"),
  ];
  strictEqual(buildFullTranscript(branch), "user: q\n\nassistant: a");
});

test("buildFullTranscript: empty content message is skipped (empty user string)", () => {
  const branch = [userMsg(""), assistantMsg("real reply")];
  strictEqual(buildFullTranscript(branch), "assistant: real reply");
});

test("buildFullTranscript: assistant with empty content array is skipped", () => {
  const branch = [userMsg("q"), assistantMsg([])];
  strictEqual(buildFullTranscript(branch), "user: q");
});

test("buildFullTranscript: user string content extracted directly", () => {
  const branch = [userMsg("plain string content")];
  strictEqual(buildFullTranscript(branch), "user: plain string content");
});

test("buildFullTranscript: array content with multiple text elements joined by space", () => {
  const branch = [
    assistantMsg([
      { type: "text", text: "first part" },
      { type: "text", text: "second part" },
    ]),
  ];
  strictEqual(buildFullTranscript(branch), "assistant: first part second part");
});

test("buildFullTranscript: array content with toolCall + thinking extracts only text", () => {
  const branch = [
    assistantMsg([
      { type: "thinking", thinking: "internal reasoning" },
      { type: "text", text: "visible answer" },
      {
        type: "toolCall",
        id: "tc1",
        name: "read",
        arguments: { path: "/x" },
      },
    ]),
  ];
  strictEqual(buildFullTranscript(branch), "assistant: visible answer");
});

test("buildFullTranscript: all-empty messages returns null", () => {
  const branch = [userMsg(""), assistantMsg([])];
  strictEqual(buildFullTranscript(branch), null);
});

test("buildFullTranscript: mixed real-world branch (all entry types)", () => {
  const branch = [
    userMsg("搭建数据库"),
    assistantMsg("连接池配好了"),
    compactionEntry("早期搭建工作摘要"),
    autoNamingTitleEntry("数据库搭建"),
    userMsg("加迁移脚本"),
    assistantMsg("迁移已建好"),
    autoNamingTitleEntry("数据库搭建与迁移"),
    foreignCustomEntry("bookmark"),
    customMessageEntry("note"),
    userMsg("现在播种测试数据"),
    assistantMsg("已用测试数据填充"),
  ];
  strictEqual(
    buildFullTranscript(branch),
    "user: 搭建数据库\n\nassistant: 连接池配好了\n\nuser: 加迁移脚本\n\nassistant: 迁移已建好\n\nuser: 现在播种测试数据\n\nassistant: 已用测试数据填充",
  );
});

// ============================================================================
// shouldRefresh
// ============================================================================

test("shouldRefresh: autoRefreshTurns null disables refresh", () => {
  const branch = [userMsg("a"), assistantMsg("b"), userMsg("c")];
  strictEqual(shouldRefresh(branch, null), false);
});

test("shouldRefresh: no custom entry, count below threshold -> false", () => {
  const branch = [userMsg("a"), assistantMsg("b")]; // 2 messages
  strictEqual(shouldRefresh(branch, 10), false);
});

test("shouldRefresh: no custom entry, count equals threshold -> true", () => {
  const branch = Array.from({ length: 10 }, (_, i) =>
    i % 2 === 0 ? userMsg(`u${i}`) : assistantMsg(`a${i}`),
  ); // 10 messages
  strictEqual(shouldRefresh(branch, 10), true);
});

test("shouldRefresh: no custom entry, count exceeds threshold -> true", () => {
  const branch = Array.from({ length: 14 }, (_, i) =>
    i % 2 === 0 ? userMsg(`u${i}`) : assistantMsg(`a${i}`),
  ); // 14 messages
  strictEqual(shouldRefresh(branch, 10), true);
});

test("shouldRefresh: single custom entry, count after it equals threshold -> true", () => {
  const branch = [
    userMsg("old1"),
    assistantMsg("old2"),
    autoNamingTitleEntry("title"),
    ...Array.from({ length: 10 }, (_, i) =>
      i % 2 === 0 ? userMsg(`u${i}`) : assistantMsg(`a${i}`),
    ), // 10 after
  ];
  strictEqual(shouldRefresh(branch, 10), true);
});

test("shouldRefresh: single custom entry, count after it below threshold -> false", () => {
  const branch = [
    userMsg("old1"),
    assistantMsg("old2"),
    autoNamingTitleEntry("title"),
    userMsg("new1"),
    assistantMsg("new2"), // 2 after
  ];
  strictEqual(shouldRefresh(branch, 10), false);
});

test("shouldRefresh: multiple custom entries, uses the LAST one", () => {
  const branch = [
    userMsg("v1"),
    autoNamingTitleEntry("title1"),
    userMsg("v2"),
    assistantMsg("v3"),
    autoNamingTitleEntry("title2"),
    userMsg("v4"),
    assistantMsg("v5"),
    userMsg("v6"),
    assistantMsg("v7"),
    userMsg("v8"),
    assistantMsg("v9"),
    userMsg("v10"),
    assistantMsg("v11"), // 8 after last title
  ];
  // 8 < 10 -> false
  strictEqual(shouldRefresh(branch, 10), false);
  // 8 >= 8 -> true (verify it counts after last title, not first)
  strictEqual(shouldRefresh(branch, 8), true);
});

test("shouldRefresh: custom entry at the end (no messages after) -> false", () => {
  const branch = [
    userMsg("a"),
    assistantMsg("b"),
    autoNamingTitleEntry("just set"), // 0 after
  ];
  strictEqual(shouldRefresh(branch, 10), false);
});

test("shouldRefresh: count equals threshold exactly at boundary -> true", () => {
  const branch = [
    autoNamingTitleEntry("title"),
    ...Array.from({ length: 10 }, (_, i) =>
      i % 2 === 0 ? userMsg(`u${i}`) : assistantMsg(`a${i}`),
    ), // exactly 10 after
  ];
  strictEqual(shouldRefresh(branch, 10), true);
});

test("shouldRefresh: only counts user+assistant, ignores other entries after title", () => {
  const branch = [
    autoNamingTitleEntry("title"),
    userMsg("u1"),
    assistantMsg("a1"),
    compactionEntry("sum"),
    foreignCustomEntry("mark"),
    customMessageEntry("note"),
    modelChangeEntry(),
    userMsg("u2"),
    assistantMsg("a2"), // 4 real messages after title
  ];
  strictEqual(shouldRefresh(branch, 4), true);
  strictEqual(shouldRefresh(branch, 5), false);
});

test("shouldRefresh: threshold 0 always refreshes when there are messages (edge)", () => {
  const branch = [userMsg("a")];
  strictEqual(shouldRefresh(branch, 0), true);
});

test("shouldRefresh: threshold 0 with empty branch -> true (0>=0 pure logic; empty transcript guarded by orchestrator)", () => {
  strictEqual(shouldRefresh([], 0), true);
});

// ============================================================================
// hasAutoNamingTitle
// ============================================================================

test("hasAutoNamingTitle: empty branch -> false", () => {
  strictEqual(hasAutoNamingTitle([]), false);
});

test("hasAutoNamingTitle: no title entry -> false", () => {
  const branch = [userMsg("a"), foreignCustomEntry("x")];
  strictEqual(hasAutoNamingTitle(branch), false);
});

test("hasAutoNamingTitle: has title entry -> true", () => {
  const branch = [userMsg("a"), autoNamingTitleEntry("t")];
  strictEqual(hasAutoNamingTitle(branch), true);
});

// ============================================================================
// buildFullTranscriptWithPending (方案 B: full + pending message)
// ============================================================================

test("buildFullTranscriptWithPending: empty branch + pending user -> single line", () => {
  const pending: AgentMessage = {
    role: "user" as const,
    content: "first",
    timestamp: Date.now(),
  };
  strictEqual(buildFullTranscriptWithPending([], pending), "user: first");
});

test("buildFullTranscriptWithPending: existing branch + pending user -> appended", () => {
  const branch = [userMsg("old q"), assistantMsg("old a")];
  const pending: AgentMessage = {
    role: "user" as const,
    content: "new q",
    timestamp: Date.now(),
  };
  strictEqual(
    buildFullTranscriptWithPending(branch, pending),
    "user: old q\n\nassistant: old a\n\nuser: new q",
  );
});

test("buildFullTranscriptWithPending: reload-with-history case (6 old + new user)", () => {
  const branch = [
    userMsg("搭建 Postgres 连接"),
    assistantMsg("配好了连接池"),
    userMsg("建用户表模型"),
    assistantMsg("User model 已建好"),
    userMsg("写测试"),
    assistantMsg("测试全绿"),
  ];
  const pending: AgentMessage = {
    role: "user" as const,
    content: "现在给 API 加上速率限制",
    timestamp: Date.now(),
  };
  const result = buildFullTranscriptWithPending(branch, pending);
  ok(result?.includes("搭建 Postgres 连接"));
  ok(result?.includes("现在给 API 加上速率限制"));
  ok(result?.endsWith("user: 现在给 API 加上速率限制"));
});

test("buildFullTranscriptWithPending: pending with array content extracts text", () => {
  const pending: AgentMessage = {
    role: "user" as const,
    content: [
      { type: "text", text: "multi" },
      { type: "text", text: "block" },
    ],
    timestamp: Date.now(),
  };
  strictEqual(buildFullTranscriptWithPending([], pending), "user: multi block");
});

test("buildFullTranscriptWithPending: pending empty text -> base only", () => {
  const branch = [userMsg("exists")];
  const pending: AgentMessage = {
    role: "user" as const,
    content: "",
    timestamp: Date.now(),
  };
  strictEqual(buildFullTranscriptWithPending(branch, pending), "user: exists");
});

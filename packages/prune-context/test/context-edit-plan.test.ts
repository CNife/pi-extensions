/**
 * prune → context-edit plan seam tests.
 * Run: npx tsx --test packages/prune-context/test/context-edit-plan.test.ts
 */

import { deepStrictEqual, strictEqual } from "node:assert";
import { test } from "node:test";
import {
  type BranchEntryLike,
  contextEditCompactionBoundary,
  type LiveMessage,
  type MessageLike,
  planContextEdits,
  selectLiveMessages,
} from "../extensions/prune.ts";

function live(
  entryId: string,
  message: MessageLike,
  lineNumber?: number,
): LiveMessage {
  return { entryId, message, lineNumber };
}

function messageEntry(id: string, message: MessageLike): BranchEntryLike {
  return { type: "message", id, message };
}

test("keeps user and assistant text, but removes thinking content from assistant entries", () => {
  const plan = planContextEdits([
    live("user-1", { role: "user", content: "Keep this request" }),
    live("assistant-1", {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "private reasoning" },
        { type: "text", text: "Keep this answer" },
      ],
    }),
  ]);

  deepStrictEqual(plan, [
    { entryId: "user-1", action: "keep" },
    {
      entryId: "assistant-1",
      action: "replace",
      replacement: { content: [{ type: "text", text: "Keep this answer" }] },
    },
  ]);
});

test("trims Plan C tool-call payload fields and annotates each call with its recall anchor", () => {
  const plan = planContextEdits([
    live(
      "assistant-calls",
      {
        role: "assistant",
        content: [
          { type: "text", text: "Running tools" },
          { type: "thinking", thinking: "private reasoning" },
          {
            type: "toolCall",
            id: "read-1",
            name: "read",
            arguments: { path: "/tmp/a.ts", offset: 4 },
          },
          {
            type: "toolCall",
            id: "write-1",
            name: "write",
            arguments: { path: "/tmp/b.ts", content: "large payload" },
          },
          {
            type: "toolCall",
            id: "edit-1",
            name: "edit",
            arguments: {
              path: "/tmp/c.ts",
              oldText: "old",
              newText: "new",
              replaceAll: false,
            },
          },
        ],
      },
      14,
    ),
  ]);

  deepStrictEqual(plan, [
    {
      entryId: "assistant-calls",
      action: "replace",
      replacement: {
        content: [
          { type: "text", text: "Running tools" },
          {
            type: "toolCall",
            id: "read-1",
            name: "read",
            arguments: { path: "/tmp/a.ts", offset: 4 },
          },
          { type: "text", text: "#14.1" },
          {
            type: "toolCall",
            id: "write-1",
            name: "write",
            arguments: { path: "/tmp/b.ts" },
          },
          { type: "text", text: "#14.2" },
          {
            type: "toolCall",
            id: "edit-1",
            name: "edit",
            arguments: { path: "/tmp/c.ts", replaceAll: false },
          },
          { type: "text", text: "#14.3" },
        ],
      },
    },
  ]);
});

test("omits pruned tool results and keeps non-pruned failures", () => {
  const plan = planContextEdits([
    live("success", {
      role: "toolResult",
      toolName: "search",
      isError: false,
      content: "result",
    }),
    live("failed", {
      role: "toolResult",
      toolName: "search",
      isError: true,
      content: "error detail",
    }),
    live("read-failed", {
      role: "toolResult",
      toolName: "read",
      isError: true,
      content: "read error",
    }),
    live("write-success", {
      role: "toolResult",
      toolName: "write",
      isError: false,
      content: "written",
    }),
  ]);

  deepStrictEqual(plan, [
    { entryId: "success", action: "omit", replacement: null },
    { entryId: "failed", action: "keep" },
    { entryId: "read-failed", action: "omit", replacement: null },
    { entryId: "write-success", action: "omit", replacement: null },
  ]);
});

test("keeps bashExecution entries because appendContextEdit cannot edit that upstream role", () => {
  deepStrictEqual(
    planContextEdits([
      live("bash-success", {
        role: "bashExecution",
        command: "make",
        output: "large output",
        exitCode: 0,
      }),
      live("bash-failure", {
        role: "bashExecution",
        command: "make",
        output: "failure output",
        exitCode: 1,
      }),
    ]),
    [
      { entryId: "bash-success", action: "keep" },
      { entryId: "bash-failure", action: "keep" },
    ],
  );
});

test("still applies field pruning without a line mapping, but omits an unusable recall anchor", () => {
  const plan = planContextEdits([
    live("assistant-write", {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "private reasoning" },
        {
          type: "toolCall",
          id: "write-1",
          name: "write",
          arguments: { path: "/tmp/a.ts", content: "large payload" },
        },
      ],
    }),
  ]);

  deepStrictEqual(plan, [
    {
      entryId: "assistant-write",
      action: "replace",
      replacement: {
        content: [
          {
            type: "toolCall",
            id: "write-1",
            name: "write",
            arguments: { path: "/tmp/a.ts" },
          },
        ],
      },
    },
  ]);
});

test("uses legacy compaction kept suffix and recovers orphaned or compact-all boundaries", () => {
  const entries: BranchEntryLike[] = [
    messageEntry("old", {
      role: "user",
      content: "summarized before legacy compaction",
    }),
    messageEntry("kept", {
      role: "user",
      content: "kept after legacy compaction",
    }),
    {
      type: "compaction",
      id: "legacy",
      firstKeptEntryId: "kept",
      summary: "old summary",
    },
    messageEntry("after", { role: "assistant", content: "newer message" }),
  ];

  deepStrictEqual(
    selectLiveMessages(entries).map(({ entryId }) => entryId),
    ["kept", "after"],
  );
  deepStrictEqual(
    selectLiveMessages([
      messageEntry("old", { role: "user", content: "before" }),
      {
        type: "compaction",
        id: "orphan",
        firstKeptEntryId: "missing",
        summary: "legacy summary",
      },
      messageEntry("after-orphan", { role: "user", content: "after" }),
    ]).map(({ entryId }) => entryId),
    ["after-orphan"],
  );
  deepStrictEqual(
    selectLiveMessages([
      messageEntry("old", { role: "user", content: "before" }),
      {
        type: "compaction",
        id: "compact-all",
        firstKeptEntryId: "",
        summary: "legacy summary",
      },
      messageEntry("after-compact-all", { role: "user", content: "after" }),
    ]).map(({ entryId }) => entryId),
    ["after-compact-all"],
  );
});

test("chooses a valid compaction handoff and never reuses an orphaned firstKeptEntryId", () => {
  const branch: BranchEntryLike[] = [
    messageEntry("kept", { role: "user", content: "kept" }),
    {
      type: "compaction",
      id: "legacy",
      firstKeptEntryId: "missing",
      summary: "old summary",
    },
    messageEntry("after", { role: "assistant", content: "answer" }),
  ];

  strictEqual(
    contextEditCompactionBoundary(branch, [
      { entryId: "after", action: "keep" },
    ]),
    "legacy",
  );
  strictEqual(
    contextEditCompactionBoundary(
      [messageEntry("only", { role: "assistant", content: "x" })],
      [{ entryId: "only", action: "omit", replacement: null }],
    ),
    null,
  );
});

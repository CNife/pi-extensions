/**
 * prune 的 context-edit 计划接缝测试。
 *
 * 覆盖 live message 选择、上下文编辑计划与 compaction 边界。
 *
 * Run: npx vitest run packages/prune-context/test/context-edit-plan.test.ts
 */

import { expect, test } from "vitest";
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

test("保留 user 和 assistant 文本，并移除 assistant 条目的 thinking 内容", () => {
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

  expect(plan).toEqual([
    { entryId: "user-1", action: "keep" },
    {
      entryId: "assistant-1",
      action: "replace",
      replacement: { content: [{ type: "text", text: "Keep this answer" }] },
    },
  ]);
});

test("裁剪 Plan C tool-call 载荷字段，并为每个调用添加 recall 锚点", () => {
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
          {
            type: "toolCall",
            id: "bash-1",
            name: "bash",
            arguments: { command: "printf hi", timeout: 1000 },
          },
        ],
      },
      14,
    ),
    live("read-result", {
      role: "toolResult",
      toolCallId: "read-1",
      toolName: "read",
      isError: false,
      content: "result removed by Plan C",
    }),
  ]);

  expect(plan).toEqual([
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
          {
            type: "toolCall",
            id: "bash-1",
            name: "bash",
            arguments: { command: "printf hi", timeout: 1000 },
          },
        ],
      },
    },
    { entryId: "read-result", action: "omit", replacement: null },
  ]);
});

test("省略已裁剪的工具结果并保留未裁剪的失败结果", () => {
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

  expect(plan).toEqual([
    { entryId: "success", action: "omit", replacement: null },
    { entryId: "failed", action: "keep" },
    { entryId: "read-failed", action: "omit", replacement: null },
    { entryId: "write-success", action: "omit", replacement: null },
  ]);
});

test("保留 bashExecution 条目，因为 appendContextEdit 无法编辑上游该角色", () => {
  expect(planContextEdits([
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
    ])).toEqual([
      { entryId: "bash-success", action: "keep" },
      { entryId: "bash-failure", action: "keep" },
    ],);
});

test("没有行映射时仍裁剪字段，但省略不可用的 recall 锚点", () => {
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

  expect(plan).toEqual([
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

test("使用旧版 compaction 保留后缀，并恢复孤立或 compact-all 边界", () => {
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

  expect(selectLiveMessages(entries).map(({ entryId }) => entryId)).toEqual(["kept", "after"],);
  expect(selectLiveMessages([
      messageEntry("old", { role: "user", content: "before" }),
      {
        type: "compaction",
        id: "orphan",
        firstKeptEntryId: "missing",
        summary: "legacy summary",
      },
      messageEntry("after-orphan", { role: "user", content: "after" }),
    ]).map(({ entryId }) => entryId)).toEqual(["after-orphan"],);
  expect(selectLiveMessages([
      messageEntry("old", { role: "user", content: "before" }),
      {
        type: "compaction",
        id: "compact-all",
        firstKeptEntryId: "",
        summary: "legacy summary",
      },
      messageEntry("after-compact-all", { role: "user", content: "after" }),
    ]).map(({ entryId }) => entryId)).toEqual(["after-compact-all"],);
});

test("选择有效的 compaction 交接点，并避免复用孤立的 firstKeptEntryId", () => {
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

  expect(contextEditCompactionBoundary(branch, [
      { entryId: "after", action: "keep" },
    ])).toBe("after",);
  expect(contextEditCompactionBoundary(
      [
        branch[0],
        { ...branch[1], firstKeptEntryId: "kept" },
        branch[2],
      ],
      [{ entryId: "after", action: "keep" }],
    )).toBe("kept",);
  expect(contextEditCompactionBoundary(
      [messageEntry("only", { role: "assistant", content: "x" })],
      [{ entryId: "only", action: "omit", replacement: null }],
    )).toBe(null,);
});
test("不重新规划已有分支内 context edit 的条目", () => {
  expect(selectLiveMessages([
      messageEntry("edited", { role: "assistant", content: "already trimmed" }),
      {
        type: "context_edit",
        id: "edit-entry",
        targetId: "edited",
        replacement: { content: "already trimmed" },
      },
      messageEntry("new", { role: "user", content: "new message" }),
    ]).map(({ entryId }) => entryId)).toEqual(["new"],);
});
test("省略仅含 thinking 的 assistant 条目，并使用单次调用的短锚点", () => {
  expect(planContextEdits([
      live("thinking-only", {
        role: "assistant",
        content: [{ type: "thinking", thinking: "private reasoning" }],
      }),
      live(
        "single-call",
        {
          role: "assistant",
          content: [
            {
              type: "toolCall",
              id: "write-1",
              name: "write",
              arguments: { path: "/tmp/a.ts", content: "payload" },
            },
          ],
        },
        23,
      ),
    ])).toEqual([
      { entryId: "thinking-only", action: "omit", replacement: null },
      {
        entryId: "single-call",
        action: "replace",
        replacement: {
          content: [
            {
              type: "toolCall",
              id: "write-1",
              name: "write",
              arguments: { path: "/tmp/a.ts" },
            },
            { type: "text", text: "#23" },
          ],
        },
      },
    ],);
});
test("没有裁剪内容时不编辑完整 tool call", () => {
  expect(planContextEdits([
      live(
        "full-read",
        {
          role: "assistant",
          content: [
            {
              type: "toolCall",
              id: "read-1",
              name: "read",
              arguments: { path: "/tmp/a.ts", offset: 12 },
            },
          ],
        },
        29,
      ),
    ])).toEqual([{ entryId: "full-read", action: "keep" }],);
});
test("在新的 compaction 边界中保留模型可见的自定义消息", () => {
  const branch: BranchEntryLike[] = [
    {
      type: "custom_message",
      id: "custom",
      customType: "example",
      content: "Keep custom context",
      display: false,
    },
    messageEntry("next", { role: "user", content: "Next request" }),
  ];
  const liveMessages = selectLiveMessages(branch);
  const plan = planContextEdits(liveMessages);

  expect(liveMessages.map(({ entryId }) => entryId)).toEqual(["custom", "next"]);
  expect(plan.map(({ action }) => action)).toEqual(["keep", "keep"]);
  expect(contextEditCompactionBoundary(branch, plan)).toBe("custom");
});

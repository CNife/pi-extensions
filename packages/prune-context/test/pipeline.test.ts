/**
 * prune → format 管线测试（接缝 1）。
 *
 * 纯函数管线：pruneMessages → formatSummary。
 * 用 node:test + tsx --test，仅验证可观察行为。
 *
 * Run: npx tsx --test packages/prune-context/test/pipeline.test.ts
 */

import { ok, strictEqual } from "node:assert";
import { test } from "node:test";
import { formatSummary } from "../extensions/format.ts";
import { type MessageLike, pruneMessages } from "../extensions/prune.ts";

// ============================================================================
// Fixtures
// ============================================================================

function userMsg(text: string): MessageLike {
  return { role: "user", content: text };
}

function assistantTextMsg(text: string): MessageLike {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
  };
}

function assistantMixedMsg(): MessageLike {
  return {
    role: "assistant",
    content: [
      { type: "thinking", thinking: "internal reasoning..." },
      { type: "text", text: "Here is the answer." },
      {
        type: "toolCall",
        id: "tc1",
        name: "read",
        args: { path: "/tmp/foo.ts" },
      },
    ],
  };
}

function toolResultMsg(): MessageLike {
  return {
    role: "toolResult",
    content: [{ type: "text", text: "file content here" }],
  };
}

// ============================================================================
// pruneMessages
// ============================================================================

test("pruneMessages: user/assistant text 全留", () => {
  const messages: MessageLike[] = [
    userMsg("Hello"),
    assistantTextMsg("Hi there"),
    userMsg("Do something"),
    assistantTextMsg("Done"),
  ];
  const entries = pruneMessages(messages);
  strictEqual(entries.length, 4);
  strictEqual(entries[0].role, "user");
  strictEqual(entries[0].text, "Hello");
  strictEqual(entries[1].role, "assistant");
  strictEqual(entries[1].text, "Hi there");
  strictEqual(entries[2].role, "user");
  strictEqual(entries[2].text, "Do something");
  strictEqual(entries[3].role, "assistant");
  strictEqual(entries[3].text, "Done");
});

test("pruneMessages: toolResult 跳过", () => {
  const messages: MessageLike[] = [
    userMsg("Read a file"),
    assistantMixedMsg(),
    toolResultMsg(),
    assistantTextMsg("File read complete."),
  ];
  const entries = pruneMessages(messages);
  // user + assistant(text only) + assistant(text) = 3
  strictEqual(entries.length, 3);
  strictEqual(entries[0].text, "Read a file");
  strictEqual(entries[1].text, "Here is the answer.");
  strictEqual(entries[2].text, "File read complete.");
});

test("pruneMessages: thinking 和 toolCall 不出现在输出中", () => {
  const messages: MessageLike[] = [assistantMixedMsg()];
  const entries = pruneMessages(messages);
  strictEqual(entries.length, 1);
  ok(!entries[0].text.includes("internal reasoning"));
  ok(!entries[0].text.includes("toolCall"));
  strictEqual(entries[0].text, "Here is the answer.");
});

test("pruneMessages: 空文本条目不输出", () => {
  const messages: MessageLike[] = [
    userMsg(""),
    { role: "assistant", content: [{ type: "thinking", thinking: "hmm" }] },
    userMsg("real message"),
  ];
  const entries = pruneMessages(messages);
  strictEqual(entries.length, 1);
  strictEqual(entries[0].text, "real message");
});

test("pruneMessages: user content 为 content-part 数组", () => {
  const messages: MessageLike[] = [
    {
      role: "user",
      content: [
        { type: "text", text: "part one" },
        { type: "image", mimeType: "image/png", data: "..." },
        { type: "text", text: "part two" },
      ],
    },
  ];
  const entries = pruneMessages(messages);
  strictEqual(entries.length, 1);
  strictEqual(entries[0].text, "part one\npart two");
});

// ============================================================================
// formatSummary
// ============================================================================

test("formatSummary: 首行统计 + role 渲染", () => {
  const entries = pruneMessages([userMsg("Hello"), assistantTextMsg("Hi")]);
  const summary = formatSummary(entries, 5);
  const lines = summary.split("\n");
  strictEqual(lines[0], "Pruned 5 messages.");
  strictEqual(lines[1], "");
  strictEqual(lines[2], "**user**: Hello");
  strictEqual(lines[3], "");
  strictEqual(lines[4], "**assistant**: Hi");
});

test("formatSummary: previousSummary 透传在顶部", () => {
  const entries = pruneMessages([userMsg("New message")]);
  const summary = formatSummary(
    entries,
    3,
    "Old summary line 1\nOld summary line 2",
  );
  const lines = summary.split("\n");
  strictEqual(lines[0], "Pruned 3 messages.");
  strictEqual(lines[1], "");
  strictEqual(lines[2], "Old summary line 1");
  strictEqual(lines[3], "Old summary line 2");
  strictEqual(lines[4], "");
  strictEqual(lines[5], "**user**: New message");
});

test("formatSummary: 空 entries 只输出统计行", () => {
  const summary = formatSummary([], 10);
  strictEqual(summary, "Pruned 10 messages.");
});

// ============================================================================
// 管线集成：text-only fixture → summary
// ============================================================================

test("pipeline: text-only fixture 产出完整 summary", () => {
  const messages: MessageLike[] = [
    userMsg("请帮我读一下 main.ts"),
    assistantTextMsg("好的，我来读取文件。"),
    assistantMixedMsg(), // thinking + text + toolCall → 只留 text
    toolResultMsg(), // 跳过
    assistantTextMsg("文件内容已读取，主要包含一个入口函数。"),
    userMsg("谢谢"),
  ];

  const entries = pruneMessages(messages);
  const summary = formatSummary(entries, messages.length);

  // 首行统计
  ok(summary.startsWith("Pruned 6 messages."));
  // user/assistant text 保留
  ok(summary.includes("**user**: 请帮我读一下 main.ts"));
  ok(summary.includes("**assistant**: 好的，我来读取文件。"));
  ok(summary.includes("**assistant**: Here is the answer."));
  ok(summary.includes("**assistant**: 文件内容已读取，主要包含一个入口函数。"));
  ok(summary.includes("**user**: 谢谢"));
  // thinking / toolCall / toolResult 不出现
  ok(!summary.includes("internal reasoning"));
  ok(!summary.includes("toolCall"));
  ok(!summary.includes("file content here"));
});

/**
 * prune → format 管线测试（接缝 1）。
 *
 * 纯函数管线：pruneMessages → formatSummary。
 * 用 node:test + tsx --test，仅验证可观察行为。
 *
 * Run: npx tsx --test packages/prune-context/test/pipeline.test.ts
 */

import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { test } from "node:test";
import { formatSummary } from "../extensions/format.ts";
import {
  extractFiles,
  type MessageLike,
  type PrunedEntry,
  pruneMessages,
} from "../extensions/prune.ts";

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

function assistantThinkingMsg(): MessageLike {
  return {
    role: "assistant",
    content: [
      { type: "thinking", thinking: "internal reasoning..." },
      { type: "text", text: "Here is the answer." },
    ],
  };
}

function assistantToolCallMsg(
  toolCalls: Array<{ id: string; name: string; args: Record<string, unknown> }>,
  text?: string,
): MessageLike {
  const content: unknown[] = [];
  if (text) {
    content.push({ type: "text", text });
  }
  for (const tc of toolCalls) {
    content.push({
      type: "toolCall",
      id: tc.id,
      name: tc.name,
      arguments: tc.args,
    });
  }
  return { role: "assistant", content };
}

function toolResultMsg(
  toolName: string,
  isError: boolean,
  text: string,
): MessageLike {
  return {
    role: "toolResult",
    toolCallId: `tc-${toolName}`,
    toolName,
    content: [{ type: "text", text }],
    isError,
  };
}

function bashSuccessMsg(command: string, output: string): MessageLike {
  return {
    role: "bashExecution",
    command,
    output,
    exitCode: 0,
    cancelled: false,
  };
}

function bashFailedMsg(
  command: string,
  output: string,
  exitCode: number,
): MessageLike {
  return {
    role: "bashExecution",
    command,
    output,
    exitCode,
    cancelled: false,
  };
}

function bashCancelledMsg(command: string, output: string): MessageLike {
  return {
    role: "bashExecution",
    command,
    output,
    exitCode: undefined,
    cancelled: true,
  };
}

function customMsg(customType: string, text: string): MessageLike {
  return {
    role: "custom",
    customType,
    content: [{ type: "text", text }],
  };
}

// ============================================================================
// pruneMessages: 基本规则
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
  strictEqual(entries[0].kind, "text");
  strictEqual((entries[0] as { role: string }).role, "user");
  strictEqual((entries[0] as { text: string }).text, "Hello");
  strictEqual(entries[1].kind, "text");
  strictEqual((entries[1] as { text: string }).text, "Hi there");
});

test("pruneMessages: thinking 全裁", () => {
  const messages: MessageLike[] = [assistantThinkingMsg()];
  const entries = pruneMessages(messages);
  strictEqual(entries.length, 1);
  strictEqual(entries[0].kind, "text");
  strictEqual((entries[0] as { text: string }).text, "Here is the answer.");
  // thinking 内容不出现
  ok(
    !JSON.stringify(entries).includes("internal reasoning"),
    "thinking should not appear",
  );
});

test("pruneMessages: 纯 thinking 消息不产出条目", () => {
  const messages: MessageLike[] = [
    {
      role: "assistant",
      content: [{ type: "thinking", thinking: "hmm" }],
    },
  ];
  const entries = pruneMessages(messages);
  strictEqual(entries.length, 0);
});

test("pruneMessages: 空文本条目不输出", () => {
  const messages: MessageLike[] = [
    userMsg(""),
    { role: "assistant", content: [{ type: "thinking", thinking: "hmm" }] },
    userMsg("real message"),
  ];
  const entries = pruneMessages(messages);
  strictEqual(entries.length, 1);
  strictEqual((entries[0] as { text: string }).text, "real message");
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
  strictEqual((entries[0] as { text: string }).text, "part one\npart two");
});

// ============================================================================
// pruneMessages: toolCall 裁剪规则
// ============================================================================

test("pruneMessages: read toolCall 保留全参数", () => {
  const messages: MessageLike[] = [
    assistantToolCallMsg([
      { id: "tc1", name: "read", args: { path: "/tmp/foo.ts", offset: 10 } },
    ]),
  ];
  const entries = pruneMessages(messages);
  strictEqual(entries.length, 1);
  strictEqual(entries[0].kind, "toolCall");
  const tc = entries[0] as { name: string; args: Record<string, unknown> };
  strictEqual(tc.name, "read");
  deepStrictEqual(tc.args, { path: "/tmp/foo.ts", offset: 10 });
});

test("pruneMessages: write toolCall 裁 content 保留 file_path", () => {
  const messages: MessageLike[] = [
    assistantToolCallMsg([
      {
        id: "tc1",
        name: "write",
        args: {
          file_path: "/tmp/out.ts",
          content: "const x = 1;\nconst y = 2;",
        },
      },
    ]),
  ];
  const entries = pruneMessages(messages);
  strictEqual(entries.length, 1);
  const tc = entries[0] as { name: string; args: Record<string, unknown> };
  strictEqual(tc.name, "write");
  deepStrictEqual(tc.args, { file_path: "/tmp/out.ts" });
  ok(!("content" in tc.args), "content should be pruned");
});

test("pruneMessages: edit toolCall 裁 oldText+newText 保留 file_path", () => {
  const messages: MessageLike[] = [
    assistantToolCallMsg([
      {
        id: "tc1",
        name: "edit",
        args: {
          file_path: "/tmp/main.ts",
          oldText: "const a = 1;",
          newText: "const a = 2;",
          replaceAll: false,
        },
      },
    ]),
  ];
  const entries = pruneMessages(messages);
  strictEqual(entries.length, 1);
  const tc = entries[0] as { name: string; args: Record<string, unknown> };
  strictEqual(tc.name, "edit");
  deepStrictEqual(tc.args, { file_path: "/tmp/main.ts", replaceAll: false });
  ok(!("oldText" in tc.args), "oldText should be pruned");
  ok(!("newText" in tc.args), "newText should be pruned");
});

test("pruneMessages: bash toolCall 保留全参数", () => {
  const messages: MessageLike[] = [
    assistantToolCallMsg([
      { id: "tc1", name: "bash", args: { command: "ls -la", timeout: 30 } },
    ]),
  ];
  const entries = pruneMessages(messages);
  strictEqual(entries.length, 1);
  const tc = entries[0] as { name: string; args: Record<string, unknown> };
  strictEqual(tc.name, "bash");
  deepStrictEqual(tc.args, { command: "ls -la", timeout: 30 });
});

test("pruneMessages: 多 toolCall 消息各自产出条目", () => {
  const messages: MessageLike[] = [
    assistantToolCallMsg([
      { id: "tc1", name: "read", args: { path: "/a.ts" } },
      { id: "tc2", name: "read", args: { path: "/b.ts" } },
    ]),
  ];
  const entries = pruneMessages(messages);
  strictEqual(entries.length, 2);
  strictEqual(entries[0].kind, "toolCall");
  strictEqual(entries[1].kind, "toolCall");
});

test("pruneMessages: assistant text + toolCall 混合消息", () => {
  const messages: MessageLike[] = [
    assistantToolCallMsg(
      [{ id: "tc1", name: "read", args: { path: "/x.ts" } }],
      "Let me read the file.",
    ),
  ];
  const entries = pruneMessages(messages);
  strictEqual(entries.length, 2);
  strictEqual(entries[0].kind, "text");
  strictEqual((entries[0] as { text: string }).text, "Let me read the file.");
  strictEqual(entries[1].kind, "toolCall");
});

// ============================================================================
// pruneMessages: toolResult 裁剪规则
// ============================================================================

test("pruneMessages: read toolResult 成功全裁", () => {
  const messages: MessageLike[] = [
    toolResultMsg("read", false, "file content here"),
  ];
  const entries = pruneMessages(messages);
  strictEqual(entries.length, 0);
});

test("pruneMessages: write toolResult 成功全裁", () => {
  const messages: MessageLike[] = [
    toolResultMsg("write", false, "File written successfully"),
  ];
  const entries = pruneMessages(messages);
  strictEqual(entries.length, 0);
});

test("pruneMessages: read toolResult 失败也裁", () => {
  const messages: MessageLike[] = [
    toolResultMsg("read", true, "ENOENT: no such file"),
  ];
  const entries = pruneMessages(messages);
  strictEqual(entries.length, 0);
});

test("pruneMessages: 其他工具 toolResult 成功裁", () => {
  const messages: MessageLike[] = [toolResultMsg("bash", false, "output here")];
  const entries = pruneMessages(messages);
  strictEqual(entries.length, 0);
});

test("pruneMessages: 其他工具 toolResult 失败保留", () => {
  const messages: MessageLike[] = [
    toolResultMsg("bash", true, "Error: command failed"),
  ];
  const entries = pruneMessages(messages);
  strictEqual(entries.length, 1);
  strictEqual(entries[0].kind, "toolResultFailed");
  const tr = entries[0] as { toolName: string; content: string };
  strictEqual(tr.toolName, "bash");
  strictEqual(tr.content, "Error: command failed");
});

// ============================================================================
// pruneMessages: bashExecution 裁剪规则
// ============================================================================

test("pruneMessages: bashExecution 成功裁 output 留 command", () => {
  const messages: MessageLike[] = [
    bashSuccessMsg("npm test", "All tests passed\nDone in 3.2s"),
  ];
  const entries = pruneMessages(messages);
  strictEqual(entries.length, 1);
  strictEqual(entries[0].kind, "bashSuccess");
  strictEqual((entries[0] as { command: string }).command, "npm test");
  ok(
    !JSON.stringify(entries).includes("All tests passed"),
    "output should be pruned",
  );
});

test("pruneMessages: bashExecution 失败全留", () => {
  const messages: MessageLike[] = [
    bashFailedMsg("npm test", "FAIL: 3 tests failed", 1),
  ];
  const entries = pruneMessages(messages);
  strictEqual(entries.length, 1);
  strictEqual(entries[0].kind, "bashFailed");
  const bash = entries[0] as {
    command: string;
    output: string;
    exitCode: number;
  };
  strictEqual(bash.command, "npm test");
  strictEqual(bash.output, "FAIL: 3 tests failed");
  strictEqual(bash.exitCode, 1);
});

test("pruneMessages: bashExecution cancelled 视为失败", () => {
  const messages: MessageLike[] = [
    bashCancelledMsg("sleep 100", "partial output"),
  ];
  const entries = pruneMessages(messages);
  strictEqual(entries.length, 1);
  strictEqual(entries[0].kind, "bashFailed");
  const bash = entries[0] as { cancelled: boolean };
  strictEqual(bash.cancelled, true);
});

test("pruneMessages: bashExecution excludeFromContext 跳过", () => {
  const messages: MessageLike[] = [
    {
      role: "bashExecution",
      command: "hidden",
      output: "secret",
      exitCode: 0,
      cancelled: false,
      excludeFromContext: true,
    },
  ];
  const entries = pruneMessages(messages);
  strictEqual(entries.length, 0);
});

// ============================================================================
// pruneMessages: custom_message
// ============================================================================

test("pruneMessages: custom_message 作为 user text 保留", () => {
  const messages: MessageLike[] = [
    customMsg("inline-skill", "Use TDD workflow for this task."),
  ];
  const entries = pruneMessages(messages);
  strictEqual(entries.length, 1);
  strictEqual(entries[0].kind, "text");
  strictEqual((entries[0] as { role: string }).role, "user");
  strictEqual(
    (entries[0] as { text: string }).text,
    "Use TDD workflow for this task.",
  );
});

// ============================================================================
// pruneMessages: 锚点
// ============================================================================

test("pruneMessages: 单 toolCall 锚点省略 .1", () => {
  const messages: MessageLike[] = [
    assistantToolCallMsg([
      { id: "tc1", name: "read", args: { path: "/a.ts" } },
    ]),
  ];
  const lineNumbers = [14];
  const entries = pruneMessages(messages, lineNumbers);
  strictEqual(entries.length, 1);
  strictEqual((entries[0] as { anchor: string }).anchor, "#14");
});

test("pruneMessages: 多 toolCall 锚点带索引", () => {
  const messages: MessageLike[] = [
    assistantToolCallMsg([
      { id: "tc1", name: "read", args: { path: "/a.ts" } },
      { id: "tc2", name: "read", args: { path: "/b.ts" } },
      { id: "tc3", name: "bash", args: { command: "ls" } },
    ]),
  ];
  const lineNumbers = [20];
  const entries = pruneMessages(messages, lineNumbers);
  strictEqual(entries.length, 3);
  strictEqual((entries[0] as { anchor: string }).anchor, "#20.1");
  strictEqual((entries[1] as { anchor: string }).anchor, "#20.2");
  strictEqual((entries[2] as { anchor: string }).anchor, "#20.3");
});

test("pruneMessages: 无行号时锚点为空", () => {
  const messages: MessageLike[] = [
    assistantToolCallMsg([
      { id: "tc1", name: "read", args: { path: "/a.ts" } },
    ]),
  ];
  const entries = pruneMessages(messages);
  strictEqual(entries.length, 1);
  strictEqual((entries[0] as { anchor: string }).anchor, "");
});

test("pruneMessages: text + toolCall 混合消息的锚点", () => {
  const messages: MessageLike[] = [
    assistantToolCallMsg(
      [
        { id: "tc1", name: "read", args: { path: "/a.ts" } },
        {
          id: "tc2",
          name: "write",
          args: { file_path: "/b.ts", content: "x" },
        },
      ],
      "Reading and writing.",
    ),
  ];
  const lineNumbers = [5];
  const entries = pruneMessages(messages, lineNumbers);
  // text + 2 toolCalls = 3 entries
  strictEqual(entries.length, 3);
  strictEqual(entries[0].kind, "text");
  strictEqual((entries[1] as { anchor: string }).anchor, "#5.1");
  strictEqual((entries[2] as { anchor: string }).anchor, "#5.2");
});

// ============================================================================
// extractFiles
// ============================================================================

test("extractFiles: 从 toolCall args 提取 path/file_path", () => {
  const messages: MessageLike[] = [
    assistantToolCallMsg([
      { id: "tc1", name: "read", args: { path: "/src/main.ts" } },
      {
        id: "tc2",
        name: "write",
        args: { file_path: "/src/out.ts", content: "x" },
      },
    ]),
    assistantToolCallMsg([
      { id: "tc3", name: "read", args: { path: "/src/main.ts" } }, // 重复
    ]),
    userMsg("no tools here"),
  ];
  const files = extractFiles(messages);
  deepStrictEqual(files, ["/src/main.ts", "/src/out.ts"]);
});

test("extractFiles: 无 toolCall 返回空数组", () => {
  const messages: MessageLike[] = [userMsg("hello"), assistantTextMsg("hi")];
  const files = extractFiles(messages);
  deepStrictEqual(files, []);
});

// ============================================================================
// formatSummary
// ============================================================================

test("formatSummary: 首行统计 + Files 列表", () => {
  const entries: PrunedEntry[] = [
    { kind: "text", role: "user", text: "Hello" },
  ];
  const summary = formatSummary(entries, 5, ["/a.ts", "/b.ts"]);
  const lines = summary.split("\n");
  strictEqual(lines[0], "Pruned 5 messages. Files: /a.ts, /b.ts");
});

test("formatSummary: 无文件时不输出 Files", () => {
  const entries: PrunedEntry[] = [
    { kind: "text", role: "user", text: "Hello" },
  ];
  const summary = formatSummary(entries, 3, []);
  strictEqual(summary.split("\n")[0], "Pruned 3 messages.");
});

test("formatSummary: toolCall 渲染格式", () => {
  const entries: PrunedEntry[] = [
    {
      kind: "toolCall",
      name: "read",
      args: { path: "/tmp/foo.ts" },
      anchor: "#14",
    },
  ];
  const summary = formatSummary(entries, 2);
  ok(summary.includes('- read({"path":"/tmp/foo.ts"}) #14'));
});

test("formatSummary: 多 toolCall 渲染", () => {
  const entries: PrunedEntry[] = [
    {
      kind: "toolCall",
      name: "read",
      args: { path: "/a.ts" },
      anchor: "#20.1",
    },
    {
      kind: "toolCall",
      name: "bash",
      args: { command: "ls" },
      anchor: "#20.2",
    },
  ];
  const summary = formatSummary(entries, 3);
  ok(summary.includes('- read({"path":"/a.ts"}) #20.1'));
  ok(summary.includes('- bash({"command":"ls"}) #20.2'));
});

test("formatSummary: 失败 toolResult 在 code block 中", () => {
  const entries: PrunedEntry[] = [
    {
      kind: "toolResultFailed",
      toolName: "bash",
      content: "Error: ENOENT",
    },
  ];
  const summary = formatSummary(entries, 2);
  ok(summary.includes("**toolResult** (bash, error):"));
  ok(summary.includes("```\nError: ENOENT\n```"));
});

test("formatSummary: bashSuccess 渲染", () => {
  const entries: PrunedEntry[] = [{ kind: "bashSuccess", command: "npm test" }];
  const summary = formatSummary(entries, 2);
  ok(summary.includes("**bash**: `npm test`"));
});

test("formatSummary: bashFailed 渲染", () => {
  const entries: PrunedEntry[] = [
    {
      kind: "bashFailed",
      command: "npm test",
      output: "FAIL: 3 tests",
      exitCode: 1,
      cancelled: false,
    },
  ];
  const summary = formatSummary(entries, 2);
  ok(summary.includes("**bash** (exit 1): `npm test`"));
  ok(summary.includes("```\nFAIL: 3 tests\n```"));
});

test("formatSummary: bashFailed cancelled 渲染", () => {
  const entries: PrunedEntry[] = [
    {
      kind: "bashFailed",
      command: "sleep 100",
      output: "partial",
      exitCode: undefined,
      cancelled: true,
    },
  ];
  const summary = formatSummary(entries, 2);
  ok(summary.includes("**bash** (cancelled): `sleep 100`"));
});

test("formatSummary: previousSummary 透传在顶部", () => {
  const entries: PrunedEntry[] = [
    { kind: "text", role: "user", text: "New message" },
  ];
  const summary = formatSummary(
    entries,
    3,
    [],
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
// 管线集成：全类型 fixture → summary
// ============================================================================

test("pipeline: 全消息类型 fixture 产出完整 summary", () => {
  const messages: MessageLike[] = [
    userMsg("请帮我读一下 main.ts"), // 保留
    assistantToolCallMsg(
      [{ id: "tc1", name: "read", args: { path: "/src/main.ts" } }],
      "好的，我来读取文件。",
    ), // text 保留 + toolCall 保留
    toolResultMsg("read", false, "export function main() {}"), // 裁（read 成功）
    assistantThinkingMsg(), // thinking 裁，text 保留
    assistantToolCallMsg([
      {
        id: "tc2",
        name: "write",
        args: { file_path: "/src/out.ts", content: "const x = 1;" },
      },
    ]), // toolCall 裁 content
    toolResultMsg("write", false, "File written"), // 裁（write 成功）
    bashSuccessMsg("npm test", "All passed"), // 裁 output 留 command
    bashFailedMsg("npm run build", "Error: build failed", 1), // 全留
    toolResultMsg("ffgrep", true, "No matches found"), // 失败保留
    customMsg("inline-skill", "Use TDD."), // 保留为 user text
    userMsg("谢谢"), // 保留
  ];

  const lineNumbers = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  const entries = pruneMessages(messages, lineNumbers);
  const files = extractFiles(messages);
  const summary = formatSummary(entries, messages.length, files);

  // 首行统计
  ok(summary.startsWith("Pruned 11 messages."));
  ok(summary.includes("Files: /src/main.ts, /src/out.ts"));

  // user text 保留
  ok(summary.includes("**user**: 请帮我读一下 main.ts"));
  ok(summary.includes("**user**: 谢谢"));

  // assistant text 保留
  ok(summary.includes("**assistant**: 好的，我来读取文件。"));
  ok(summary.includes("**assistant**: Here is the answer."));

  // toolCall 渲染 + 锚点
  ok(summary.includes('- read({"path":"/src/main.ts"}) #3'));
  ok(summary.includes('- write({"file_path":"/src/out.ts"}) #6'));

  // thinking 不出现
  ok(!summary.includes("internal reasoning"));

  // 成功的 read/write toolResult 不出现
  ok(!summary.includes("export function main()"));
  ok(!summary.includes("File written"));

  // write content 不出现
  ok(!summary.includes("const x = 1;"));

  // bash 成功只留 command
  ok(summary.includes("**bash**: `npm test`"));
  ok(!summary.includes("All passed"));

  // bash 失败全留
  ok(summary.includes("**bash** (exit 1): `npm run build`"));
  ok(summary.includes("Error: build failed"));

  // 失败 toolResult 保留
  ok(summary.includes("**toolResult** (ffgrep, error):"));
  ok(summary.includes("No matches found"));

  // custom_message 保留
  ok(summary.includes("**user**: Use TDD."));
});

test("pipeline: previousSummary 透传", () => {
  const messages: MessageLike[] = [userMsg("New message")];
  const entries = pruneMessages(messages);
  const summary = formatSummary(
    entries,
    3,
    [],
    "Pruned 10 messages. Files: /old.ts\n\n**user**: Old task",
  );
  const lines = summary.split("\n");
  strictEqual(lines[0], "Pruned 3 messages.");
  strictEqual(lines[1], "");
  ok(lines[2].startsWith("Pruned 10 messages."));
  ok(summary.includes("**user**: Old task"));
  ok(summary.includes("**user**: New message"));
});

test("pipeline: 不合并连续纯 toolCall 的 assistant 消息", () => {
  const messages: MessageLike[] = [
    assistantToolCallMsg([
      { id: "tc1", name: "read", args: { path: "/a.ts" } },
    ]),
    assistantToolCallMsg([
      { id: "tc2", name: "read", args: { path: "/b.ts" } },
    ]),
  ];
  const lineNumbers = [5, 6];
  const entries = pruneMessages(messages, lineNumbers);
  // 两条消息各自产出 1 个 toolCall 条目
  strictEqual(entries.length, 2);
  strictEqual((entries[0] as { anchor: string }).anchor, "#5");
  strictEqual((entries[1] as { anchor: string }).anchor, "#6");
});

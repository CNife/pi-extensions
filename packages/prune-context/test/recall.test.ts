/**
 * recall 工具测试（接缝 2）。
 *
 * 纯函数：parseAnchor + recallFromJsonl。
 * 手工构造小型 JSONL 片段，断言锚点解析、行号定位、
 * toolCallId 匹配、返回全文、错误处理。
 *
 * Run: npx tsx --test packages/prune-context/test/recall.test.ts
 */

import { ok, strictEqual, throws } from "node:assert";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { parseAnchor, recallFromJsonl } from "../extensions/recall.ts";

// ============================================================================
// parseAnchor
// ============================================================================

test("parseAnchor: #14.1 → { line: 14, index: 1 }", () => {
  const result = parseAnchor("#14.1");
  strictEqual(result.line, 14);
  strictEqual(result.index, 1);
});

test("parseAnchor: 14.1 → { line: 14, index: 1 }", () => {
  const result = parseAnchor("14.1");
  strictEqual(result.line, 14);
  strictEqual(result.index, 1);
});

test("parseAnchor: 14 → { line: 14, index: 1 }（默认索引）", () => {
  const result = parseAnchor("14");
  strictEqual(result.line, 14);
  strictEqual(result.index, 1);
});

test("parseAnchor: #5.3 → { line: 5, index: 3 }", () => {
  const result = parseAnchor("#5.3");
  strictEqual(result.line, 5);
  strictEqual(result.index, 3);
});

test("parseAnchor: 空字符串抛错", () => {
  throws(() => parseAnchor(""), /Invalid anchor/);
});

test("parseAnchor: # 后为空抛错", () => {
  throws(() => parseAnchor("#"), /Invalid anchor/);
});

test("parseAnchor: 非数字抛错", () => {
  throws(() => parseAnchor("abc"), /Invalid anchor/);
  throws(() => parseAnchor("#x.y"), /Invalid anchor/);
});

test("parseAnchor: 零值抛错", () => {
  throws(() => parseAnchor("0"), /Invalid anchor/);
  throws(() => parseAnchor("14.0"), /Invalid anchor/);
});

test("parseAnchor: 负值抛错", () => {
  throws(() => parseAnchor("-1"), /Invalid anchor/);
});

test("parseAnchor: 过多部分抛错", () => {
  throws(() => parseAnchor("1.2.3"), /Invalid anchor/);
});

// ============================================================================
// recallFromJsonl: fixtures
// ============================================================================

let tmpDir: string;
let jsonlPath: string;

before(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "recall-test-"));
  jsonlPath = join(tmpDir, "session.jsonl");

  // 构造 JSONL：
  // 行 1: header
  // 行 2: assistant 消息，2 个 toolCall（tc-1: read, tc-2: bash）
  // 行 3: toolResult for tc-1（read 结果）
  // 行 4: toolResult for tc-2（bash 结果）
  // 行 5: assistant 消息，1 个 toolCall（tc-3: write），无后续 toolResult
  const lines = [
    JSON.stringify({ type: "header", version: 1 }),
    JSON.stringify({
      id: "entry-1",
      type: "message",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "Let me read and run." },
          {
            type: "toolCall",
            id: "tc-1",
            name: "read",
            arguments: { path: "/src/main.ts", offset: 10 },
          },
          {
            type: "toolCall",
            id: "tc-2",
            name: "bash",
            arguments: { command: "npm test", timeout: 30 },
          },
        ],
      },
    }),
    JSON.stringify({
      id: "entry-2",
      type: "message",
      message: {
        role: "toolResult",
        toolCallId: "tc-1",
        toolName: "read",
        content: [
          { type: "text", text: "export function main() {\n  return 42;\n}" },
        ],
      },
    }),
    JSON.stringify({
      id: "entry-3",
      type: "message",
      message: {
        role: "toolResult",
        toolCallId: "tc-2",
        toolName: "bash",
        content: "All 5 tests passed\nDone in 1.2s",
      },
    }),
    JSON.stringify({
      id: "entry-4",
      type: "message",
      message: {
        role: "assistant",
        content: [
          {
            type: "toolCall",
            id: "tc-3",
            name: "write",
            arguments: { file_path: "/out.ts", content: "const x = 1;" },
          },
        ],
      },
    }),
  ];

  writeFileSync(jsonlPath, lines.join("\n") + "\n");
});

after(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ============================================================================
// recallFromJsonl: 成功路径
// ============================================================================

test("recallFromJsonl: 恢复第 2 行第 1 个 toolCall（read）", () => {
  const result = recallFromJsonl(jsonlPath, 2, 1);
  ok(result.includes("## toolCall: read"));
  ok(result.includes('"/src/main.ts"'));
  ok(result.includes('"offset": 10'));
  ok(result.includes("## toolResult"));
  ok(result.includes("export function main()"));
  ok(result.includes("return 42;"));
});

test("recallFromJsonl: 恢复第 2 行第 2 个 toolCall（bash）", () => {
  const result = recallFromJsonl(jsonlPath, 2, 2);
  ok(result.includes("## toolCall: bash"));
  ok(result.includes('"npm test"'));
  ok(result.includes('"timeout": 30'));
  ok(result.includes("## toolResult"));
  ok(result.includes("All 5 tests passed"));
  ok(result.includes("Done in 1.2s"));
});

test("recallFromJsonl: 单 toolCall 行（第 5 行）", () => {
  const result = recallFromJsonl(jsonlPath, 5, 1);
  ok(result.includes("## toolCall: write"));
  ok(result.includes('"/out.ts"'));
  ok(result.includes('"const x = 1;"'));
});

test("recallFromJsonl: 无匹配 toolResult 时返回提示", () => {
  const result = recallFromJsonl(jsonlPath, 5, 1);
  ok(result.includes("No toolResult found for this toolCall."));
});

test("recallFromJsonl: 返回全文不截断", () => {
  // 构造一个长结果的 JSONL
  const longText = "x".repeat(2000);
  const longJsonl = join(tmpDir, "long.jsonl");
  const lines = [
    JSON.stringify({ type: "header", version: 1 }),
    JSON.stringify({
      id: "entry-long",
      type: "message",
      message: {
        role: "assistant",
        content: [
          {
            type: "toolCall",
            id: "tc-long",
            name: "bash",
            arguments: { command: "cat big.txt" },
          },
        ],
      },
    }),
    JSON.stringify({
      id: "entry-long-result",
      type: "message",
      message: {
        role: "toolResult",
        toolCallId: "tc-long",
        toolName: "bash",
        content: [{ type: "text", text: longText }],
      },
    }),
  ];
  writeFileSync(longJsonl, lines.join("\n") + "\n");

  const result = recallFromJsonl(longJsonl, 2, 1);
  ok(result.includes(longText), "full 2000-char result should appear");
});

// ============================================================================
// recallFromJsonl: 错误处理
// ============================================================================

test("recallFromJsonl: 行号越界抛错", () => {
  throws(() => recallFromJsonl(jsonlPath, 999, 1), /out of range/);
});

test("recallFromJsonl: 行号 0 抛错", () => {
  throws(() => recallFromJsonl(jsonlPath, 0, 1), /out of range/);
});

test("recallFromJsonl: toolCall 索引越界抛错", () => {
  throws(
    () => recallFromJsonl(jsonlPath, 2, 10),
    /toolCall index 10 out of range/,
  );
});

test("recallFromJsonl: 指向 header 行抛错", () => {
  throws(() => recallFromJsonl(jsonlPath, 1, 1), /not an assistant message/);
});

test("recallFromJsonl: 指向 toolResult 行抛错", () => {
  throws(() => recallFromJsonl(jsonlPath, 3, 1), /not an assistant message/);
});

test("recallFromJsonl: 文件不存在抛错", () => {
  throws(() => recallFromJsonl(join(tmpDir, "nonexistent.jsonl"), 1, 1));
});

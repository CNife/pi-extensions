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
  const d = recallFromJsonl(jsonlPath, 2, 1);
  strictEqual(d.anchor, "#2.1");
  strictEqual(d.line, 2);
  strictEqual(d.index, 1);
  strictEqual(d.toolName, "read");
  strictEqual(d.args.path, "/src/main.ts");
  strictEqual(d.args.offset, 10);
  strictEqual(d.hasResult, true);
  ok(d.resultText?.includes("export function main()"));
  ok(d.resultText?.includes("return 42;"));
  strictEqual(d.resultLines, 3);
  strictEqual(d.images.length, 0);
});

test("recallFromJsonl: 恢复第 2 行第 2 个 toolCall（bash）", () => {
  const d = recallFromJsonl(jsonlPath, 2, 2);
  strictEqual(d.anchor, "#2.2");
  strictEqual(d.toolName, "bash");
  strictEqual(d.args.command, "npm test");
  strictEqual(d.args.timeout, 30);
  strictEqual(d.hasResult, true);
  ok(d.resultText?.includes("All 5 tests passed"));
  ok(d.resultText?.includes("Done in 1.2s"));
});

test("recallFromJsonl: 单 toolCall 行（第 5 行）", () => {
  const d = recallFromJsonl(jsonlPath, 5, 1);
  strictEqual(d.anchor, "#5.1");
  strictEqual(d.toolName, "write");
  strictEqual(d.args.file_path, "/out.ts");
  strictEqual(d.args.content, "const x = 1;");
});

test("recallFromJsonl: 无匹配 toolResult 时 hasResult=false", () => {
  const d = recallFromJsonl(jsonlPath, 5, 1);
  strictEqual(d.hasResult, false);
  strictEqual(d.resultText, undefined);
  strictEqual(d.resultLines, 0);
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

  const d = recallFromJsonl(longJsonl, 2, 1);
  strictEqual(d.hasResult, true);
  ok(d.resultText?.includes(longText), "full 2000-char result should appear");
  strictEqual(d.resultLines, 1);
});

test("recallFromJsonl: 提取 image part 元信息（不携带 base64 数据）", () => {
  const raw = "fake-image-bytes";
  const b64 = Buffer.from(raw).toString("base64");
  const imgJsonl = join(tmpDir, "image.jsonl");
  const lines = [
    JSON.stringify({ type: "header", version: 1 }),
    JSON.stringify({
      id: "entry-img",
      type: "message",
      message: {
        role: "assistant",
        content: [
          {
            type: "toolCall",
            id: "tc-img",
            name: "view_image",
            arguments: { path: "/a.png" },
          },
        ],
      },
    }),
    JSON.stringify({
      id: "entry-img-result",
      type: "message",
      message: {
        role: "toolResult",
        toolCallId: "tc-img",
        toolName: "view_image",
        content: [
          { type: "text", text: "screenshot" },
          { type: "image", data: b64, mimeType: "image/png" },
        ],
      },
    }),
  ];
  writeFileSync(imgJsonl, lines.join("\n") + "\n");

  const d = recallFromJsonl(imgJsonl, 2, 1);
  strictEqual(d.hasResult, true);
  strictEqual(d.toolName, "view_image");
  ok(d.resultText?.includes("screenshot"));
  strictEqual(d.images.length, 1);
  strictEqual(d.images[0].mimeType, "image/png");
  strictEqual(d.images[0].bytes, raw.length);
});

test("recallFromJsonl: image-only 结果 resultLines=0（无文本 part）", () => {
  const b64 = Buffer.from("png-bytes").toString("base64");
  const imgOnlyJsonl = join(tmpDir, "img-only.jsonl");
  const lines = [
    JSON.stringify({ type: "header", version: 1 }),
    JSON.stringify({
      id: "entry-img-only",
      type: "message",
      message: {
        role: "assistant",
        content: [
          { type: "toolCall", id: "tc-io", name: "screenshot", arguments: {} },
        ],
      },
    }),
    JSON.stringify({
      id: "entry-img-only-result",
      type: "message",
      message: {
        role: "toolResult",
        toolCallId: "tc-io",
        toolName: "screenshot",
        content: [{ type: "image", data: b64, mimeType: "image/png" }],
      },
    }),
  ];
  writeFileSync(imgOnlyJsonl, lines.join("\n") + "\n");

  const d = recallFromJsonl(imgOnlyJsonl, 2, 1);
  strictEqual(d.hasResult, true);
  strictEqual(d.resultText, "");
  strictEqual(d.resultLines, 0);
  strictEqual(d.images.length, 1);
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

/**
 * Tests for the TUI render helpers of recall (spec #138, #139 resolution).
 *
 * Seam: the string-producing render functions in render.ts. These take a
 * RecallDetails (or a result-like on the error path) + a minimal ThemeLike and
 * return the rendered text - no `Text` component, no real TUI. Tests stub `fg`
 * to `[token]s` and `bold` to `[bold]s` so assertions pin both the ThemeColor
 * token and the text content.
 *
 * Run: npx tsx --test packages/prune-context/test/render.test.ts
 */

import { ok } from "node:assert";
import { test } from "node:test";
import type { RecallDetails } from "../extensions/recall.ts";
import {
  type AgentToolResultLike,
  formatRecallText,
  type RecallArgs,
  renderRecallCall,
  renderRecallResult,
  type ThemeLike,
} from "../extensions/render.ts";

// ============================================================================
// Theme stub: fg token marker + bold marker, so assertions see both
// ============================================================================

const theme: ThemeLike = {
  fg: (token, s) => `[${token}]${s}`,
  bold: (s) => `[bold]${s}`,
};

// ============================================================================
// Fixtures
// ============================================================================

const shortResult: RecallDetails = {
  anchor: "#2.1",
  line: 2,
  index: 1,
  toolName: "read",
  args: { path: "/src/main.ts", offset: 10 },
  resultText: "export function main() {\n  return 42;\n}",
  images: [],
  resultLines: 3,
  hasResult: true,
};

const longResult: RecallDetails = {
  anchor: "#14.1",
  line: 14,
  index: 1,
  toolName: "read",
  args: { path: "big.ts", offset: 1, limit: 100 },
  resultText: Array.from({ length: 35 }, (_, i) => `L${i + 1} content`).join(
    "\n",
  ),
  images: [],
  resultLines: 35,
  hasResult: true,
};

const jsonResult: RecallDetails = {
  anchor: "#3.1",
  line: 3,
  index: 1,
  toolName: "bash",
  args: { command: "cat data.json" },
  resultText: '{"ok":true,"items":[1,2,3]}',
  images: [],
  resultLines: 1,
  hasResult: true,
};

const noResult: RecallDetails = {
  anchor: "#5.1",
  line: 5,
  index: 1,
  toolName: "write",
  args: { file_path: "/out.ts", content: "const x = 1;" },
  images: [],
  resultLines: 0,
  hasResult: false,
};

const imageResult: RecallDetails = {
  anchor: "#7.1",
  line: 7,
  index: 1,
  toolName: "view_image",
  args: { path: "/a.png" },
  resultText: "screenshot",
  images: [{ mimeType: "image/png", bytes: 12288 }],
  resultLines: 1,
  hasResult: true,
};

const imageOnlyResult: RecallDetails = {
  anchor: "#8.1",
  line: 8,
  index: 1,
  toolName: "screenshot",
  args: {},
  resultText: "",
  images: [{ mimeType: "image/png", bytes: 4096 }],
  resultLines: 0,
  hasResult: true,
};

const errorResult: AgentToolResultLike = {
  content: [{ type: "text", text: "Line 999 out of range (file has 5 lines)" }],
  // details undefined on the error path (pi synthesizes the result)
};

// ============================================================================
// renderRecallCall
// ============================================================================

test("renderCall: recall + accent anchor", () => {
  const text = renderRecallCall({ id: "#14.1" }, theme);
  ok(text.includes("[toolTitle][bold]recall"), `tool header:\n${text}`);
  ok(text.includes("[accent]#14.1"), `anchor accent:\n${text}`);
});

test("renderCall: normalises anchor without leading #", () => {
  const text = renderRecallCall({ id: "14.1" }, theme);
  ok(text.includes("[accent]#14.1"), `normalised anchor:\n${text}`);
});

// ============================================================================
// renderRecallResult · short text result
// ============================================================================

test("short result collapsed: header + args TOON + full result + status", () => {
  const text = renderRecallResult(
    { details: shortResult },
    { expanded: false, isError: false },
    theme,
  );
  // header: recall (toolTitle) + anchor (accent) + toolName (text)
  ok(text.includes("[toolTitle][bold]recall"), `header:\n${text}`);
  ok(text.includes("[accent]#2.1"), `anchor:\n${text}`);
  ok(text.includes("[text]read"), `toolName:\n${text}`);
  // args as TOON
  ok(text.includes("path: /src/main.ts"), `args path:\n${text}`);
  ok(text.includes("offset: 10"), `args offset:\n${text}`);
  // full result (3 lines <= threshold 3)
  ok(text.includes("export function main()"), `result:\n${text}`);
  ok(text.includes("return 42;"), `result line 3:\n${text}`);
  // status line (dim)
  ok(text.includes("[dim]Recalled"), `status dim:\n${text}`);
  ok(text.includes("3 lines"), `status lines:\n${text}`);
  // no truncation hint for short content
  ok(!text.includes("more (expand)"), `no more hint:\n${text}`);
});

test("short result expanded: same full content", () => {
  const text = renderRecallResult(
    { details: shortResult },
    { expanded: true, isError: false },
    theme,
  );
  ok(text.includes("export function main()"), `result present:\n${text}`);
  ok(text.includes("[dim]Recalled"), `status present:\n${text}`);
  ok(!text.includes("more (expand)"), `no more hint:\n${text}`);
});

// ============================================================================
// renderRecallResult · long text result + multi-arg args
// ============================================================================

test("long result collapsed: args 2-line preview + result 3-line preview + more hints", () => {
  const text = renderRecallResult(
    { details: longResult },
    { expanded: false, isError: false },
    theme,
  );
  // args has 3 keys -> TOON 3 lines -> collapsed 2 + more
  ok(text.includes("path: big.ts"), `args line 1:\n${text}`);
  ok(text.includes("offset: 1"), `args line 2:\n${text}`);
  ok(text.includes("[muted]... 1 more (expand)"), `args more hint:\n${text}`);
  // result 35 lines -> collapsed 3 + more
  ok(text.includes("L1 content"), `result line 1:\n${text}`);
  ok(text.includes("L2 content"), `result line 2:\n${text}`);
  ok(text.includes("L3 content"), `result line 3:\n${text}`);
  ok(
    text.includes("[muted]... 32 more (expand)"),
    `result more hint:\n${text}`,
  );
  // status reports full count
  ok(text.includes("35 lines"), `status full count:\n${text}`);
  // truncated lines absent
  ok(!text.includes("L4 content"), `line 4 hidden:\n${text}`);
});

test("long result expanded: full args + full result, no more hints", () => {
  const text = renderRecallResult(
    { details: longResult },
    { expanded: true, isError: false },
    theme,
  );
  ok(text.includes("limit: 100"), `full args line 3:\n${text}`);
  ok(text.includes("L35 content"), `full result last line:\n${text}`);
  ok(text.includes("L4 content"), `full result line 4:\n${text}`);
  ok(!text.includes("more (expand)"), `no more hint:\n${text}`);
});

// ============================================================================
// renderRecallResult · JSON result detected -> TOON
// ============================================================================

test("JSON result: object auto-detected and TOON-rendered", () => {
  const text = renderRecallResult(
    { details: jsonResult },
    { expanded: false, isError: false },
    theme,
  );
  // TOON projection of {ok:true, items:[1,2,3]}
  ok(text.includes("ok: true"), `toon ok:\n${text}`);
  ok(text.includes("items[3]: 1,2,3"), `toon items:\n${text}`);
  // raw JSON braces not present (TOON replaces them)
  ok(!text.includes('{"ok"'), `raw json absent:\n${text}`);
});

// ============================================================================
// renderRecallResult · no toolResult
// ============================================================================

test("no result: warning line, no status", () => {
  const text = renderRecallResult(
    { details: noResult },
    { expanded: false, isError: false },
    theme,
  );
  ok(text.includes("[warning]No toolResult found"), `warning:\n${text}`);
  ok(!text.includes("Recalled"), `no status line:\n${text}`);
  // args still rendered (toolCall was found)
  ok(text.includes("file_path: /out.ts"), `args still shown:\n${text}`);
});

test("no result expanded: same warning (no expandable content)", () => {
  const text = renderRecallResult(
    { details: noResult },
    { expanded: true, isError: false },
    theme,
  );
  ok(text.includes("[warning]No toolResult found"), `warning:\n${text}`);
});

// ============================================================================
// renderRecallResult · image part
// ============================================================================

test("image result: placeholder after text + image count in status", () => {
  const text = renderRecallResult(
    { details: imageResult },
    { expanded: false, isError: false },
    theme,
  );
  ok(text.includes("screenshot"), `result text:\n${text}`);
  ok(
    text.includes("[dim][image: image/png, 12.0KB]"),
    `image placeholder:\n${text}`,
  );
  ok(text.includes("1 image"), `image count in status:\n${text}`);
});

test("image-only result: no text, status reports images only (0 lines)", () => {
  const text = renderRecallResult(
    { details: imageOnlyResult },
    { expanded: false, isError: false },
    theme,
  );
  ok(
    text.includes("[dim][image: image/png, 4.0KB]"),
    `image placeholder:\n${text}`,
  );
  ok(text.includes("1 image"), `image count in status:\n${text}`);
  ok(!text.includes("lines"), `no line count for image-only:\n${text}`);
  ok(!text.includes("(empty result)"), `not empty (has image):\n${text}`);
});

// ============================================================================
// renderRecallResult · error path (pi throw contract)
// ============================================================================

test("error: recall · error header with anchor + message in error color", () => {
  const args: RecallArgs = { id: "#999.1" };
  const text = renderRecallResult(
    errorResult,
    { expanded: false, isError: true },
    theme,
    args,
  );
  ok(text.includes("[toolTitle][bold]recall"), `tool header:\n${text}`);
  ok(text.includes("[error]· error"), `error marker:\n${text}`);
  ok(text.includes("[accent]#999.1"), `anchor from args:\n${text}`);
  ok(
    text.includes("[error]Line 999 out of range"),
    `whole message under error:\n${text}`,
  );
});

test("error: anchor recovered from args.id even when unnormalised", () => {
  const text = renderRecallResult(
    errorResult,
    { expanded: true, isError: true },
    theme,
    { id: "999.1" },
  );
  ok(text.includes("[accent]#999.1"), `normalised anchor:\n${text}`);
});

// ============================================================================
// formatRecallText (LLM-facing Markdown)
// ============================================================================

test("formatRecallText: success with result -> toolCall + toolResult blocks", () => {
  const md = formatRecallText(shortResult);
  ok(md.includes("## toolCall: read"), `toolCall header:\n${md}`);
  ok(md.includes("```json"), `json fence:\n${md}`);
  ok(md.includes('"/src/main.ts"'), `args json:\n${md}`);
  ok(md.includes("## toolResult"), `toolResult header:\n${md}`);
  ok(md.includes("export function main()"), `result text:\n${md}`);
});

test("formatRecallText: no result -> not-found message", () => {
  const md = formatRecallText(noResult);
  ok(md.includes("## toolCall: write"), `toolCall header:\n${md}`);
  ok(
    md.includes("No toolResult found for this toolCall."),
    `not found:\n${md}`,
  );
});

test("formatRecallText: image -> placeholder line", () => {
  const md = formatRecallText(imageResult);
  ok(md.includes("screenshot"), `result text:\n${md}`);
  ok(md.includes("[image: image/png, 12.0KB]"), `image placeholder:\n${md}`);
});

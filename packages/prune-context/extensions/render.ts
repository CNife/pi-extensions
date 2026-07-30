/**
 * TUI render helpers for recall (spec #138, #139 resolution).
 *
 * Pure string producers parameterised over a minimal ThemeLike, so tests stub
 * `fg(token, s)` / `bold(s)` instead of touching a real TUI. The thin wrapper
 * (extensions/tool.ts) wraps the returned text in a `Text` component and owns
 * no logic. Rendering rules (#138):
 *   - Colors: pi standard ThemeColor only (accent/success/warning/error/muted/
 *     dim/text/toolTitle). toolTitle for the tool-name header, accent for the
 *     anchor, text for the recalled tool name (nmem/execute-python precedent).
 *   - Layout: `recall #anchor toolName` header; args and result顶格, blank line
 *     between them; status line顶格.
 *   - args -> TOON; collapsed first 2 lines + more, expanded full.
 *   - result -> try JSON.parse: object/array -> TOON, else plain text; collapsed
 *     first 3 lines + more, expanded full.
 *   - image part -> `[image: mimeType, NKB]` placeholder after result text.
 *
 * Error state follows pi's throw contract: execute throws -> pi sets
 * isError:true, details undefined, content[0].text = the message. renderResult
 * then reads opts.isError + args.id (for the anchor) + content[0].text.
 */

import { encode } from "@toon-format/toon";
import type { RecallDetails } from "./recall.ts";

// ============================================================================
// Minimal theme + option interfaces (subset of pi's types; no pi import)
// ============================================================================

export interface ThemeLike {
  fg(token: string, text: string): string;
  bold(text: string): string;
}

/** What renderResult can read from an AgentToolResult without importing pi. */
export interface AgentToolResultLike {
  content?: Array<{ type?: string; text?: string }>;
  details?: unknown;
}

export interface RenderOptions {
  expanded: boolean;
  isError: boolean;
}

/** Args for recall_pruned_tool_call (id is echoed in call/error renders). */
export interface RecallArgs {
  id: string;
}

// ============================================================================
// Helpers
// ============================================================================

/** Human-readable byte size: <1KB in bytes, else KB (1dp under 100KB). */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  const kb = bytes / 1024;
  return kb >= 100 ? `${Math.round(kb)}KB` : `${kb.toFixed(1)}KB`;
}

/** Normalise an anchor to leading-`#` form (`14.1` -> `#14.1`). */
function normalizeAnchor(anchor: string): string {
  return anchor.startsWith("#") ? anchor : `#${anchor}`;
}

/**
 * Collapse multi-line text to a preview when not expanded.
 *
 * Shows the first `threshold` lines plus a `... N more (expand)` hint when
 * there are more; returns the full text otherwise (expanded or short enough).
 */
function collapse(
  text: string,
  threshold: number,
  expanded: boolean,
  theme: ThemeLike,
): string {
  const lines = text.split("\n");
  if (expanded || lines.length <= threshold) return text;
  const shown = lines.slice(0, threshold).join("\n");
  const more = lines.length - threshold;
  return `${shown}\n${theme.fg("muted", `... ${more} more (expand)`)}`;
}

/**
 * Render toolCall args as TOON.
 *
 * Empty args -> dim placeholder. Collapsed -> first 2 lines + more; expanded
 * -> full TOON.
 */
function renderArgs(
  args: Record<string, unknown>,
  expanded: boolean,
  theme: ThemeLike,
): string {
  if (Object.keys(args).length === 0) {
    return theme.fg("dim", "(no arguments)");
  }
  return collapse(encode(args), 2, expanded, theme);
}

/**
 * Render toolResult text.
 *
 * JSON-parseable object/array -> TOON; everything else (parse fail or
 * primitive) -> plain text. Collapsed -> first 3 lines + more; expanded -> full.
 */
function renderResultText(
  resultText: string,
  expanded: boolean,
  theme: ThemeLike,
): string {
  let rendered = resultText;
  try {
    const parsed: unknown = JSON.parse(resultText);
    if (typeof parsed === "object" && parsed !== null) {
      rendered = encode(parsed);
    }
    // primitives (string/number/bool/null) stay as the original text
  } catch {
    // not JSON -> plain text
  }
  return collapse(rendered, 3, expanded, theme);
}

/** Build the dim status footer: `Recalled  N lines  ·  M images`. */
function statusLine(details: RecallDetails): string {
  const parts: string[] = [];
  if (details.resultLines > 0) {
    parts.push(
      `${details.resultLines} ${details.resultLines === 1 ? "line" : "lines"}`,
    );
  }
  if (details.images.length > 0) {
    parts.push(
      `${details.images.length} ${details.images.length === 1 ? "image" : "images"}`,
    );
  }
  if (parts.length === 0) parts.push("empty");
  return `Recalled  ${parts.join("  ·  ")}`;
}

// ============================================================================
// LLM-facing text (moved from recall.ts; extraction/presentation separation)
// ============================================================================

/**
 * Format a RecallDetails as the Markdown text returned to the LLM.
 *
 * Preserves the original recall.ts Markdown shape (toolCall args JSON block +
 * toolResult block); image parts become placeholders since the LLM cannot see
 * base64 data.
 */
export function formatRecallText(details: RecallDetails): string {
  const sections: string[] = [];
  sections.push(`## toolCall: ${details.toolName}`);
  sections.push("");
  sections.push("```json");
  sections.push(JSON.stringify(details.args, null, 2));
  sections.push("```");
  sections.push("");
  sections.push("## toolResult");
  sections.push("");
  if (details.hasResult) {
    if (details.resultText) {
      sections.push("```");
      sections.push(details.resultText);
      sections.push("```");
    }
    for (const img of details.images) {
      sections.push(`[image: ${img.mimeType}, ${formatBytes(img.bytes)}]`);
    }
    if (!details.resultText && details.images.length === 0) {
      sections.push("(empty result)");
    }
  } else {
    sections.push("No toolResult found for this toolCall.");
  }
  return sections.join("\n");
}

// ============================================================================
// TUI call rendering
// ============================================================================

/** Render the tool-call line: `recall #anchor`. */
export function renderRecallCall(args: RecallArgs, theme: ThemeLike): string {
  return `${theme.fg("toolTitle", theme.bold("recall"))} ${theme.fg("accent", normalizeAnchor(args.id))}`;
}

// ============================================================================
// TUI result rendering (success + error paths)
// ============================================================================

/** Render the success result: header + args + result + images + status. */
function renderSuccess(
  details: RecallDetails,
  opts: RenderOptions,
  theme: ThemeLike,
): string {
  const lines: string[] = [];
  lines.push(
    `${theme.fg("toolTitle", theme.bold("recall"))} ${theme.fg("accent", details.anchor)} ${theme.fg("text", details.toolName)}`,
  );
  lines.push(renderArgs(details.args, opts.expanded, theme));

  if (!details.hasResult) {
    lines.push("");
    lines.push(theme.fg("warning", "No toolResult found"));
    return lines.join("\n");
  }

  lines.push("");
  if (details.resultText) {
    lines.push(renderResultText(details.resultText, opts.expanded, theme));
  }
  for (const img of details.images) {
    lines.push(
      theme.fg("dim", `[image: ${img.mimeType}, ${formatBytes(img.bytes)}]`),
    );
  }
  if (!details.resultText && details.images.length === 0) {
    lines.push(theme.fg("dim", "(empty result)"));
  }
  lines.push(theme.fg("dim", statusLine(details)));
  return lines.join("\n");
}

/**
 * Render the tool result. On the error path (pi throw contract: execute threw
 * -> details undefined, content[0].text = message, opts.isError true) the
 * anchor is recovered from `args.id`; otherwise the structured RecallDetails
 * drives the layout.
 */
export function renderRecallResult(
  result: AgentToolResultLike,
  opts: RenderOptions,
  theme: ThemeLike,
  args?: RecallArgs,
): string {
  if (opts.isError) {
    const message = result.content?.[0]?.text ?? "";
    const anchor = normalizeAnchor(args?.id ?? "");
    return `${theme.fg("toolTitle", theme.bold("recall"))} ${theme.fg("error", "· error")} ${theme.fg("accent", anchor)}\n  ${theme.fg("error", message)}`;
  }
  const details = result.details as RecallDetails | undefined;
  if (!details) return result.content?.[0]?.text ?? "";
  return renderSuccess(details, opts, theme);
}

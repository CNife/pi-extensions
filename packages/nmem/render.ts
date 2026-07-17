/**
 * TUI render helpers for nmem (spec #88, #87 resolution).
 *
 * Pure string producers parameterised over a minimal ThemeLike, so tests stub
 * `fg(token, s)` instead of touching a real TUI. The thin wrapper
 * (extensions/nmem.ts) wraps the returned text in a `Text` component and owns
 * no logic. Rendering rules (#87):
 *   - Colors: pi standard ThemeColor only (accent/success/warning/error/muted/
 *     dim/text/toolOutput). toolTitle is also a standard ThemeColor and is
 *     used for the tool-name header (per execute-python precedent).
 *   - Labels: lowercase + dim.
 *   - Value-type coloring: identifier -> muted, number -> toolOutput,
 *     enum -> accent, free text -> text.
 *   - Separator between tool name and state: middle dot `·`.
 *   - score: toFixed(4) everywhere.
 *
 * Error state: the pi custom-tool contract is throw -> isError. renderResult
 * then gets `context.isError === true`, `result.details === undefined`, and
 * `result.content[0].text` = the NmemError message. We render the whole error
 * text under `error` — no parsing, no fake code/hint split.
 */

import type {
  MemoriesSearchResult,
  ReadThreadResult,
  SavedMemoryResult,
  ThreadsSearchResult,
} from "./client.ts";

/** Args passed to nmem_save_memory (title is rendered back in the result). */
export interface SaveMemoryArgs {
  title: string;
  content?: string;
  unit_type?: string;
  importance?: number;
  labels?: string[];
  id?: string;
}

/** Args passed to nmem_search (query is echoed in the collapsed summary). */
export interface SearchArgs {
  query: string;
  kind?: "memories" | "threads";
  limit?: number;
}

// ============================================================================
// Minimal theme interface (subset of pi's Theme used by these renderers)
// ============================================================================

export interface ThemeLike {
  fg: (token: string, text: string) => string;
  bold: (text: string) => string;
}

/** What renderResult can read from an AgentToolResult without importing pi types. */
export interface AgentToolResultLike {
  content?: Array<{ type?: string; text?: string }>;
  details?: unknown;
}

export interface RenderOptions {
  expanded: boolean;
  isError: boolean;
}

// ============================================================================
// Value-type coloring (per #87 resolution)
// ============================================================================

const valueColor = {
  id: (theme: ThemeLike, v: string) => theme.fg("muted", v),
  number: (theme: ThemeLike, v: string) => theme.fg("toolOutput", v),
  enum: (theme: ThemeLike, v: string) => theme.fg("accent", v),
  text: (theme: ThemeLike, v: string) => theme.fg("text", v),
};

/** role -> ThemeColor (user->accent, assistant->text, system->muted). */
function roleToken(role: string): string {
  if (role === "user") return "accent";
  if (role === "assistant") return "text";
  return "muted";
}

function dimLabel(theme: ThemeLike, label: string): string {
  return theme.fg("dim", label);
}

/** score rendered to exactly 4 decimals, as a number-colored value. */
function scoreValue(theme: ThemeLike, score: number): string {
  return valueColor.number(theme, score.toFixed(4));
}

// ============================================================================
// nmem_search
// ============================================================================

type AnySearchResult = MemoriesSearchResult | ThreadsSearchResult;

export function renderSearchResult(
  result: AgentToolResultLike,
  opts: RenderOptions,
  theme: ThemeLike,
  args?: SearchArgs,
): string {
  if (opts.isError) return renderError(result, "nmem_search", theme);

  const details = result.details as AnySearchResult | undefined;
  const query = args?.query ?? "";
  if (details && "memories" in details) {
    return opts.expanded
      ? renderMemoriesExpanded(details, theme)
      : renderMemoriesCollapsed(details, query, theme);
  }
  if (details && "threads" in details) {
    return opts.expanded
      ? renderThreadsExpanded(details, theme)
      : renderThreadsCollapsed(details, query, theme);
  }
  // No structured details (shouldn't happen on success) — fall back to text.
  return result.content?.[0]?.text ?? "";
}

function renderMemoriesCollapsed(
  result: MemoriesSearchResult,
  query: string,
  theme: ThemeLike,
): string {
  const lines: string[] = [];
  lines.push(
    `${theme.fg("text", `Search "${query}", ${result.returned} results`)}`,
  );
  result.memories.forEach((m, i) => {
    lines.push(
      `  ${theme.fg("accent", `${i + 1}.`)} ${valueColor.text(theme, m.title)}  ${dimLabel(theme, `score ${scoreValue(theme, m.score)}`)}`,
    );
  });
  lines.push(dimLabel(theme, "  Expand for details"));
  return lines.join("\n");
}

function renderMemoriesExpanded(
  result: MemoriesSearchResult,
  theme: ThemeLike,
): string {
  const lines: string[] = [];
  for (const m of result.memories) {
    lines.push(`  ${theme.bold(valueColor.text(theme, m.title))}`);
    lines.push(
      `    ${dimLabel(theme, "id")}         ${valueColor.id(theme, m.id)}`,
    );
    lines.push(
      `    ${dimLabel(theme, "score")}      ${scoreValue(theme, m.score)}`,
    );
    lines.push(
      `    ${dimLabel(theme, "type")}       ${valueColor.enum(theme, m.unit_type)}`,
    );
    lines.push(
      `    ${dimLabel(theme, "importance")} ${valueColor.number(theme, m.importance.toFixed(2))}`,
    );
    lines.push(
      `    ${dimLabel(theme, "content")}    ${valueColor.text(theme, m.content)}`,
    );
    lines.push("");
  }
  lines.push(dimLabel(theme, `${result.returned} results`));
  return lines.join("\n");
}

function renderThreadsCollapsed(
  result: ThreadsSearchResult,
  query: string,
  theme: ThemeLike,
): string {
  const lines: string[] = [];
  lines.push(
    `${theme.fg("text", `Search "${query}", found ${result.total} threads`)}`,
  );
  result.threads.forEach((t, i) => {
    lines.push(
      `  ${theme.fg("accent", `${i + 1}.`)} ${valueColor.text(theme, t.title)}  ${dimLabel(theme, `${t.message_count} messages, ${t.matches} matches`)}`,
    );
  });
  lines.push(dimLabel(theme, "  Expand for details"));
  return lines.join("\n");
}

function renderThreadsExpanded(
  result: ThreadsSearchResult,
  theme: ThemeLike,
): string {
  const lines: string[] = [];
  for (const t of result.threads) {
    lines.push(`  ${theme.bold(valueColor.text(theme, t.title))}`);
    lines.push(
      `    ${dimLabel(theme, "id")}       ${valueColor.id(theme, t.id)}`,
    );
    lines.push(
      `    ${dimLabel(theme, "messages")} ${valueColor.number(theme, `${t.message_count}`)}`,
    );
    lines.push(
      `    ${dimLabel(theme, "matches")}  ${valueColor.number(theme, `${t.matches}`)}`,
    );
  }
  lines.push(dimLabel(theme, `${result.total} threads`));
  return lines.join("\n");
}

export function renderReadThreadResult(
  result: AgentToolResultLike,
  opts: RenderOptions,
  theme: ThemeLike,
): string {
  if (opts.isError) return renderError(result, "nmem_read_thread", theme);

  const details = result.details as ReadThreadResult | undefined;
  if (!details) return result.content?.[0]?.text ?? "";

  const footer = dimLabel(
    theme,
    `${details.total_messages} messages · returned ${details.returned} · offset ${details.offset}`,
  );

  if (!opts.expanded) {
    const lines: string[] = [];
    lines.push(`  ${valueColor.text(theme, details.title)}`);
    lines.push(`  ${footer}`);
    lines.push(dimLabel(theme, "  Expand for details"));
    return lines.join("\n");
  }

  const lines: string[] = [];
  lines.push(
    `  ${theme.fg("toolTitle", theme.bold("nmem_read_thread"))} ${valueColor.text(theme, `· ${details.title}`)}`,
  );
  lines.push(
    `    ${dimLabel(theme, "created")} ${valueColor.text(theme, details.created_at)}`,
  );
  lines.push("");
  for (const msg of details.messages) {
    const tag = theme.fg(roleToken(msg.role), `[${msg.role}]`.padEnd(11));
    lines.push(`  ${tag} ${valueColor.text(theme, msg.content)}`);
  }
  lines.push("");
  lines.push(`  ${footer}`);
  return lines.join("\n");
}

export function renderSaveMemoryResult(
  result: AgentToolResultLike,
  opts: RenderOptions,
  theme: ThemeLike,
  args?: SaveMemoryArgs,
): string {
  if (opts.isError) return renderError(result, "nmem_save_memory", theme);

  const details = result.details as SavedMemoryResult | undefined;
  if (!details) return result.content?.[0]?.text ?? "";

  const title = args?.title ?? "";
  const warnings = details.warnings ?? [];

  if (!opts.expanded) {
    const head = `${theme.fg("success", `✓ ${details.action}`)} ${valueColor.id(theme, details.id)} ${valueColor.text(theme, title)}`;
    const tail =
      warnings.length > 0
        ? ` ${theme.fg("warning", `(${warnings.length} ${warnings.length === 1 ? "warning" : "warnings"})`)}`
        : "";
    return `  ${head}${tail}`;
  }

  const lines: string[] = [];
  lines.push(
    `  ${theme.fg("toolTitle", theme.bold(`nmem_save_memory · ${details.action}`))}`,
  );
  lines.push(
    `    ${dimLabel(theme, "id")}         ${valueColor.id(theme, details.id)}`,
  );
  lines.push(
    `    ${dimLabel(theme, "title")}     ${valueColor.text(theme, title)}`,
  );
  if (args?.unit_type) {
    lines.push(
      `    ${dimLabel(theme, "type")}      ${valueColor.enum(theme, args.unit_type)}`,
    );
  }
  if (args?.importance !== undefined) {
    lines.push(
      `    ${dimLabel(theme, "importance")} ${valueColor.number(theme, args.importance.toFixed(2))}`,
    );
  }
  if (details.updated_fields && details.updated_fields.length > 0) {
    lines.push(
      `    ${dimLabel(theme, "updated")}   ${valueColor.text(theme, details.updated_fields.join(", "))}`,
    );
  }
  for (const w of warnings) {
    lines.push(
      `    ${dimLabel(theme, "warning")}   ${valueColor.text(theme, w)}`,
    );
  }
  return lines.join("\n");
}

// ============================================================================
// Error state (shared)
// ============================================================================

export function renderError(
  result: AgentToolResultLike,
  toolName: string,
  theme: ThemeLike,
): string {
  const message = result.content?.[0]?.text ?? "";
  const title = `${theme.fg("toolTitle", theme.bold(toolName))} ${theme.fg("error", "· error")}`;
  return `${title}\n  ${theme.fg("error", message)}`;
}

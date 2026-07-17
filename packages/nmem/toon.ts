/**
 * Pure TOON text projection for nmem (spec #88).
 *
 * This module holds the LLM-facing TOON text projection only. It imports just
 * the TOON encoder (no `@earendil-works/pi-ai` / `pi-coding-agent`), so
 * pure-function tests can exercise it without pulling pi's restricted
 * `exports` map into module resolution. The TUI-facing render helpers live
 * in render.ts (same reason).
 *
 * Seam: toToonText(result) — the LLM-facing TOON text (token-efficient, no
 * duplicate note/warnings). The thin wrapper (extensions/nmem.ts) calls it
 * and owns no logic of its own.
 */

import { encode } from "@toon-format/toon";

// ============================================================================
// TOON text projection (LLM-facing)
// ============================================================================

/**
 * Encode a typed nmem result into TOON text for the LLM (spec #88).
 *
 * `note` / `warnings` are result fields, so encode includes them exactly once
 * — replacing the old hand-spliced prefix that duplicated them.
 */
export function toToonText(result: unknown): string {
  return encode(result);
}

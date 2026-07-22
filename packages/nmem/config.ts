/**
 * nmem plugin config - deep module.
 *
 * The plugin's own behavior switches, separate from the backend connection
 * info (apiUrl/apiKey) that lives in the shared ~/.nowledge-mem/config.json
 * and is resolved by client.ts#resolveConfig. v1 carries a single switch:
 *   injectContextBundle - whether the startup Context Bundle body is injected
 *                         (default false; the guidance text is injected regardless).
 *
 * Follows the repo config convention (see packages/agent-loop-reflection):
 * file at <agent-dir>/cnife-nmem.json, auto-created with defaults on first
 * load, three-level validation (file I/O -> JSON parse -> type check), warn +
 * fallback defaults on any failure. The toggle is non-critical, so loading
 * never throws and always yields a usable config (defaulting to bundle-off,
 * the safe choice).
 *
 * Agent-dir resolution mirrors pi's getAgentDir (PI_CODING_AGENT_DIR env, then
 * ~/.pi/agent) but is inlined here instead of imported: the pi packages'
 * exports maps are gated and cannot be imported by plain `tsx --test` (the same
 * constraint, documented in tool.test.ts, that keeps unit tests on the deep
 * module and off the entry). Inlining keeps this module node-builtin-only and
 * unit-testable, exactly like client.ts.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface NmemPluginConfig {
  injectContextBundle: boolean;
}

export const DEFAULT_PLUGIN_CONFIG: NmemPluginConfig = {
  injectContextBundle: false,
};

const CONFIG_FILE_NAME = "cnife-nmem.json";

/** Keys the /nmem-config command may set (v1: just the bundle switch). */
export const SETTABLE_KEYS = ["injectContextBundle"] as const;
export type SettableKey = (typeof SETTABLE_KEYS)[number];

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function warnConfig(message: string): void {
  console.warn(`[nmem] ${message}`);
}

/** Warn and fall back to defaults - the shared failure exit of loadPluginConfig. */
function failDefaults(message: string): NmemPluginConfig {
  warnConfig(message);
  return { ...DEFAULT_PLUGIN_CONFIG };
}

/** Expand a leading ~ to the home dir (pi's expandTildePath equivalent). */
function expandTilde(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return join(homedir(), path.slice(2));
  return path;
}

/**
 * Agent config dir, resolved at call time so PI_CODING_AGENT_DIR redirects it
 * (tests, isolated loading). Mirrors pi's getAgentDir for the pi app.
 */
function agentDir(): string {
  const envDir = process.env.PI_CODING_AGENT_DIR?.trim();
  if (envDir) return expandTilde(envDir);
  return join(homedir(), ".pi", "agent");
}

/** Config file path, resolved at call time (honors PI_CODING_AGENT_DIR). */
export function pluginConfigPath(): string {
  return join(agentDir(), CONFIG_FILE_NAME);
}

function writeJson(path: string, config: NmemPluginConfig): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, "utf-8");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Load the plugin config. Missing file -> auto-create defaults. Any failure
 * (I/O, parse, type) -> warn + fall back to defaults. Never throws.
 */
export function loadPluginConfig(): NmemPluginConfig {
  const path = pluginConfigPath();

  if (!existsSync(path)) {
    try {
      writeJson(path, DEFAULT_PLUGIN_CONFIG);
    } catch (error) {
      warnConfig(
        `failed to create ${path}: ${errorMessage(error)}; using defaults`,
      );
    }
    return { ...DEFAULT_PLUGIN_CONFIG };
  }

  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch (error) {
    return failDefaults(
      `failed to read ${path}: ${errorMessage(error)}; using defaults`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return failDefaults(`invalid JSON in ${path}; using defaults`);
  }

  if (!isRecord(parsed)) {
    return failDefaults(`config in ${path} is not an object; using defaults`);
  }

  if (
    parsed.injectContextBundle !== undefined &&
    typeof parsed.injectContextBundle !== "boolean"
  ) {
    return failDefaults(
      "injectContextBundle must be a boolean; using defaults",
    );
  }

  return {
    injectContextBundle:
      typeof parsed.injectContextBundle === "boolean"
        ? parsed.injectContextBundle
        : DEFAULT_PLUGIN_CONFIG.injectContextBundle,
  };
}

/**
 * Persist the plugin config (mkdir -p). Throws on I/O failure so the caller
 * (the /nmem-config command) can surface it to the user.
 */
export function savePluginConfig(config: NmemPluginConfig): void {
  writeJson(pluginConfigPath(), config);
}

// ============================================================================
// /nmem-config command helpers (pure, unit-tested)
// ============================================================================

export type ParseSetResult =
  | { ok: true; key: SettableKey; value: boolean }
  | { ok: false; error: string };

const USAGE =
  "用法：/nmem-config <键> <值>，如 /nmem-config injectContextBundle true";

/**
 * Parse the arguments of `/nmem-config <key> <value>`. v1 accepts a single
 * key (injectContextBundle) with a boolean value (true/false). Returns a
 * discriminated result so the command handler stays thin.
 */
export function parseConfigSetArgs(args: string): ParseSetResult {
  const parts = args.trim().split(/\s+/).filter(Boolean);

  if (parts.length === 0) {
    return { ok: false, error: USAGE };
  }

  const [key, value, ...rest] = parts;

  if (!SETTABLE_KEYS.includes(key as SettableKey)) {
    return {
      ok: false,
      error: `未知配置项 "${key}"；v1 可设置：${SETTABLE_KEYS.join(", ")}`,
    };
  }

  if (value === undefined || rest.length > 0) {
    return {
      ok: false,
      error: `缺少值或参数过多；${USAGE}`,
    };
  }

  if (value !== "true" && value !== "false") {
    return {
      ok: false,
      error: `${key} 的值必须是 true 或 false，收到 "${value}"`,
    };
  }

  return { ok: true, key: key as SettableKey, value: value === "true" };
}

/**
 * Format the read-only `/nmem-config` overview: the plugin config file and its
 * values, plus the resolved backend apiUrl (read-only - it lives in the shared
 * ~/.nowledge-mem/config.json and is not edited here).
 */
export function formatConfigShow(
  config: NmemPluginConfig,
  opts: { apiUrl: string; path: string },
): string {
  return [
    `nmem 插件配置（${opts.path}）`,
    `  injectContextBundle = ${config.injectContextBundle}`,
    "",
    "后端连接（~/.nowledge-mem/config.json，只读）",
    `  apiUrl = ${opts.apiUrl}`,
    "",
    USAGE,
    "改动下次会话启动生效。",
  ].join("\n");
}

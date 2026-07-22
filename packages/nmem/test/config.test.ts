/**
 * Tests for the nmem plugin-config deep module (config.ts).
 *
 * Seam: the public interface of config.ts (pluginConfigPath / loadPluginConfig /
 * savePluginConfig / parseConfigSetArgs / formatConfigShow). Pure-FS + parsing,
 * no backend, no pi UI. PI_CODING_AGENT_DIR is redirected to a fresh temp dir
 * per test so the real ~/.pi/agent is never touched (getAgentDir reads the env
 * var at call time, so pluginConfigPath() picks up the redirect).
 *
 * Run: npx tsx --test packages/nmem/test/config.test.ts
 */

import { deepStrictEqual, match, ok, strictEqual } from "node:assert";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import {
  DEFAULT_PLUGIN_CONFIG,
  formatConfigShow,
  loadPluginConfig,
  type NmemPluginConfig,
  parseConfigSetArgs,
  pluginConfigPath,
  savePluginConfig,
} from "../config.ts";

let tempAgentDir: string;
let savedEnv: string | undefined;

beforeEach(() => {
  savedEnv = process.env.PI_CODING_AGENT_DIR;
  tempAgentDir = mkdtempSync(join(tmpdir(), "nmem-config-test-"));
  process.env.PI_CODING_AGENT_DIR = tempAgentDir;
});

afterEach(() => {
  if (savedEnv === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = savedEnv;
  rmSync(tempAgentDir, { recursive: true, force: true });
});

// ============================================================================
// pluginConfigPath
// ============================================================================

test("pluginConfigPath resolves under the (redirected) agent dir", () => {
  strictEqual(pluginConfigPath(), join(tempAgentDir, "cnife-nmem.json"));
});

// ============================================================================
// loadPluginConfig
// ============================================================================

test("loadPluginConfig: missing file auto-creates defaults and returns them", () => {
  const path = pluginConfigPath();
  ok(!existsSync(path));
  const config = loadPluginConfig();
  deepStrictEqual(config, { injectContextBundle: false });
  ok(existsSync(path), "config file should be created");
  deepStrictEqual(
    JSON.parse(readFileSync(path, "utf-8")),
    DEFAULT_PLUGIN_CONFIG,
  );
});

test("loadPluginConfig: reads an existing valid config", () => {
  writeFileSync(
    pluginConfigPath(),
    JSON.stringify({ injectContextBundle: true }),
    "utf-8",
  );
  deepStrictEqual(loadPluginConfig(), { injectContextBundle: true });
});

test("loadPluginConfig: explicit false is honored", () => {
  writeFileSync(
    pluginConfigPath(),
    JSON.stringify({ injectContextBundle: false }),
    "utf-8",
  );
  deepStrictEqual(loadPluginConfig(), { injectContextBundle: false });
});

test("loadPluginConfig: invalid JSON falls back to defaults (no throw)", () => {
  writeFileSync(pluginConfigPath(), "{ not json", "utf-8");
  deepStrictEqual(loadPluginConfig(), DEFAULT_PLUGIN_CONFIG);
});

test("loadPluginConfig: non-object JSON falls back to defaults", () => {
  writeFileSync(pluginConfigPath(), "[1, 2, 3]", "utf-8");
  deepStrictEqual(loadPluginConfig(), DEFAULT_PLUGIN_CONFIG);
});

test("loadPluginConfig: wrong-typed injectContextBundle falls back to defaults", () => {
  writeFileSync(
    pluginConfigPath(),
    JSON.stringify({ injectContextBundle: "yes" }),
    "utf-8",
  );
  deepStrictEqual(loadPluginConfig(), DEFAULT_PLUGIN_CONFIG);
});

test("loadPluginConfig: unknown extra keys are ignored, known key kept", () => {
  writeFileSync(
    pluginConfigPath(),
    JSON.stringify({ injectContextBundle: true, futureKey: 42 }),
    "utf-8",
  );
  deepStrictEqual(loadPluginConfig(), { injectContextBundle: true });
});

// ============================================================================
// savePluginConfig
// ============================================================================

test("savePluginConfig round-trips through loadPluginConfig", () => {
  const next: NmemPluginConfig = { injectContextBundle: true };
  savePluginConfig(next);
  deepStrictEqual(loadPluginConfig(), next);
});

test("savePluginConfig creates parent dirs if missing", () => {
  // Point at a nested, not-yet-existing subdir.
  process.env.PI_CODING_AGENT_DIR = join(tempAgentDir, "nested", "deeper");
  savePluginConfig({ injectContextBundle: true });
  ok(existsSync(join(tempAgentDir, "nested", "deeper", "cnife-nmem.json")));
});

// ============================================================================
// parseConfigSetArgs
// ============================================================================

test("parseConfigSetArgs: 'injectContextBundle true' parses", () => {
  deepStrictEqual(parseConfigSetArgs("injectContextBundle true"), {
    ok: true,
    key: "injectContextBundle",
    value: true,
  });
});

test("parseConfigSetArgs: 'injectContextBundle false' parses", () => {
  deepStrictEqual(parseConfigSetArgs("  injectContextBundle   false  "), {
    ok: true,
    key: "injectContextBundle",
    value: false,
  });
});

test("parseConfigSetArgs: empty args is a usage error", () => {
  const result = parseConfigSetArgs("   ");
  strictEqual(result.ok, false);
  if (!result.ok) match(result.error, /用法|usage/i);
});

test("parseConfigSetArgs: missing value is an error", () => {
  const result = parseConfigSetArgs("injectContextBundle");
  strictEqual(result.ok, false);
});

test("parseConfigSetArgs: unknown key is an error naming valid keys", () => {
  const result = parseConfigSetArgs("bogusKey true");
  strictEqual(result.ok, false);
  if (!result.ok) match(result.error, /injectContextBundle/);
});

test("parseConfigSetArgs: non-boolean value is an error", () => {
  const result = parseConfigSetArgs("injectContextBundle maybe");
  strictEqual(result.ok, false);
  if (!result.ok) match(result.error, /true|false/);
});

// ============================================================================
// formatConfigShow
// ============================================================================

test("formatConfigShow: shows path, key value, apiUrl, and usage", () => {
  const out = formatConfigShow(
    { injectContextBundle: false },
    { apiUrl: "http://127.0.0.1:14242", path: pluginConfigPath() },
  );
  match(out, /injectContextBundle\s*=\s*false/);
  match(out, /http:\/\/127\.0\.0\.1:14242/);
  match(out, /cnife-nmem\.json/);
  match(out, /\/nmem-config/);
});

test("formatConfigShow: reflects an enabled bundle", () => {
  const out = formatConfigShow(
    { injectContextBundle: true },
    { apiUrl: "http://x", path: pluginConfigPath() },
  );
  match(out, /injectContextBundle\s*=\s*true/);
});

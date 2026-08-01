/**
 * agent_template 纯逻辑测试。
 *
 * 测 agent-logic.ts 导出的纯函数：
 *   - parseAgentProfile：frontmatter 解析
 *   - listAgentProfiles：目录扫描
 *
 * 用 node:test + tsx --test，仅验证可观察行为。
 * 参考 packages/skills-injection/test/skills-logic.test.ts。
 *
 * Run: npx tsx --test personal/agent_template/test/agent-logic.test.ts
 */

import { deepStrictEqual, strictEqual, throws } from "node:assert";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  AgentProfileParseError,
  DEFAULT_THINKING,
  listAgentProfiles,
  parseAgentProfile,
} from "../extensions/agent-logic.ts";

const NL = "\n";

/** 用行数组拼 .md 全文（避免模板字面量转义噪音）。 */
function md(lines: string[]): string {
  return lines.join(NL);
}

// ============================================================================
// parseAgentProfile
// ============================================================================

test("parseAgentProfile: 标准 frontmatter（全字段，逗号 tools）", () => {
  const p = parseAgentProfile(
    md([
      "---",
      "name: explorer",
      "description: 只读探索代码库。",
      "model: opencode-go/deepseek-v4-flash",
      "thinking: high",
      "tools: read, ffgrep, fffind, ls, web_search, web_fetch",
      "sessionPreference: persistent",
      "sessionHint: 优先用主题命名会话。",
      "---",
      "# 角色",
      "你负责收集事实。",
    ]),
  );
  deepStrictEqual(p, {
    name: "explorer",
    description: "只读探索代码库。",
    model: "opencode-go/deepseek-v4-flash",
    thinking: "high",
    tools: ["read", "ffgrep", "fffind", "ls", "web_search", "web_fetch"],
    prompt: "# 角色" + NL + "你负责收集事实。",
  });
});

test("parseAgentProfile: sessionPreference/sessionHint 不进输出", () => {
  const p = parseAgentProfile(
    md([
      "---",
      "name: x",
      "description: d",
      "model: m",
      "thinking: low",
      "sessionPreference: ephemeral",
      "sessionHint: hint text",
      "---",
      "body",
    ]),
  );
  strictEqual(Object.hasOwn(p, "sessionPreference"), false);
  strictEqual(Object.hasOwn(p, "sessionHint"), false);
  strictEqual(p.prompt, "body");
});

test("parseAgentProfile: 缺 thinking -> 默认 medium", () => {
  const p = parseAgentProfile(
    md(["---", "name: x", "description: d", "model: m", "---", "body"]),
  );
  strictEqual(p.thinking, DEFAULT_THINKING);
  strictEqual(p.thinking, "medium");
});

test("parseAgentProfile: 缺 tools -> undefined（无 tools 键）", () => {
  const p = parseAgentProfile(
    md([
      "---",
      "name: reviewer",
      "description: 只读审查。",
      "model: ark-coding-plan/glm-5.2",
      "thinking: xhigh",
      "---",
      "body",
    ]),
  );
  strictEqual(Object.hasOwn(p, "tools"), false);
  strictEqual(p.tools, undefined);
});

test("parseAgentProfile: 缺 prompt 正文 -> 空串", () => {
  const p = parseAgentProfile(
    md(["---", "name: x", "description: d", "model: m", "---", ""]),
  );
  strictEqual(p.prompt, "");
});

test("parseAgentProfile: 缺 model -> 空串", () => {
  const p = parseAgentProfile(
    md(["---", "name: x", "description: d", "thinking: high", "---", "body"]),
  );
  strictEqual(p.model, "");
});

test("parseAgentProfile: 缺 name -> 空串（listAgentProfiles 用文件名回填）", () => {
  const p = parseAgentProfile(
    md(["---", "description: d", "model: m", "---", "body"]),
  );
  strictEqual(p.name, "");
});

test("parseAgentProfile: 双引号 description 去引号", () => {
  const p = parseAgentProfile(
    md([
      "---",
      "name: x",
      'description: "带引号的描述"',
      "model: m",
      "---",
      "body",
    ]),
  );
  strictEqual(p.description, "带引号的描述");
});

test("parseAgentProfile: 单引号 description 去引号", () => {
  const p = parseAgentProfile(
    md([
      "---",
      "name: x",
      "description: 'single quoted'",
      "model: m",
      "---",
      "body",
    ]),
  );
  strictEqual(p.description, "single quoted");
});

test("parseAgentProfile: flow array tools [a, b, c]", () => {
  const p = parseAgentProfile(
    md([
      "---",
      "name: x",
      "description: d",
      "model: m",
      "tools: [read, grep, ls]",
      "---",
      "body",
    ]),
  );
  deepStrictEqual(p.tools, ["read", "grep", "ls"]);
});

test("parseAgentProfile: block array tools（缩进 - item）", () => {
  const p = parseAgentProfile(
    md([
      "---",
      "name: x",
      "description: d",
      "model: m",
      "tools:",
      "  - read",
      "  - grep",
      "  - ls",
      "---",
      "body",
    ]),
  );
  deepStrictEqual(p.tools, ["read", "grep", "ls"]);
});

test("parseAgentProfile: 空 tools 值 -> undefined（默认工具集）", () => {
  const p = parseAgentProfile(
    md([
      "---",
      "name: x",
      "description: d",
      "model: m",
      "tools:",
      "---",
      "body",
    ]),
  );
  strictEqual(p.tools, undefined);
});

test("parseAgentProfile: 无 frontmatter -> AgentProfileParseError", () => {
  throws(
    () => parseAgentProfile("# Just a title" + NL + "no frontmatter here"),
    AgentProfileParseError,
  );
});

test("parseAgentProfile: frontmatter 未闭合 -> AgentProfileParseError", () => {
  throws(
    () =>
      parseAgentProfile(md(["---", "name: x", "model: m", "no closing delim"])),
    AgentProfileParseError,
  );
});

test("parseAgentProfile: 空 frontmatter（全默认）", () => {
  const p = parseAgentProfile(md(["---", "---", "body"]));
  deepStrictEqual(p, {
    name: "",
    description: "",
    model: "",
    thinking: DEFAULT_THINKING,
    prompt: "body",
  });
});

// ============================================================================
// listAgentProfiles
// ============================================================================

test("listAgentProfiles: 多个 .md -> 按 name 字母序摘要", () => {
  const dir = mkdtempSync(join(tmpdir(), "agent-template-"));
  try {
    writeFileSync(
      join(dir, "worker.md"),
      md([
        "---",
        "name: worker",
        "description: 执行明确任务。",
        "model: opencode-go/deepseek-v4-flash",
        "---",
        "body",
      ]),
    );
    writeFileSync(
      join(dir, "explorer.md"),
      md([
        "---",
        "name: explorer",
        "description: 只读探索。",
        "model: opencode-go/deepseek-v4-flash",
        "---",
        "body",
      ]),
    );
    writeFileSync(
      join(dir, "reviewer.md"),
      md([
        "---",
        "name: reviewer",
        "description: 只读审查。",
        "model: ark-coding-plan/glm-5.2",
        "---",
        "body",
      ]),
    );
    deepStrictEqual(listAgentProfiles(dir), [
      {
        name: "explorer",
        description: "只读探索。",
        model: "opencode-go/deepseek-v4-flash",
      },
      {
        name: "reviewer",
        description: "只读审查。",
        model: "ark-coding-plan/glm-5.2",
      },
      {
        name: "worker",
        description: "执行明确任务。",
        model: "opencode-go/deepseek-v4-flash",
      },
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("listAgentProfiles: 不存在目录 -> []", () => {
  strictEqual(
    listAgentProfiles(join(tmpdir(), "agent-template-nonexistent-xyz")).length,
    0,
  );
});

test("listAgentProfiles: 非 .md 文件忽略", () => {
  const dir = mkdtempSync(join(tmpdir(), "agent-template-"));
  try {
    writeFileSync(join(dir, "readme.txt"), "ignore me");
    writeFileSync(join(dir, "agent.json"), "{}");
    writeFileSync(
      join(dir, "ok.md"),
      md(["---", "name: ok", "description: d", "model: m", "---", "b"]),
    );
    deepStrictEqual(listAgentProfiles(dir), [
      { name: "ok", description: "d", model: "m" },
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("listAgentProfiles: 单个坏 .md（无 frontmatter）跳过，其余正常", () => {
  const dir = mkdtempSync(join(tmpdir(), "agent-template-"));
  try {
    writeFileSync(join(dir, "bad.md"), "no frontmatter at all");
    writeFileSync(
      join(dir, "good.md"),
      md(["---", "name: good", "description: d", "model: m", "---", "b"]),
    );
    deepStrictEqual(listAgentProfiles(dir), [
      { name: "good", description: "d", model: "m" },
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("listAgentProfiles: frontmatter 缺 name -> 用文件名回填", () => {
  const dir = mkdtempSync(join(tmpdir(), "agent-template-"));
  try {
    writeFileSync(
      join(dir, "unnamed.md"),
      md(["---", "description: d", "model: m", "---", "b"]),
    );
    deepStrictEqual(listAgentProfiles(dir), [
      { name: "unnamed", description: "d", model: "m" },
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

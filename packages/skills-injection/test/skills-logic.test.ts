/**
 * skills-injection 纯逻辑测试。
 *
 * 测 skills-logic.ts 导出的纯函数：
 *   - parseConfig: 配置 JSON 校验
 *   - filterSkillsSection: system prompt skills 段过滤替换
 *   - summarizeSkills / formatStartupSummary: session_start 分类与英文说明
 *   - sortSkillItems: 命令列表排序
 *
 * 用 node:test + tsx --test，仅验证可观察行为。
 * 参考 auto-naming-session/test/transcript.test.ts。
 *
 * Run: npx tsx --test packages/skills-injection/test/skills-logic.test.ts
 */

import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { test } from "node:test";
import type { Skill } from "@earendil-works/pi-coding-agent";
import {
  DEFAULT_CONFIG,
  filterSkillsSection,
  formatStartupSummary,
  parseConfig,
  sortSkillItems,
  summarizeSkills,
} from "../extensions/skills-logic.ts";

// ============================================================================
// Fixtures
// ============================================================================

function makeSkill(
  name: string,
  opts: { disableModelInvocation?: boolean } = {},
): Skill {
  return {
    name,
    description: `desc-${name}`,
    filePath: `/skills/${name}/SKILL.md`,
    baseDir: `/skills/${name}`,
    sourceInfo: {
      path: `/skills/${name}/SKILL.md`,
      source: "user",
      scope: "user",
      origin: "top-level",
    },
    disableModelInvocation: opts.disableModelInvocation ?? false,
  } as Skill;
}

/** 构造含 available_skills 段的 system prompt（贴近 pi 的 buildSystemPrompt 产出） */
function makeSystemPrompt(skillNames: string[]): string {
  const blocks = skillNames
    .map(
      (n) =>
        `  <skill>\n    <name>${n}</name>\n    <description>desc-${n}</description>\n    <location>/skills/${n}/SKILL.md</location>\n  </skill>`,
    )
    .join("\n");
  return [
    "You are an expert coding assistant...",
    "",
    "The following skills provide specialized instructions for specific tasks.",
    "Use the read tool to load a skill's file when the task matches its description.",
    "When a skill file references a relative path, resolve it against the skill directory (parent of SKILL.md / dirname of the path) and use that absolute path in tool commands.",
    "",
    "<available_skills>",
    blocks,
    "</available_skills>",
    "Current working directory: /tmp",
  ].join("\n");
}

/** mock renderSkills：返回可识别的标记串，便于断言（空数组返回空串） */
function mockRender(skills: Skill[]): string {
  if (skills.length === 0) return "";
  return `\n\nRENDERED:${skills.map((s) => s.name).join(",")}`;
}

// ============================================================================
// parseConfig
// ============================================================================

test("parseConfig: 合法配置原样返回", () => {
  deepStrictEqual(parseConfig({ excluded: ["a", "b"] }), {
    excluded: ["a", "b"],
  });
});

test("parseConfig: 空数组", () => {
  deepStrictEqual(parseConfig({ excluded: [] }), { excluded: [] });
});

test("parseConfig: null 回退默认", () => {
  deepStrictEqual(parseConfig(null), DEFAULT_CONFIG);
});

test("parseConfig: 非对象回退默认", () => {
  deepStrictEqual(parseConfig("str"), DEFAULT_CONFIG);
  deepStrictEqual(parseConfig(123), DEFAULT_CONFIG);
});

test("parseConfig: excluded 非数组回退默认", () => {
  deepStrictEqual(parseConfig({}), DEFAULT_CONFIG);
  deepStrictEqual(parseConfig({ excluded: "a" }), DEFAULT_CONFIG);
});

test("parseConfig: 过滤非 string 元素", () => {
  deepStrictEqual(parseConfig({ excluded: ["a", 1, null, "b", true] }), {
    excluded: ["a", "b"],
  });
});

// ============================================================================
// filterSkillsSection
// ============================================================================

test("filterSkillsSection: 有命中 -> 替换为过滤后的渲染", () => {
  const skills = [makeSkill("a"), makeSkill("b"), makeSkill("c")];
  const prompt = makeSystemPrompt(["a", "b", "c"]);
  const replaced = filterSkillsSection(
    prompt,
    skills,
    new Set(["b"]),
    mockRender,
  );
  ok(replaced !== null);
  ok(replaced.includes("RENDERED:a,c"));
  ok(!replaced.includes("<name>b</name>"));
  ok(replaced.includes("Current working directory: /tmp"));
});

test("filterSkillsSection: 排除集合空 -> null", () => {
  const skills = [makeSkill("a")];
  const prompt = makeSystemPrompt(["a"]);
  strictEqual(filterSkillsSection(prompt, skills, new Set(), mockRender), null);
});

test("filterSkillsSection: 命中的全是 disableModelInvocation -> null", () => {
  const skills = [makeSkill("a", { disableModelInvocation: true })];
  const prompt = makeSystemPrompt(["a"]);
  strictEqual(
    filterSkillsSection(prompt, skills, new Set(["a"]), mockRender),
    null,
  );
});

test("filterSkillsSection: 全部排除 -> 段消失", () => {
  const skills = [makeSkill("a"), makeSkill("b")];
  const prompt = makeSystemPrompt(["a", "b"]);
  const replaced = filterSkillsSection(
    prompt,
    skills,
    new Set(["a", "b"]),
    mockRender,
  );
  ok(replaced !== null);
  ok(!replaced.includes("<available_skills>"));
  ok(!replaced.includes("The following skills"));
  ok(replaced.includes("Current working directory: /tmp"));
});

test("filterSkillsSection: 正则未匹配（无 skills 段）-> null", () => {
  const skills = [makeSkill("a")];
  const prompt = "You are an assistant.\nCurrent working directory: /tmp";
  strictEqual(
    filterSkillsSection(prompt, skills, new Set(["a"]), mockRender),
    null,
  );
});

test("filterSkillsSection: disableModelInvocation 的 skill 不进 filtered", () => {
  const skills = [
    makeSkill("a"),
    makeSkill("d", { disableModelInvocation: true }),
  ];
  const prompt = makeSystemPrompt(["a", "d"]);
  const replaced = filterSkillsSection(
    prompt,
    skills,
    new Set(["a"]),
    mockRender,
  );
  ok(replaced !== null);
  ok(!replaced.includes("RENDERED:"));
});

// ============================================================================
// summarizeSkills / formatStartupSummary
// ============================================================================

test("summarizeSkills: 三类分类 + 字母序", () => {
  const skills = [
    { name: "zeta" },
    { name: "alpha" },
    { name: "mid", disableModelInvocation: true },
    { name: "beta" },
    { name: "gamma", disableModelInvocation: true },
  ];
  deepStrictEqual(summarizeSkills(skills, new Set(["beta", "missing"])), {
    injected: ["alpha", "zeta"],
    forbidden: ["beta"],
    nonInjectable: ["gamma", "mid"],
  });
});

test("summarizeSkills: 全部 injected", () => {
  deepStrictEqual(summarizeSkills([{ name: "b" }, { name: "a" }], new Set()), {
    injected: ["a", "b"],
    forbidden: [],
    nonInjectable: [],
  });
});

test("summarizeSkills: excluded 命中 non-injectable 仍归 non-injectable", () => {
  deepStrictEqual(
    summarizeSkills(
      [{ name: "x", disableModelInvocation: true }],
      new Set(["x"]),
    ),
    { injected: [], forbidden: [], nonInjectable: ["x"] },
  );
});

test("formatStartupSummary: 多行英文 + 空类写 0", () => {
  const text = formatStartupSummary({
    injected: ["a", "b"],
    forbidden: [],
    nonInjectable: ["z"],
  });
  strictEqual(
    text,
    [
      "Skills injection",
      "injected (2): a, b",
      "forbidden (0): 0",
      "non-injectable (1): z",
    ].join("\n"),
  );
});

// ============================================================================
// sortSkillItems
// ============================================================================

test("sortSkillItems: 纯字母序", () => {
  const items = [{ name: "zeta" }, { name: "alpha" }, { name: "mid" }];
  const sorted = sortSkillItems(items);
  deepStrictEqual(
    sorted.map((i) => i.name),
    ["alpha", "mid", "zeta"],
  );
});

test("sortSkillItems: 不修改原数组", () => {
  const items = [{ name: "b" }, { name: "a" }];
  const original = items.map((i) => i.name);
  sortSkillItems(items);
  deepStrictEqual(
    items.map((i) => i.name),
    original,
  );
});

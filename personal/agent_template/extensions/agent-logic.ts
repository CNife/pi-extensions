/**
 * agent_template 纯逻辑：解析 ~/.pi/agent/agents/*.md frontmatter。
 *
 * 零运行时 pi 依赖（仅 node:fs/node:path），独立可测。
 * 编排（FabricProvider 注册、I/O 路由）在 index.ts。
 *
 * Run: npx tsx --test personal/agent_template/test/agent-logic.test.ts
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// ──── Types ─────────────────────────────────────────────────────

export interface AgentProfile {
  /** Subagent name（frontmatter name；缺失时由 listAgentProfiles 用文件名回填）。 */
  name: string;
  /** 角色描述（frontmatter description）。 */
  description: string;
  /** agents.run 的 model id（frontmatter model）。 */
  model: string;
  /** agents.run 的 thinking 级别（frontmatter thinking；默认 medium）。 */
  thinking: string;
  /** agents.run 的工具白名单（frontmatter tools）。undefined = 用 agents.run 默认工具集。 */
  tools?: string[];
  /** prompt 正文（frontmatter 之后的 markdown）。 */
  prompt: string;
}

export interface AgentSummary {
  name: string;
  description: string;
  model: string;
}

// ──── Errors ────────────────────────────────────────────────────

export class AgentProfileParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentProfileParseError";
  }
}

// ──── Defaults ──────────────────────────────────────────────────

/** frontmatter 缺失 thinking 时的默认值。 */
export const DEFAULT_THINKING = "medium";

// ──── Frontmatter splitting ─────────────────────────────────────

const FRONTMATTER_DELIM = "---";
const NL = "\n";

/** 按行切分，剥离行尾 \r（兼容 CRLF）。 */
function splitLines(text: string): string[] {
  return text.split(NL).map((line) =>
    line.endsWith("\r") ? line.slice(0, -1) : line,
  );
}

/**
 * 分离 leading --- frontmatter 与正文。
 * 无 frontmatter 或未闭合 -> AgentProfileParseError。
 */
function splitFrontmatter(content: string): {
  frontmatter: string;
  body: string;
} {
  const lines = splitLines(content);
  let i = 0;
  while (i < lines.length && lines[i].trim() === "") i++;
  if (i >= lines.length || lines[i].trim() !== FRONTMATTER_DELIM) {
    throw new AgentProfileParseError(
      'Agent profile has no frontmatter block; expected a leading "---" line.',
    );
  }
  const start = i + 1;
  let end = start;
  while (end < lines.length && lines[end].trim() !== FRONTMATTER_DELIM) end++;
  if (end >= lines.length) {
    throw new AgentProfileParseError(
      'Agent profile frontmatter is not closed; expected a closing "---" line.',
    );
  }
  return {
    frontmatter: lines.slice(start, end).join(NL),
    body: lines.slice(end + 1).join(NL),
  };
}

// ──── Minimal YAML-ish frontmatter parsing ──────────────────────

/** 去除包裹引号（单/双）。 */
function stripQuotes(value: string): string {
  if (
    value.length >= 2 &&
    ((value[0] === '"' && value[value.length - 1] === '"') ||
      (value[0] === "'" && value[value.length - 1] === "'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

/** 解析 flow array 内部 [a, b, c] 的 a, b, c -> ["a","b","c"]。 */
function parseFlowArray(inner: string): string[] {
  if (inner.trim() === "") return [];
  return inner
    .split(",")
    .map((s) => stripQuotes(s.trim()))
    .filter((s) => s !== "");
}

/**
 * 解析 frontmatter 文本为键值表。值统一为 string | string[]。
 * 仅处理 agent .md 用到的子集：key: value、key: "quoted"、
 * key: a, b, c（string）、key: [a, b]（flow array）、key: + 缩进 - item（block array）。
 */
function parseFrontmatterYaml(text: string): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {};
  const lines = splitLines(text);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "" || line.trimStart().startsWith("#")) {
      i++;
      continue;
    }
    const colon = line.indexOf(":");
    if (colon === -1) {
      i++;
      continue;
    }
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    if (value === "") {
      // 可能是 block array：收集后续缩进 - item 行
      const items: string[] = [];
      let j = i + 1;
      while (j < lines.length) {
        const m = lines[j].match(/^\s+-\s+(.*)$/);
        if (m === null) break;
        items.push(stripQuotes(m[1].trim()));
        j++;
      }
      if (items.length > 0) {
        result[key] = items;
        i = j;
      } else {
        result[key] = "";
        i++;
      }
      continue;
    }
    if (value.startsWith("[") && value.endsWith("]")) {
      result[key] = parseFlowArray(value.slice(1, -1));
      i++;
      continue;
    }
    result[key] = stripQuotes(value);
    i++;
  }
  return result;
}

/** 从已解析键值表读取 tools（string -> 逗号切分；string[] -> 原样）。 */
function coerceTools(raw: string | string[] | undefined): string[] | undefined {
  if (raw === undefined) return undefined;
  let arr: string[];
  if (Array.isArray(raw)) {
    arr = raw;
  } else if (raw.trim() === "") {
    arr = [];
  } else {
    arr = raw.split(",").map((s) => s.trim()).filter((s) => s !== "");
  }
  return arr.length > 0 ? arr : undefined;
}

/**
 * 解析单个 agent .md 全文 -> AgentProfile。
 *
 * - 无 frontmatter -> AgentProfileParseError
 * - 缺 thinking -> DEFAULT_THINKING（"medium"）
 * - 缺 tools -> undefined（agents.run 用默认工具集）
 * - 缺 prompt 正文 -> ""
 * - sessionPreference/sessionHint 等其他字段忽略
 */
export function parseAgentProfile(content: string): AgentProfile {
  const { frontmatter, body } = splitFrontmatter(content);
  const fm = parseFrontmatterYaml(frontmatter);

  const name = typeof fm.name === "string" ? fm.name.trim() : "";
  const description = typeof fm.description === "string" ? fm.description : "";
  const model = typeof fm.model === "string" ? fm.model.trim() : "";
  const thinking =
    typeof fm.thinking === "string" && fm.thinking.trim() !== ""
      ? fm.thinking.trim()
      : DEFAULT_THINKING;
  const tools = coerceTools(fm.tools);
  const prompt = body.trim();

  return { name, description, model, thinking, prompt, ...(tools ? { tools } : {}) };
}

/**
 * 扫描目录下 *.md，返回所有可解析的 agent profile（按 name 字母序）。
 * frontmatter 缺 name 时用文件名（去 .md）回填。单个 .md 解析失败跳过并 warn。
 * 目录不存在/不可读 -> []。
 */
export function scanProfiles(dir: string): AgentProfile[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  const profiles: AgentProfile[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".md")) continue;
    let content: string;
    try {
      content = readFileSync(join(dir, entry), "utf-8");
    } catch {
      continue;
    }
    let profile: AgentProfile;
    try {
      profile = parseAgentProfile(content);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn("[agent-template] Skipping " + entry + ": " + msg);
      continue;
    }
    if (profile.name === "") profile.name = entry.slice(0, -3);
    profiles.push(profile);
  }
  return profiles.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * 扫描目录下 *.md，返回每个 agent 的摘要（name/description/model）。
 * scanProfiles 的摘要视图，按 name 字母序。
 */
export function listAgentProfiles(dir: string): AgentSummary[] {
  return scanProfiles(dir).map((p) => ({
    name: p.name,
    description: p.description,
    model: p.model,
  }));
}

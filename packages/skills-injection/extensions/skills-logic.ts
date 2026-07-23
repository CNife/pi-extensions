/**
 * skills-injection 的纯逻辑（零运行时 pi 依赖，type-only import Skill）。
 *
 * 编排（event handlers、命令、配置 IO）在 index.ts。
 * 参考 auto-naming-session/transcript.ts 的可测分离模式。
 */

import type { Skill } from "@earendil-works/pi-coding-agent";

// ──── Config ────────────────────────────────────────────────────

export interface SkillsInjectionConfig {
  /** 被排除注入 available_skills 的技能名列表 */
  excluded: string[];
}

export const DEFAULT_CONFIG: SkillsInjectionConfig = { excluded: [] };

/**
 * 校验并解析配置 JSON。三层校验：对象 -> excluded 是数组 -> 元素是 string。
 * 任何不合法都回退默认配置。
 */
export function parseConfig(parsed: unknown): SkillsInjectionConfig {
  if (typeof parsed !== "object" || parsed === null) {
    return { ...DEFAULT_CONFIG };
  }
  const obj = parsed as Record<string, unknown>;
  if (!Array.isArray(obj.excluded)) {
    return { ...DEFAULT_CONFIG };
  }
  const excluded = obj.excluded.filter(
    (s): s is string => typeof s === "string",
  );
  return { excluded };
}

// ──── Skills 段替换 ─────────────────────────────────────────────

// 匹配 system prompt 中 formatSkillsForPrompt 产出的整段（含前导说明文字）。
// 格式硬编码于 pi 的 formatSkillsForPrompt（skills.ts:342-358），稳定可靠。
// customPrompt 与默认 prompt 两种模式都调用 formatSkillsForPrompt，格式一致。
const SKILLS_SECTION_RE =
  /\n\nThe following skills provide specialized instructions[\s\S]*?<\/available_skills>/;

/**
 * 过滤被排除的技能，重新渲染 <available_skills> 段。
 *
 * @param renderSkills 渲染函数（运行时传 pi 的 formatSkillsForPrompt）
 * @returns 替换后的 system prompt，或 null（无需修改：无命中 / 正则未匹配）
 */
export function filterSkillsSection(
  systemPrompt: string,
  skills: Skill[],
  excluded: ReadonlySet<string>,
  renderSkills: (skills: Skill[]) => string,
): string | null {
  // 是否有实际命中的排除项（仅对会被注入的 skill 计数）
  const hasHit = skills.some(
    (s) => excluded.has(s.name) && !s.disableModelInvocation,
  );
  if (!hasHit) return null;

  // 过滤：排除用户选中的，同时跳过 disableModelInvocation 的（本就不注入）
  const filtered = skills.filter(
    (s) => !excluded.has(s.name) && !s.disableModelInvocation,
  );
  const newSection = renderSkills(filtered);
  const replaced = systemPrompt.replace(SKILLS_SECTION_RE, newSection);
  if (replaced === systemPrompt) return null;
  return replaced;
}

// ──── session_start 通知 ───────────────────────────────────────

export interface InjectedSummary {
  injected: string[];
  excludedCount: number;
}

/** 从技能名列表和排除集合，计算本会话注入的技能。 */
export function computeInjected(
  skillNames: string[],
  excluded: ReadonlySet<string>,
): InjectedSummary {
  const injected = skillNames.filter((name) => !excluded.has(name));
  return { injected, excludedCount: skillNames.length - injected.length };
}

// ──── /skills-injection 命令排序 ────────────────────────────────

export interface SkillItem {
  name: string;
}

/**
 * 按名字字母序排序。返回新数组，不修改原数组。
 */
export function sortSkillItems(items: SkillItem[]): SkillItem[] {
  return [...items].sort((a, b) => a.name.localeCompare(b.name));
}

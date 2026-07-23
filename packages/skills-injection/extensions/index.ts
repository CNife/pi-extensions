/**
 * skills-injection
 *
 * 交互式控制哪些技能被注入到 pi 的系统提示词（available_skills）。
 *
 * - /skills-injection 命令：多选勾选要【排除】的技能，持久化到配置文件
 * - before_agent_start：按配置过滤 skills，重新渲染 <available_skills> 段
 * - session_start：通知用户本会话注入了哪些技能
 *
 * 纯逻辑（parseConfig / filterSkillsSection / computeInjected / sortSkillItems）
 * 在 ./skills-logic.ts，独立可测。本文件只做编排（event hooks、命令、配置 IO）。
 *
 * 配置：~/.pi/agent/cnife-skills-injection.json，{ "excluded": ["name", ...] }
 * 生效：下一条消息即生效（before_agent_start 每 turn 读配置），无需 reload
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  type ExtensionAPI,
  formatSkillsForPrompt,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import {
  Key,
  matchesKey,
  visibleWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import {
  computeInjected,
  DEFAULT_CONFIG,
  filterSkillsSection,
  parseConfig,
  type SkillItem,
  type SkillsInjectionConfig,
  sortSkillItems,
} from "./skills-logic.ts";

// ──── Config IO ─────────────────────────────────────────────────

const CONFIG_PATH = join(getAgentDir(), "cnife-skills-injection.json");

function saveConfig(config: SkillsInjectionConfig): void {
  const dir = dirname(CONFIG_PATH);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, "utf-8");
}

function loadConfig(): SkillsInjectionConfig {
  // Level 1: 文件不存在 -> 默认配置
  if (!existsSync(CONFIG_PATH)) {
    return { ...DEFAULT_CONFIG };
  }
  // Level 2: 读取 + JSON 解析
  let raw: string;
  try {
    raw = readFileSync(CONFIG_PATH, "utf-8");
  } catch {
    return { ...DEFAULT_CONFIG };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.warn(
      "[skills-injection] Invalid JSON in config file, using defaults",
    );
    return { ...DEFAULT_CONFIG };
  }
  // Level 3: 类型校验（纯函数）
  return parseConfig(parsed);
}

// ──── Entry Point ───────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  // 启动时通知本会话注入的技能
  pi.on("session_start", async (_event, ctx) => {
    if (!ctx.hasUI) return;

    const commands = pi.getCommands();
    const skillNames = commands
      .filter((c) => c.source === "skill")
      .map((c) => c.name.replace(/^skill:/, ""));

    if (skillNames.length === 0) return;

    const config = loadConfig();
    const { injected, excludedCount } = computeInjected(
      skillNames,
      new Set(config.excluded),
    );

    const title =
      excludedCount > 0
        ? `注入 ${injected.length} 个技能（已排除 ${excludedCount} 个）`
        : `注入 ${injected.length} 个技能`;
    ctx.ui.notify(`${title}：${injected.join(", ")}`, "info");
  });

  // 拦截 system prompt，过滤被排除的技能
  pi.on("before_agent_start", async (event) => {
    const config = loadConfig();
    if (config.excluded.length === 0) return;

    const skills = event.systemPromptOptions.skills ?? [];
    const replaced = filterSkillsSection(
      event.systemPrompt,
      skills,
      new Set(config.excluded),
      formatSkillsForPrompt,
    );
    if (replaced === null) return;

    return { systemPrompt: replaced };
  });

  // /skills-injection 命令：交互式多选
  pi.registerCommand("skills-injection", {
    description: "配置哪些技能不被注入到系统提示词",
    handler: async (_args, ctx) => {
      if (ctx.mode !== "tui") {
        ctx.ui.notify("skills-injection 需要交互式终端", "warning");
        return;
      }

      const options = ctx.getSystemPromptOptions();
      const allSkills = options.skills ?? [];
      // 只列出会被注入的 skill（disableModelInvocation 的本就不注入，排除无意义）
      const items: SkillItem[] = allSkills
        .filter((s) => !s.disableModelInvocation)
        .map((s) => ({ name: s.name, description: s.description }));

      if (items.length === 0) {
        ctx.ui.notify("当前没有可注入的技能", "info");
        return;
      }

      const config = loadConfig();
      const excludedSet = new Set(config.excluded);
      const sorted = sortSkillItems(items, excludedSet);

      const result = await ctx.ui.custom<{ excluded: string[] } | null>(
        (tui, theme, _kb, done) => {
          let cursor = 0;
          const selected = sorted.map((it) => excludedSet.has(it.name));
          let cachedLines: string[] | undefined;

          const refresh = () => {
            cachedLines = undefined;
            tui.requestRender();
          };

          const handleInput = (data: string) => {
            if (matchesKey(data, Key.up)) {
              cursor = Math.max(0, cursor - 1);
              refresh();
              return;
            }
            if (matchesKey(data, Key.down)) {
              cursor = Math.min(sorted.length - 1, cursor + 1);
              refresh();
              return;
            }
            if (data === " ") {
              selected[cursor] = !selected[cursor];
              refresh();
              return;
            }
            if (matchesKey(data, Key.enter)) {
              done({
                excluded: sorted
                  .filter((_, i) => selected[i])
                  .map((it) => it.name),
              });
              return;
            }
            if (matchesKey(data, Key.escape)) {
              done(null);
              return;
            }
          };

          const render = (width: number): string[] => {
            if (cachedLines) return cachedLines;
            const lines: string[] = [];
            const renderWidth = Math.max(1, width);

            const addWrapped = (text: string) => {
              lines.push(...wrapTextWithAnsi(text, renderWidth));
            };
            const addWrappedWithPrefix = (prefix: string, text: string) => {
              const prefixWidth = visibleWidth(prefix);
              if (prefixWidth >= renderWidth) {
                addWrapped(prefix + text);
                return;
              }
              const wrapped = wrapTextWithAnsi(text, renderWidth - prefixWidth);
              const cont = " ".repeat(prefixWidth);
              for (let i = 0; i < wrapped.length; i++) {
                lines.push(`${i === 0 ? prefix : cont}${wrapped[i]}`);
              }
            };

            lines.push(theme.fg("accent", "─".repeat(renderWidth)));
            addWrappedWithPrefix(
              " ",
              theme.fg("text", "skills-injection：勾选要【排除】的技能"),
            );
            addWrappedWithPrefix(
              " ",
              theme.fg("dim", "↑↓ 导航 · Space 切换 · Enter 保存 · Esc 取消"),
            );
            lines.push("");

            for (let i = 0; i < sorted.length; i++) {
              const item = sorted[i];
              const isCursor = i === cursor;
              const mark = selected[i] ? "[x]" : "[ ]";
              const prefix = isCursor ? theme.fg("accent", "> ") : "  ";
              const color = selected[i] ? "warning" : "text";
              addWrappedWithPrefix(
                prefix,
                theme.fg(color, `${mark} ${item.name}`),
              );
              if (item.description) {
                addWrappedWithPrefix(
                  "     ",
                  theme.fg("muted", item.description),
                );
              }
            }

            lines.push(theme.fg("accent", "─".repeat(renderWidth)));
            cachedLines = lines;
            return lines;
          };

          return {
            render,
            invalidate: () => {
              cachedLines = undefined;
            },
            handleInput,
          };
        },
      );

      if (!result) {
        ctx.ui.notify("已取消", "info");
        return;
      }

      const newExcluded = result.excluded;
      const oldSet = new Set(config.excluded);
      saveConfig({ excluded: newExcluded });

      const newlyExcluded = newExcluded.filter((n) => !oldSet.has(n)).length;
      const newlyRestored = config.excluded.filter(
        (n) => !new Set(newExcluded).has(n),
      ).length;

      const parts: string[] = [`排除 ${newExcluded.length} 个技能`];
      if (newlyExcluded > 0) parts.push(`新增排除 ${newlyExcluded}`);
      if (newlyRestored > 0) parts.push(`恢复 ${newlyRestored}`);
      ctx.ui.notify(`${parts.join("，")}，下一条消息生效`, "info");
    },
  });
}

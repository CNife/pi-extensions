/**
 * skills-injection
 *
 * 交互式控制哪些技能被注入到 pi 的系统提示词（available_skills）。
 *
 * - /skills-injection 命令：SettingsList 切换 enabled/disabled，即时持久化
 * - before_agent_start：按配置过滤 skills，重新渲染 <available_skills> 段
 * - session_start：英文通知本会话 injected / forbidden / non-injectable 技能
 *
 * 纯逻辑（parseConfig / filterSkillsSection / summarizeSkills / sortSkillItems）
 * 在 ./skills-logic.ts，独立可测。本文件只做编排（event hooks、命令、配置 IO）。
 *
 * 配置：~/.pi/agent/cnife-skills-injection.json，{ "excluded": ["name", ...] }
 * 生效：下一条消息即生效（before_agent_start 每 turn 读配置），无需 reload
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  DynamicBorder,
  type ExtensionAPI,
  formatSkillsForPrompt,
  getAgentDir,
  getSettingsListTheme,
  parseFrontmatter,
} from "@earendil-works/pi-coding-agent";
import {
  Container,
  type SettingItem,
  SettingsList,
  Text,
} from "@earendil-works/pi-tui";
import {
  DEFAULT_CONFIG,
  filterSkillsSection,
  formatStartupSummary,
  parseConfig,
  type SkillItem,
  type SkillLike,
  type SkillsInjectionConfig,
  sortSkillItems,
  summarizeSkills,
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

function loadSkillsFromCommands(pi: ExtensionAPI): SkillLike[] {
  return pi
    .getCommands()
    .filter((c) => c.source === "skill")
    .map((c) => {
      const name = c.name.replace(/^skill:/, "");
      let disableModelInvocation = false;
      try {
        const raw = readFileSync(c.sourceInfo.path, "utf-8");
        const { frontmatter } = parseFrontmatter(raw);
        disableModelInvocation =
          frontmatter["disable-model-invocation"] === true;
      } catch {
        // 读失败时按可注入处理
      }
      return { name, disableModelInvocation };
    });
}

// ──── Entry Point ───────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  // 启动时英文通知本会话技能注入分类
  pi.on("session_start", async (_event, ctx) => {
    if (!ctx.hasUI) return;

    const skills = loadSkillsFromCommands(pi);
    if (skills.length === 0) return;

    const config = loadConfig();
    const summary = summarizeSkills(skills, new Set(config.excluded));
    ctx.ui.notify(formatStartupSummary(summary), "info");
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

  // /skills-injection 命令：SettingsList 多开关（对齐 /tools、/settings）
  pi.registerCommand("skills-injection", {
    description: "Configure which skills inject into the system prompt",
    handler: async (_args, ctx) => {
      if (ctx.mode !== "tui") {
        ctx.ui.notify(
          "skills-injection requires an interactive TUI",
          "warning",
        );
        return;
      }

      const options = ctx.getSystemPromptOptions();
      const allSkills = options.skills ?? [];
      // 只列出会被注入的 skill（disableModelInvocation 的本就不注入，排除无意义）
      const items: SkillItem[] = allSkills
        .filter((s) => !s.disableModelInvocation)
        .map((s) => ({ name: s.name }));

      if (items.length === 0) {
        ctx.ui.notify("No injectable skills available", "info");
        return;
      }

      const excluded = new Set(loadConfig().excluded);
      const sorted = sortSkillItems(items);

      await ctx.ui.custom((tui, theme, _kb, done) => {
        const settingItems: SettingItem[] = sorted.map((it) => ({
          id: it.name,
          label: it.name,
          currentValue: excluded.has(it.name) ? "disabled" : "enabled",
          values: ["enabled", "disabled"],
        }));

        const container = new Container();
        // 上下分割线对齐官方 /settings（DynamicBorder + border 色）
        container.addChild(
          new DynamicBorder((s: string) => theme.fg("border", s)),
        );
        container.addChild(
          new Text(theme.fg("accent", theme.bold("Skills Injection")), 1, 0),
        );

        const settingsList = new SettingsList(
          settingItems,
          Math.min(settingItems.length + 2, 15),
          getSettingsListTheme(),
          (id, newValue) => {
            if (newValue === "disabled") {
              excluded.add(id);
            } else {
              excluded.delete(id);
            }
            saveConfig({ excluded: [...excluded].sort() });
          },
          () => {
            done(undefined);
          },
          { enableSearch: true },
        );

        container.addChild(settingsList);
        container.addChild(
          new DynamicBorder((s: string) => theme.fg("border", s)),
        );

        return {
          render(width: number) {
            return container.render(width);
          },
          invalidate() {
            container.invalidate();
          },
          handleInput(data: string) {
            settingsList.handleInput?.(data);
            tui.requestRender();
          },
        };
      });
    },
  });
}

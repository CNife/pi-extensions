import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  type ExtensionAPI,
  type ExtensionContext,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";

// ──── Config ────────────────────────────────────────────────────

export type AgentLoopReflectionConfig = {
  reminderTurnsInterval: number;
  reminderText: string;
};

const DEFAULT_REMINDER_TEXT = [
  "请先暂停继续推进，做一次 agent loop 反思：",
  "",
  "1. 回到用户的原始目标：现在正在做的事是否仍然直接服务于这个目标？",
  "2. 检查当前证据和方向：已经验证了什么，哪些只是猜测，下一步是否仍然是最小有效动作？",
  "3. 判断是否卡住、不确定或可能跑偏：如果是，请先调用 `advisor` 获取建议，再继续。",
  "",
  "如果一切仍然清晰，请用一两句话说明判断依据，然后继续执行。",
].join("\n");

const DEFAULT_CONFIG: AgentLoopReflectionConfig = {
  reminderTurnsInterval: 10,
  reminderText: DEFAULT_REMINDER_TEXT,
};

const CONFIG_PATH = join(getAgentDir(), "cnife-agent-loop-reflection.json");
const STATUS_KEY = "agent-loop-reflection";

function warnConfig(message: string): void {
  console.warn(`[agent-loop-reflection] ${message}`);
}

function saveDefaultConfig(path: string): void {
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(path, `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`, "utf-8");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function loadConfig(): AgentLoopReflectionConfig | null {
  if (!existsSync(CONFIG_PATH)) {
    try {
      saveDefaultConfig(CONFIG_PATH);
    } catch {
      warnConfig("Failed to create default config file");
      return null;
    }
    return { ...DEFAULT_CONFIG };
  }

  let raw: string;
  try {
    raw = readFileSync(CONFIG_PATH, "utf-8");
  } catch {
    warnConfig("Failed to read config file, using defaults");
    return { ...DEFAULT_CONFIG };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    warnConfig("Invalid JSON in config file, using defaults");
    return { ...DEFAULT_CONFIG };
  }

  if (!isRecord(parsed)) {
    warnConfig("Config is not an object, using defaults");
    return { ...DEFAULT_CONFIG };
  }

  if (
    parsed.reminderTurnsInterval !== undefined &&
    !isPositiveInteger(parsed.reminderTurnsInterval)
  ) {
    warnConfig(
      "reminderTurnsInterval must be a positive integer, using defaults",
    );
    return { ...DEFAULT_CONFIG };
  }

  if (
    parsed.reminderText !== undefined &&
    (typeof parsed.reminderText !== "string" ||
      parsed.reminderText.trim().length === 0)
  ) {
    warnConfig("reminderText must be a non-empty string, using defaults");
    return { ...DEFAULT_CONFIG };
  }

  return {
    reminderTurnsInterval:
      parsed.reminderTurnsInterval !== undefined
        ? (parsed.reminderTurnsInterval as number)
        : DEFAULT_CONFIG.reminderTurnsInterval,
    reminderText:
      parsed.reminderText !== undefined
        ? (parsed.reminderText as string)
        : DEFAULT_CONFIG.reminderText,
  };
}

// ──── State ────────────────────────────────────────────────────

// Single countdown: how many more assistant turns before the next reminder.
let turnsUntilNextReminder = 0;

function resetCadence(value: number): void {
  turnsUntilNextReminder = value;
}

function setConfigErrorStatus(ctx: ExtensionContext): void {
  ctx.ui.setStatus(
    STATUS_KEY,
    ctx.ui.theme.fg("error", "agent-loop-reflection config error"),
  );
}

// ──── Entry Point ──────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  const config = loadConfig();
  if (!config) {
    pi.on("session_start", (_event, ctx) => {
      setConfigErrorStatus(ctx);
    });
    return;
  }

  resetCadence(config.reminderTurnsInterval);

  pi.on("session_start", () => resetCadence(config.reminderTurnsInterval));
  pi.on("session_tree", () => resetCadence(config.reminderTurnsInterval));
  pi.on("session_compact", () => resetCadence(config.reminderTurnsInterval));
  pi.on("agent_start", () => resetCadence(config.reminderTurnsInterval));
  pi.on("agent_end", () => resetCadence(config.reminderTurnsInterval));

  pi.on("input", (event) => {
    if (event.source === "extension") return;
    resetCadence(config.reminderTurnsInterval);
  });

  pi.on("turn_end", (event) => {
    if (event.message.role !== "assistant") return;

    turnsUntilNextReminder--;

    if (event.message.stopReason !== "toolUse") return;
    if (turnsUntilNextReminder > 0) return;

    pi.sendUserMessage(config.reminderText, { deliverAs: "steer" });
    turnsUntilNextReminder = config.reminderTurnsInterval + 1;
  });
}

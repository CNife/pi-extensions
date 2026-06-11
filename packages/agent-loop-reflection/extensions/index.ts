import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  type ExtensionAPI,
  type ExtensionContext,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";

// ──── Config ────────────────────────────────────────────────────

export type AgentLoopReflectionConfig = {
  enabled: boolean;
  thresholdTurns: number;
  repeatEveryTurns: number;
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
  enabled: true,
  thresholdTurns: 10,
  repeatEveryTurns: 10,
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

  if (parsed.enabled !== undefined && typeof parsed.enabled !== "boolean") {
    warnConfig("enabled must be a boolean, using defaults");
    return { ...DEFAULT_CONFIG };
  }

  if (
    parsed.thresholdTurns !== undefined &&
    !isPositiveInteger(parsed.thresholdTurns)
  ) {
    warnConfig("thresholdTurns must be a positive integer, using defaults");
    return { ...DEFAULT_CONFIG };
  }

  if (
    parsed.repeatEveryTurns !== undefined &&
    !isPositiveInteger(parsed.repeatEveryTurns)
  ) {
    warnConfig("repeatEveryTurns must be a positive integer, using defaults");
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
    enabled:
      parsed.enabled !== undefined
        ? (parsed.enabled as boolean)
        : DEFAULT_CONFIG.enabled,
    thresholdTurns:
      parsed.thresholdTurns !== undefined
        ? (parsed.thresholdTurns as number)
        : DEFAULT_CONFIG.thresholdTurns,
    repeatEveryTurns:
      parsed.repeatEveryTurns !== undefined
        ? (parsed.repeatEveryTurns as number)
        : DEFAULT_CONFIG.repeatEveryTurns,
    reminderText:
      parsed.reminderText !== undefined
        ? (parsed.reminderText as string)
        : DEFAULT_CONFIG.reminderText,
  };
}

// ──── State ────────────────────────────────────────────────────

export type CadenceState = {
  effectiveTurnsSinceAnchor: number;
  lastReminderEffectiveTurn: number;
  latestNonPluginUserEntryId: string | null;
  pendingReflectionTurnsToSkip: number;
};

function createInitialState(): CadenceState {
  return {
    effectiveTurnsSinceAnchor: 0,
    lastReminderEffectiveTurn: 0,
    latestNonPluginUserEntryId: null,
    pendingReflectionTurnsToSkip: 0,
  };
}

function resetState(state: CadenceState): void {
  state.effectiveTurnsSinceAnchor = 0;
  state.lastReminderEffectiveTurn = 0;
  state.latestNonPluginUserEntryId = null;
  state.pendingReflectionTurnsToSkip = 0;
}

// ──── Branch Helpers ───────────────────────────────────────────

type TextContentLike = {
  type: string;
  text?: string;
};

type LatestUserMessage = {
  id: string;
  text: string;
};

function getUserMessageText(content: string | TextContentLike[]): string {
  if (typeof content === "string") return content;
  return content
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("");
}

function findLatestNonPluginUserMessage(
  ctx: ExtensionContext,
  reminderText: string,
): LatestUserMessage | null {
  const branch = ctx.sessionManager.getBranch();

  for (let i = branch.length - 1; i >= 0; i--) {
    const entry = branch[i];
    if (entry.type !== "message") continue;
    if (entry.message.role !== "user") continue;

    const content = entry.message.content;
    const text = getUserMessageText(content);
    if (text === reminderText) continue;

    return { id: entry.id, text };
  }

  return null;
}

function syncAnchorFromBranch(
  state: CadenceState,
  ctx: ExtensionContext,
  reminderText: string,
): boolean {
  const latest = findLatestNonPluginUserMessage(ctx, reminderText);
  if (!latest) return false;

  if (latest.id === state.latestNonPluginUserEntryId) return true;

  state.latestNonPluginUserEntryId = latest.id;
  state.effectiveTurnsSinceAnchor = 0;
  state.lastReminderEffectiveTurn = 0;
  state.pendingReflectionTurnsToSkip = 0;
  return true;
}

function recordEffectiveTurnIfNeeded(state: CadenceState): boolean {
  if (state.pendingReflectionTurnsToSkip > 0) {
    state.pendingReflectionTurnsToSkip -= 1;
    return false;
  }

  state.effectiveTurnsSinceAnchor += 1;
  return true;
}

export function shouldSendReminder(
  state: CadenceState,
  config: Pick<
    AgentLoopReflectionConfig,
    "thresholdTurns" | "repeatEveryTurns"
  >,
): boolean {
  if (state.effectiveTurnsSinceAnchor < config.thresholdTurns) return false;

  if (state.lastReminderEffectiveTurn === 0) return true;

  return (
    state.effectiveTurnsSinceAnchor - state.lastReminderEffectiveTurn >=
    config.repeatEveryTurns
  );
}

function markReminderSent(state: CadenceState): void {
  state.lastReminderEffectiveTurn = state.effectiveTurnsSinceAnchor;
  state.pendingReflectionTurnsToSkip += 1;
}

function willContinueAfterTurn(event: {
  message: { role: string; stopReason?: string };
}): boolean {
  return (
    event.message.role === "assistant" && event.message.stopReason === "toolUse"
  );
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

  const state = createInitialState();

  pi.on("session_start", () => {
    resetState(state);
  });

  pi.on("session_tree", () => {
    resetState(state);
  });

  pi.on("session_compact", () => {
    resetState(state);
  });

  pi.on("agent_start", () => {
    resetState(state);
  });

  pi.on("agent_end", () => {
    resetState(state);
  });

  pi.on("turn_end", (event, ctx) => {
    if (!config.enabled) return;
    if (event.message.role !== "assistant") return;
    if (!syncAnchorFromBranch(state, ctx, config.reminderText)) return;
    if (!recordEffectiveTurnIfNeeded(state)) return;
    if (!willContinueAfterTurn(event)) return;
    if (!shouldSendReminder(state, config)) return;

    pi.sendUserMessage(config.reminderText, { deliverAs: "steer" });
    markReminderSent(state);
  });
}

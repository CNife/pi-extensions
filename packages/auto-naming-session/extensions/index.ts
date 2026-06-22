import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Model, TextContent } from "@earendil-works/pi-ai";
import { completeSimple } from "@earendil-works/pi-ai";
import {
  type ExtensionAPI,
  type ExtensionContext,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";

// ──── Config ────────────────────────────────────────────────────

export type AutoNamingConfig = {
  /** 每 N 个 turn 自动刷新标题。null 禁用自动刷新 */
  auto_refresh_turns: number | null;
  /** 指定模型 "provider/modelId"，null 用当前 ctx.model */
  model: string | null;
  /** 标题语言 */
  language: string;
};

const DEFAULT_CONFIG: AutoNamingConfig = {
  auto_refresh_turns: 10,
  model: null,
  language: "english",
};

const CONFIG_PATH = join(getAgentDir(), "cnife-auto-naming-session.json");

function saveDefaultConfig(path: string): void {
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(path, `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`, "utf-8");
}

function loadConfig(): AutoNamingConfig | null {
  // Level 1: 文件不存在 → 写入默认配置
  if (!existsSync(CONFIG_PATH)) {
    try {
      saveDefaultConfig(CONFIG_PATH);
    } catch {
      return null;
    }
    return { ...DEFAULT_CONFIG };
  }

  // Level 2: 读取 + JSON 解析
  let raw: string;
  try {
    raw = readFileSync(CONFIG_PATH, "utf-8");
  } catch {
    console.warn(
      "[auto-naming-session] Failed to read config file, using defaults",
    );
    return { ...DEFAULT_CONFIG };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.warn(
      "[auto-naming-session] Invalid JSON in config file, using defaults",
    );
    return { ...DEFAULT_CONFIG };
  }

  // Level 3: 类型校验
  if (typeof parsed !== "object" || parsed === null) {
    console.warn(
      "[auto-naming-session] Config is not an object, using defaults",
    );
    return { ...DEFAULT_CONFIG };
  }

  const obj = parsed as Record<string, unknown>;

  if (
    obj.auto_refresh_turns !== undefined &&
    obj.auto_refresh_turns !== null &&
    typeof obj.auto_refresh_turns !== "number"
  ) {
    console.warn(
      "[auto-naming-session] auto_refresh_turns must be a number or null, using default",
    );
    return { ...DEFAULT_CONFIG };
  }

  if (
    obj.model !== undefined &&
    obj.model !== null &&
    typeof obj.model !== "string"
  ) {
    console.warn(
      "[auto-naming-session] model must be a string or null, using default",
    );
    return { ...DEFAULT_CONFIG };
  }

  if (obj.language !== undefined && typeof obj.language !== "string") {
    console.warn(
      "[auto-naming-session] language must be a string, using default",
    );
    return { ...DEFAULT_CONFIG };
  }

  return {
    auto_refresh_turns:
      obj.auto_refresh_turns !== undefined
        ? (obj.auto_refresh_turns as number | null)
        : DEFAULT_CONFIG.auto_refresh_turns,
    model:
      obj.model !== undefined
        ? (obj.model as string | null)
        : DEFAULT_CONFIG.model,
    language:
      obj.language !== undefined
        ? (obj.language as string)
        : DEFAULT_CONFIG.language,
  };
}

// ──── State ────────────────────────────────────────────────────

export type AutoNamingState = {
  /** 上次命名时记录的最后 entry ID，用于增量上下文 */
  lastEntryId: string | null;
  /** 是否已生成过首标题 */
  firstTitleGenerated: boolean;
};

function createInitialState(): AutoNamingState {
  return {
    lastEntryId: null,
    firstTitleGenerated: false,
  };
}

// ──── Helpers ───────────────────────────────────────────────────

interface AutoNamingEntry {
  title: string;
  lastEntryId: string | null;
  timestamp: number;
}

function findLatestAutoNamingTitle(ctx: {
  sessionManager: {
    getBranch: () => Array<{
      type: string;
      customType?: string;
      data?: unknown;
    }>;
  };
}): AutoNamingEntry | undefined {
  const branch = ctx.sessionManager.getBranch();
  for (let i = branch.length - 1; i >= 0; i--) {
    const entry = branch[i];
    if (entry.type === "custom" && entry.customType === "auto-naming-title") {
      return entry.data as AutoNamingEntry;
    }
  }
  return undefined;
}

function isTitleManuallyChanged(
  currentName: string | undefined,
  lastEntry: AutoNamingEntry | undefined,
): boolean {
  if (currentName === undefined) return false;
  if (!lastEntry) return false;
  return currentName !== lastEntry.title;
}

// ──── Transcript Building ────────────────────────────────────────

function messageContentToText(
  content: string | Array<{ type: string; text?: string }>,
): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((c): c is { type: "text"; text: string } => c.type === "text")
      .map((c) => c.text)
      .join(" ");
  }
  return "";
}

function buildTranscript(
  ctx: ExtensionContext,
  lastEntryId: string | null,
): string | null {
  const branch = ctx.sessionManager.getBranch();

  let started = lastEntryId === null;
  const parts: string[] = [];

  for (const entry of branch) {
    if (!started) {
      if (entry.id === lastEntryId) {
        started = true;
      }
      continue;
    }

    if (entry.type === "message" && entry.message) {
      if (entry.message.role === "user" || entry.message.role === "assistant") {
        const text = messageContentToText(entry.message.content);
        if (text) {
          parts.push(`${entry.message.role}: ${text}`);
        }
      }
    }
  }

  if (parts.length === 0) return null;
  return parts.join("\n\n");
}

function parseModelRef(
  ref: string,
): { provider: string; id: string } | undefined {
  const parts = ref.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return undefined;
  return { provider: parts[0], id: parts[1] };
}

async function generateTitle(
  ctx: ExtensionContext,
  config: AutoNamingConfig,
  transcript: string,
  notifyErrors: boolean,
): Promise<string | null> {
  // 解析模型
  let model: Model<any> | undefined;
  if (config.model) {
    const parsed = parseModelRef(config.model);
    if (!parsed) {
      if (notifyErrors) {
        ctx.ui.notify(
          `Invalid model "${config.model}". Use "provider/modelId"`,
          "warning",
        );
      }
      return null;
    }
    model = ctx.modelRegistry.find(parsed.provider, parsed.id);
    if (!model) {
      if (notifyErrors) {
        ctx.ui.notify(`Model "${config.model}" not found`, "warning");
      }
      return null;
    }
  } else {
    model = ctx.model;
    if (!model) return null;
  }

  // 获取认证
  const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
  if (!auth.ok) {
    if (notifyErrors) {
      ctx.ui.notify(`Auth failed: ${auth.error}`, "warning");
    }
    return null;
  }

  // 调用 LLM
  const userMessage = `Conversation:\n\n${transcript}\n\nSynthesize the full scope of this conversation into a concise title in ${config.language}.`;
  const systemPrompt = `You are a session titling assistant. Generate a concise, descriptive title (max 60 chars) for the following conversation in ${config.language}. Consider the overall conversation arc, key topics, and primary goals rather than focusing on the most recent messages. Output ONLY the title, no quotes, no explanation.`;

  const response = await completeSimple(
    model,
    {
      systemPrompt,
      messages: [{ role: "user", content: userMessage, timestamp: Date.now() }],
    },
    {
      apiKey: auth.apiKey,
      headers: auth.headers,
      maxTokens: 60,
    },
  );

  if (response.stopReason === "error" || response.stopReason === "aborted") {
    ctx.ui.notify(
      `Title gen failed: ${response.errorMessage ?? response.stopReason}`,
      "warning",
    );
    return null;
  }

  // 提取标题
  const title = response.content
    .filter((c): c is TextContent & { type: "text" } => c.type === "text")
    .map((c) => c.text)
    .join("")
    .trim()
    .slice(0, 60);

  if (!title) {
    if (notifyErrors) {
      ctx.ui.notify("Generated empty title, skipping", "warning");
    }
    return null;
  }

  return title;
}

function applyTitle(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  state: AutoNamingState,
  title: string,
): void {
  pi.setSessionName(title);
  pi.appendEntry("auto-naming-title", {
    title,
    lastEntryId: state.lastEntryId,
    timestamp: Date.now(),
  });
  state.lastEntryId = ctx.sessionManager.getLeafId() ?? null;
  state.firstTitleGenerated = true;
}

// ──── Constants ────────────────────────────────────────────────

const STATUS_KEY = "auto-naming";

function setConfigErrorStatus(ctx: {
  ui: {
    setStatus: (key: string, text: string) => void;
    theme: { fg: (style: string, text: string) => string };
  };
}): void {
  ctx.ui.setStatus(
    STATUS_KEY,
    ctx.ui.theme.fg("error", "auto-naming config error"),
  );
}

// ──── Entry Point ───────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  const config = loadConfig();
  if (!config) {
    pi.on("session_start", (_event, ctx) => {
      setConfigErrorStatus(ctx);
    });
    return;
  }

  const state = createInitialState();

  pi.on("session_start", async (_event, ctx) => {
    const lastEntry = findLatestAutoNamingTitle(ctx);
    state.lastEntryId = lastEntry?.lastEntryId ?? null;
    state.firstTitleGenerated = lastEntry !== undefined;
  });

  pi.on("agent_end", async (_event, ctx) => {
    const msgCount = countMessagesSince(ctx, state.lastEntryId);
    if (!shouldGenerateTitle(msgCount, config.auto_refresh_turns)) return;

    const currentName = pi.getSessionName();
    const lastEntry = findLatestAutoNamingTitle(ctx);
    if (isTitleManuallyChanged(currentName, lastEntry)) return;

    try {
      const transcript = buildTranscript(ctx, state.lastEntryId);
      if (!transcript) return;

      const title = await generateTitle(ctx, config, transcript, true);
      if (title) applyTitle(pi, ctx, state, title);
    } catch (err) {
      ctx.ui.notify(
        `Error: ${err instanceof Error ? err.message : String(err)}`,
        "error",
      );
    }
  });

  // 首条 user message 立即生成标题
  pi.on("message_end", async (event, ctx) => {
    if (!event.message || event.message.role !== "user") return;
    if (state.firstTitleGenerated) return;

    try {
      // 直接用 event.message 构建 transcript（此时 message 尚未进入 branch）
      const text = messageContentToText(event.message.content);
      if (!text) return;

      const transcript = `user: ${text}`;
      const title = await generateTitle(ctx, config, transcript, false);
      if (title) applyTitle(pi, ctx, state, title);
    } catch {
      // 首次生成失败不阻塞，等 agent_end 再试
    }
  });
}

/** 统计 lastEntryId 之后的 user + assistant 消息数量 */
function countMessagesSince(
  ctx: {
    sessionManager: {
      getBranch: () => Array<{
        type: string;
        id?: string;
        message?: { role: string };
      }>;
    };
  },
  lastEntryId: string | null,
): number {
  const branch = ctx.sessionManager.getBranch();
  let started = lastEntryId === null;
  let count = 0;

  for (const entry of branch) {
    if (!started) {
      if (entry.id === lastEntryId) {
        started = true;
      }
      continue;
    }
    if (
      entry.type === "message" &&
      entry.message &&
      (entry.message.role === "user" || entry.message.role === "assistant")
    ) {
      count++;
    }
  }
  return count;
}

/** 判断是否应该触发标题生成。基于消息数累积阈值 */
export function shouldGenerateTitle(
  messageCount: number,
  autoRefreshTurns: number | null,
): boolean {
  if (autoRefreshTurns === null) return false;
  return messageCount >= autoRefreshTurns;
}

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Model, TextContent } from "@earendil-works/pi-ai";
import { completeSimple } from "@earendil-works/pi-ai";
import {
  type ExtensionAPI,
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
};

function createInitialState(): AutoNamingState {
  return {
    lastEntryId: null,
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

function buildTranscript(
  ctx: {
    sessionManager: {
      getBranch: () => Array<{
        type: string;
        id?: string;
        message?: {
          role: string;
          content: string | Array<{ type: string; text?: string }>;
        };
      }>;
    };
  },
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
        const content = entry.message.content;
        const text =
          typeof content === "string"
            ? content
            : Array.isArray(content)
              ? content
                  .filter(
                    (c): c is { type: "text"; text: string } =>
                      c.type === "text",
                  )
                  .map((c) => c.text)
                  .join(" ")
              : "";
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
  });

  pi.on("turn_end", async (event, ctx) => {
    const turnIndex = event.turnIndex;

    if (!shouldGenerateTitle(turnIndex, config.auto_refresh_turns)) return;

    const currentName = pi.getSessionName();
    const lastEntry = findLatestAutoNamingTitle(ctx);
    if (isTitleManuallyChanged(currentName, lastEntry)) return;

    try {
      // 1. 解析模型
      let model: Model<any> | undefined;
      if (config.model) {
        const parsed = parseModelRef(config.model);
        if (!parsed) {
          ctx.ui.notify(
            `Invalid model "${config.model}". Use "provider/modelId"`,
            "warning",
          );
          return;
        }
        model = ctx.modelRegistry.find(parsed.provider, parsed.id);
        if (!model) {
          ctx.ui.notify(`Model "${config.model}" not found`, "warning");
          return;
        }
      } else {
        model = ctx.model;
        if (!model) return;
      }

      // 2. 获取认证
      const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
      if (!auth.ok) {
        ctx.ui.notify(`Auth failed: ${auth.error}`, "warning");
        return;
      }

      // 3. 构建对话上下文
      const transcript = buildTranscript(ctx, state.lastEntryId);
      if (!transcript) return;

      // 4. 调用 LLM
      const userMessage = `Conversation:\n\n${transcript}\n\nGenerate a concise title for this conversation in ${config.language}.`;

      const systemPrompt = `You are a session titling assistant. Generate a concise, descriptive title (max 60 chars) for the following conversation in ${config.language}. Output ONLY the title, no quotes, no explanation.`;

      const response = await completeSimple(
        model,
        {
          systemPrompt,
          messages: [
            { role: "user", content: userMessage, timestamp: Date.now() },
          ],
        },
        {
          apiKey: auth.apiKey,
          headers: auth.headers,
          maxTokens: 60,
        },
      );

      if (
        response.stopReason === "error" ||
        response.stopReason === "aborted"
      ) {
        ctx.ui.notify(
          `Title gen failed: ${response.errorMessage ?? response.stopReason}`,
          "warning",
        );
        return;
      }

      // 5. 提取标题
      const title = response.content
        .filter((c): c is TextContent & { type: "text" } => c.type === "text")
        .map((c) => c.text)
        .join("")
        .trim()
        .slice(0, 60);

      if (!title) {
        ctx.ui.notify("Generated empty title, skipping", "warning");
        return;
      }

      // 6. 应用标题
      pi.setSessionName(title);

      // 7. 持久化元数据（用于手动保护）
      pi.appendEntry("auto-naming-title", {
        title,
        lastEntryId: state.lastEntryId,
        timestamp: Date.now(),
      });
      state.lastEntryId = ctx.sessionManager.getLeafId() ?? null;
    } catch (err) {
      ctx.ui.notify(
        `Error: ${err instanceof Error ? err.message : String(err)}`,
        "error",
      );
    }
  });
}

/** 判断是否应该触发标题生成。turnIndex 是 0-based */
export function shouldGenerateTitle(
  turnIndex: number,
  autoRefreshTurns: number | null,
): boolean {
  if (turnIndex === 0) return true;
  if (autoRefreshTurns === null) return false;
  return turnIndex >= autoRefreshTurns && turnIndex % autoRefreshTurns === 0;
}

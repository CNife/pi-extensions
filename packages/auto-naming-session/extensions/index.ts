import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import type { Model, TextContent } from "@earendil-works/pi-ai";
import { completeSimple } from "@earendil-works/pi-ai";
import {
  type ExtensionAPI,
  type ExtensionContext,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import {
  buildFullTranscript,
  buildFullTranscriptWithPending,
  hasAutoNamingTitle,
  shouldRefresh,
} from "./transcript.ts";

// ──── Herdr Sync ───────────────────────────────────────────────

const execFileAsync = promisify(execFile);
const HERDR_SOURCE = "pi-auto-naming";

function getHerdrPaneId(): string | undefined {
  if (process.env.HERDR_ENV !== "1") return undefined;
  return process.env.HERDR_PANE_ID || undefined;
}

async function syncTitleToHerdr(title: string | undefined): Promise<void> {
  const paneId = getHerdrPaneId();
  if (!paneId) return;

  const args = ["pane", "report-metadata", paneId, "--source", HERDR_SOURCE];
  if (title) {
    args.push("--title", title);
  } else {
    args.push("--clear-title");
  }

  try {
    await execFileAsync("herdr", args);
  } catch {
    // herdr 未安装、pane 已关闭等——静默忽略
  }
}

// 跟踪上次同步到 herdr 的标题，去重避免重复调用
let lastSyncedTitle: string | undefined;

/** 当前标题与上次同步的不同时同步到 herdr，相同则跳过 */
async function syncTitleIfChanged(pi: ExtensionAPI): Promise<void> {
  const current = pi.getSessionName();
  if (current === lastSyncedTitle) return;
  lastSyncedTitle = current;
  await syncTitleToHerdr(current);
}

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
  /** 是否已生成过首标题（session_start 时从 hasAutoNamingTitle 派生） */
  firstTitleGenerated: boolean;
};

function createInitialState(): AutoNamingState {
  return {
    firstTitleGenerated: false,
  };
}

// ──── Helpers ───────────────────────────────────────────────────

interface AutoNamingEntry {
  title: string;
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

// ──── Title Generation ──────────────────────────────────────────
// Transcript 构建逻辑（buildFullTranscript / buildFullTranscriptWithPending /
// shouldRefresh / hasAutoNamingTitle）已提取到 ./transcript.ts 作为可测纯函数。

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
  state: AutoNamingState,
  title: string,
): void {
  pi.setSessionName(title);
  pi.appendEntry("auto-naming-title", {
    title,
    timestamp: Date.now(),
  });
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
  // herdr 同步：不依赖 auto-naming 配置。
  // session_info_changed 事件不转发到扩展层，改在 session_start / agent_end
  // 轮询 getSessionName()，变更时同步；自动改名后在 applyTitle 处即时同步。
  // 覆盖自动生成与手动 /name（手动改名在下一回合结束时同步）。
  pi.on("session_start", async () => {
    void syncTitleIfChanged(pi);
  });
  pi.on("agent_end", async () => {
    void syncTitleIfChanged(pi);
  });

  const config = loadConfig();
  if (!config) {
    pi.on("session_start", (_event, ctx) => {
      setConfigErrorStatus(ctx);
    });
    return;
  }

  const state = createInitialState();

  pi.on("session_start", async (_event, ctx) => {
    state.firstTitleGenerated = hasAutoNamingTitle(
      ctx.sessionManager.getBranch(),
    );
  });

  pi.on("agent_end", async (_event, ctx) => {
    const branch = ctx.sessionManager.getBranch();
    if (!shouldRefresh(branch, config.auto_refresh_turns)) return;

    const lastEntry = findLatestAutoNamingTitle(ctx);
    if (isTitleManuallyChanged(pi.getSessionName(), lastEntry)) return;

    try {
      const transcript = buildFullTranscript(branch);
      if (!transcript) return;

      const title = await generateTitle(ctx, config, transcript, true);
      if (title) {
        applyTitle(pi, state, title);
        void syncTitleIfChanged(pi);
      }
    } catch (err) {
      ctx.ui.notify(
        `Error: ${err instanceof Error ? err.message : String(err)}`,
        "error",
      );
    }
  });

  // 首条 user message 立即生成标题（方案 B：message_end 时当前消息尚未 append）
  pi.on("message_end", async (event, ctx) => {
    if (!event.message || event.message.role !== "user") return;
    if (state.firstTitleGenerated) return;

    try {
      // pi 先发 message_end 事件给扩展，后 appendMessage 持久化，故 branch 不含
      // 当前消息；用 buildFullTranscriptWithPending 拼接全量 branch + 当前消息。
      const transcript = buildFullTranscriptWithPending(
        ctx.sessionManager.getBranch(),
        event.message,
      );
      if (!transcript) return;

      const title = await generateTitle(ctx, config, transcript, false);
      if (title) {
        applyTitle(pi, state, title);
        void syncTitleIfChanged(pi);
      }
    } catch {
      // 首次生成失败不阻塞，等 agent_end 再试
    }
  });
}

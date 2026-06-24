import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import type { Model, TextContent } from "@earendil-works/pi-ai";
import { completeSimple } from "@earendil-works/pi-ai";
import {
  type ExtensionAPI,
  type ExtensionContext,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";

// ──── Config ────────────────────────────────────────────────────

interface VaultConfig {
  base: string;
  diary_dir: string;
  template: string;
  exclude_meta: string[];
}

interface DiaryConfig {
  /** "provider/modelId"，null 用当前 ctx.model */
  model: string | null;
  vaults: { work: VaultConfig; personal: VaultConfig };
}

const DEFAULT_CONFIG: DiaryConfig = {
  model: null,
  vaults: {
    work: {
      base: "",
      diary_dir: "工作日志",
      template: "日志模板.md",
      exclude_meta: ["AGENTS.md", "任务.md", "日志模板.md"],
    },
    personal: {
      base: "",
      diary_dir: "个人日记",
      template: "日记模板.md",
      exclude_meta: ["AGENTS.md"],
    },
  },
};

const CONFIG_PATH = join(getAgentDir(), "cnife-obsidian-diary.json");
const WEEKDAYS = [
  "星期一",
  "星期二",
  "星期三",
  "星期四",
  "星期五",
  "星期六",
  "星期日",
];

function saveDefaultConfig(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`, "utf-8");
}

/** 硬失败配置加载：任一级失败返回 null（日记写入绝不用猜测配置）。 */
function loadConfig(): DiaryConfig | null {
  // Level 1: 文件不存在 → 写模板配置（唯一写操作，只写配置文件）后报错
  if (!existsSync(CONFIG_PATH)) {
    try {
      saveDefaultConfig(CONFIG_PATH);
    } catch {
      return null;
    }
    return null;
  }

  // Level 2: 读取 + JSON 解析（硬失败，不回退默认值）
  let raw: string;
  try {
    raw = readFileSync(CONFIG_PATH, "utf-8");
  } catch {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  // Level 3: 类型校验（硬失败）
  if (typeof parsed !== "object" || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;

  const model = obj.model;
  if (model !== null && typeof model !== "string") return null;

  if (typeof obj.vaults !== "object" || obj.vaults === null) return null;
  const vaultsObj = obj.vaults as Record<string, unknown>;

  const work = parseVaultConfig(vaultsObj.work);
  const personal = parseVaultConfig(vaultsObj.personal);
  if (!work || !personal) return null;

  return { model: model as string | null, vaults: { work, personal } };
}

function parseVaultConfig(v: unknown): VaultConfig | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.base !== "string") return null;
  if (typeof o.diary_dir !== "string") return null;
  if (typeof o.template !== "string") return null;
  if (
    !Array.isArray(o.exclude_meta) ||
    o.exclude_meta.some((x) => typeof x !== "string")
  ) {
    return null;
  }
  return {
    base: o.base,
    diary_dir: o.diary_dir,
    template: o.template,
    exclude_meta: o.exclude_meta as string[],
  };
}

// ──── Path Helpers ──────────────────────────────────────────────

/** 展开 ~ 为 home 目录（防御性，配置 base 可能含 ~）。 */
function expandHome(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/") || p.startsWith("~\\")) {
    return join(homedir(), p.slice(2));
  }
  return p;
}

/** 越界校验：防 ../ 逃逸。加 sep 防前缀误配（/vault 匹配 /vault-escape）。 */
function isPathWithin(filePath: string, baseDir: string): boolean {
  const resolvedBase = resolve(baseDir);
  const resolvedFile = resolve(filePath);
  return (
    resolvedFile === resolvedBase || resolvedFile.startsWith(resolvedBase + sep)
  );
}

interface DiaryPaths {
  diaryPath: string;
}

/** {base}/{diary_dir}/{year}/{month:02d}/{year}年{month}月{day}日{星期}.md */
function computeDiaryPaths(
  vault: VaultConfig,
  date: Date = new Date(),
): DiaryPaths {
  const base = expandHome(vault.base);
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  // ponytail: getDay 0=周日→索引6，(getDay+6)%7 映射到 WEEKDAYS[0]=周一
  const weekday = WEEKDAYS[(date.getDay() + 6) % 7];
  const monthDir = join(
    base,
    vault.diary_dir,
    String(year),
    String(month).padStart(2, "0"),
  );
  return {
    diaryPath: join(monthDir, `${year}年${month}月${day}日${weekday}.md`),
  };
}

// ──── Scanning (复刻旧 _scan_todos / _scan_recent) ──────────────

const TODO_PATTERN = /^\s*-\s*\[ \]\s+(.+)$/;

interface Todo {
  file: string;
  line: number;
  content: string;
}

interface RecentDiary {
  file: string;
  mtime: Date;
  preview: string;
}

/** 递归遍历 .md 文件。 */
function walkMd(dir: string, cb: (filePath: string) => void): void {
  let entries: ReturnType<typeof readdirSync>;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      walkMd(fullPath, cb);
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      cb(fullPath);
    }
  }
}

function isExcluded(fname: string, exclude: Set<string>): boolean {
  return fname.endsWith("模板.md") || exclude.has(fname);
}

function scanTodos(vault: VaultConfig, days = 14): Todo[] {
  const base = expandHome(vault.base);
  const diaryBase = join(base, vault.diary_dir);
  const exclude = new Set(vault.exclude_meta);
  const cutoff = Date.now() - days * 86_400_000;
  const results: Todo[] = [];

  walkMd(diaryBase, (filePath) => {
    const fname = filePath.split(sep).pop() ?? "";
    if (isExcluded(fname, exclude)) return;
    const stat = statSync(filePath);
    if (stat.mtimeMs < cutoff) return;
    const rel = relative(base, filePath);
    const content = readFileSync(filePath, "utf-8");
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const m = TODO_PATTERN.exec(lines[i]);
      if (m && m[1] === " ") {
        results.push({ file: rel, line: i + 1, content: m[2].trim() });
      }
    }
  });

  return results;
}

function scanRecent(
  vault: VaultConfig,
  days = 10,
  excludePath?: string,
): RecentDiary[] {
  const base = expandHome(vault.base);
  const diaryBase = join(base, vault.diary_dir);
  const exclude = new Set(vault.exclude_meta);
  const cutoff = Date.now() - days * 86_400_000;
  const found: { mtime: Date; path: string }[] = [];

  walkMd(diaryBase, (filePath) => {
    const fname = filePath.split(sep).pop() ?? "";
    if (isExcluded(fname, exclude)) return;
    const stat = statSync(filePath);
    if (stat.mtimeMs < cutoff) return;
    found.push({ mtime: stat.mtime, path: filePath });
  });

  found.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
  const top = (
    excludePath ? found.filter((f) => f.path !== excludePath) : found
  ).slice(0, 3);

  return top.map((f) => {
    const content = readFileSync(f.path, "utf-8");
    const allLines = content.split("\n");
    const previewLines = allLines.slice(0, 30);
    const preview =
      allLines.length > 30
        ? `${previewLines.join("\n")}\n... (截断)`
        : previewLines.join("\n");
    return { file: relative(base, f.path), mtime: f.mtime, preview };
  });
}

function safeReadFile(path: string): string {
  try {
    return readFileSync(path, "utf-8").trim();
  } catch {
    return "";
  }
}

// ──── Transcript (复用 auto-naming 模式) ────────────────────────

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

function buildTranscript(ctx: ExtensionContext): string | null {
  const branch = ctx.sessionManager.getBranch();
  const parts: string[] = [];
  for (const entry of branch) {
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

// ──── Model Resolution (复用 auto-naming 模式) ──────────────────

function parseModelRef(
  ref: string,
): { provider: string; id: string } | undefined {
  const parts = ref.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return undefined;
  return { provider: parts[0], id: parts[1] };
}

async function resolveModel(
  ctx: ExtensionContext,
  config: DiaryConfig,
): Promise<Model<any> | null> {
  if (config.model) {
    const parsed = parseModelRef(config.model);
    if (!parsed) {
      ctx.ui.notify(
        `Invalid model "${config.model}". Use "provider/modelId"`,
        "warning",
      );
      return null;
    }
    const model = ctx.modelRegistry.find(parsed.provider, parsed.id);
    if (!model) {
      ctx.ui.notify(`Model "${config.model}" not found`, "warning");
      return null;
    }
    return model;
  }
  if (!ctx.model) {
    ctx.ui.notify("No model available", "warning");
    return null;
  }
  return ctx.model;
}

// ──── LLM Summary ───────────────────────────────────────────────

interface DiarySummary {
  variant: "work" | "personal";
  summary: string;
  instructions: string;
}

interface VaultContext {
  name: "work" | "personal";
  paths: DiaryPaths;
  todos: Todo[];
  recent: RecentDiary[];
  today: string;
}

function formatMtime(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${mm}-${dd} ${hh}:${mi}`;
}

function buildContextSection(c: VaultContext): string {
  const todoLines =
    c.todos.length > 0
      ? c.todos.map((t) => `  - ${t.file}:${t.line} | ${t.content}`).join("\n")
      : "  (无)";
  const recentLines =
    c.recent.length > 0
      ? c.recent
          .map(
            (r) =>
              `  ## ${r.file} (${formatMtime(r.mtime)})\n${r.preview
                .split("\n")
                .map((l) => `  ${l}`)
                .join("\n")}`,
          )
          .join("\n\n")
      : "  (无)";
  const todayContent = c.today || "(空)";
  return [
    `### ${c.name}`,
    `- 日记路径: ${c.paths.diaryPath}`,
    `- 待办 (${c.todos.length}):`,
    todoLines,
    `- 近期日记 (${c.recent.length}):`,
    recentLines,
    `- 今日日记已有内容:`,
    todayContent,
  ].join("\n");
}

/** 提取 JSON：优先围栏内，否则取首个 { 到末个 }，兜底裸文本。 */
function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  const trimmed = text.trim();
  const m = trimmed.match(/\{[\s\S]*\}/);
  return m ? m[0] : trimmed;
}

async function generateDiarySummary(
  ctx: ExtensionContext,
  model: Model<any>,
  apiKey: string | undefined,
  headers: Record<string, string> | undefined,
  transcript: string,
  contexts: VaultContext[],
  explicitVariant: "work" | "personal" | null,
): Promise<DiarySummary | null> {
  const variantClause = explicitVariant
    ? `本次变体已固定为 "${explicitVariant}"，variant 字段必须填 "${explicitVariant}"。`
    : "请根据会话内容判断属于 work（工作）还是 personal（个人），填入 variant。";

  const systemPrompt = `你是 Obsidian 日记总结助手。根据当前会话记录和日记上下文，生成今日日记草稿。

要求：
1. 总结会话中的关键事件、决策、成果，整合已有待办与近期日记的延续
2. 日记语言为中文，风格简洁专业，使用 markdown 格式
3. ${variantClause}
4. summary 是日记正文
5. instructions 是给写入执行者的操作说明（如：从模板创建新文件并写入 / 在已有内容后追加 / 覆盖更新等）

只输出合法 JSON，不要使用 markdown 围栏，不要输出任何解释文字。格式：{"variant":"work"|"personal","summary":"...","instructions":"..."}`;

  const contextSections = contexts.map(buildContextSection).join("\n\n");
  const userMessage = `## 当前会话记录

${transcript}

## 日记上下文

${contextSections}

请生成今日日记草稿。`;

  const response = await completeSimple(
    model,
    {
      systemPrompt,
      messages: [{ role: "user", content: userMessage, timestamp: Date.now() }],
    },
    { apiKey, headers, maxTokens: 2048 },
  );

  if (
    response.stopReason === "error" ||
    response.stopReason === "aborted" ||
    response.stopReason === "length"
  ) {
    ctx.ui.notify(
      `Diary gen failed: ${response.errorMessage ?? response.stopReason}`,
      "warning",
    );
    return null;
  }

  const text = response.content
    .filter((c): c is TextContent & { type: "text" } => c.type === "text")
    .map((c) => c.text)
    .join("")
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJson(text));
  } catch {
    ctx.ui.notify("Diary gen returned invalid JSON", "warning");
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) return null;
  const o = parsed as Record<string, unknown>;
  if (o.variant !== "work" && o.variant !== "personal") return null;
  if (typeof o.summary !== "string" || !o.summary) return null;
  if (typeof o.instructions !== "string") return null;

  return {
    variant: o.variant,
    summary: o.summary,
    instructions: o.instructions,
  };
}

// ──── Output ────────────────────────────────────────────────────

function formatDiaryMessage(
  diaryPath: string,
  variant: string,
  summary: string,
  instructions: string,
): string {
  return [
    "请完成 Obsidian 日记写入流程：",
    "",
    "**重要：禁止未经用户确认直接写入文件。必须先将下方日记草稿完整展示给用户，等待用户确认或修改后，再用工具写入。**",
    "",
    `- 日记路径: \`${diaryPath}\``,
    `- 变体: ${variant}`,
    "",
    "## 日记草稿",
    "",
    summary,
    "",
    "## 写入指令",
    "",
    instructions,
  ].join("\n");
}

// ──── Args ──────────────────────────────────────────────────────

function parseArgs(args: string): { variant: "work" | "personal" | null } {
  const trimmed = (args ?? "").trim();
  if (trimmed === "--work") return { variant: "work" };
  if (trimmed === "--personal") return { variant: "personal" };
  return { variant: null };
}

// ──── Entry Point ───────────────────────────────────────────────

export default function (pi: ExtensionAPI): void {
  pi.registerCommand("diary", {
    description: "Summarize the current session into an Obsidian diary entry",
    handler: async (args, ctx) => {
      // 1. 配置（硬失败）
      const config = loadConfig();
      if (!config) {
        ctx.ui.notify(
          `配置缺失或损坏，模板已写入 ${CONFIG_PATH}，请编辑后重试`,
          "error",
        );
        return;
      }

      // 2. 参数解析
      const { variant: explicitVariant } = parseArgs(args);

      // 3. 读取当前会话 transcript
      const transcript = buildTranscript(ctx);
      if (!transcript) {
        ctx.ui.notify("当前会话无记录可总结", "warning");
        return;
      }

      // 4. 路径计算 + 扫描（无标志双 vault，有标志单 vault）
      const names: ("work" | "personal")[] = explicitVariant
        ? [explicitVariant]
        : ["work", "personal"];

      const contexts: VaultContext[] = names.map((name) => {
        const vault = config.vaults[name];
        const paths = computeDiaryPaths(vault);
        return {
          name,
          paths,
          todos: scanTodos(vault),
          recent: scanRecent(vault, 10, paths.diaryPath),
          today: safeReadFile(paths.diaryPath),
        };
      });

      // 5. 路径越界校验
      for (const c of contexts) {
        if (
          !isPathWithin(
            c.paths.diaryPath,
            expandHome(config.vaults[c.name].base),
          )
        ) {
          ctx.ui.notify(
            `日记路径越界，请检查配置: ${c.paths.diaryPath}`,
            "error",
          );
          return;
        }
      }

      // 6. 模型选择 + 认证
      const model = await resolveModel(ctx, config);
      if (!model) return;
      const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
      if (!auth.ok) {
        ctx.ui.notify(`认证失败: ${auth.error}`, "warning");
        return;
      }

      // 7. LLM 语义总结
      const result = await generateDiarySummary(
        ctx,
        model,
        auth.apiKey,
        auth.headers,
        transcript,
        contexts,
        explicitVariant,
      );
      if (!result) return;

      // 8. 选定 diaryPath
      const chosen = contexts.find((c) => c.name === result.variant);
      if (!chosen) {
        ctx.ui.notify(`无效变体: ${result.variant}`, "error");
        return;
      }

      // 9. 发送到当前会话主 Agent
      pi.sendUserMessage(
        formatDiaryMessage(
          chosen.paths.diaryPath,
          result.variant,
          result.summary,
          result.instructions,
        ),
        { deliverAs: "followUp" },
      );
    },
  });
}

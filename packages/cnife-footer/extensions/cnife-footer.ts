/**
 * cnife-footer - 个人专属 pi footer。
 * 两行：第一行工作区（目录 · git分支 ↑ahead ↓behind *未提交 · 会话名），
 *       第二行模型（provider/id · thinking · ctx · $cost · tps）。
 * 全 dim，仅 ASCII + Unicode，无 nerd font，无配置。
 */

import { basename } from "node:path";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";

interface GitState {
  branch: string | null;
  ahead: number;
  behind: number;
  dirty: number;
}

/** 单轮对话的计时状态，移植自 pi-tps（裁剪掉 footer 不用的 cost/energy 字段）。 */
interface TurnTiming {
  lastUpdateMs: number;
  firstTokenMs: number | null;
  currentMessageStartMs: number | null;
  totalGenerationMs: number;
  updateCount: number;
  firstStreamUpdateMs: number | null;
  lastStreamUpdateMs: number;
  stallMs: number;
  stallCount: number;
  inStall: boolean;
  totalOutput: number;
}

const SEP = " · ";
const GIT_INTERVAL_MS = 10_000;
const BASH_REFRESH_DELAY_MS = 1500;

// ── TPS 算法常量（移植自 pi-tps buildTelemetry） ──────────────────────────
/** message_update 间隔超过此值视为推理停顿（ms） */
const STALL_THRESHOLD_MS = 500;
/** 流式窗口最短时长，低于则不作为 primary 测量（ms） */
const MIN_STREAM_MS = 1;
/** primary 分支要求的最少流式 update 数（不含 TTFT 那次） */
const MIN_STREAM_UPDATES = 5;
/** 流式 chunk 间平均间隔阈值，低于则判为缓冲刷盘而非真实生成（ms） */
const MIN_INTER_CHUNK_MS = 1;
/** 有效生成窗口最短时长（ms） */
const MIN_GENERATION_MS = 200;
/** fallback 分支判定停顿主导的活跃时长阈值（ms） */
const ACTIVE_TIME_THRESHOLD_MS = 200;
const STALL_REDUCTION_DENOM = 2;
const STALL_DOMINANCE_RATIO = 0.85;
/** 单轮速率上限，超过则判为测量伪影，返回 null */
const MAX_PLAUSIBLE_TPS = 10_000;

function fmt(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}K`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

function fmtCost(c: number): string {
  return c < 0.01 ? `$${c.toFixed(3)}` : `$${c.toFixed(2)}`;
}

/** Type guard：assistant message 且 usage 字段就绪，用于流式与结束事件。 */
function isAssistantMessage(message: unknown): message is AssistantMessage {
  if (!message || typeof message !== "object") return false;
  const msg = message as { role?: unknown; usage?: unknown };
  if (msg.role !== "assistant") return false;
  if (typeof msg.usage !== "object" || msg.usage === null) return false;
  const usage = msg.usage as { input?: unknown; output?: unknown };
  return typeof usage.input === "number" && typeof usage.output === "number";
}

/** 保留一位小数四舍五入。 */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * 由单轮计时状态算出生成速率（token/s）。
 * 三段门控：primary（纯流式窗口减停顿）/ fallback（含 TTFT 的保守估计）/ null（无法判定）。
 * 再经体积门：超过 MAX_PLAUSIBLE_TPS 判为伪影，返回 null。
 * 移植自 pi-tps 的 buildTelemetry，裁剪掉 footer 不需要的 cost/tokens/model 详情。
 */
function computeTps(timing: TurnTiming): number | null {
  if (timing.totalOutput <= 0) return null;
  if (timing.firstTokenMs === null) return null;

  const streamMs =
    timing.updateCount > 0 && timing.firstStreamUpdateMs !== null
      ? timing.lastStreamUpdateMs - timing.firstStreamUpdateMs
      : null;
  const avgInterChunkGap =
    streamMs !== null && timing.updateCount > 1
      ? streamMs / (timing.updateCount - 1)
      : 0;

  let tps: number | null = null;
  if (
    streamMs !== null &&
    streamMs >= MIN_STREAM_MS &&
    timing.updateCount >= MIN_STREAM_UPDATES &&
    avgInterChunkGap >= MIN_INTER_CHUNK_MS &&
    timing.stallMs < streamMs &&
    streamMs - timing.stallMs >= MIN_GENERATION_MS &&
    timing.stallMs < streamMs - timing.stallMs
  ) {
    // primary：流式窗口减去停顿，纯生成时间
    const effectiveStreamMs = streamMs - timing.stallMs;
    tps = round1(timing.totalOutput / (effectiveStreamMs / 1000));
  } else if (
    timing.updateCount >= 2 &&
    timing.totalGenerationMs >= MIN_GENERATION_MS
  ) {
    // fallback：含 TTFT 的完整生成窗口，保守低估
    let effectiveGenMs = timing.totalGenerationMs - timing.stallMs;
    const stallsDominate =
      effectiveGenMs < ACTIVE_TIME_THRESHOLD_MS ||
      timing.stallMs > timing.totalGenerationMs * STALL_DOMINANCE_RATIO;
    effectiveGenMs = stallsDominate
      ? Math.max(
          timing.totalGenerationMs - timing.stallMs / STALL_REDUCTION_DENOM,
          MIN_GENERATION_MS,
        )
      : Math.max(effectiveGenMs, MIN_GENERATION_MS);
    tps = round1(timing.totalOutput / (effectiveGenMs / 1000));
  } else {
    tps = null;
  }

  if (tps !== null && tps > MAX_PLAUSIBLE_TPS) {
    tps = null;
  }
  return tps;
}

/** Parse `git status -b --porcelain` output into branch/ahead/behind/dirty. */
function parseGitStatus(stdout: string): GitState {
  const lines = stdout.split("\n");
  const header = lines[0] ?? "";
  let branch: string | null = null;
  let ahead = 0;
  let behind = 0;

  // Header forms:
  //   ## main
  //   ## main...origin/main
  //   ## main...origin/main [ahead 1]
  //   ## main...origin/main [ahead 1, behind 2]
  //   ## main...origin/main [gone]
  //   ## HEAD (no branch)            -> detached
  //   ## No commits yet on main
  const m = header.match(
    /^## (?:HEAD \(no branch\)|No commits yet on (\S+)|(.+?)(?:\.\.\.\S+)?(?: \[(.+)\])?)$/,
  );
  if (m) {
    branch = m[1] ?? m[2] ?? null;
    const bracket = m[3];
    if (bracket) {
      const a = bracket.match(/ahead (\d+)/);
      const b = bracket.match(/behind (\d+)/);
      if (a) ahead = Number(a[1]);
      if (b) behind = Number(b[1]);
    }
  }

  let dirty = 0;
  for (let i = 1; i < lines.length; i++) {
    const l = lines[i];
    if (l && !l.startsWith("##")) dirty++;
  }

  return { branch, ahead, behind, dirty };
}

export default function (pi: ExtensionAPI) {
  let gitState: GitState = { branch: null, ahead: 0, behind: 0, dirty: 0 };
  let activeTui: { requestRender(): void } | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let bashRefreshTimer: ReturnType<typeof setTimeout> | undefined;
  let refreshing = false;
  let cwd = "";

  // TPS（生成速率）：turn 维度计时，lastTps 保留上一轮有效速率供 footer 渲染。
  // turn 进行中沿用上一轮值，与原「保持到下一条」体验一致。
  let currentTiming: TurnTiming | null = null;
  let lastTps: number | null = null;

  const refreshGit = async () => {
    if (refreshing) return;
    refreshing = true;
    try {
      const result = await pi
        .exec("git", ["status", "-b", "--porcelain"], { cwd })
        .catch(() => undefined);
      if (result === undefined) {
        gitState = { branch: null, ahead: 0, behind: 0, dirty: 0 };
      } else {
        gitState = parseGitStatus(result.stdout);
      }
      activeTui?.requestRender();
    } finally {
      refreshing = false;
    }
  };

  /** 清空当前轮计时与最近速率并重渲染（切模型/compact/树导航/新会话时调用）。 */
  const resetTps = () => {
    currentTiming = null;
    lastTps = null;
    activeTui?.requestRender();
  };

  pi.on("session_start", async (_event, ctx) => {
    cwd = ctx.cwd;
    gitState = { branch: null, ahead: 0, behind: 0, dirty: 0 };
    currentTiming = null;
    lastTps = null;

    ctx.ui.setFooter((tui, theme, footerData) => {
      activeTui = tui;
      const unsub = footerData.onBranchChange(() => {
        void refreshGit();
      });

      const renderLine = (parts: string[], width: number): string => {
        const joined = parts.filter((p) => p.length > 0).join(SEP);
        return truncateToWidth(
          theme.fg("dim", joined),
          width,
          theme.fg("dim", "..."),
        );
      };

      return {
        dispose() {
          unsub();
        },
        invalidate() {},
        render(width: number): string[] {
          try {
            // Line 1: dir · [branch ↑a ↓b *d] · session
            const dir = basename(cwd) || cwd;
            const gitParts: string[] = [];
            if (gitState.branch) {
              gitParts.push(gitState.branch);
              if (gitState.ahead > 0) gitParts.push(`↑${gitState.ahead}`);
              if (gitState.behind > 0) gitParts.push(`↓${gitState.behind}`);
              if (gitState.dirty > 0) gitParts.push(`*${gitState.dirty}`);
            }
            const gitStr = gitParts.join(" ");
            const session = pi.getSessionName() ?? "";
            const line1 = renderLine([dir, gitStr, session], width);

            // Line 2: provider/id · thinking · ctx · $cost · tps (cost=0/无 tps 隐藏)
            const model = ctx.model
              ? `${ctx.model.provider}/${ctx.model.id}`
              : "no-model";
            const thinking = pi.getThinkingLevel();

            let cost = 0;
            for (const e of ctx.sessionManager.getEntries()) {
              if (e.type === "message" && e.message.role === "assistant") {
                cost += (e.message as AssistantMessage).usage.cost.total;
              }
            }

            const usage = ctx.getContextUsage();
            let ctxStr: string;
            if (usage?.contextWindow) {
              const used = usage.tokens ?? 0;
              const pctStr =
                usage.percent !== null && usage.percent !== undefined
                  ? `${usage.percent.toFixed(1)}%`
                  : "?";
              ctxStr = `${fmt(used)}/${fmt(usage.contextWindow)} (${pctStr})`;
            } else {
              ctxStr = "?";
            }

            const costStr = cost > 0 ? fmtCost(cost) : "";
            const tpsStr = lastTps != null ? `${lastTps.toFixed(1)}t/s` : "";
            const line2 = renderLine(
              [model, thinking, ctxStr, costStr, tpsStr],
              width,
            );

            return [line1, line2];
          } catch {
            return [theme.fg("dim", "footer error")];
          }
        },
      };
    });

    void refreshGit();
    timer = setInterval(() => {
      void refreshGit();
    }, GIT_INTERVAL_MS);
  });

  // ── TPS：turn 维度计时（口径移植自 pi-tps） ──────────────────────────
  // turn_start 起计，message_update 累积流式窗口与停顿，turn_end 用三段门控
  // 算出生成速率。performance.now() 单调亚毫秒计时。
  pi.on("turn_start", () => {
    const now = performance.now();
    currentTiming = {
      lastUpdateMs: now,
      firstTokenMs: null,
      currentMessageStartMs: null,
      totalGenerationMs: 0,
      updateCount: 0,
      firstStreamUpdateMs: null,
      lastStreamUpdateMs: 0,
      stallMs: 0,
      stallCount: 0,
      inStall: false,
      totalOutput: 0,
    };
  });

  pi.on("message_start", (event) => {
    if (!currentTiming) return;
    if (!isAssistantMessage(event.message)) return;
    const now = performance.now();
    currentTiming.currentMessageStartMs = now;
    // 重置停顿时钟，工具间隙不计入推理停顿
    currentTiming.lastUpdateMs = now;
    currentTiming.inStall = false;
  });

  pi.on("message_update", (event) => {
    if (!currentTiming) return;
    if (!isAssistantMessage(event.message)) return;
    const now = performance.now();
    // 第一个 update 即 TTFT，不计入流式窗口
    if (currentTiming.firstTokenMs === null) {
      currentTiming.firstTokenMs = now;
      currentTiming.lastUpdateMs = now;
      return;
    }
    currentTiming.updateCount++;
    if (currentTiming.firstStreamUpdateMs === null) {
      currentTiming.firstStreamUpdateMs = now;
    }
    currentTiming.lastStreamUpdateMs = now;
    const gap = now - currentTiming.lastUpdateMs;
    if (gap >= STALL_THRESHOLD_MS) {
      if (!currentTiming.inStall) currentTiming.stallCount++;
      currentTiming.inStall = true;
      currentTiming.stallMs += gap;
    } else {
      currentTiming.inStall = false;
    }
    currentTiming.lastUpdateMs = now;
  });

  pi.on("message_end", (event) => {
    if (!currentTiming) return;
    if (!isAssistantMessage(event.message)) return;
    const message = event.message as AssistantMessage;
    const now = performance.now();
    if (currentTiming.currentMessageStartMs !== null) {
      currentTiming.totalGenerationMs +=
        now - currentTiming.currentMessageStartMs;
      currentTiming.currentMessageStartMs = null;
    }
    currentTiming.totalOutput += message.usage.output || 0;
    currentTiming.lastUpdateMs = now;
  });

  pi.on("turn_end", () => {
    if (!currentTiming) return;
    const timing = currentTiming;
    currentTiming = null;
    const tps = computeTps(timing);
    // 算不出（中断/报错/突发刷盘/窗口太短）时保留上一轮值，不渲染
    if (tps !== null) {
      lastTps = tps;
      activeTui?.requestRender();
    }
  });

  // 切模型 / compact / 树导航后重置 TPS（含当前轮计时状态）
  pi.on("session_tree", () => resetTps());
  pi.on("session_compact", () => resetTps());
  pi.on("model_select", () => resetTps());

  // agent 工具执行后立即刷新 git
  pi.on("tool_result", async () => {
    void refreshGit();
  });

  // `!`/`!!` 命令执行后延迟刷新（debounce，等命令执行完）
  pi.on("user_bash", () => {
    if (bashRefreshTimer) clearTimeout(bashRefreshTimer);
    bashRefreshTimer = setTimeout(() => {
      bashRefreshTimer = undefined;
      void refreshGit();
    }, BASH_REFRESH_DELAY_MS);
  });

  pi.on("session_shutdown", () => {
    if (timer) {
      clearInterval(timer);
      timer = undefined;
    }
    if (bashRefreshTimer) {
      clearTimeout(bashRefreshTimer);
      bashRefreshTimer = undefined;
    }
    activeTui = undefined;
  });
}

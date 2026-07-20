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

const SEP = " · ";
const GIT_INTERVAL_MS = 10_000;
const BASH_REFRESH_DELAY_MS = 1500;

function fmt(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}K`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

function fmtCost(c: number): string {
  return c < 0.01 ? `$${c.toFixed(3)}` : `$${c.toFixed(2)}`;
}

/** Type guard: assistant message 才有 usage/stopReason，用于 message_end。 */
function isAssistantMessage(message: unknown): message is AssistantMessage {
  if (!message || typeof message !== "object") return false;
  return (message as { role?: unknown }).role === "assistant";
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

  // TPS（输出速率）：requestAt 配对 before_provider_request/message_end，
  // lastTps 保存最近一次有效速率，render 时拼到第 2 行末尾。
  let requestAt: number | null = null;
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

  /** 清空 TPS 锚点与最近速率并重渲染（切模型/compact/树导航/无效结束时调用）。 */
  const resetTps = () => {
    requestAt = null;
    lastTps = null;
    activeTui?.requestRender();
  };

  pi.on("session_start", async (_event, ctx) => {
    cwd = ctx.cwd;
    gitState = { branch: null, ahead: 0, behind: 0, dirty: 0 };
    requestAt = null;
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

  // TPS（输出速率）：before_provider_request 记请求时刻，message_end 算 output/elapsed。
  // 口径对齐 pi 官方 tps.ts：elapsed 含网络 + 排队 + 生成，不用 message.timestamp。
  pi.on("before_provider_request", () => {
    requestAt = Date.now();
  });

  pi.on("message_end", (event) => {
    if (!isAssistantMessage(event.message)) return;
    const message = event.message as AssistantMessage;
    // aborted/error 或无效数据时丢弃，不留旧值
    if (message.stopReason === "aborted" || message.stopReason === "error") {
      resetTps();
      return;
    }
    const output = message.usage.output;
    if (requestAt === null || output <= 0) {
      resetTps();
      return;
    }
    const elapsedSeconds = (Date.now() - requestAt) / 1000;
    if (elapsedSeconds <= 0) {
      resetTps();
      return;
    }
    lastTps = output / elapsedSeconds;
    activeTui?.requestRender();
    // 消费完毕，等下一条 message 的 before_provider_request
    requestAt = null;
  });

  // 切模型 / compact / 树导航后重置 TPS
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

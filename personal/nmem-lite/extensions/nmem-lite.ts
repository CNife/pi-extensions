/**
 * nmem-lite — pi 扩展薄入口：何时同步、注入什么引导。
 * 仅注册事件钩子 + 引导注入判定；REST 传输见 ./rest.ts，会话同步见 ./session-sync.ts。
 *
 * Personal-layer replacement for @cnife/pi-nmem on this machine:
 *   1. Ambient sync — auto-sync pi sessions as nmem threads (REST, no CLI)
 *   2. Guidance     — 把 nmem 能力提示写进结构化 prompt section
 *
 * NOT in scope (vs packages/nmem): custom tools, /nmem-config, Context Bundle
 * auto-injection, plugin config file. Recall/save go through the official
 * `nmem` CLI via the nmem-guide skill.
 *
 * Ported from @cnife/pi-nmem / OMP plugins/nmem，同步语义与 OMP 侧插件同构；
 * 宿主差异（定时器、前台预算、agent_settled 触发、引导走 prompt section 且总是
 * 注入、shutdown 带 reason）见 ./session-sync.ts 与 ADR 0006。
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import {
  FOREGROUND_FLUSH_OPTIONS,
  flush,
  scheduleFlush,
} from "./session-sync.ts";

// ============================================================================
// Guidance injection (always on, written into a structured prompt section)
// ============================================================================

function startupGuidance(): string {
  return [
    "## Nowledge Mem",
    "",
    "Nowledge Mem (`nmem` CLI) is available. This extension auto-syncs your conversation as a thread; you need not save conversation history manually.",
    "The `nmem-guide` skill covers proactive search and autonomous save — reach it when past context would help.",
    "Context Bundle / Working Memory are opt-in: run `nmem context` or `nmem wm read` when you need session-start context.",
    "",
  ].join("\n");
}

// ============================================================================
// Extension entry
// ============================================================================

export default function nmemLite(pi: ExtensionAPI): void {
  // 总是注入（不做 opt-in 开关）。原地改结构化 section，而不是返回 systemPrompt
  // ——后者等于 forceSystemPrompt，会整段替换系统提示、丢掉结构化 section 的增量
  // 与缓存友好性（pi 文档要求优先改 section）。
  pi.on("before_agent_start", async (event) => {
    event.systemPromptOptions.sections.nowledge_mem = startupGuidance();
  });

  // agent_settled 是「自动续跑停止后」的通知点（agent_end 每次底层 run 都响，
  // 不是最终空闲信号），故防抖同步只挂在这里。
  pi.on("agent_settled", async (_event, ctx) => {
    scheduleFlush(ctx, "agent_settled");
  });

  pi.on("session_before_compact", async (_event, ctx) => {
    await flush(ctx, "session_before_compact", FOREGROUND_FLUSH_OPTIONS);
  });

  // 只挂 session_shutdown，不挂 session_before_switch：pi 在 before_switch 之后会先
  // await session.abort()（把中断的 turn 落盘）再发 shutdown，所以 shutdown 时刻的
  // 快照更完整；挂两处会让 /new、/resume 连跑两次刚性同步，最坏等待翻倍。
  pi.on("session_shutdown", async (event, ctx) => {
    const reason = event.reason
      ? `session_shutdown:${event.reason}`
      : "session_shutdown";
    await flush(ctx, reason, FOREGROUND_FLUSH_OPTIONS);
  });
}

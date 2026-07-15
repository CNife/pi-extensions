// ──── PROTOTYPE: first-title timing (#58) ───────────────────────────
//
// 一次性 TUI 壳：场景步进器。预计算每个场景的模拟帧，逐帧展示
// 在 pi 真实时序下，方案 A / 方案 B 各自会在何时、用什么 transcript 生成首标题。
//
// 纯逻辑在 transcript.ts（可 lift 进真实代码）；场景在 scenarios.ts。
// 运行：npm run proto:timing   （加 --dump 非交互打印所有帧）

import { SCENARIOS, type Scenario, type TimelineEvent } from "./scenarios.ts";
import type { Entry, Message } from "./transcript.ts";
import {
  buildFullTranscript,
  buildFullTranscriptWithPending,
  hasAutoNamingTitle,
} from "./transcript.ts";

// ──── ANSI ─────────────────────────────────────────────────────────

const B = "\x1b[1m";
const D = "\x1b[2m";
const R = "\x1b[0m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const DIM_GREEN = "\x1b[2;32m";

function bold(s: string): string {
  return `${B}${s}${R}`;
}
function dim(s: string): string {
  return `${D}${s}${R}`;
}

// ──── 模拟 ─────────────────────────────────────────────────────────

interface OptionDecision {
  fires: boolean;
  transcript: string | null;
  note: string;
}

interface SimFrame {
  eventKind: TimelineEvent["kind"];
  eventLabel: string;
  branchBefore: Entry[];
  pendingMessage?: Message;
  fullTranscript: string | null;
  optionA: OptionDecision;
  optionB: OptionDecision;
  appended?: Entry;
}

interface SimResult {
  frames: SimFrame[];
  aFirstFire: number | null; // 帧序号（0-based），null=未触发
  bFirstFire: number | null;
}

function simulate(scenario: Scenario): SimResult {
  const branch: Entry[] = [...scenario.initialBranch];
  let firstA = hasAutoNamingTitle(branch);
  let firstB = hasAutoNamingTitle(branch);
  const frames: SimFrame[] = [];
  let aFirstFire: number | null = null;
  let bFirstFire: number | null = null;

  scenario.events.forEach((ev, idx) => {
    const branchBefore = [...branch];
    const fullTranscript = buildFullTranscript(branch);
    const pendingMessage =
      ev.kind === "user_message_end" || ev.kind === "assistant_message_end"
        ? ev.message
        : undefined;

    // 方案 A：首标题只在 agent_end 生成
    let optionA: OptionDecision;
    if (firstA) {
      optionA = {
        fires: false,
        transcript: null,
        note: "首标题已生成；refresh 路径在 agent_end 处理（本帧不重复）",
      };
    } else if (ev.kind === "agent_end") {
      if (fullTranscript) {
        optionA = {
          fires: true,
          transcript: fullTranscript,
          note: "agent_end 生成首标题（branch 已完整）",
        };
        firstA = true;
        if (aFirstFire === null) aFirstFire = idx;
      } else {
        optionA = {
          fires: false,
          transcript: null,
          note: "agent_end 但 transcript 为空，跳过",
        };
      }
    } else {
      optionA = {
        fires: false,
        transcript: null,
        note: "等待 agent_end（暂不生成）",
      };
    }

    // 方案 B：首标题在 user_message_end 即时生成
    let optionB: OptionDecision;
    if (firstB) {
      optionB = {
        fires: false,
        transcript: null,
        note: "首标题已生成；refresh 路径在 agent_end 处理（本帧不重复）",
      };
    } else if (ev.kind === "user_message_end" && pendingMessage) {
      const transcript = buildFullTranscriptWithPending(branch, pendingMessage);
      if (transcript) {
        optionB = {
          fires: true,
          transcript,
          note: "user_message_end 即时生成（buildFullTranscript(branch) + 当前消息）",
        };
        firstB = true;
        if (bFirstFire === null) bFirstFire = idx;
      } else {
        optionB = {
          fires: false,
          transcript: null,
          note: "拼接后仍无文本，跳过",
        };
      }
    } else {
      optionB = {
        fires: false,
        transcript: null,
        note: "等待 user_message_end",
      };
    }

    // 事件处理完后，pi 才 appendMessage 持久化
    let appended: Entry | undefined;
    if (pendingMessage) {
      appended = {
        type: "message",
        id: `sim${branch.length}`,
        message: pendingMessage,
      };
      branch.push(appended);
    }

    frames.push({
      eventKind: ev.kind,
      eventLabel: ev.label,
      branchBefore,
      pendingMessage,
      fullTranscript,
      optionA,
      optionB,
      appended,
    });
  });

  return { frames, aFirstFire, bFirstFire };
}

// ──── 渲染辅助 ─────────────────────────────────────────────────────

const COLS = 88;

function truncate(s: string, max: number): string {
  let width = 0;
  let out = "";
  for (const ch of s) {
    const w = ch.charCodeAt(0) > 0x1100 && isWide(ch) ? 2 : 1;
    if (width + w > max) return `${out}…`;
    out += ch;
    width += w;
  }
  return out;
}

function isWide(ch: string): boolean {
  const c = ch.codePointAt(0) ?? 0;
  // CJK 统一表意、全角标点等按 2 列宽
  return (
    (c >= 0x1100 && c <= 0x115f) ||
    (c >= 0x2e80 && c <= 0x303e) ||
    (c >= 0x3041 && c <= 0x33ff) ||
    (c >= 0x3400 && c <= 0x4dbf) ||
    (c >= 0x4e00 && c <= 0x9fff) ||
    (c >= 0xa000 && c <= 0xa4cf) ||
    (c >= 0xac00 && c <= 0xd7a3) ||
    (c >= 0xf900 && c <= 0xfaff) ||
    (c >= 0xfe30 && c <= 0xfe4f) ||
    (c >= 0xff00 && c <= 0xff60) ||
    (c >= 0xffe0 && c <= 0xffe6)
  );
}

function pad(s: string, max: number): string {
  let width = 0;
  for (const ch of s) {
    width += ch.charCodeAt(0) > 0x1100 && isWide(ch) ? 2 : 1;
  }
  return s + " ".repeat(Math.max(0, max - width));
}

function rule(): string {
  return "─".repeat(COLS);
}

function section(title: string): string {
  const head = `── ${title} `;
  const dashCount = Math.max(0, COLS - head.length);
  return `${dim(head)}${dim("─".repeat(dashCount))}`;
}

function entryTag(entry: Entry): string {
  switch (entry.type) {
    case "message":
      return `m:${entry.message.role}`;
    case "custom":
      return `custom:${entry.customType}`;
    case "compaction":
      return "compaction";
    case "branch_summary":
      return "branch_summary";
    case "custom_message":
      return `custom_message:${entry.customType}`;
  }
}

function entryPreview(entry: Entry): string {
  switch (entry.type) {
    case "message": {
      const text = entry.message.content;
      if (typeof text === "string") return text;
      return text
        .filter((c) => c.type === "text")
        .map((c) => (c.type === "text" ? c.text : ""))
        .join(" ");
    }
    case "compaction":
      return entry.summary;
    case "branch_summary":
      return entry.summary;
    case "custom":
      return JSON.stringify(entry.data);
    case "custom_message":
      return typeof entry.content === "string"
        ? entry.content
        : "[content blocks]";
  }
}

function renderBranch(branch: Entry[]): string[] {
  if (branch.length === 0) return [dim("  (空 branch)")];
  return branch.map((e) => {
    const tag = dim(pad(`[${entryTag(e)}]`, 22));
    return `  ${tag} ${truncate(entryPreview(e), COLS - 26)}`;
  });
}

function renderTranscript(t: string | null, indent = "    "): string[] {
  if (!t) return [dim(`${indent}(null - branch 无可用文本)`)];
  return t
    .split("\n")
    .map((line) => `${indent}${truncate(line, COLS - indent.length)}`);
}

function renderOption(
  name: string,
  dec: OptionDecision,
  accent: string,
): string[] {
  const status = dec.fires
    ? `${GREEN}✅ 生成首标题${R}`
    : `${DIM_GREEN}⏳ 本帧不生成${R}`;
  const lines: string[] = [];
  lines.push(`  ${accent}${bold(name)}${R}`);
  lines.push(`    ${status}`);
  lines.push(`    ${dim(dec.note)}`);
  if (dec.transcript) {
    lines.push(`    ${dim("transcript ->")}`);
    lines.push(...renderTranscript(dec.transcript, "      "));
  }
  return lines;
}

function fireLabel(idx: number | null, frames: SimFrame[]): string {
  if (idx === null) return dim("未触发");
  const f = frames[idx];
  return `${YELLOW}帧 ${idx + 1}${R} ${dim(`(${f.eventKind})`)}`;
}

function render(scenario: Scenario, sim: SimResult, frameIdx: number): string {
  const frame = sim.frames[frameIdx];
  const total = sim.frames.length;
  const out: string[] = [];

  out.push(rule());
  out.push(` ${B}${scenario.name}${R}   ${dim(`帧 ${frameIdx + 1}/${total}`)}`);
  out.push(` ${dim(truncate(scenario.description, COLS - 1))}`);
  out.push(rule());
  out.push(
    ` ${B}时序对比${R}：方案 A 首标题 @ ${fireLabel(sim.aFirstFire, sim.frames)}  |  方案 B 首标题 @ ${fireLabel(sim.bFirstFire, sim.frames)}`,
  );
  out.push(rule());
  out.push(` ${B}事件${R}：${CYAN}${frame.eventKind}${R}`);
  out.push(` ${dim(truncate(frame.eventLabel, COLS - 1))}`);
  out.push(section(`branch（事件触发时，${frame.branchBefore.length} 条）`));
  out.push(...renderBranch(frame.branchBefore));
  if (frame.appended) {
    out.push(dim("  -> 事件后 appendMessage："));
    out.push(
      `    ${dim(pad(`[${entryTag(frame.appended)}]`, 22))} ${truncate(entryPreview(frame.appended), COLS - 28)}`,
    );
  }
  out.push(section("buildFullTranscript(branch)  方案 A 在 agent_end 用它"));
  out.push(...renderTranscript(frame.fullTranscript));
  out.push(section("方案 A：agent_end 统一处理"));
  out.push(...renderOption("agent_end 统一处理", frame.optionA, CYAN));
  out.push("");
  out.push(
    ...renderOption("message_end + 拼接当前消息", frame.optionB, YELLOW),
  );
  out.push(rule());
  out.push("");
  out.push(
    ` ${B}[n]${R}下一帧  ${B}[p]${R}上一帧  ${B}[s]${R}切场景  ${B}[q]${R}退出`,
  );
  return out.join("\n");
}

// ──── 主循环 ───────────────────────────────────────────────────────

const sims: SimResult[] = SCENARIOS.map(simulate);
const DUMP = process.argv.includes("--dump");

function stripAnsi(s: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: 剥离 ANSI 转义必须用 ESC 字符
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

/** 非交互模式：把每个场景的所有帧打成纯文本，便于验证逻辑。 */
function dumpAll(): void {
  SCENARIOS.forEach((scenario, sIdx) => {
    const sim = sims[sIdx];
    for (let i = 0; i < sim.frames.length; i++) {
      console.log(stripAnsi(render(scenario, sim, i)));
      console.log();
    }
  });
}

if (DUMP) {
  dumpAll();
  process.exit(0);
}

let scenarioIdx = 0;
let frameIdx = 0;

function draw(): void {
  console.clear();
  const scenario = SCENARIOS[scenarioIdx];
  const sim = sims[scenarioIdx];
  process.stdout.write(`${render(scenario, sim, frameIdx)}\n`);
}

function setRaw(on: boolean): void {
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(on);
  }
}

process.stdin.setEncoding("utf8");
setRaw(true);
process.stdin.resume();

process.stdin.on("data", (key: Buffer | string) => {
  const k = typeof key === "string" ? key : key.toString();
  if (k === "\x03" || k === "q") {
    setRaw(false);
    process.exit(0);
  }
  if (k === "n") {
    frameIdx = Math.min(frameIdx + 1, sims[scenarioIdx].frames.length - 1);
    draw();
  }
  if (k === "p") {
    frameIdx = Math.max(frameIdx - 1, 0);
    draw();
  }
  if (k === "s") {
    scenarioIdx = (scenarioIdx + 1) % SCENARIOS.length;
    frameIdx = 0;
    draw();
  }
});

draw();
process.stdout.write(`${dim("(按 n/p 翻帧，s 切场景，q 退出)")}\n`);

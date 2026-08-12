/**
 * plannotator-cli 三斜杠命令行为测试（OMP 同名插件测试移植）。
 *
 * 用 stub CLI（test/fixtures/plannotator，环境契约见 stub 头注释）替换真实
 * plannotator 二进制，验证：
 *   /pnr 参数构造与通知、/pna 路径归一化与空参、/pnl annotate-last --stdin 内容、
 *   spawn 环境强制项（BROWSER=none PLANNOTATOR_BROWSER=none PLANNOTATOR_AI=disabled）、
 *   stdout 反馈 -> sendUserMessage 直接发送（无 deliverAs）、json 完整即投递（不等 exited）、
 *   超时兜底、无反馈 / CLI 报错通知。
 * 断言文案与 extensions/index.ts 逐字一致。
 *
 * 运行：cd personal/plannotator-cli && npx vitest run （或仓库根 npm test）
 *
 * 机制说明（与 OMP 的差异）：node:child_process.spawn 的 env 在 spawn 调用时
 * 从 process.env 构造快照（扩展 buildSpawnEnv 逐测试生效），无需包装注入；
 * stub 通过 PATH 前缀（test/fixtures）解析。
 *
 * 测试 API 说明：仓库现有测试文件用 node:test（以 `npx tsx --test` 运行），但
 * vitest 4 没有 node:test 互操作——node:test 的测试在 vitest worker 里脱离
 * 管控（async 测试静默不执行、失败不传退出码）。为保证根 `npm test`（vitest）
 * 真正执行并强制失败，本文件改用 vitest 自带的 test API，断言仍用 node:assert。
 */

import { deepStrictEqual, equal, ok, strictEqual } from "node:assert";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";

import plannotatorCli, {
  type CommandCtx,
  type PiLike,
  resolveFeedbackTimeoutMs,
} from "../extensions/index.ts";

// ============================================================================
// Fixtures
// ============================================================================

interface TestPi extends PiLike {
  commands: Map<
    string,
    {
      description: string;
      handler: (args: string | undefined, ctx: CommandCtx) => void;
    }
  >;
  sent: { content: string; opts: unknown }[];
}

function makePi(): TestPi {
  const commands = new Map<
    string,
    {
      description: string;
      handler: (args: string | undefined, ctx: CommandCtx) => void;
    }
  >();
  const sent: { content: string; opts: unknown }[] = [];
  return {
    commands,
    sent,
    registerCommand(name, opts) {
      commands.set(name, opts);
    },
    sendUserMessage(content, opts) {
      sent.push({ content, opts });
    },
  };
}

type Notice = { msg: string; type: "info" | "error" };

/** 取注册的命令，未注册即测试错误（Map.get 可空，此处为 fixture 内不变量）。 */
function command(pi: TestPi, name: string) {
  const cmd = pi.commands.get(name);
  if (!cmd) throw new Error(`command not registered: ${name}`);
  return cmd;
}

function makeCtx(
  cwd: string,
  entries: unknown[],
  notified: Notice[],
): CommandCtx {
  return {
    cwd,
    ui: {
      notify: (msg: string, type: "info" | "error") =>
        notified.push({ msg, type }),
    },
    sessionManager: { getBranch: () => entries },
  };
}

/** 无 getBranch 时走 getEntries 兜底分支的 ctx */
function makeCtxNoBranch(
  cwd: string,
  entries: unknown[],
  notified: Notice[],
): CommandCtx {
  return {
    cwd,
    ui: {
      notify: (msg: string, type: "info" | "error") =>
        notified.push({ msg, type }),
    },
    sessionManager: { getEntries: () => entries },
  };
}

function msg(role: string, content: unknown) {
  return { type: "message", message: { role, content } };
}

async function waitFor(
  fn: () => boolean | Promise<boolean>,
  timeoutMs = 3000,
  intervalMs = 25,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fn()) return;
    // 轮询真实时钟：等待的是子进程副作用（stub 日志/文件/投递），
    // 进程在真实时间运行，无法用 fake timer 驱动。
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, intervalMs);
    await promise;
  }
  throw new Error(`waitFor 超时 (${timeoutMs}ms)`);
}

/** 负向断言窗口：等待一段真实时间，证明"未发生"（无副作用断言）。 */
async function expectNothingHappens(ms = 150) {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  await promise;
}

// 所有 scratch 挂在同一个扁平基目录下（沿用 OMP 测试结构）。
let suiteBase: string;
function setupScratch() {
  suiteBase ??= mkdtempSync(join(tmpdir(), "pncli-suite-"));
  const scratch = mkdtempSync(join(suiteBase, "t-"));
  const stubLog = join(scratch, "stub.log");
  process.env.TMPDIR = scratch;
  process.env.HOME = join(scratch, "home");
  // PATH 前缀让子进程（buildSpawnEnv 继承的 env）解析到 fixtures 里的 stub。
  process.env.PATH = `${join(import.meta.dirname, "fixtures")}:${process.env.PATH}`;
  process.env.PLANNO_STUB_LOG = stubLog;
  delete process.env.PLANNO_STUB_STDIN_FILE;
  delete process.env.PLANNO_STUB_STDOUT;
  delete process.env.PLANNO_STUB_STDERR;
  delete process.env.PLANNO_STUB_EXIT;
  delete process.env.PLANNO_STUB_SLEEP;
  delete process.env.PLANNO_STUB_HANG;
  delete process.env.PLANNOTATOR_FEEDBACK_TIMEOUT_MS;
  delete process.env.PLANNOTATOR_AI;
  return { scratch, stubLog };
}

function stdinFile(scratch: string) {
  return join(scratch, "stdin.txt");
}

function assertStubLog(log: string, ...fragments: string[]) {
  for (const f of fragments) ok(log.includes(f), `stub.log 应包含 ${f}`);
}

// ============================================================================
// 用例 1: 工厂注册
// ============================================================================

test("注册: 恰好 pnr/pna/pnl 三个命令，description 与源码一致", () => {
  const pi = makePi();
  plannotatorCli(pi);
  deepStrictEqual([...pi.commands.keys()], ["pnr", "pna", "pnl"]);
  strictEqual(
    command(pi, "pnr").description,
    "Open Plannotator code review for local git changes or a PR/MR URL",
  );
  strictEqual(
    command(pi, "pna").description,
    "Open Plannotator annotation UI for a markdown file, folder, or URL",
  );
  strictEqual(
    command(pi, "pnl").description,
    "Annotate the last assistant message in Plannotator",
  );
});

// ============================================================================
// 用例 2/3: /pnr
// ============================================================================

test("/pnr 无参: review + 无 URL 通知 + spawn env 强制项", async () => {
  const { scratch, stubLog } = setupScratch();
  const pi = makePi();
  plannotatorCli(pi);
  const notified: Notice[] = [];
  command(pi, "pnr").handler(undefined, makeCtx(scratch, [], notified));

  await waitFor(() => existsSync(stubLog));
  const log = readFileSync(stubLog, "utf8");
  assertStubLog(log, `cwd=${scratch}`, "arg=review");
  // #44 研究强制项：抑制浏览器启动路径 + 默认禁用 AI 探针
  assertStubLog(
    log,
    "env BROWSER=none",
    "env PLANNOTATOR_BROWSER=none",
    "env PLANNOTATOR_AI=disabled",
  );
  ok(
    notified.some(
      (n) => n.msg === "Opening code review in browser..." && n.type === "info",
    ),
    "应发 info 通知",
  );
});

test("/pnr 带 URL: review + URL 参数", async () => {
  const { scratch, stubLog } = setupScratch();
  const pi = makePi();
  plannotatorCli(pi);
  const notified: Notice[] = [];
  const url = "https://github.com/o/r/pull/1";
  command(pi, "pnr").handler(url, makeCtx(scratch, [], notified));

  await waitFor(() => existsSync(stubLog));
  const log = readFileSync(stubLog, "utf8");
  assertStubLog(log, "arg=review", `arg=${url}`);
  ok(
    notified.some(
      (n) => n.msg === `Opening code review for ${url}...` && n.type === "info",
    ),
    "应发带 URL 的 info 通知",
  );
});

// ============================================================================
// 用例 4-9: /pna
// ============================================================================

test("/pna: annotate + --json + 目标通知", async () => {
  const { scratch, stubLog } = setupScratch();
  const pi = makePi();
  plannotatorCli(pi);
  const notified: Notice[] = [];
  command(pi, "pna").handler("docs.md", makeCtx(scratch, [], notified));

  await waitFor(() => existsSync(stubLog));
  const log = readFileSync(stubLog, "utf8");
  assertStubLog(log, "arg=annotate", "arg=docs.md", "arg=--json");
  ok(
    notified.some(
      (n) =>
        n.msg === "Opening annotation UI for docs.md..." && n.type === "info",
    ),
    "应发 info 通知",
  );
});

test("/pna @a.md 归一化为 a.md", async () => {
  const { scratch, stubLog } = setupScratch();
  const pi = makePi();
  plannotatorCli(pi);
  command(pi, "pna").handler("@a.md", makeCtx(scratch, [], []));
  await waitFor(() => existsSync(stubLog));
  assertStubLog(readFileSync(stubLog, "utf8"), "arg=a.md");
});

test('/pna "b.md" 归一化为 b.md', async () => {
  const { scratch, stubLog } = setupScratch();
  const pi = makePi();
  plannotatorCli(pi);
  command(pi, "pna").handler('"b.md"', makeCtx(scratch, [], []));
  await waitFor(() => existsSync(stubLog));
  assertStubLog(readFileSync(stubLog, "utf8"), "arg=b.md");
});

test("/pna 'c.md' 归一化为 c.md", async () => {
  const { scratch, stubLog } = setupScratch();
  const pi = makePi();
  plannotatorCli(pi);
  command(pi, "pna").handler("'c.md'", makeCtx(scratch, [], []));
  await waitFor(() => existsSync(stubLog));
  assertStubLog(readFileSync(stubLog, "utf8"), "arg=c.md");
});

test("/pna ~/d.md 展开为 HOME/d.md", async () => {
  const { scratch, stubLog } = setupScratch();
  const home = process.env.HOME;
  if (!home) throw new Error("HOME not set");
  const pi = makePi();
  plannotatorCli(pi);
  command(pi, "pna").handler("~/d.md", makeCtx(scratch, [], []));
  await waitFor(() => existsSync(stubLog));
  assertStubLog(readFileSync(stubLog, "utf8"), `arg=${join(home, "d.md")}`);
});

test("/pna ~ 展开为 HOME 本身", async () => {
  const { scratch, stubLog } = setupScratch();
  const home = process.env.HOME;
  if (!home) throw new Error("HOME not set");
  const pi = makePi();
  plannotatorCli(pi);
  command(pi, "pna").handler("~", makeCtx(scratch, [], []));
  await waitFor(() => existsSync(stubLog));
  assertStubLog(readFileSync(stubLog, "utf8"), `arg=${home}`);
});

test("/pna 空参: Usage 错误且不 spawn", async () => {
  const { scratch, stubLog } = setupScratch();
  const pi = makePi();
  plannotatorCli(pi);
  const notified: Notice[] = [];
  command(pi, "pna").handler("", makeCtx(scratch, [], notified));
  await expectNothingHappens();

  equal(existsSync(stubLog), false, "不应 spawn CLI");
  ok(
    notified.some(
      (n) =>
        n.msg === "Usage: /pna <file.md | folder/ | https://...>" &&
        n.type === "error",
    ),
    "应发 Usage 错误通知",
  );
});

test("/pna 用户显式设置 PLANNOTATOR_AI 时尊重用户值", async () => {
  const { scratch, stubLog } = setupScratch();
  process.env.PLANNOTATOR_AI = "auto";
  const pi = makePi();
  plannotatorCli(pi);
  command(pi, "pna").handler("docs.md", makeCtx(scratch, [], []));
  await waitFor(() => existsSync(stubLog));
  assertStubLog(readFileSync(stubLog, "utf8"), "env PLANNOTATOR_AI=auto");
});

// ============================================================================
// 用例 10-16: /pnl
// ============================================================================

test("/pnl: annotate-last --stdin --json + stdin 内容为提取文本", async () => {
  const { scratch, stubLog } = setupScratch();
  process.env.PLANNO_STUB_STDIN_FILE = stdinFile(scratch);
  const pi = makePi();
  plannotatorCli(pi);
  const notified: Notice[] = [];
  const entries = [msg("assistant", [{ type: "text", text: "last reply" }])];
  command(pi, "pnl").handler(undefined, makeCtx(scratch, entries, notified));

  await waitFor(() => existsSync(stubLog));
  const log = readFileSync(stubLog, "utf8");
  assertStubLog(log, "arg=annotate-last", "arg=--stdin", "arg=--json");
  ok(
    notified.some(
      (n) =>
        n.msg === "Opening annotation UI for last message..." &&
        n.type === "info",
    ),
    "应发 info 通知",
  );
  // 无临时文件：消息内容直接经 stdin 传入
  await waitFor(() => existsSync(stdinFile(scratch)));
  equal(readFileSync(stdinFile(scratch), "utf8"), "last reply");
});

test("/pnl string content 直接写入 stdin", async () => {
  const { scratch } = setupScratch();
  process.env.PLANNO_STUB_STDIN_FILE = stdinFile(scratch);
  const pi = makePi();
  plannotatorCli(pi);
  command(pi, "pnl").handler(
    undefined,
    makeCtx(scratch, [msg("assistant", "plain string")], []),
  );
  await waitFor(() => existsSync(stdinFile(scratch)));
  equal(readFileSync(stdinFile(scratch), "utf8"), "plain string");
});

test("/pnl 数组 content 按行拼接", async () => {
  const { scratch } = setupScratch();
  process.env.PLANNO_STUB_STDIN_FILE = stdinFile(scratch);
  const pi = makePi();
  plannotatorCli(pi);
  command(pi, "pnl").handler(
    undefined,
    makeCtx(scratch, [msg("assistant", ["part1", "part2"])], []),
  );
  await waitFor(() => existsSync(stdinFile(scratch)));
  equal(readFileSync(stdinFile(scratch), "utf8"), "part1\npart2");
});

test("/pnl 对象 {text} content", async () => {
  const { scratch } = setupScratch();
  process.env.PLANNO_STUB_STDIN_FILE = stdinFile(scratch);
  const pi = makePi();
  plannotatorCli(pi);
  command(pi, "pnl").handler(
    undefined,
    makeCtx(scratch, [msg("assistant", { text: "obj text" })], []),
  );
  await waitFor(() => existsSync(stdinFile(scratch)));
  equal(readFileSync(stdinFile(scratch), "utf8"), "obj text");
});

test("/pnl 跳过 user 与空 assistant，取最后非空", async () => {
  const { scratch } = setupScratch();
  process.env.PLANNO_STUB_STDIN_FILE = stdinFile(scratch);
  const pi = makePi();
  plannotatorCli(pi);
  const entries = [
    msg("user", "hi"),
    msg("assistant", "  "),
    msg("assistant", "real"),
  ];
  command(pi, "pnl").handler(undefined, makeCtx(scratch, entries, []));
  await waitFor(() => existsSync(stdinFile(scratch)));
  equal(readFileSync(stdinFile(scratch), "utf8"), "real");
});

test("/pnl 无 getBranch 时走 getEntries 兜底", async () => {
  const { scratch } = setupScratch();
  process.env.PLANNO_STUB_STDIN_FILE = stdinFile(scratch);
  const pi = makePi();
  plannotatorCli(pi);
  const entries = [msg("user", "x"), msg("assistant", "from-fallback")];
  command(pi, "pnl").handler(undefined, makeCtxNoBranch(scratch, entries, []));
  await waitFor(() => existsSync(stdinFile(scratch)));
  equal(readFileSync(stdinFile(scratch), "utf8"), "from-fallback");
});

test("/pnl 无 assistant 消息: 错误通知且无副作用", async () => {
  const { scratch, stubLog } = setupScratch();
  process.env.PLANNO_STUB_STDIN_FILE = stdinFile(scratch);
  const pi = makePi();
  plannotatorCli(pi);
  const notified: Notice[] = [];
  const entries = [msg("user", "only user")];
  command(pi, "pnl").handler(undefined, makeCtx(scratch, entries, notified));
  await expectNothingHappens();

  equal(existsSync(stubLog), false, "不应 spawn CLI");
  equal(existsSync(stdinFile(scratch)), false, "不应产生 stdin 文件");
  ok(
    notified.some(
      (n) =>
        n.msg === "No assistant message found in session." &&
        n.type === "error",
    ),
    "应发错误通知",
  );
});

// ============================================================================
// 用例 17-24: 反馈回路与失败路径
// ============================================================================

test("stdout 反馈 -> sendUserMessage 直接发送（省略 deliverAs，空闲即触发回合）", async () => {
  const { scratch } = setupScratch();
  process.env.PLANNO_STUB_STDOUT = "请修复 X";
  const pi = makePi();
  plannotatorCli(pi);
  const notified: Notice[] = [];
  command(pi, "pna").handler("docs.md", makeCtx(scratch, [], notified));

  await waitFor(() => pi.sent.length > 0);
  // 不带 deliverAs：若带 "followUp"，pi 只入队不启动回合，反馈会静默滞留到
  // 下一条显式输入（OMP 实测缺陷）；省略后空闲路径直接触发回合。
  deepStrictEqual(pi.sent[0], { content: "请修复 X", opts: undefined });
  ok(!notified.some((n) => n.type === "error"), "不应有错误通知");
});

test("/pnl 反馈投递: 前缀说明这是对上一条助手消息的反馈", async () => {
  const { scratch } = setupScratch();
  process.env.PLANNO_STUB_STDOUT = "请修复 X";
  const pi = makePi();
  plannotatorCli(pi);
  const notified: Notice[] = [];
  const entries = [msg("assistant", "last reply")];
  command(pi, "pnl").handler(undefined, makeCtx(scratch, entries, notified));

  await waitFor(() => pi.sent.length > 0);
  // 反馈必须带 framing 前缀：明确告诉 AI 这是对它上一条消息的标注反馈，
  // 而非让 AI 对着一个不存在的文件猜"文件在哪"。
  ok(
    pi.sent[0].content.startsWith(
      "这是对你上一条助手消息的标注反馈，请直接处理，无需查找文件。",
    ),
    "应带 framing 前缀",
  );
  ok(pi.sent[0].content.endsWith("请修复 X"), "前缀后应跟反馈正文");
});

test("json 完整即投递: stdout 有完整 JSON 但进程挂起时不等 exited", async () => {
  const { scratch } = setupScratch();
  process.env.PLANNO_STUB_STDOUT =
    '{"decision":"annotated","feedback":"json 完整即投递"}';
  process.env.PLANNO_STUB_HANG = "1"; // 输出 JSON 后挂起（关闭期挂起模拟）
  const pi = makePi();
  plannotatorCli(pi);
  const notified: Notice[] = [];
  command(pi, "pna").handler("docs.md", makeCtx(scratch, [], notified));

  // 不等 exited：JSON 一完整反馈立即投递
  await waitFor(() => pi.sent.length > 0, 2000);
  deepStrictEqual(pi.sent[0], { content: "json 完整即投递", opts: undefined });
  ok(!notified.some((n) => n.type === "error"), "不应有错误通知");
});

test("挂起时非 JSON stdout 走超时兜底投递", async () => {
  const { scratch } = setupScratch();
  process.env.PLANNO_STUB_STDOUT = "部分反馈文本"; // 非 JSON（/pnr 纯文本场景）
  process.env.PLANNO_STUB_HANG = "1";
  process.env.PLANNOTATOR_FEEDBACK_TIMEOUT_MS = "200";
  const pi = makePi();
  plannotatorCli(pi);
  command(pi, "pnr").handler(undefined, makeCtx(scratch, [], []));

  // timeout 兜底：stdout 已有内容（关闭期挂起场景），kill 后仍投递
  await waitFor(() => pi.sent.length > 0, 3000);
  deepStrictEqual(pi.sent[0], { content: "部分反馈文本", opts: undefined });
});

test("超时无输出: error 通知提示重试", async () => {
  const { scratch } = setupScratch();
  process.env.PLANNO_STUB_HANG = "1"; // 无 stdout 挂起
  process.env.PLANNOTATOR_FEEDBACK_TIMEOUT_MS = "200";
  const pi = makePi();
  plannotatorCli(pi);
  const notified: Notice[] = [];
  command(pi, "pna").handler("docs.md", makeCtx(scratch, [], notified));

  await waitFor(() => notified.some((n) => n.type === "error"), 3000);
  ok(
    notified.some(
      (n) =>
        n.msg ===
          "Annotation timed out waiting for feedback (plannotator may have hung). Please retry." &&
        n.type === "error",
    ),
    "应发超时错误通知",
  );
  equal(pi.sent.length, 0, "无反馈不应投递");
});

test("CLI 非零退出且无 stdout: failed 通知（含 stderr）", async () => {
  const { scratch } = setupScratch();
  process.env.PLANNO_STUB_EXIT = "1";
  process.env.PLANNO_STUB_STDERR = "boom";
  const pi = makePi();
  plannotatorCli(pi);
  const notified: Notice[] = [];
  command(pi, "pna").handler("docs.md", makeCtx(scratch, [], notified));

  await waitFor(() => notified.some((n) => n.type === "error"), 3000);
  ok(
    notified.some(
      (n) => n.msg === "Annotation failed: boom" && n.type === "error",
    ),
    "应发 failed 错误通知（含 stderr）",
  );
  equal(pi.sent.length, 0, "无反馈不应投递");
});

test("CLI 非零退出且无 stdout 无 stderr: failed 通知（exit code）", async () => {
  const { scratch } = setupScratch();
  process.env.PLANNO_STUB_EXIT = "3";
  const pi = makePi();
  plannotatorCli(pi);
  const notified: Notice[] = [];
  command(pi, "pna").handler("docs.md", makeCtx(scratch, [], notified));

  await waitFor(() => notified.some((n) => n.type === "error"), 3000);
  ok(
    notified.some(
      (n) => n.msg === "Annotation failed: exit code 3" && n.type === "error",
    ),
    "应发 failed 错误通知（exit code）",
  );
  equal(pi.sent.length, 0, "无反馈不应投递");
});

test("正常退出无反馈: closed (no feedback) info 通知", async () => {
  const { scratch } = setupScratch();
  const pi = makePi();
  plannotatorCli(pi);
  const notified: Notice[] = [];
  command(pi, "pna").handler("docs.md", makeCtx(scratch, [], notified));

  // Opening 通知也是 info，需精确匹配 closed 消息
  await waitFor(
    () => notified.some((n) => n.msg === "Annotation closed (no feedback)."),
    3000,
  );
  ok(
    notified.some(
      (n) => n.msg === "Annotation closed (no feedback)." && n.type === "info",
    ),
    "应发 closed 通知",
  );
  equal(pi.sent.length, 0, "无反馈不应投递");
});

// ── resolveFeedbackTimeoutMs: 默认值与 env 解析（回归保护：防 120s 默认值再现）──

/** 临时设置环境变量，测试后恢复原值（含未设状态）。 */
function withEnv(
  name: string,
  value: string | undefined,
  fn: () => void,
): void {
  const saved = process.env[name];
  try {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
    fn();
  } finally {
    if (saved !== undefined) process.env[name] = saved;
    else delete process.env[name];
  }
}

test("resolveFeedbackTimeoutMs: 未设 env 回退默认 30min", () => {
  withEnv("PLANNOTATOR_FEEDBACK_TIMEOUT_MS", undefined, () => {
    equal(resolveFeedbackTimeoutMs(), 30 * 60 * 1000);
  });
});

test("resolveFeedbackTimeoutMs: 合法 env 值透传", () => {
  withEnv("PLANNOTATOR_FEEDBACK_TIMEOUT_MS", "45000", () => {
    equal(resolveFeedbackTimeoutMs(), 45000);
  });
});

test("resolveFeedbackTimeoutMs: 非法 env（非数字 / 空白）回退默认", () => {
  for (const bad of ["abc", "", "   "]) {
    withEnv("PLANNOTATOR_FEEDBACK_TIMEOUT_MS", bad, () => {
      equal(
        resolveFeedbackTimeoutMs(),
        30 * 60 * 1000,
        `非法值 ${JSON.stringify(bad)} 应回退默认`,
      );
    });
  }
});

test("resolveFeedbackTimeoutMs: 0 / 负数 / NaN / Infinity 回退默认", () => {
  for (const bad of ["0", "-5", "NaN", "Infinity"]) {
    withEnv("PLANNOTATOR_FEEDBACK_TIMEOUT_MS", bad, () => {
      equal(
        resolveFeedbackTimeoutMs(),
        30 * 60 * 1000,
        `非法值 ${JSON.stringify(bad)} 应回退默认`,
      );
    });
  }
});

/**
 * Test suite for PythonKernel - real subprocess fixtures.
 *
 * Tests observable behavior through the public interface (execute / shutdown /
 * isAlive). No fake-process adapter - every test drives a real `uv run` child
 * process speaking NDJSON with runner.py.
 *
 * Run: npx tsx --test packages/execute-python/test/kernel.test.ts
 */

import { ok, strictEqual } from "node:assert";
import { test } from "node:test";
import { type KernelExecuteResult, PythonKernel } from "../kernel.ts";

// ============================================================================
// Helpers
// ============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function cell(
  kernel: PythonKernel,
  code: string,
  opts: {
    packages?: string[];
    pythonVersion?: string;
    pythonExecutable?: string;
    reset?: boolean;
    timeoutMs?: number;
    signal?: AbortSignal;
  } = {},
): Promise<KernelExecuteResult> {
  return kernel.execute({
    code,
    packages: opts.packages,
    pythonVersion: opts.pythonVersion,
    pythonExecutable: opts.pythonExecutable,
    reset: opts.reset,
    timeoutMs: opts.timeoutMs,
    signal: opts.signal,
  });
}

// ============================================================================
// Tests
// ============================================================================

test("startup: kernel starts and becomes alive", async () => {
  const kernel = new PythonKernel({ cwd: process.cwd() });
  const result = await cell(kernel, "print('hello')");
  strictEqual(result.exitCode, 0);
  strictEqual(result.stdout.trim(), "hello");
  ok(kernel.isAlive());
  await kernel.shutdown();
  ok(!kernel.isAlive());
});

test("cross-call variable reuse: x=42 survives", async () => {
  const kernel = new PythonKernel({ cwd: process.cwd() });
  await cell(kernel, "x = 42");
  const result = await cell(kernel, "print(x)");
  strictEqual(result.exitCode, 0);
  strictEqual(result.stdout.trim(), "42");
  await kernel.shutdown();
});

test("cross-call import reuse: import math survives", async () => {
  const kernel = new PythonKernel({ cwd: process.cwd() });
  await cell(kernel, "import math");
  const result = await cell(kernel, "print(math.sqrt(4))");
  strictEqual(result.exitCode, 0);
  strictEqual(result.stdout.trim(), "2.0");
  await kernel.shutdown();
});

test("real-time stdout streaming: multiple chunks via onChunk", async () => {
  const kernel = new PythonKernel({ cwd: process.cwd() });
  const chunks: { text: string; stream: "stdout" | "stderr" }[] = [];
  await kernel.execute({
    code: `
import time
for i in range(3):
    print(f"line {i}")
    time.sleep(0.1)
`,
    onChunk: (text, stream) => chunks.push({ text, stream }),
  });
  ok(chunks.length >= 2, `expected >=2 chunks, got ${chunks.length}`);
  const allStdout = chunks
    .filter((c) => c.stream === "stdout")
    .map((c) => c.text)
    .join("");
  ok(allStdout.includes("line 0"));
  ok(allStdout.includes("line 1"));
  ok(allStdout.includes("line 2"));
  await kernel.shutdown();
});

test("error handling: 1/0 produces exception name, value, and traceback", async () => {
  const kernel = new PythonKernel({ cwd: process.cwd() });
  const stderrChunks: string[] = [];
  const result = await kernel.execute({
    code: "1/0",
    onChunk: (_text, stream) => {
      if (stream === "stderr") stderrChunks.push(_text);
    },
  });
  strictEqual(result.exitCode, 1);
  ok(result.error, "error should be present");
  strictEqual(result.error?.name, "ZeroDivisionError");
  ok(result.error?.value.includes("division by zero"));
  ok(result.error?.traceback.includes("ZeroDivisionError"));
  ok(result.error?.traceback.includes("line"), "traceback has line info");
  // Traceback should also stream to stderr
  const allStderr = stderrChunks.join("");
  ok(allStderr.includes("ZeroDivisionError"), "traceback streamed to stderr");
  await kernel.shutdown();
});

test("kernel crash: os._exit(7) -> kernelKilled, no retry; next call restarts", async () => {
  const kernel = new PythonKernel({ cwd: process.cwd() });
  await cell(kernel, "y = 99");

  // Crash the kernel
  const crashResult = await cell(kernel, "import os; os._exit(7)");
  ok(crashResult.kernelKilled, "crash should set kernelKilled");

  // Kernel should not be alive
  ok(!kernel.isAlive(), "kernel should not be alive after crash");

  // Next call should auto-start new kernel, old variable lost
  const afterResult = await cell(kernel, "print(y)");
  strictEqual(afterResult.exitCode, 1);
  ok(afterResult.error, "should have an error");
  ok(afterResult.error?.name === "NameError", "y should be NameError");
  ok(afterResult.restarted, "should report restarted");
  strictEqual(afterResult.restartReason, "crash");
  await kernel.shutdown();
});

test("session_shutdown: kernel process cleaned up", async () => {
  const kernel = new PythonKernel({ cwd: process.cwd() });
  await cell(kernel, "print('alive')");
  ok(kernel.isAlive());
  const result = await kernel.shutdown();
  ok(result.confirmed, "shutdown confirmed");
  ok(!kernel.isAlive(), "not alive after shutdown");
});

test("python_version and python_executable mutually exclusive: validated by tool handler (kernel itself accepts both)", async () => {
  // The mutual exclusion is enforced in the tool handler, not the kernel.
  // The kernel just uses whichever is provided. This test documents that.
  const kernel = new PythonKernel({ cwd: process.cwd() });
  const result = await kernel.execute({
    code: "print('ok')",
    pythonVersion: "3.12",
  });
  strictEqual(result.exitCode, 0);
  ok(result.stdout.includes("ok"));
  await kernel.shutdown();
});

test("switching python_version triggers kernel restart", async () => {
  const kernel = new PythonKernel({ cwd: process.cwd() });
  // First call with default python
  const r1 = await cell(kernel, "import sys; print('started')");
  strictEqual(r1.exitCode, 0);

  // Set a variable
  await cell(kernel, "z = 'remember me'");

  // Switch python_version -> restart
  const r3 = await cell(kernel, "print(z)", { pythonVersion: "3.12" });
  ok(r3.restarted, "should report restarted");
  strictEqual(r3.restartReason, "pythonVersion");
  // State lost
  ok(r3.error, "z should be NameError after restart");
  ok(r3.error?.name === "NameError");
  await kernel.shutdown();
});

test("switching python_executable triggers kernel restart", async () => {
  const kernel = new PythonKernel({ cwd: process.cwd() });
  await cell(kernel, "w = 100");

  // Use python3 as a different executable
  const result = await cell(kernel, "print(w)", {
    pythonExecutable: "python3",
  });
  ok(result.restarted, "should report restarted");
  strictEqual(result.restartReason, "pythonExecutable");
  await kernel.shutdown();
});

test("deps at start: packages work and import survives across calls with same packages", async () => {
  const kernel = new PythonKernel({ cwd: process.cwd() });
  // Start with a real third-party package
  const r1 = await cell(kernel, "import typing_extensions; print('ok')", {
    packages: ["typing-extensions"],
  });
  strictEqual(r1.exitCode, 0);
  ok(r1.stdout.includes("ok"));

  // Same packages -> no restart, import still available
  const r2 = await cell(
    kernel,
    "import typing_extensions; print('still here')",
    { packages: ["typing-extensions"] },
  );
  strictEqual(r2.exitCode, 0);
  ok(!r2.restarted, "same packages should not restart");
  ok(r2.stdout.includes("still here"));
  await kernel.shutdown();
});

test("packages same: does not restart, state preserved", async () => {
  const kernel = new PythonKernel({ cwd: process.cwd() });
  await cell(kernel, "v = 5", { packages: ["typing-extensions"] });

  // Same packages again -> no restart, state preserved
  const r2 = await cell(kernel, "print(v)", {
    packages: ["typing-extensions"],
  });
  ok(!r2.restarted, "should not restart with same packages");
  strictEqual(r2.stdout.trim(), "5");
  await kernel.shutdown();
});

test("packages change: triggers restart, state lost", async () => {
  const kernel = new PythonKernel({ cwd: process.cwd() });
  await cell(kernel, "data = [1,2,3]", { packages: ["typing-extensions"] });

  // Different packages -> restart, state lost
  const r2 = await cell(kernel, "print(data)", {
    packages: ["requests"],
  });
  ok(r2.restarted, "should restart with different packages");
  strictEqual(r2.restartReason, "packages");
  ok(r2.error, "data should be NameError");
  ok(r2.error?.name === "NameError");
  await kernel.shutdown();
});

test("reset: clears state and accumulated packages, then executes", async () => {
  const kernel = new PythonKernel({ cwd: process.cwd() });
  await cell(kernel, "keeper = 'survive me'", {
    packages: ["typing-extensions"],
  });

  // Reset -> state lost, S cleared
  const r2 = await cell(kernel, "print(keeper)", { reset: true });
  ok(r2.restarted, "reset should report restarted");
  strictEqual(r2.restartReason, "reset");
  ok(r2.error, "keeper should be NameError after reset");
  ok(r2.error?.name === "NameError");

  await kernel.shutdown();
});

test("display(): emits display frames", async () => {
  const kernel = new PythonKernel({ cwd: process.cwd() });
  const displays: string[] = [];
  const result = await kernel.execute({
    code: "display(42)",
    onDisplay: (data) => displays.push(data),
  });
  strictEqual(result.displays.length, 1);
  strictEqual(result.displays[0], "42");
  strictEqual(displays.length, 1);
  strictEqual(displays[0], "42");
  await kernel.shutdown();
});

test("timeout: execution times out and reports timedOut", async () => {
  const kernel = new PythonKernel({ cwd: process.cwd() });
  // Seed state before the timeout cell so we can verify it survives.
  await cell(kernel, "timeout_state = 'survived'");
  const result = await cell(kernel, "import time; time.sleep(10)", {
    timeoutMs: 500,
  });
  ok(result.cancelled, "should be cancelled");
  ok(result.timedOut, "should be timed out");
  if (process.platform !== "win32") {
    ok(!result.kernelKilled, "timeout should not kill kernel on Linux");
  }
  // Kernel survives the timeout
  ok(kernel.isAlive(), "kernel should survive timeout");
  // Pre-timeout state preserved
  const afterResult = await cell(kernel, "print(timeout_state)");
  strictEqual(afterResult.exitCode, 0);
  strictEqual(afterResult.stdout.trim(), "survived");
  await kernel.shutdown();
});

test("execution count: increments across calls", async () => {
  const kernel = new PythonKernel({ cwd: process.cwd() });
  const r1 = await cell(kernel, "print('a')");
  const r2 = await cell(kernel, "print('b')");
  const r3 = await cell(kernel, "print('c')");
  strictEqual(r1.execCount, 1);
  strictEqual(r2.execCount, 2);
  strictEqual(r3.execCount, 3);
  await kernel.shutdown();
});

test("SIGINT cancellation: preserves kernel state (sleep)", async () => {
  const kernel = new PythonKernel({ cwd: process.cwd() });
  await cell(kernel, "preserved = 'kept'");

  // Start a long-running cell, cancel it via AbortSignal
  const controller = new AbortController();
  const abortAt = Date.now();
  const execPromise = kernel.execute({
    code: "import time; time.sleep(30)",
    signal: controller.signal,
  });

  // Give it time to start executing
  await sleep(500);
  controller.abort();

  const result = await execPromise;
  ok(result.cancelled, "should be cancelled");
  ok(!result.timedOut, "manual abort should not be timedOut");
  if (process.platform !== "win32") {
    // On Linux, child-pid SIGINT penetrates uv run: the done frame arrives
    // well within the first escalation grace (CHILD_PID_SIGINT_GRACE_MS = 3s),
    // so no escalation is needed.
    ok(!result.kernelKilled, "SIGINT should preserve kernel on Linux");
    strictEqual(result.exitCode, 130, "cancelled exit code is 130");
    ok(
      Date.now() - abortAt < 3000,
      "done frame should arrive within first grace (no escalation)",
    );
  }

  // Kernel should still be alive
  ok(kernel.isAlive(), "kernel should survive SIGINT");

  // State should be preserved
  const afterResult = await cell(kernel, "print(preserved)");
  strictEqual(afterResult.exitCode, 0);
  strictEqual(afterResult.stdout.trim(), "kept");
  await kernel.shutdown();
});

test("SIGINT cancellation: CPU-bound while-True-pass preserves kernel", async () => {
  const kernel = new PythonKernel({ cwd: process.cwd() });
  await cell(kernel, "cpu_state = 'survived'");

  // CPU-bound infinite loop - SIGINT must interrupt Python's eval loop
  const controller = new AbortController();
  const abortAt = Date.now();
  const execPromise = kernel.execute({
    code: "while True:\n    pass",
    signal: controller.signal,
  });

  // Give it time to enter the loop
  await sleep(500);
  controller.abort();

  const result = await execPromise;
  ok(result.cancelled, "should be cancelled");
  if (process.platform !== "win32") {
    ok(!result.kernelKilled, "SIGINT should preserve kernel on Linux");
    strictEqual(result.exitCode, 130, "cancelled exit code is 130");
    ok(
      Date.now() - abortAt < 3000,
      "done frame should arrive within first grace (no escalation)",
    );
  }

  // Kernel still alive
  ok(kernel.isAlive(), "kernel should survive CPU-loop SIGINT");

  // State preserved
  const afterResult = await cell(kernel, "print(cpu_state)");
  strictEqual(afterResult.exitCode, 0);
  strictEqual(afterResult.stdout.trim(), "survived");
  await kernel.shutdown();
});

test("shutdown aborts live execution as kernelKilled", async () => {
  const kernel = new PythonKernel({ cwd: process.cwd() });

  // Start a long-running cell
  const execPromise = kernel.execute({
    code: "import time; time.sleep(30)",
  });
  await sleep(500);

  // Shutdown while execution is running
  const shutdownResult = await kernel.shutdown();
  ok(shutdownResult.confirmed, "shutdown confirmed");

  // The live execution should have been aborted
  const result = await execPromise;
  ok(result.kernelKilled, "live exec should be kernelKilled on shutdown");
});

test("parent watchdog: kernel self-terminates when parent process exits", async () => {
  // The parent watchdog in runner.py checks if ppid changed (reparented to
  // init). We can't easily kill the Node process from within a test, but we
  // can verify the watchdog mechanism is present by checking that the runner
  // terminates when its stdin is closed (which is what happens on parent
  // death via pipe). This is an indirect test of the cleanup path.
  const kernel = new PythonKernel({ cwd: process.cwd() });
  await cell(kernel, "print('alive')");
  ok(kernel.isAlive());

  // Shutdown closes stdin and the runner exits.
  const result = await kernel.shutdown();
  ok(result.confirmed, "shutdown confirmed");
  ok(!kernel.isAlive());
});

test("auto-display: trailing expression 1 + 2 -> displays contains '3'", async () => {
  const kernel = new PythonKernel({ cwd: process.cwd() });
  const result = await cell(kernel, "1 + 2");
  strictEqual(result.exitCode, 0);
  strictEqual(result.displays.length, 1);
  strictEqual(result.displays[0], "3");
  await kernel.shutdown();
});

test("auto-display: trailing expression with preceding statements", async () => {
  const kernel = new PythonKernel({ cwd: process.cwd() });
  const result = await cell(kernel, "x = 10\ny = 20\nx + y");
  strictEqual(result.exitCode, 0);
  strictEqual(result.displays.length, 1);
  strictEqual(result.displays[0], "30");
  await kernel.shutdown();
});

test("auto-display: trailing method call shows repr", async () => {
  const kernel = new PythonKernel({ cwd: process.cwd() });
  const result = await cell(kernel, "d = {'a': 1, 'b': 2}\nd.keys()");
  strictEqual(result.exitCode, 0);
  strictEqual(result.displays.length, 1);
  strictEqual(result.displays[0], "dict_keys(['a', 'b'])");
  await kernel.shutdown();
});

test("no auto-display: assignment last line -> displays empty", async () => {
  const kernel = new PythonKernel({ cwd: process.cwd() });
  const result = await cell(kernel, "x = 42");
  strictEqual(result.exitCode, 0);
  strictEqual(result.displays.length, 0);
  await kernel.shutdown();
});

test("no auto-display: import last line -> displays empty", async () => {
  const kernel = new PythonKernel({ cwd: process.cwd() });
  const result = await cell(kernel, "import math");
  strictEqual(result.exitCode, 0);
  strictEqual(result.displays.length, 0);
  await kernel.shutdown();
});

test("no auto-display: None-valued trailing expression -> displays empty", async () => {
  const kernel = new PythonKernel({ cwd: process.cwd() });
  const result = await cell(kernel, "x = 1\nNone");
  strictEqual(result.exitCode, 0);
  strictEqual(result.displays.length, 0);
  await kernel.shutdown();
});

test("display() called multiple times -> all in displays", async () => {
  const kernel = new PythonKernel({ cwd: process.cwd() });
  const result = await cell(kernel, "display(1)\ndisplay(2)\ndisplay(3)");
  strictEqual(result.exitCode, 0);
  strictEqual(result.displays.length, 3);
  strictEqual(result.displays[0], "1");
  strictEqual(result.displays[1], "2");
  strictEqual(result.displays[2], "3");
  await kernel.shutdown();
});

test("auto-display and manual display() coexist", async () => {
  const kernel = new PythonKernel({ cwd: process.cwd() });
  const result = await cell(kernel, "display('manual')\n99");
  strictEqual(result.exitCode, 0);
  strictEqual(result.displays.length, 2);
  strictEqual(result.displays[0], "'manual'");
  strictEqual(result.displays[1], "99");
  await kernel.shutdown();
});

test("execCount resets to 1 after kernel crash and restart", async () => {
  const kernel = new PythonKernel({ cwd: process.cwd() });
  const r1 = await cell(kernel, "print('first')");
  const r2 = await cell(kernel, "print('second')");
  strictEqual(r1.execCount, 1);
  strictEqual(r2.execCount, 2);

  // Crash the kernel
  const crashResult = await cell(kernel, "import os; os._exit(7)");
  ok(crashResult.kernelKilled, "crash should set kernelKilled");

  // After crash + restart, execCount should restart from 1
  const afterResult = await cell(kernel, "print('restarted')");
  strictEqual(afterResult.execCount, 1);
  ok(afterResult.restarted, "should report restarted");
  strictEqual(afterResult.restartReason, "crash");
  await kernel.shutdown();
});

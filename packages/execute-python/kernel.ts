/**
 * PythonKernel - persistent Python kernel deep module.
 *
 * Owns subprocess management, NDJSON-over-stdio protocol, state machine,
 * and lifecycle. Small interface (execute / shutdown / isAlive) hiding a
 * long-lived `uv run`-driven Python subprocess that speaks NDJSON with
 * runner.py.
 *
 * Three-layer separation:
 * 1. PythonKernel (this module): pure execution, does not know TUI/LLM.
 * 2. Tool handler (execute-python.ts defineTool.execute): calls kernel.execute(),
 *    converts to AgentToolResult.
 * 3. Renderer (renderCall/renderResult): pure display, does not import kernel types.
 *
 * State machine: stopped / starting / idle / executing / crashed / shutting-down.
 * Single execution - overlapping execute() calls are rejected, never queued.
 * State machine is NOT exposed externally.
 *
 * Fingerprint: {packages, pythonVersion, pythonExecutable}. Naive replacement
 * semantics: any change in the fingerprint triggers a kernel restart with the
 * new values. Accumulation model (S ∪ P) is deferred to a later slice.
 */

import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// ============================================================================
// Public Types
// ============================================================================

export interface KernelExecuteOptions {
  code: string;
  packages?: string[];
  pythonVersion?: string;
  pythonExecutable?: string;
  reset?: boolean;
  signal?: AbortSignal;
  onChunk?: (text: string, stream: "stdout" | "stderr") => void;
  onDisplay?: (data: string) => void;
  timeoutMs?: number;
}

export interface KernelError {
  name: string;
  value: string;
  traceback: string;
}

export type RestartReason =
  | "packages"
  | "pythonVersion"
  | "pythonExecutable"
  | "reset"
  | "crash";

export interface KernelExecuteResult {
  exitCode: number;
  cancelled: boolean;
  timedOut: boolean;
  kernelKilled: boolean;
  error: KernelError | null;
  stdout: string;
  stderr: string;
  displays: string[];
  execCount: number;
  restarted: boolean;
  restartReason?: RestartReason;
}

export interface KernelShutdownResult {
  confirmed: boolean;
}

export interface KernelConstructorOptions {
  cwd: string;
}

// ============================================================================
// Internal Types
// ============================================================================

type KernelStatus =
  | "stopped"
  | "starting"
  | "idle"
  | "executing"
  | "crashed"
  | "shutting-down";

interface KernelFingerprint {
  packages: string[];
  pythonVersion: string | undefined;
  pythonExecutable: string | undefined;
}

interface PendingExec {
  id: string;
  resolve: (r: KernelExecuteResult) => void;
  stdout: string;
  stderr: string;
  displays: string[];
  startedAt: number;
  cancelled: boolean;
  timedOut: boolean;
  kernelKilled: boolean;
  error: KernelError | null;
  exitCode: number | undefined;
  execCount: number;
  escalationTimer: ReturnType<typeof setTimeout> | null;
  escalationStep: number;
  settled: boolean;
  onChunk?: KernelExecuteOptions["onChunk"];
  onDisplay?: KernelExecuteOptions["onDisplay"];
  signal?: AbortSignal;
  onAbort?: () => void;
  timeoutTimer: ReturnType<typeof setTimeout> | null;
}

// ============================================================================
// Constants
// ============================================================================

const CHILD_PID_SIGINT_GRACE_MS = 3000;
const GROUP_SIGINT_GRACE_MS = 1500;
const GROUP_SIGTERM_GRACE_MS = 1000;
const SHUTDOWN_GRACE_MS = 1000;
const DEFAULT_STARTUP_TIMEOUT_MS = 20_000;

const RUNNER_PATH = join(dirname(fileURLToPath(import.meta.url)), "runner.py");

// ============================================================================
// Helpers
// ============================================================================

/** Normalize a packages array: trim, drop empties, deduplicate. */
function normalizePackages(packages: string[] | undefined): string[] {
  if (!packages) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of packages) {
    const trimmed = raw.trim();
    if (trimmed && !seen.has(trimmed)) {
      seen.add(trimmed);
      result.push(trimmed);
    }
  }
  return result;
}

/** Compare two fingerprints for equality. */
function fingerprintsEqual(
  a: KernelFingerprint,
  b: KernelFingerprint,
): boolean {
  if (a.pythonVersion !== b.pythonVersion) return false;
  if (a.pythonExecutable !== b.pythonExecutable) return false;
  if (a.packages.length !== b.packages.length) return false;
  const aSet = new Set(a.packages);
  for (const p of b.packages) {
    if (!aSet.has(p)) return false;
  }
  return true;
}

/** Determine which fingerprint dimension changed (or null if identical). */
function fingerprintChangeReason(
  old: KernelFingerprint,
  next: KernelFingerprint,
): RestartReason | null {
  if (old.pythonVersion !== next.pythonVersion) return "pythonVersion";
  if (old.pythonExecutable !== next.pythonExecutable) return "pythonExecutable";
  if (!fingerprintsEqual(old, next)) return "packages";
  return null;
}

// ============================================================================
// PythonKernel
// ============================================================================

export class PythonKernel {
  #proc: ChildProcess | null = null;
  #status: KernelStatus = "stopped";
  #readBuffer = "";
  #pending = new Map<string, PendingExec>();
  #execCount = 0;
  #cwd: string;
  #onReady: (() => void) | null = null;
  #onStartFail: ((err: Error) => void) | null = null;
  #stderrSinceStart = "";

  /** Fingerprint of the current (or last) kernel instance. */
  #fingerprint: KernelFingerprint = {
    packages: [],
    pythonVersion: undefined,
    pythonExecutable: undefined,
  };

  /** Set on each execute(); consumed by #doExecute into the result. */
  #lastRestarted = false;
  #lastRestartReason: RestartReason | undefined = undefined;

  constructor(options: KernelConstructorOptions) {
    this.#cwd = options.cwd;
  }

  isAlive(): boolean {
    return (
      (this.#status === "idle" || this.#status === "executing") &&
      this.#proc !== null
    );
  }

  /**
   * Execute code in the persistent kernel. One method handles everything:
   * check fingerprint changes, decide restart, execute.
   *
   * Naive replacement semantics: if packages/pythonVersion/pythonExecutable
   * differ from the current kernel, restart with the new values. If reset is
   * true, restart with a fresh fingerprint.
   */
  async execute(options: KernelExecuteOptions): Promise<KernelExecuteResult> {
    const requestedFingerprint: KernelFingerprint = {
      packages: normalizePackages(options.packages),
      pythonVersion: options.pythonVersion,
      pythonExecutable: options.pythonExecutable,
    };

    // Reset tracking for this call.
    this.#lastRestarted = false;
    this.#lastRestartReason = undefined;

    if (this.isAlive()) {
      // Kernel is alive - check if restart is needed.
      let reason: RestartReason | null = null;
      if (options.reset) {
        reason = "reset";
      } else {
        reason = fingerprintChangeReason(
          this.#fingerprint,
          requestedFingerprint,
        );
      }
      if (reason !== null) {
        await this.#restart(requestedFingerprint, reason);
      }
    } else {
      // Kernel not alive - need to start.
      if (this.#status === "executing" || this.#status === "starting") {
        throw new Error(
          "kernel busy: one execution at a time (reject, not queue)",
        );
      }
      if (this.#status === "shutting-down") {
        throw new Error("kernel is shutting down");
      }
      // stopped or crashed.
      const hadPreviousKernel =
        this.#proc !== null || this.#status === "crashed";
      const fingerprintChanged =
        hadPreviousKernel &&
        !fingerprintsEqual(this.#fingerprint, requestedFingerprint);

      if (options.reset) {
        // Reset: start fresh with requested fingerprint.
        this.#fingerprint = requestedFingerprint;
        await this.#startFresh(requestedFingerprint);
        this.#lastRestarted = true;
        this.#lastRestartReason = "reset";
      } else if (fingerprintChanged) {
        // Fingerprint changed since last kernel.
        const reason = fingerprintChangeReason(
          this.#fingerprint,
          requestedFingerprint,
        );
        if (reason) {
          await this.#restart(requestedFingerprint, reason);
        }
      } else if (hadPreviousKernel) {
        // Same fingerprint, crash recovery: restart, state lost.
        this.#lastRestarted = true;
        this.#lastRestartReason = "crash";
        await this.#startFresh(this.#fingerprint);
      } else {
        // First-ever start: use requested fingerprint.
        this.#fingerprint = requestedFingerprint;
        await this.#startFresh(requestedFingerprint);
      }
    }

    if (this.#status === "executing") {
      throw new Error(
        "kernel busy: one execution at a time (reject, not queue)",
      );
    }
    this.#status = "executing";

    return this.#doExecute(options);
  }

  async shutdown(
    timeoutMs: number = SHUTDOWN_GRACE_MS,
  ): Promise<KernelShutdownResult> {
    if (this.#status === "stopped") return { confirmed: true };
    this.#status = "shutting-down";
    this.#abortPending("kernel shutdown", true);
    const proc = this.#proc;
    if (!proc) {
      this.#status = "stopped";
      return { confirmed: true };
    }
    try {
      this.#writeLine(JSON.stringify({ type: "exit" }));
    } catch {
      // writer may be closed
    }
    try {
      proc.stdin?.end();
    } catch {
      // ignore
    }
    let confirmed = await this.#waitForExit(proc, timeoutMs);
    if (!confirmed && proc.pid) {
      if (process.platform !== "win32") {
        try {
          process.kill(-proc.pid, "SIGTERM");
        } catch {
          // ignore
        }
      } else {
        try {
          proc.kill("SIGKILL");
        } catch {
          // ignore
        }
      }
      confirmed = await this.#waitForExit(proc, timeoutMs);
    }
    if (!confirmed && proc.pid && process.platform !== "win32") {
      try {
        process.kill(-proc.pid, "SIGKILL");
      } catch {
        // ignore
      }
      confirmed = await this.#waitForExit(proc, timeoutMs);
    }
    this.#proc = null;
    this.#status = "stopped";
    return { confirmed };
  }

  // --------------------------------------------------------------------------
  // Private: startup / restart
  // --------------------------------------------------------------------------

  async #restart(
    nextFingerprint: KernelFingerprint,
    reason: RestartReason,
  ): Promise<void> {
    if (this.isAlive() || this.#status === "starting") {
      await this.#killCurrent();
    }
    this.#fingerprint = nextFingerprint;
    await this.#startFresh(nextFingerprint);
    this.#lastRestarted = true;
    this.#lastRestartReason = reason;
  }

  async #killCurrent(): Promise<void> {
    const proc = this.#proc;
    if (!proc) return;
    this.#status = "shutting-down";
    this.#abortPending("kernel restart", true);
    try {
      this.#writeLine(JSON.stringify({ type: "exit" }));
    } catch {
      // ignore
    }
    try {
      proc.stdin?.end();
    } catch {
      // ignore
    }
    await this.#waitForExit(proc, SHUTDOWN_GRACE_MS);
    if (proc.pid && process.platform !== "win32") {
      try {
        process.kill(-proc.pid, "SIGKILL");
      } catch {
        // ignore
      }
      await this.#waitForExit(proc, SHUTDOWN_GRACE_MS);
    }
    this.#proc = null;
    this.#status = "stopped";
  }

  async #startFresh(fingerprint: KernelFingerprint): Promise<void> {
    this.#proc = null;
    this.#readBuffer = "";
    this.#onReady = null;
    this.#onStartFail = null;
    this.#status = "stopped";

    const args = ["run", "--no-project", "--quiet"];
    if (fingerprint.pythonVersion) {
      args.push("--python", fingerprint.pythonVersion);
    } else if (fingerprint.pythonExecutable) {
      args.push("--python", fingerprint.pythonExecutable);
    }
    for (const pkg of fingerprint.packages) {
      args.push("--with", pkg);
    }
    args.push(RUNNER_PATH);

    const env = {
      ...process.env,
      PYTHONUNBUFFERED: "1",
      PYTHONIOENCODING: "utf-8",
    };
    const proc = spawn("uv", args, {
      stdio: ["pipe", "pipe", "pipe"],
      detached: process.platform !== "win32",
      cwd: this.#cwd,
      env,
      windowsHide: true,
    });
    this.#proc = proc;
    this.#status = "starting";
    this.#stderrSinceStart = "";

    const ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(
          new Error(
            `kernel startup timed out\n--- stderr ---\n${this.#stderrSinceStart}`,
          ),
        );
      }, DEFAULT_STARTUP_TIMEOUT_MS);
      this.#onReady = () => {
        clearTimeout(timer);
        resolve();
      };
      this.#onStartFail = (err: Error) => {
        clearTimeout(timer);
        reject(err);
      };
    });

    proc.stdout?.setEncoding("utf8");
    proc.stdout?.on("data", (chunk: string) => {
      this.#readBuffer += chunk;
      this.#flushFrames();
    });
    proc.stderr?.setEncoding("utf8");
    proc.stderr?.on("data", (chunk: string) => {
      this.#stderrSinceStart += chunk;
      for (const p of this.#pending.values()) {
        p.stderr += chunk;
        p.onChunk?.(chunk, "stderr");
      }
    });
    proc.on("error", (err) => {
      this.#onStartFail?.(new Error(`spawn failed: ${err.message}`));
    });
    proc.on("exit", (code, signal) => {
      this.#onExit(code, signal);
    });

    try {
      await ready;
    } catch (err) {
      this.#status = "crashed";
      this.#proc = null;
      throw err;
    }
    this.#status = "idle";
  }

  // --------------------------------------------------------------------------
  // Private: execution
  // --------------------------------------------------------------------------

  #doExecute(options: KernelExecuteOptions): Promise<KernelExecuteResult> {
    const id = randomUUID();
    const startedAt = Date.now();
    const pending: PendingExec = {
      id,
      resolve: undefined as never,
      stdout: "",
      stderr: "",
      displays: [],
      startedAt,
      cancelled: false,
      timedOut: false,
      kernelKilled: false,
      error: null,
      exitCode: undefined,
      execCount: 0,
      escalationTimer: null,
      escalationStep: 0,
      settled: false,
      onChunk: options.onChunk,
      onDisplay: options.onDisplay,
      signal: options.signal,
      timeoutTimer: null,
    };
    const promise = new Promise<KernelExecuteResult>((resolve) => {
      pending.resolve = resolve;
    });
    this.#pending.set(id, pending);

    // Abort / timeout -> graceful interrupt then escalation.
    const step = () => {
      if (pending.settled) return;
      const proc = this.#proc;
      const pid = proc?.pid;
      if (!proc || !pid) {
        this.#finalize(pending);
        return;
      }
      const tryKill = (target: "child" | "group", sig: NodeJS.Signals) => {
        try {
          if (target === "child") proc.kill(sig);
          else process.kill(-pid, sig);
        } catch {
          // already gone
        }
      };
      if (pending.escalationStep === 0) {
        pending.escalationStep = 1;
        tryKill("child", "SIGINT");
        pending.escalationTimer = setTimeout(step, CHILD_PID_SIGINT_GRACE_MS);
      } else if (pending.escalationStep === 1) {
        pending.escalationStep = 2;
        if (process.platform !== "win32") {
          tryKill("group", "SIGINT");
        } else {
          tryKill("child", "SIGKILL");
        }
        pending.escalationTimer = setTimeout(step, GROUP_SIGINT_GRACE_MS);
      } else if (pending.escalationStep === 2) {
        pending.escalationStep = 3;
        if (process.platform !== "win32") {
          tryKill("group", "SIGTERM");
        }
        pending.escalationTimer = setTimeout(step, GROUP_SIGTERM_GRACE_MS);
      } else if (pending.escalationStep === 3) {
        pending.escalationStep = 4;
        if (process.platform !== "win32") {
          tryKill("group", "SIGKILL");
        }
        pending.escalationTimer = setTimeout(step, GROUP_SIGTERM_GRACE_MS);
      } else {
        this.#finalize(pending);
      }
    };

    pending.onAbort = () => {
      if (pending.settled) return;
      if (pending.signal?.reason?.name === "TimeoutError")
        pending.timedOut = true;
      pending.cancelled = true;
      step();
    };

    if (options.signal) {
      if (options.signal.aborted) {
        pending.onAbort();
      } else {
        options.signal.addEventListener(
          "abort",
          pending.onAbort as EventListener,
          { once: true },
        );
      }
    }
    if (options.timeoutMs && options.timeoutMs > 0) {
      pending.timeoutTimer = setTimeout(() => {
        if (pending.settled) return;
        pending.timedOut = true;
        pending.cancelled = true;
        step();
      }, options.timeoutMs);
    }

    try {
      this.#writeLine(JSON.stringify({ id, code: options.code }));
    } catch (err) {
      pending.cancelled = true;
      pending.error = {
        name: "TransportError",
        value: err instanceof Error ? err.message : String(err),
        traceback: "",
      };
      this.#finalize(pending);
    }

    return promise;
  }

  // --------------------------------------------------------------------------
  // Private: finalization / abort
  // --------------------------------------------------------------------------

  #finalize(pending: PendingExec): KernelExecuteResult {
    if (pending.settled) {
      return this.#buildResult(pending);
    }
    pending.settled = true;
    this.#pending.delete(pending.id);
    if (pending.escalationTimer) clearTimeout(pending.escalationTimer);
    if (pending.timeoutTimer) clearTimeout(pending.timeoutTimer);
    if (pending.signal && pending.onAbort) {
      pending.signal.removeEventListener(
        "abort",
        pending.onAbort as EventListener,
      );
    }
    const result = this.#buildResult(pending);
    // Back to idle only if the process is still with us and we're executing.
    if (
      this.#proc &&
      this.#proc.exitCode === null &&
      this.#status === "executing"
    ) {
      this.#status = "idle";
    }
    pending.resolve(result);
    return result;
  }

  #buildResult(pending: PendingExec): KernelExecuteResult {
    return {
      exitCode: pending.exitCode ?? -1,
      cancelled: pending.cancelled,
      timedOut: pending.timedOut,
      kernelKilled: pending.kernelKilled,
      error: pending.error,
      stdout: pending.stdout,
      stderr: pending.stderr,
      displays: pending.displays,
      execCount: pending.execCount,
      restarted: this.#lastRestarted,
      restartReason: this.#lastRestartReason,
    };
  }

  #abortPending(reason: string, kernelKilled: boolean): void {
    for (const pending of [...this.#pending.values()]) {
      if (pending.settled) continue;
      pending.kernelKilled = kernelKilled;
      pending.cancelled = true;
      pending.stderr += `\n[kernel] ${reason}\n`;
      this.#finalize(pending);
    }
  }

  // --------------------------------------------------------------------------
  // Private: process events
  // --------------------------------------------------------------------------

  #onExit(code: number | null, signal: string | null): void {
    if (this.#status === "starting") {
      this.#onStartFail?.(
        new Error(
          `kernel exited during startup (code=${code} signal=${signal})\n--- stderr ---\n${this.#stderrSinceStart}`,
        ),
      );
      this.#status = "stopped";
      return;
    }
    // Crash mid-execution or idle: settle the live call as kernel-killed.
    this.#abortPending(
      `kernel process exited (code=${code} signal=${signal})`,
      true,
    );
    this.#status = "crashed";
  }

  #waitForExit(proc: ChildProcess, timeoutMs: number): Promise<boolean> {
    if (proc.exitCode !== null || proc.signalCode) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      const onExit = () => resolve(true);
      proc.once("exit", onExit);
      const timer = setTimeout(
        () => {
          proc.removeListener("exit", onExit);
          resolve(false);
        },
        Math.max(0, timeoutMs),
      );
      timer.unref?.();
    });
  }

  // --------------------------------------------------------------------------
  // Private: NDJSON protocol
  // --------------------------------------------------------------------------

  #writeLine(line: string): void {
    if (!this.#proc?.stdin) throw new Error("kernel stdin is not open");
    this.#proc.stdin.write(`${line}\n`);
  }

  #flushFrames(): void {
    for (;;) {
      const nl = this.#readBuffer.indexOf("\n");
      if (nl < 0) return;
      const line = this.#readBuffer.slice(0, nl);
      this.#readBuffer = this.#readBuffer.slice(nl + 1);
      if (!line.trim()) continue;
      let frame: Record<string, unknown>;
      try {
        frame = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue; // ignore malformed
      }
      this.#handleFrame(frame);
    }
  }

  #handleFrame(frame: Record<string, unknown>): void {
    const type = frame.type as string;
    if (type === "ready") {
      this.#onReady?.();
      this.#onReady = null;
      this.#onStartFail = null;
      return;
    }
    const rid = frame.id as string | undefined;
    const pending = rid ? this.#pending.get(rid) : undefined;
    switch (type) {
      case "started": {
        if (typeof frame.count === "number") {
          this.#execCount = frame.count;
          if (pending) pending.execCount = frame.count;
        }
        return;
      }
      case "stream": {
        if (!pending) return;
        const text = (frame.data as string) ?? "";
        const stream = (frame.stream as "stdout" | "stderr") ?? "stdout";
        if (stream === "stdout") pending.stdout += text;
        else pending.stderr += text;
        pending.onChunk?.(text, stream);
        return;
      }
      case "display": {
        const data = (frame.data as string) ?? "";
        if (pending) {
          pending.displays.push(data);
          pending.onDisplay?.(data);
        }
        return;
      }
      case "done": {
        if (!pending) return;
        if (typeof frame.exit_code === "number")
          pending.exitCode = frame.exit_code;
        if (frame.error && typeof frame.error === "object") {
          const e = frame.error as {
            name?: string;
            value?: string;
            traceback?: string;
          };
          pending.error = {
            name: String(e.name ?? "Error"),
            value: String(e.value ?? ""),
            traceback: String(e.traceback ?? ""),
          };
        }
        if (frame.cancelled) pending.cancelled = true;
        this.#finalize(pending);
        return;
      }
    }
  }
}

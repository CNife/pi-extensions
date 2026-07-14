/**
 * Execute Python Tool - Persistent Python kernel
 *
 * Features:
 * - Persistent Python kernel: variables, imports, and installed packages
 *   survive across executePython calls within the same session
 * - Real-time streaming output via onUpdate
 * - Custom TUI rendering (renderCall + renderResult)
 * - Kernel crash detection + automatic restart on next call
 * - SIGINT cancellation preserves kernel state
 * - session_shutdown cleanup
 */

import { Type } from "@earendil-works/pi-ai";
import {
  defineTool,
  type ExtensionAPI,
  highlightCode,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { PythonKernel } from "../kernel.ts";

// ============================================================================
// Types
// ============================================================================

interface ExecutePythonResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  cancelled: boolean;
  timedOut: boolean;
  kernelKilled: boolean;
  error: { name: string; value: string; traceback: string } | null;
  displays: string[];
  variables: string[];
  restarted: boolean;
  restartReason?: string;
  /** Requirement strings newly added to the accumulated set S (P \ S). */
  addedPackages: string[];
}

interface ExecutePythonRenderState {
  startedAt: number | undefined;
  endedAt: number | undefined;
  interval: NodeJS.Timeout | undefined;
}

// ============================================================================
// Constants
// ============================================================================

const UPDATE_THROTTLE_MS = 100;

// ============================================================================
// Helpers
// ============================================================================

function formatDuration(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

function appendAdded(base: string, addedPackages: string[]): string {
  if (addedPackages.length === 0) return base;
  return `${base} 新增依赖：${addedPackages.join(", ")}。`;
}

function buildRestartNotice(
  reason: string,
  addedPackages: string[] = [],
): string {
  switch (reason) {
    case "packages": {
      const added = addedPackages.length > 0 ? addedPackages.join(", ") : "";
      return added
        ? `内核已重启：新增依赖 ${added}，内存状态已重置。`
        : "内核已重启：依赖变更，内存状态已重置。";
    }
    case "pythonVersion":
      return appendAdded(
        "内核已重启：Python 版本切换，内存状态已重置。",
        addedPackages,
      );
    case "pythonExecutable":
      return appendAdded(
        "内核已重启：Python 解释器切换，内存状态已重置。",
        addedPackages,
      );
    case "reset":
      return "内核已重置：所有状态和累加依赖已清空。";
    case "crash":
      return appendAdded(
        "内核已崩溃后重启：之前的内存状态已丢失。",
        addedPackages,
      );
    default:
      return "";
  }
}

// ============================================================================
// Tool Definition
// ============================================================================

const executePythonTool = defineTool({
  name: "executePython",
  label: "Execute Python",
  description: [
    "Execute Python code in a persistent kernel. Variables, imports, and installed",
    "packages survive across calls within the same session. No bash escaping needed.",
    "Optionally provide timeout in seconds.",
  ].join(" "),
  promptSnippet:
    "Execute Python code in a persistent kernel (state survives across calls)",
  promptGuidelines: [
    "Use for complex tasks: heavy computation, multi-step data processing, heredoc-style scripts",
    "Variables and imports persist across calls - no need to re-import or re-define",
    "Use packages param to declare third-party dependencies (e.g. ['requests', 'pandas>=2.0'])",
    "Prefer bash for simple commands or short pipes (≤3 |)",
    "No bash escaping needed - write Python code directly",
    "Use executePython for running Python code (python -c, scripts) instead of bash",
  ],
  executionMode: "sequential",
  parameters: Type.Object({
    code: Type.String({
      description: "Python code to execute, no escaping needed",
    }),
    packages: Type.Optional(
      Type.Array(Type.String(), {
        description:
          "PyPI dependencies to auto-install, e.g. ['requests', 'pandas>=2.0']. uv handles venv automatically. Declaring already-installed packages is a no-op (kernel reuses).",
        default: [],
      }),
    ),
    python_version: Type.Optional(
      Type.String({
        description: "Python version, e.g. '3.12', passed to uv --python",
      }),
    ),
    python_executable: Type.Optional(
      Type.String({
        description:
          "Python executable path, e.g. '/usr/bin/python3.12'. Mutually exclusive with python_version",
      }),
    ),
    timeout: Type.Optional(
      Type.Number({
        description: "Timeout in seconds, no timeout by default",
      }),
    ),
    reset: Type.Optional(
      Type.Boolean({
        description:
          "Reset the kernel: clear all variables, imports, and accumulated dependencies, then execute the provided code in a fresh kernel",
        default: false,
      }),
    ),
  }),

  async execute(_toolCallId, params, signal, onUpdate, ctx) {
    const {
      code,
      packages,
      python_version,
      python_executable,
      timeout,
      reset,
    } = params;

    // Validate mutually exclusive parameters
    if (python_version && python_executable) {
      return {
        content: [
          {
            type: "text" as const,
            text: "exitCode: 1\n--- stderr ---\npython_version and python_executable are mutually exclusive",
          },
        ],
        details: {
          stdout: "",
          stderr: "python_version and python_executable are mutually exclusive",
          exitCode: 1,
          cancelled: false,
          timedOut: false,
          kernelKilled: false,
          error: null,
          displays: [],
          variables: [],
          restarted: false,
          addedPackages: [],
        } as ExecutePythonResult,
      };
    }

    // Get or create kernel for this session
    const kernel = getOrCreateKernel(ctx.cwd);

    // Streaming state
    let stdout = "";
    let stderr = "";
    let updateTimer: ReturnType<typeof setTimeout> | undefined;
    let updateDirty = false;
    let lastUpdateAt = 0;

    const emitUpdate = () => {
      if (!onUpdate || !updateDirty) return;
      updateDirty = false;
      lastUpdateAt = Date.now();
      onUpdate({
        content: [
          {
            type: "text" as const,
            text: stdout || stderr ? `${stdout}${stderr}` : "",
          },
        ],
        details: {
          stdout,
          stderr,
          exitCode: -1,
          cancelled: false,
          timedOut: false,
          kernelKilled: false,
          error: null,
          displays: [],
          variables: [],
          restarted: false,
          addedPackages: [],
        } as ExecutePythonResult,
      });
    };

    const scheduleUpdate = () => {
      if (!onUpdate) return;
      updateDirty = true;
      const delay = UPDATE_THROTTLE_MS - (Date.now() - lastUpdateAt);
      if (delay <= 0) {
        if (updateTimer) clearTimeout(updateTimer);
        emitUpdate();
      } else if (!updateTimer) {
        updateTimer = setTimeout(() => {
          updateTimer = undefined;
          emitUpdate();
        }, delay);
      }
    };

    try {
      const result = await kernel.execute({
        code,
        packages,
        pythonVersion: python_version,
        pythonExecutable: python_executable,
        reset,
        signal,
        onChunk: (text, stream) => {
          if (stream === "stdout") stdout += text;
          else stderr += text;
          scheduleUpdate();
        },
        onDisplay: () => scheduleUpdate(),
        timeoutMs: timeout ? timeout * 1000 : undefined,
      });

      // Flush any pending update
      if (updateTimer) {
        clearTimeout(updateTimer);
        updateTimer = undefined;
      }

      // Build plain text content for LLM
      const contentParts: string[] = [];

      // Restart notice
      if (result.restarted && result.restartReason) {
        const notice = buildRestartNotice(
          result.restartReason,
          result.addedPackages,
        );
        if (notice) contentParts.push(notice);
      }

      contentParts.push(`exitCode: ${result.exitCode}`);
      contentParts.push("--- stdout ---");
      contentParts.push(result.stdout || "(no output)");

      if (result.displays.length > 0) {
        contentParts.push("--- display ---");
        for (const d of result.displays) {
          contentParts.push(d);
        }
      }

      // Kernel state snapshot: top-level variable names so the LLM can see
      // what survives in the persistent namespace and reuse it instead of
      // re-defining.
      if (result.variables.length > 0) {
        const shown = result.variables.slice(0, 30);
        let line = shown.join(", ");
        if (result.variables.length > 30) {
          line += `, ... ${result.variables.length - 30} more`;
        }
        contentParts.push("--- kernel state ---");
        contentParts.push(line);
      }

      if (result.stderr) {
        contentParts.push("--- stderr ---");
        contentParts.push(result.stderr);
      }

      if (result.cancelled) {
        contentParts.push(result.timedOut ? "[timed out]" : "[cancelled]");
      }

      if (result.kernelKilled) {
        contentParts.push("[kernel killed]");
      }

      if (result.error?.name === "StartupError") {
        contentParts.push(
          "[内核启动失败：之前的内存状态已丢失，修正依赖后可重试]",
        );
      }

      const details: ExecutePythonResult = {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        cancelled: result.cancelled,
        timedOut: result.timedOut,
        kernelKilled: result.kernelKilled,
        error: result.error,
        displays: result.displays,
        variables: result.variables,
        restarted: result.restarted,
        restartReason: result.restartReason,
        addedPackages: result.addedPackages,
      };

      return {
        content: [
          {
            type: "text" as const,
            text: contentParts.join("\n"),
          },
        ],
        details,
      };
    } catch (error) {
      // Kernel busy/shutting-down rejection or other unexpected error.
      // (Startup failures are returned as error results by the kernel, not thrown.)
      if (updateTimer) {
        clearTimeout(updateTimer);
        updateTimer = undefined;
      }
      const errorMsg = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: "text" as const,
            text: `exitCode: -1\n--- stderr ---\n${errorMsg}`,
          },
        ],
        details: {
          stdout,
          stderr: errorMsg,
          exitCode: -1,
          cancelled: false,
          timedOut: false,
          kernelKilled: true,
          error: {
            name: "StartupError",
            value: errorMsg,
            traceback: "",
          },
          displays: [],
          variables: [],
          restarted: false,
          addedPackages: [],
        } as ExecutePythonResult,
      };
    }
  },

  // Custom rendering for tool call display
  renderCall(args, theme, _context) {
    const code = args.code;
    let text = `${theme.fg("toolTitle", theme.bold("python"))}\n`;
    if (args.packages && args.packages.length > 0) {
      text += `${theme.fg("dim", `packages: ${args.packages.join(", ")}`)}\n`;
    }
    const highlighted = highlightCode(code, "python");
    text += `${highlighted.join("\n")}\n`;
    return new Text(text, 0, 0);
  },

  // Custom rendering for tool result display
  renderResult(result, { expanded, isPartial }, theme, context) {
    const state = context.state as ExecutePythonRenderState;

    // Track timing
    if (context.executionStarted && state.startedAt === undefined) {
      state.startedAt = Date.now();
      state.endedAt = undefined;
    }

    // Set up interval to update elapsed time during execution
    if (state.startedAt !== undefined && isPartial && !state.interval) {
      state.interval = setInterval(() => context.invalidate(), 1000);
    }
    if (!isPartial) {
      state.endedAt ??= Date.now();
      if (state.interval) {
        clearInterval(state.interval);
        state.interval = undefined;
      }
    }

    const details = result.details as ExecutePythonResult | undefined;

    // Partial result (still running)
    if (isPartial) {
      let text = theme.fg("warning", "Running...");
      if (state.startedAt) {
        const elapsed = Date.now() - state.startedAt;
        text += theme.fg("muted", ` (${formatDuration(elapsed)})`);
      }
      if (details?.stdout) {
        const lines = details.stdout.split("\n");
        const preview = lines.slice(-5).join("\n");
        if (preview) {
          text += `\n${preview}`;
        }
      }
      return new Text(text, 0, 0);
    }

    // Final result
    let text = "";

    // Restart notice
    if (details?.restarted && details.restartReason) {
      const notice = buildRestartNotice(
        details.restartReason,
        details.addedPackages,
      );
      if (notice) {
        text += `${theme.fg("warning", notice)}\n`;
      }
    }

    // Collapsed mode: show first 5 lines of stdout
    if (!expanded && details?.stdout) {
      const lines = details.stdout.split("\n");
      const preview = lines.slice(0, 5).join("\n");
      if (preview) {
        text += preview;
      }
      if (lines.length > 5) {
        text += `\n${theme.fg("muted", `... ${lines.length - 5} more lines`)}`;
      }
    }

    // Show stderr in collapsed mode when present
    if (!expanded && details?.stderr) {
      text += `\n${theme.fg("warning", "--- stderr below ---")}`;
      text += `\n${details.stderr}`;
    }

    // Expanded mode: show full stdout and stderr (only if stderr exists)
    if (expanded) {
      if (details?.stdout) {
        text += details.stdout;
      }
      if (details?.stderr) {
        text += `\n${theme.fg("warning", "--- stderr ---")}`;
        text += `\n${details.stderr}`;
      }
    }

    // Show displays
    if (details?.displays && details.displays.length > 0) {
      text += `\n${theme.fg("dim", "--- display ---")}`;
      for (const d of details.displays) {
        text += `\n${d}`;
      }
    }

    // Status line: exitCode + stdout lines + duration
    const exitCode = details?.exitCode ?? -1;
    const exitText =
      exitCode === 0
        ? theme.fg("success", "Done")
        : details?.cancelled
          ? theme.fg("warning", "Cancelled")
          : theme.fg("error", `Error ${exitCode}`);

    const stdoutLines = details?.stdout
      ? details.stdout.split("\n").filter((l) => l.trim()).length
      : 0;

    const statusParts = [exitText];
    if (stdoutLines > 0) {
      statusParts.push(theme.fg("dim", `${stdoutLines} lines`));
    }

    if (state.startedAt) {
      const endTime = state.endedAt ?? Date.now();
      const label = isPartial ? "Elapsed" : "Took";
      statusParts.push(
        theme.fg(
          "muted",
          `${label} ${formatDuration(endTime - state.startedAt)}`,
        ),
      );
    }

    text += `\n${statusParts.join("  ")}`;

    return new Text(text, 0, 0);
  },
});

// ============================================================================
// Kernel management
// ============================================================================

let sessionKernel: PythonKernel | null = null;

function getOrCreateKernel(cwd: string): PythonKernel {
  if (!sessionKernel) {
    sessionKernel = new PythonKernel({ cwd });
  }
  return sessionKernel;
}

// ============================================================================
// Extension Export
// ============================================================================

export default function (pi: ExtensionAPI) {
  pi.registerTool(executePythonTool);

  // Intercept bash tool results to guide AI toward executePython
  pi.on("tool_result", async (event, _ctx) => {
    if (event.toolName !== "bash") return;

    const command = (event.input as { command?: string })?.command ?? "";
    // Detect python -c patterns in bash commands
    if (/python[0-9.]*\s+-c\s/.test(command)) {
      return {
        content: [
          ...event.content,
          {
            type: "text" as const,
            text: "\nTip: Use executePython for Python code instead of bash.",
          },
        ],
      };
    }
  });

  // Clean up kernel on session shutdown
  pi.on("session_shutdown", async () => {
    if (sessionKernel) {
      await sessionKernel.shutdown();
      sessionKernel = null;
    }
  });
}

/**
 * Execute Python Tool - Run Python code with uv
 *
 * Features:
 * - Real-time streaming output via onUpdate
 * - Custom TUI rendering (renderCall + renderResult)
 * - Process group management (detached + signal)
 * - Plain text content for LLM consumption
 */

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Type } from "@earendil-works/pi-ai";
import {
  defineTool,
  type ExtensionAPI,
  highlightCode,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

// ============================================================================
// Types
// ============================================================================

interface ExecutePythonResult {
  path: string;
  stdout: string;
  stderr: string;
  exitCode: number;
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

function killProcessTree(pid: number): void {
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Process already dead
    }
  }
}

function formatDuration(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

// ============================================================================
// Tool Definition
// ============================================================================

const executePythonTool = defineTool({
  name: "executePython",
  label: "Execute Python",
  description: [
    "Execute Python code with uv. No bash escaping needed, auto-manages dependencies.",
    "Output is streamed in real-time with PYTHONUNBUFFERED=1.",
    "Optionally provide timeout in seconds.",
  ].join(" "),
  promptSnippet: "Execute Python code (prefer over bash for complex tasks)",
  promptGuidelines: [
    "Use for complex tasks: heavy computation, multi-step data processing, heredoc-style scripts",
    "Use packages param to declare ALL third-party dependencies (uv auto-manages venv)",
    "Prefer bash for simple commands or short pipes (≤3 |)",
    "No bash escaping needed — write Python code directly",
  ],
  parameters: Type.Object({
    code: Type.String({
      description: "Python code to execute, no escaping needed",
    }),
    packages: Type.Optional(
      Type.Array(Type.String(), {
        description:
          "PyPI dependencies to auto-install, e.g. ['requests', 'pandas>=2.0']. uv handles venv automatically.",
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
  }),

  async execute(_toolCallId, params, signal, onUpdate, _ctx) {
    const { code, packages, python_version, python_executable, timeout } =
      params;

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
          path: "",
          stdout: "",
          stderr: "python_version and python_executable are mutually exclusive",
          exitCode: 1,
        } as ExecutePythonResult,
      };
    }

    // Generate temp file path
    const id = randomUUID();
    const tempPath = join(tmpdir(), `pi-python-${id}.py`);

    try {
      // Write code to temp file
      await writeFile(tempPath, code, "utf-8");

      // Build uv command
      const args = ["run"];

      if (python_version) {
        args.push("--python", python_version);
      } else if (python_executable) {
        args.push("--python", python_executable);
      }

      if (packages && packages.length > 0) {
        for (const pkg of packages) {
          args.push("--with", pkg);
        }
      }

      args.push(tempPath);

      // Execute uv command with streaming
      const result = await new Promise<ExecutePythonResult>((resolve) => {
        let stdout = "";
        let stderr = "";
        let timedOut = false;
        let timeoutId: ReturnType<typeof setTimeout> | undefined;
        let updateTimer: ReturnType<typeof setTimeout> | undefined;
        let updateDirty = false;
        let lastUpdateAt = 0;

        const child = spawn("uv", args, {
          stdio: ["ignore", "pipe", "pipe"],
          detached: process.platform !== "win32",
          windowsHide: true,
          env: { ...process.env, PYTHONUNBUFFERED: "1" },
        });

        // Timeout handling
        if (timeout && timeout > 0) {
          timeoutId = setTimeout(() => {
            timedOut = true;
            if (child.pid) {
              killProcessTree(child.pid);
            }
          }, timeout * 1000);
        }

        // Signal handling for cancellation
        if (signal) {
          if (signal.aborted) {
            if (child.pid) killProcessTree(child.pid);
          } else {
            signal.addEventListener(
              "abort",
              () => {
                if (child.pid) killProcessTree(child.pid);
              },
              { once: true },
            );
          }
        }

        // Throttled update function
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
              path: tempPath,
              stdout,
              stderr,
              exitCode: -1, // Still running
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

        // Stream stdout
        child.stdout?.setEncoding("utf8");
        child.stdout?.on("data", (chunk: string) => {
          stdout += chunk;
          scheduleUpdate();
        });

        // Stream stderr
        child.stderr?.setEncoding("utf8");
        child.stderr?.on("data", (chunk: string) => {
          stderr += chunk;
          scheduleUpdate();
        });

        // Handle spawn errors
        child.on("error", (error) => {
          if (timeoutId) clearTimeout(timeoutId);
          if (updateTimer) clearTimeout(updateTimer);
          resolve({
            path: tempPath,
            stdout,
            stderr: `spawn error: ${error.message}`,
            exitCode: -1,
          });
        });

        // Handle process exit
        child.on("close", (code) => {
          if (timeoutId) clearTimeout(timeoutId);
          if (updateTimer) clearTimeout(updateTimer);

          // Preserve any stderr produced before timeout and append
          // a timeout marker to avoid losing diagnostic details.
          const finalStderr = timedOut
            ? stderr
              ? `${stderr}\n[timeout after ${timeout}s]`
              : `timeout after ${timeout}s`
            : stderr;

          resolve({
            path: tempPath,
            stdout,
            stderr: finalStderr,
            exitCode: timedOut ? -1 : (code ?? 0),
          });
        });
      });

      // Build plain text content for LLM
      const contentParts = [`exitCode: ${result.exitCode}`];
      contentParts.push(`--- stdout ---`);
      contentParts.push(result.stdout || "(no output)");
      if (result.stderr) {
        contentParts.push(`--- stderr ---`);
        contentParts.push(result.stderr);
      }

      return {
        content: [
          {
            type: "text" as const,
            text: contentParts.join("\n"),
          },
        ],
        details: result,
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `exitCode: -1\n--- stderr ---\n${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        details: {
          path: tempPath,
          stdout: "",
          stderr: error instanceof Error ? error.message : String(error),
          exitCode: -1,
        } as ExecutePythonResult,
      };
    }
  },

  // Custom rendering for tool call display
  renderCall(args, theme, _context) {
    const code = args.code;
    let text = "";
    if (args.packages && args.packages.length > 0) {
      text += theme.fg("dim", `packages: ${args.packages.join(", ")}`) + "\n";
    }
    const highlighted = highlightCode(code, "python");
    text += highlighted.join("\n") + "\n";
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

    // Partial result (still running)
    if (isPartial) {
      const details = result.details as ExecutePythonResult | undefined;
      let text = theme.fg("warning", "Running...");
      if (state.startedAt) {
        const elapsed = Date.now() - state.startedAt;
        text += theme.fg("muted", ` (${formatDuration(elapsed)})`);
      }
      if (details?.stdout) {
        const lines = details.stdout.split("\n");
        const preview = lines.slice(-5).join("\n");
        if (preview) {
          text += "\n" + preview;
        }
      }
      return new Text(text, 0, 0);
    }

    // Final result
    const details = result.details as ExecutePythonResult | undefined;
    let text = "";

    // Collapsed mode: show first 5 lines of stdout
    if (!expanded && details?.stdout) {
      const lines = details.stdout.split("\n");
      const preview = lines.slice(0, 5).join("\n");
      if (preview) {
        text += preview;
      }
      if (lines.length > 5) {
        text += "\n" + theme.fg("muted", `... ${lines.length - 5} more lines`);
      }
    }

    // Expanded mode: show full stdout and stderr (only if stderr exists)
    if (expanded) {
      if (details?.stdout) {
        text += details.stdout;
      }
      if (details?.stderr) {
        text += "\n" + theme.fg("warning", "--- stderr ---");
        text += "\n" + details.stderr;
      }
    }

    // Status line: exitCode + stdout lines + duration
    const exitCode = details?.exitCode ?? -1;
    const exitText =
      exitCode === 0
        ? theme.fg("success", "Done")
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

    text += "\n" + statusParts.join("  ");

    return new Text(text, 0, 0);
  },
});

// ============================================================================
// Extension Export
// ============================================================================

export default function (pi: ExtensionAPI) {
  pi.registerTool(executePythonTool);
}

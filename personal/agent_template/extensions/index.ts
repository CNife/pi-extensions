/**
 * agent_template - fabric FabricProvider for ~/.pi/agent/agents/*.md agent profiles.
 *
 * 配置/路由/执行分离：
 * - 配置（本 provider）：list/describe/invoke 只读 agents/*.md，不执行。
 * - 路由（模型）：经 tools.catalog() 发现 agent，按任务选 agent。
 * - 执行（沙箱）：模型在 fabric_exec 内调 profile 读配置后 agents.run 执行。
 *
 * 零运行时 pi-fabric 依赖：import type 擦除 + 事件名常量硬编码。
 * pi-fabric 在 devDependencies（类型检查用，--omit=dev 不装）。
 * fabric 不存在时 emit 无监听者、DISCOVER 不触发，扩展 no-op。
 *
 * 配置复用：~/.pi/agent/agents/*.md 同时被 pi-subagents 和本扩展读，零重复。
 */

import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type {
  FabricActionDescriptor,
  FabricInvocationContext,
  FabricProvider,
  FabricProviderDiscovery,
} from "pi-fabric/protocol";
import type { AgentProfile, AgentSummary } from "./agent-logic.ts";
import { listAgentProfiles, scanProfiles } from "./agent-logic.ts";

// ──── Constants (hardcoded; v1 protocol contract, stable) ───────

const FABRIC_PROVIDER_REGISTER_EVENT = "pi-fabric:provider:register:v1";
const FABRIC_PROVIDER_DISCOVER_EVENT = "pi-fabric:provider:discover:v1";

const PROVIDER_NAME = "agent_template";
const PROVIDER_DESCRIPTION =
  "Discover and read pi agent profiles (~/.pi/agent/agents/*.md) for task-routed agents.run in fabric_exec. Reads config only; execution happens via agents.run in the sandbox.";
const AGENTS_SUBDIR = "agents";
const PROFILE_ACTION = "profile";

// ──── Helpers ───────────────────────────────────────────────────

function agentsDir(): string {
  return join(getAgentDir(), AGENTS_SUBDIR);
}

/** Read a single agent profile by name (scans dir, matches frontmatter name or filename stem). Throws if not found. */
function readProfileByName(name: string): AgentProfile {
  const profile = scanProfiles(agentsDir()).find((p) => p.name === name);
  if (profile === undefined) {
    throw new Error("Agent profile not found: " + name);
  }
  return profile;
}

/** Project a profile to the execution params agents.run consumes (spec: {model, thinking, tools, prompt}). */
function toExecParams(profile: AgentProfile): {
  model: string;
  thinking: string;
  tools?: string[];
  prompt: string;
} {
  return {
    model: profile.model,
    thinking: profile.thinking,
    prompt: profile.prompt,
    ...(profile.tools ? { tools: profile.tools } : {}),
  };
}

function profileDescriptor(): FabricActionDescriptor {
  return {
    name: PROFILE_ACTION,
    description:
      "Read an agent's execution params (model, thinking, tools, prompt) by name. Returns params for agents.run, not a result. Two-step: profile(name) -> agents.run in fabric_exec.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Agent name (matches ~/.pi/agent/agents/<name>.md).",
        },
      },
      required: ["name"],
    },
    risk: "read",
  };
}

function agentDescriptor(summary: AgentSummary): FabricActionDescriptor {
  const desc =
    summary.description !== "" ? summary.description : "Agent " + summary.name;
  return {
    name: summary.name,
    description:
      desc + " (model: " + summary.model + "; returns params for agents.run)",
    inputSchema: {
      type: "object",
      properties: {
        task: {
          type: "string",
          description:
            "Task for the agent. The provider returns execution params; pass task to agents.run in fabric_exec.",
        },
      },
      required: [],
    },
    risk: "read",
  };
}

// ──── FabricProvider ────────────────────────────────────────────

const provider: FabricProvider = {
  name: PROVIDER_NAME,
  description: PROVIDER_DESCRIPTION,
  async list(_request, _context: FabricInvocationContext) {
    return [
      profileDescriptor(),
      ...listAgentProfiles(agentsDir()).map(agentDescriptor),
    ];
  },
  async describe(actionName, _context: FabricInvocationContext) {
    if (actionName === PROFILE_ACTION) return profileDescriptor();
    const summary = listAgentProfiles(agentsDir()).find(
      (s) => s.name === actionName,
    );
    return summary ? agentDescriptor(summary) : undefined;
  },
  async invoke(actionName, args, _context: FabricInvocationContext) {
    if (actionName === PROFILE_ACTION) {
      const name = (args as { name?: unknown }).name;
      if (typeof name !== "string" || name === "") {
        throw new Error(
          "agent_template.profile requires a 'name' string argument.",
        );
      }
      return toExecParams(readProfileByName(name));
    }
    // Per-agent action: equivalent to profile (returns execution params).
    // task is accepted (schema) but execution is via agents.run in the sandbox.
    return toExecParams(readProfileByName(actionName));
  },
};

// ──── Entry ─────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  // Graceful degradation: if pi.events is unavailable, the provider is never
  // registered and the extension is a no-op. When fabric is absent, the
  // REGISTER emit has no listener and the DISCOVER event never fires.
  if (typeof pi.events?.emit !== "function") return;

  const register = () => {
    pi.events.emit(FABRIC_PROVIDER_REGISTER_EVENT, {
      version: 1,
      provider,
      overwrite: true,
    });
  };

  // Proactive registration (fabric already loaded).
  register();

  // Reactive registration (fabric loads after this extension).
  pi.events.on(FABRIC_PROVIDER_DISCOVER_EVENT, (event: unknown) => {
    if (
      event !== null &&
      typeof event === "object" &&
      typeof (event as FabricProviderDiscovery).register === "function"
    ) {
      (event as FabricProviderDiscovery).register(provider, {
        overwrite: true,
      });
    }
  });
}

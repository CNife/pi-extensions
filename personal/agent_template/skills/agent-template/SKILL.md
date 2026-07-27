---
name: agent-template
description: Route tasks to pi agents via the agent_template fabric provider. Use when delegating to a configured agent (explorer/reviewer/worker). Two-step: profile then agents.run.
---

# Agent template routing

The agent_template fabric provider exposes the agent configs in ~/.pi/agent/agents/*.md (shared with pi-subagents) as discoverable actions. Each action returns **execution params** (model, thinking, tools, prompt) for agents.run. The provider reads config only; execution happens in the sandbox, preserving fabric transport, worktree, handoff, approval, budget, and recursion.

## Discover and execute

```ts
// List routable agents + the generic profile action
const catalog = await tools.catalog({ provider: "agent_template" });

// Route directly by agent name (returns params, not a result)
const p = await tools.call({ ref: "agent_template.reviewer", args: { task } });

// Execute in the sandbox - execution lives here, not in the provider
return agents.run({
  model: p.model,
  thinking: p.thinking,
  tools: p.tools,
  task: p.prompt + "\n\n## Task\n" + task,
});
```

profile takes { name }; every agent is also its own action agent_template.<name> taking { task } and returning the same params (one less call). Use profile({ name }) when you want to inspect params before choosing.

## Routing guidance

Pick the agent by task shape (see each agent's catalog description):

- **explorer** - read-only codebase exploration or web research; returns evidence, never edits.
- **reviewer** - read-only review of diffs/PRs/instructions; returns evidence-based findings.
- **worker** - executes well-specified tasks (goal/steps/verification/stop-condition given); no open-ended design.

When unsure, prefer read-only agents (explorer/reviewer); delegate to worker only for bounded execution.

## tools whitelist

agents.run tools is a **whitelist replacement**, not an append. If the profile has tools, the subagent gets exactly those (list all needed). If tools is undefined, the subagent uses the default tool set. Extension tools (ffgrep, fffind, web_search) are available - child agents inherit global settings.

## Notes

- Config is shared with pi-subagents: editing ~/.pi/agent/agents/*.md affects both.
- sessionPreference/sessionHint in the frontmatter are ignored (agents.run controls transport/worktree).
- The provider never executes - if you got params but no result, you forgot the agents.run step.

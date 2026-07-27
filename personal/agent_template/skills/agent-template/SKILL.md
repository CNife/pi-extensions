---
name: agent-template
description: Route subtasks to preconfigured pi agents (explorer/reviewer/worker). Use when delegating instead of hand-specifying agents.run params.
---

# Agent template routing

The agent_template provider exposes agent configs in ~/.pi/agent/agents/*.md as discoverable actions. Each returns **execution params** (model, thinking, tools, prompt) for agents.run. Routing through the provider preserves fabric transport, worktree, handoff, approval, budget, and recursion.

## Discover and execute

```ts
// Returns params, not a result
const p = await tools.call({ ref: "agent_template.reviewer", args: { task } });

return agents.run({
  model: p.model,
  thinking: p.thinking,
  tools: p.tools,
  task: p.prompt + "\n\n## Task\n" + task,
});
```

Direct actions `agent_template.<name>` take `{ task }` and return params in one call. Use `profile({ name })` only to inspect params before choosing.

## Routing guidance

Pick the agent by task shape:

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

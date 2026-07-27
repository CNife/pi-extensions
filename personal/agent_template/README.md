# agent_template

个人 fabric FabricProvider：把 `~/.pi/agent/agents/*.md`（pi-subagents 约定的声明式 subagent 配置）目录化、可发现，供模型在 fabric_exec 沙箱内按任务路由不同 model 执行。

## 架构：配置/路由/执行分离

fabric 扩展面的 `FabricInvocationContext` 没有 agents/mesh 句柄，外部 provider 触达不到 fabric 的 agents 运行时。因此三层分离：

| 层 | 负责 | 位置 |
| --- | --- | --- |
| 配置 | 只读 `agents/*.md`，目录化与可发现 | 本 provider（`list`/`describe`/`invoke`） |
| 路由 | 经 `tools.catalog()` 发现 agent，按任务选 | 模型在 fabric_exec 沙箱内 |
| 执行 | `agents.run` 跑选中 agent | 模型在 fabric_exec 沙箱内 |

provider 只做配置读取，不执行--保留 fabric 的 transport / worktree / handoff / 审批 / 预算 / 递归全部能力。

## 两步模式

```ts
// 1. 路由到 agent（直接按名，等价 profile({name})，少一次调用）
const p = await tools.call({ ref: "agent_template.reviewer", args: { task } });
// 2. 沙箱内执行
return agents.run({
  model: p.model, thinking: p.thinking, tools: p.tools,
  task: p.prompt + "\n\n## Task\n" + task,
});
```

详见包内技能 `skills/agent-template/SKILL.md`（model-invoked，sync 后进 `~/.pi/agent/skills/`）。

## 暴露的 actions

- `profile({ name })` -> 返回 `{ model, thinking, tools, prompt }`（risk=read）
- `agent_template.<name>({ task })` -> 每个 agent 一个 action，等价 profile（按名直接路由）

## pi-fabric 依赖

零运行时依赖：`import type` 擦除 + 事件名常量硬编码。pi-fabric 在 devDependencies（类型检查用，sync 用 `--omit=dev` 不装）。fabric 不存在时 emit 无监听者、DISCOVER 不触发，扩展 no-op。

## 测试

唯一 seam 是 frontmatter 解析纯逻辑（`extensions/agent-logic.ts`），无 pi 依赖：

```bash
npx tsx --test personal/agent_template/test/agent-logic.test.ts
```

类型检查（需先 `npm install` 装 devDeps）：

```bash
cd personal/agent_template && ./node_modules/.bin/tsc --noEmit -p tsconfig.json
```

## 同步

```bash
node scripts/sync-personal.mjs
```

软链 `personal/agent_template` 到 `~/.pi/agent/extensions/agent_template`，并软链 `skills/agent-template` 到 `~/.pi/agent/skills/agent-template`。

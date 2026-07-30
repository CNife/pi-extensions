# Pi Extension Development

## Package Structure

```text
packages/<name>/
├── package.json          # name: @cnife/pi-<name>
├── README.md
└── extensions/
    └── <name>.ts         # Or index.ts
```

## Registration

- **Extensions**: `"pi": {"extensions": ["./extensions"]}` in package.json
- **Skills**: `"pi": {"skills": ["./skills"]}` — SKILL.md files

## Default Export

```typescript
export default function (pi: ExtensionAPI) {
  const config = loadConfig();
  if (!config) {
    pi.on("session_start", (_event, ctx) => {
      ctx.ui.setStatus("key", ctx.ui.theme.fg("error", "msg"));
    });
    return;
  }
  pi.on("turn_end", async (event, ctx) => { ... });
}
```

## API Reference

| API | Purpose | Notes |
|-----|---------|-------|
| `pi.on(event, handler)` | Event registration | session_start, turn_end, message_end, input |
| `pi.registerTool(tool)` | LLM-callable tool | defineTool() from @earendil-works/pi-ai |
| `pi.registerCommand(name, opts)` | Slash command | /name, handler receives ExtensionCommandContext |
| `pi.setSessionName(name)` / `getSessionName()` | Session title | Writes SessionInfoEntry to session JSONL |
| `pi.appendEntry(type, data)` | Persistent metadata | CustomEntry, NOT visible to LLM |
| `ctx.sessionManager.getBranch()` | Walk session tree | Root → leaf, all entry types |
| `ctx.modelRegistry.find(provider, id)` | Resolve model | Returns Model<Api> or undefined |
| `ctx.modelRegistry.getApiKeyAndHeaders(model)` | Get auth | Must check `auth.ok` before use |
| `completeSimple(model, context, opts)` | LLM call | From @earendil-works/pi-ai, never throws, check stopReason |

## Dependency Pattern

```json
{
  "peerDependencies": { "@earendil-works/pi-coding-agent": "*" }
}
```

## Config Management

```typescript
const CONFIG_PATH = join(getAgentDir(), "cnife-<name>.json");
```

Three-level validation: file I/O → JSON parse → type check. Missing file auto-creates defaults. Failure → console.warn + fallback defaults.

## Conventions

- **Peer dependencies** only, not runtime dependencies - exceptions: `@cnife/pi-nmem` (spec #88) and `@cnife/pi-prune-context` (spec #138) pull in `@toon-format/toon` as a runtime dependency for TOON encoding; all other extensions remain peer-only
- **Event-driven** over command-driven when possible
- **Chinese commit messages**, no conventional commit prefixes
- **Double quotes, 2-space indent** (Biome enforced)
- **Version bumps**: 更新 `package.json` 版本号时，必须同时更新 `package-lock.json`（`npm install` 会自动同步）
- **Local testing**: `pi -ne -ns -e packages/<pkg>/extensions/<file>.ts`
- **Presentation cards** (`docs/presentation-cards/`): 独立宣传物料，不随插件实现改动同步更新；如需更新展示卡，单独决策

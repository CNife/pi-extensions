# Pi Extension Development

## Package Structure

```text
packages/<name>/
├── package.json          # name: @cnife/pi-<name>, pi.extensions: ["./extensions"]
├── README.md
└── extensions/
    └── <name>.ts         # Or index.ts — single entry point
```

## Registration

- **Extensions**: `"pi": {"extensions": ["./extensions"]}` — default export `(pi: ExtensionAPI) => void`
- **Skills**: `"pi": {"skills": ["./skills"]}` — SKILL.md files with frontmatter

## Default Export Pattern

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

## API Surface

| API | Purpose | Example |
|-----|---------|---------|
| `pi.on(event, handler)` | Event registration | `session_start`, `turn_end`, `message_end` |
| `pi.registerTool(tool)` | LLM-callable tool | `execute-python` |
| `pi.registerCommand(name, opts)` | Slash command | `simple-plannotator` |
| `pi.setSessionName(name)` | Set session title | `auto-naming-session` |
| `pi.getSessionName()` | Get current title | Manual-protection check |
| `pi.appendEntry(type, data)` | Persist metadata (not LLM-visible) | Title tracking |
| `ctx.sessionManager.getBranch()` | Walk session tree | State reconstruction |
| `ctx.modelRegistry.find()` | Resolve model | LLM calls |
| `ctx.modelRegistry.getApiKeyAndHeaders()` | Get auth | Must check `auth.ok` |
| `ctx.ui.setStatus(key, text)` | Footer display | Status line |
| `ctx.ui.notify(msg, severity)` | User notification | Error/warning display |

## Dependency Pattern

```json
{
  "peerDependencies": { "@earendil-works/pi-coding-agent": "*" }
}
```

No runtime dependency on `@earendil-works/pi-ai` (transitive via pi-coding-agent). Use peerDependencies, NOT dependencies, for the host platform.

## Config Management

```typescript
const CONFIG_PATH = join(getAgentDir(), "cnife-<name>.json");
```

Three-level validation: file I/O → JSON parse → type check. Missing file auto-creates defaults. Validation failure → console.warn + fallback defaults.

# pi-extensions Monorepo

## Architecture

npm workspaces monorepo (`packages/*`), `@cnife/*` namespace. TypeScript (ES2022, strict mode), Biome lint/format, Husky pre-commit.

## Key Conventions

- **Code only in `packages/`**: Root config only (package.json, tsconfig.json, biome.json)
- **Double quotes, 2-space indent** (Biome enforced)
- **Chinese commit messages**, no conventional commit prefixes
- **No bundler**: Extensions loaded via jiti at runtime
- **Local testing**: `pi -ne -ns -e packages/<pkg>/extensions/<file>.ts`

## Build & CI

- `npx biome check ./packages` — lint + format check
- GitHub Actions on push to main: npm publish with provenance, auto-skips already-published versions
- Husky pre-commit runs lint-staged: biome check --write (ts), rumdl fmt (md), npm install --package-lock-only (package.json)

## Change Workflow

`grill → plan → plan-to-tasks → write-code → check-work`

Changes live in `changes/YYYYMMDD-<slug>/`, dual-agent model (executor + reviewer) via checkpoint files. See `docs/cnife-pi-workflow.md`.

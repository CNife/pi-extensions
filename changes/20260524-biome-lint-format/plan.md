# 变更方案

## 目标

为项目添加 Biome 进行 linting 和格式化，并配置 pre-commit 钩子以确保代码质量。

## 背景

当前项目缺少 lint 和 format 工具，代码风格不一致，没有自动化的质量检查。需要引入工具链来统一代码风格，并在提交前自动检查。

## 最终方案

1. **安装 Biome**：一个工具同时处理 linting 和格式化，配置简单，速度快。
2. **配置 Biome**：使用默认配置，调整缩进为 2 空格，引号为双引号。
3. **添加 package.json scripts**：提供 `lint`、`lint:fix`、`format`、`check` 命令。
4. **安装 Husky**：管理 Git 钩子。
5. **安装 Lint-staged**：只对暂存文件运行检查，提高效率。
6. **配置 pre-commit 钩子**：在提交前运行 `npx lint-staged`，对 TypeScript 文件运行 `biome check --write`，对 Markdown 文件运行 `rumdl fmt`。

## 关键决策

| # | 决策 | 理由 |
|---|------|------|
| 1 | 选择 Biome 而不是 ESLint + Prettier | Biome 简单、快速，一个工具解决两个问题，适合小型项目。 |
| 2 | 使用 Husky + Lint-staged 管理 pre-commit | Husky 是 Node.js 项目管理 Git 钩子的标准工具，L lint-staged 只检查暂存文件，避免全项目扫描。 |
| 3 | Biome 只检查 `extensions/` 和 `skills/` 目录 | Biome v2 不支持 Markdown，`changes/` 只含 `.md` 文件无需纳入。 |
| 4 | TypeScript 用 Biome，Markdown 用 rumdl | **关键发现**：Biome v2 不支持 Markdown 格式化，rumdl 是 Rust 实现的 Markdown linter+formatter。 |
| 5 | Markdown 格式化范围为全部 `**/*.md` | Markdown 格式化轻量无副作用，不限目录。 |

## 用语

- **lint**：代码静态分析，检查潜在错误和风格问题。
- **format**：代码格式化，统一缩进、引号等风格。
- **pre-commit**：Git 提交前运行的钩子，用于自动检查代码质量。

## 假设

- 假设项目希望使用双引号和 2 空格缩进（可通过 Biome 配置调整）。
- Biome 检查 `extensions/` 和 `skills/` 目录的 `.ts` 文件，rumdl 格式化全部 `.md` 文件。
- 假设 pre-commit 钩子只运行 lint-staged，不运行其他检查。

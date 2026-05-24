---
status: 完成
priority: 中
depends_on: [T04-安装Husky和Lint-staged依赖]
---
# T06: 配置 lint-staged

**目标**：在 package.json 中添加 lint-staged 配置，指定对 TypeScript 文件运行 `biome check --write`，对 Markdown 文件运行 `biome format --write`。

**涉及文件**：
- `package.json`（lint-staged 配置）

**验证方式**：
```bash
# 检查 package.json 中的 lint-staged 配置
cat package.json | grep -A 10 "lint-staged"

# 应看到 TypeScript 和 Markdown 的配置
```
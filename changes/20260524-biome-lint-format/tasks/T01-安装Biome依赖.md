---
status: 完成
priority: 高
depends_on: []
---
# T01: 安装 Biome 依赖

**目标**：安装 Biome 作为开发依赖，确保 linting 和格式化工具可用。

**涉及文件**：
- `package.json`（依赖项）
- `package-lock.json`（自动生成）

**验证方式**：
```bash
npx biome --version
# 应输出 Biome 版本号，如 @biomejs/biome 1.x.x
```
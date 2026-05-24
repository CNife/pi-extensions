---
status: 完成
priority: 中
depends_on: []
---
# T04: 安装 Husky 和 Lint-staged 依赖

**目标**：安装 Husky 和 Lint-staged 作为开发依赖，为 pre-commit 钩子做准备。

**涉及文件**：
- `package.json`（依赖项）
- `package-lock.json`（自动生成）

**验证方式**：
```bash
npx husky --version
npx lint-staged --version

# 应输出版本号
```
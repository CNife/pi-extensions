---
status: 完成
priority: 中
depends_on: [T04-安装Husky和Lint-staged依赖]
---
# T05: 初始化 Husky

**目标**：初始化 Husky，创建 .husky 目录和 pre-commit 文件，配置 pre-commit 钩子运行 lint-staged。

**涉及文件**：
- `.husky/pre-commit`（新建）
- `package.json`（添加 prepare 脚本）

**验证方式**：
```bash
# 检查 .husky 目录和 pre-commit 文件
ls -la .husky/
cat .husky/pre-commit

# 文件应包含 npx lint-staged
```
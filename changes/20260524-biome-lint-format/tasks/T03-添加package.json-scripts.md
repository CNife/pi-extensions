---
status: 完成
priority: 高
depends_on: [T01-安装Biome依赖]
---
# T03: 添加 package.json scripts

**目标**：在 package.json 中添加 lint、lint:fix、format、check 脚本，方便运行 Biome 命令。

**涉及文件**：
- `package.json`（scripts 字段）

**验证方式**：
```bash
# 检查 scripts 是否添加
npm run

# 应看到 lint、lint:fix、format、check 脚本
```
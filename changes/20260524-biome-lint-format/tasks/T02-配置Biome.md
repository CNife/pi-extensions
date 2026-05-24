---
status: 完成
priority: 高
depends_on: [T01-安装Biome依赖]
---
# T02: 配置 Biome

**目标**：创建 Biome 配置文件，设置缩进为 2 空格，引号为双引号，并指定检查范围。

**涉及文件**：
- `biome.json`（新建）

**验证方式**：
```bash
# 检查配置文件是否存在
cat biome.json

# 验证配置内容（应包含 formatter 和 linter 配置）
npx biome check --help  # 确保 biome 命令可用
```
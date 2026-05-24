---
status: 完成
priority: 中
depends_on: [T05-初始化Husky, T06-配置lint-staged]
---
# T07: 测试 pre-commit 钩子

**目标**：端到端测试 pre-commit 钩子，确保提交前自动运行 lint-staged。

**涉及文件**：
- 无（测试过程创建临时文件）

**验证方式**：
```bash
# 1. 创建临时 TypeScript 文件
echo 'console.log("test")' > test.ts

# 2. 暂存文件
git add test.ts

# 3. 提交（应触发 pre-commit 钩子）
git commit -m "test: 验证 pre-commit 钩子"

# 4. 检查钩子是否运行（应看到 biome 输出）
# 5. 清理
git reset HEAD~1
rm test.ts
```
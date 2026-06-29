# 排查与测试指南

AI 排查本仓库 bug 及本地测试扩展时的速查手册。

## 命令 → 代码

```text
rg 'registerCommand\("命令名"' packages/ -t ts
```

例：查 `/pna` 的实现 → `rg 'registerCommand\("pna"' packages/ -t ts`

## 参数流转

用户在 pi 中输入 `/pna "/mnt/c/foo.md"` 时：

1. pi 解析命令行，把 `/mnt/c/foo.md`（含引号）作为 `args` 字符串传入 handler
2. handler 中 `args` 值可能是 `"/mnt/c/foo.md"`（shell 引号未被剥离）
3. 路径处理时需防御性 strip 首尾引号

---

## 扩展本地测试

### 隔离加载（推荐）

开发阶段用 `--no-extensions -e` 精确控制只加载被测扩展，排除其他扩展干扰：

```bash
pi --no-extensions --no-skills -e packages/<pkg>/extensions/<file>.ts --no-session
```

| 参数 | 作用 |
|------|------|
| `--no-extensions`, `-ne` | 禁用所有已安装扩展的自动发现 |
| `--no-skills`, `-ns` | 禁用技能加载（测试缓存扩展时不需要） |
| `-e <path>` | 显式加载指定扩展文件（可多次使用） |
| `--no-session` | 不保存会话（测试环境无需持久化） |

### 全量加载（上线前验证）

用符号链接让 pi 从本地工作目录加载，验证与其他扩展的交互：

```bash
ln -sf /home/cnife/code/pi-extensions ~/.pi/agent/git/github.com/CNife/pi-extensions
```

重启 pi 即加载最新代码。此方式与 `pi install git:github.com/CNife/pi-extensions` 的安装路径一致，pi 的扩展发现机制自动识别。

### npm 包冲突处理

如果扩展同时存在于 npm 安装路径和 extensions 目录（两个同名扩展都加载），会出现 footer / 状态冲突。
解决方法：

```bash
# 找到 npm 包中对应文件
find ~/.pi/agent/npm/node_modules -path "*<pkg-name>*" -name "*.ts"

# 用符号链接替换为本地最新代码
ln -sf $(pwd)/packages/<pkg>/extensions/<file>.ts \
  ~/.pi/agent/npm/node_modules/@cnife/<pkg>/extensions/<file>.ts
```

测试完成后**务必恢复**，否则后续 `pi update` 会覆盖符号链接。

### E2E 测试

隔离加载扩展 + 发送消息 + 验证 footer 的一站式流程，直接用 `extension-e2e-test` 技能（基于 herdr）。

### 配置文件测试

扩展配置文件路径由 `PI_CODING_AGENT_DIR` 环境变量决定，默认为 `~/.pi/agent`。可在脚本中重定向以隔离测试：

```bash
PI_CODING_AGENT_DIR=/tmp/test-pi pi -ne -e packages/<pkg>/extensions/<file>.ts
```

验证：

- 删除配置文件 → 重启自动创建默认值
- 写入非法 JSON → footer 应显示错误提示
- 修改配置项 → 重启后生效

### 编译检查

```bash
cd pi-extensions
npx tsc --noEmit packages/<pkg>/extensions/<file>.ts
```

## 模块依赖

本项目依赖 `@plannotator/pi-extension`（`package.json` 中声明）。该包通过 npm 安装到 `node_modules/`，pi 的 jiti 加载时按 Node 标准模块解析链查找。不需要手动 symlink。

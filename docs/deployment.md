# 部署原理

各子包独立发布到 npm，用户单独安装：

```bash
pi install npm:@cnife/pi-execute-python
# ...
```

`pi install npm:<package>` 的执行流程：

1. 下载 npm 包到 `~/.pi/agent/npm/node_modules/@cnife/<pkg>/`
2. pi 根据各包的 `package.json` 中的 `"pi"` 字段加载 `extensions/`、`skills/`、`prompts/`
3. 所有已安装包的资源在启动时合并发现

`pi update` 等价于对所有已安装包执行 `npm update`。

## 本地测试

开发阶段用 `-e` 临时加载，避免反复 install：

### 隔离加载（开发单包时，推荐）

```bash
pi --no-extensions -e packages/<pkg>/extensions/<file>.ts --no-session
```

### 全量加载（验证根 pi 包 / personal 扩展时）

仓库根本身是一个 pi 包（`package.json` 带 `pi` manifest，暴露 `personal/`）。临时加载整个仓库验证 personal 扩展共载：

```bash
pi --no-extensions -e . --no-session
```

完整流程与软链地雷警告见 `docs/troubleshooting.md` 扩展本地测试章节。

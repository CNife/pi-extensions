# 部署原理

各子包独立发布到 npm，用户单独安装：

```bash
pi install npm:@cnife/pi-cache-hit-rate
pi install npm:@cnife/pi-execute-python
# ...
```

`pi install npm:<package>` 的执行流程：

1. 下载 npm 包到 `~/.pi/agent/npm/node_modules/@cnife/<pkg>/`
2. pi 根据各包的 `package.json` 中的 `"pi"` 字段加载 `extensions/`、`skills/`、`prompts/`
3. 所有已安装包的资源在启动时合并发现

`pi update` 等价于对所有已安装包执行 `npm update`。

## 本地测试

开发阶段使用符号链接避免反复 install：

### 隔离加载（开发单包时，推荐）

```bash
pi --no-extensions -e packages/<pkg>/extensions/<file>.ts --no-session
```

### 全量加载（验证包间交互时）

```bash
ln -sf /home/cnife/code/pi-extensions ~/.pi/agent/git/github.com/CNife/pi-extensions
```

更多测试技巧见 `docs/troubleshooting.md` 扩展本地测试章节。

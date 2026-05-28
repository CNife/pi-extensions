# 排查指南

AI 排查本仓库 bug 时的速查手册。

## 命令 → 代码

```text
rg 'registerCommand\("命令名"' extensions/ -t ts
```

例：查 `/pna` 的实现 → `rg 'registerCommand\("pna"' extensions/ -t ts`

## 参数流转

用户在 pi 中输入 `/pna "/mnt/c/foo.md"` 时：

1. pi 解析命令行，把 `/mnt/c/foo.md`（含引号）作为 `args` 字符串传入 handler
2. handler 中 `args` 值可能是 `"/mnt/c/foo.md"`（shell 引号未被剥离）
3. 路径处理时需防御性 strip 首尾引号

## 本地测试

用符号链接指向当前工作目录，改完立即生效：

```text
ln -sf /home/cnife/personal_code/pi-extensions ~/.pi/agent/git/github.com/CNife/pi-extensions
```

重启 pi 即加载最新代码。验证通过后正常 `git commit` + `git push`。

## 模块依赖

本项目依赖 `@plannotator/pi-extension`（`package.json` 中声明）。该包通过 npm 安装到 `node_modules/`，pi 的 jiti 加载时按 Node 标准模块解析链查找。不需要手动 symlink。

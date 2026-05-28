# 部署原理

```text
pi install git:github.com/CNife/pi-extensions
```

1. clone 到 `~/.pi/agent/git/github.com/CNife/pi-extensions/`
2. `npm install` 安装依赖
3. pi 根据 `package.json` 的 `"pi"` 字段加载 `extensions/`、`skills/`、`prompts/`

`pi update` 等价于 git pull + npm install。

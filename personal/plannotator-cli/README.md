# plannotator-cli

基于 [Plannotator](https://github.com/backnotprop/plannotator) 的浏览器审阅/标注 pi 扩展（personal 层），注入三个斜杠命令。OMP 同名插件（`omp-extensions/plugins/plannotator-cli`）的 pi 移植，包目录同名便于对照。

直接调用 `plannotator` CLI 二进制（CLI shell-out），不依赖 `@plannotator/pi-extension` npm 包：
官方扩展用 `deliverAs: "followUp"` 投递反馈，只入队不启动回合（反馈断链）；CLI 方案反馈
直接经 `pi.sendUserMessage` 发送，无 npm 依赖、无 HTML 资产、无进程内 server。

与 `archive/simple-plannotator`（已废弃的旧 npm 方案）的关系：`simple-plannotator` 是旧版
基于浏览器的 npm 扩展（`@cnife/pi-simple-plannotator`），已退役归档；本扩展是 CLI shell-out
替代方案，功能等价、零 npm 依赖。

## 前置条件

安装 `plannotator` 命令行工具（≥ 0.25.1，建议最新）：

```bash
# macOS / Linux / WSL
curl -fsSL https://plannotator.ai/install.sh | bash
```

## 命令

| 命令 | 说明 |
| --- | --- |
| `/pnr [url]` | 在浏览器中审阅本地 git 变更，或传入 GitHub PR / GitLab MR URL |
| `/pna <path>` | 在浏览器中标注 Markdown 文件、文件夹或 URL（HTML 文件按原始渲染） |
| `/pnl` | 标注当前会话中最后一条 AI 消息（内容经 stdin 传入，无临时文件） |

在浏览器中标注后，反馈作为用户消息直接发回 agent（立即触发处理回合）；无反馈时仅通知关闭。
`/pnl` 的反馈会附加说明前缀（“这是对你上一条助手消息的标注反馈”），因为标注载体是会话内
消息、反馈本身不含文件名，不加说明会让 AI 困惑“文件在哪”。

## 安装 / 分发

本扩展在 personal 层，随 monorepo 根 pi 包分发（git 包机制，不进 npm workspaces、不发布）：

```bash
pi install git:github.com/CNife/pi-extensions   # 首次安装（不 pin ref，跟踪 main）
pi update --extensions                          # 各机拉新
```

本地开发（隔离加载，不写入 settings、不影响已装扩展）：

```bash
pi --no-extensions -e personal/plannotator-cli
```

## 实现说明

- `/pnr` → `plannotator review [url]`（stdout 为纯文本反馈）
- `/pna` → `plannotator annotate <target> --json`（解析决策 JSON 提取 `feedback`；文件夹自动
  扫描，HTML 不传 `--markdown` 即原始渲染，URL 直接抓取）
- `/pnl` → `plannotator annotate-last --stdin --json`（上一条 assistant 消息内容经 stdin 传入；
  从 `ctx.sessionManager` 的 `getBranch` 取条目，缺省时回退 `getEntries`）

进程非阻塞：命令立即返回，浏览器关闭后异步将反馈发回 agent。反馈经工厂捕获的
`pi.sendUserMessage` 直接投递（省略 `deliverAs`：pi 语义下空闲时立即投递并触发回合；
`ExtensionCommandContext` 不含 `sendUserMessage`，官方命令处理器路径即 `pi.sendUserMessage`，
见 `docs/extensions.md`）。

## 稳健性设计

依据 OMP deadlock 复测报告（wayfinder #43/#44）：

1. **spawn 必设 `BROWSER=none PLANNOTATOR_BROWSER=none`**：v0.26.7 存在罕见（~1-3%）关闭期挂起
   （stdout 已写完整 JSON 但进程不退出），全部出现在未抑制浏览器（WSL2 `cmd.exe /c start`）的
   运行中；抑制后 0/89 次挂起。
2. **stdout JSON 完整即成功**：`/pna` `/pnl` 读到完整决策 JSON 立即投递反馈并回收进程，不等
   `exited`，残余挂起对用户体验零影响。
3. **超时兜底**：默认 30min（环境变量 `PLANNOTATOR_FEEDBACK_TIMEOUT_MS` 可覆盖），到点 kill
   进程；若 stdout 已有内容仍投递，否则通知用户重试。
4. **`PLANNOTATOR_AI=disabled` 默认注入**：避免 CLI 派生嵌套 `pi --mode rpc` 子进程（AI 模型
   发现探针）；用户显式设置 `PLANNOTATOR_AI` 时尊重用户值。
5. **会话关闭兜底**：反馈/通知在异步路径投递，若会话已关闭（print 模式命令后立即退出、
   用户退出、reload——pi 的 runner 会以 stale 错误拒绝 ctx 访问），`safeNotify`/`deliver`
   吞掉并记录日志，不把未处理异常炸到进程级。

## 测试

```bash
# 仓库根（vitest 已配 personal include）
npm test
# 或只跑本包
npx vitest run personal/plannotator-cli
```

用 stub CLI（`test/fixtures/plannotator`，经 PATH 前缀注入）替换真实二进制，覆盖：命令注册、
参数构造、路径归一化、stdin 内容、spawn 环境强制项、反馈直接投递（无 deliverAs）、json 完整
即投递、超时兜底、错误与无反馈通知。

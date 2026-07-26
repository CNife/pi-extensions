# personal 分层、按条目同步与 miscs 退役

## 背景

仓库里的 pi 扩展实际分成两类，但目录与流程没有对应分层：

1. **产品**：认真做成安装包，别人 `pi install` 能用，愿付版本与文档税。
2. **个人向**：可公开参考、多机同步，但不值得单独做安装包。

现状只有 `packages/`（发布）和 `archive/`（退役产品）。个人扩展散落在本机扩展目录，无 git 历史、难同步。`@cnife/pi-miscs` 把小工具做成安装包后装上即全量加载，不适合继续当杂项桶。

本机顾问适配器有真实价值（流式调用 + 自定义渲染），但依赖深路径且不能原样当产品包。

## 决定

### 三层目录

| 层 | 目录 | 进门条件 |
| --- | --- | --- |
| 产品 | `packages/` | 独立可叙述价值、安装面干净、依赖走公开面、愿付版本与文档税 |
| 个人 | `personal/` | 与 pi 全局扩展目录同构；不进 workspaces；不 publish |
| 退役 | `archive/` | 只收曾为产品、现停更的包 |

`personal/` **不是** lab/示例集第二命名；新产品不得误扔进 personal，personal 也不得进发布流水线。

### 按条目同步（加载分叉丙）

`scripts/sync-personal.mjs` 扫描 `personal/` 顶层：

- **文件型**（`*.ts`）：软链到 `~/.pi/agent/extensions/`。
- **包型**（子目录含 `package.json`）：在目录内安装依赖，并将**绝对路径**写入 settings `packages`；**禁止**再软链同一条目。
- 绝不整树替换全局扩展目录，以便 herdr 等 local-only 文件继续留在本机且不进 git。
- 对已存在的非链接冲突失败并提示。

### pi 本地安装与依赖（实现修正）

issue 原文假设「本地路径 `pi install` 会装依赖」。对照当前
`@earendil-works/pi-coding-agent` 的 `DefaultPackageManager.install()`：
对 `type === "local"` 仅校验路径存在后返回，**不**调用 `npm install`。
npm/git 源才会 `--omit=dev` 安装。

因此：**包型依赖安装由同步脚本负责**（`npm install --omit=dev --omit=peer`），
`pi install <path>` / 直接写 settings 只负责注册加载路径。此修正记入 personal README 与 issue 评论。

### miscs 两阶段退役

1. **阶段一**（包仍在 `packages/`）：patch +1、description 加 `[Deprecated]`、README 废弃横幅；合入默认分支发最终废弃版；registry 确认。
2. **阶段二**（阶段一 publish 成功之后）：`git mv` 入 `archive/`、根 README 去掉该包（**不**新建 Deprecated 表）、archive 表加行、打 `retired-miscs-<date>` tag、更新 lock。

两个小工具（exit、debug-request-body）在归档前后落位于 `personal/`，自用不断档。

### 顾问小包

- 形态：`personal/advisor-adapter/` 文件夹小包，`dependencies` 声明 `@juicesharp/rpiv-advisor`。
- 入口代理 `registerTool`：拦截 advisor 工具，注入流式 execute + renderCall/renderResult；原 factory 其余命令与生命周期透传。
- settings：**移除**原版顾问独立扩展条目；依赖仅在小包 `node_modules`，原 factory 当库调用。
- **脆点**：不得不 deep-import 上游内部模块（`advisor/messages.ts` 等）。上游内部 API **无兼容承诺**；可工作但不稳定。

### 不进仓

dcg-guard、herdr 状态/生成物、subagent 残留配置、密钥与会话数据。

## 原因

- 目录表达产品 vs 个人 vs 退役，避免每次新扩展争论放哪。
- 个人树进 git → 多机拉仓 + 跑脚本即可；按条目软链保留 local-only。
- 包型走本地路径注册 + 脚本装依赖，避免「扩展碰巧躺在 agent 目录旁」的相对深路径。
- miscs 退役给 registry 最终废弃信号，源码进 archive 可查。

## 考虑过的选项

- **整树把 `extensions/` 指到 personal**：rejected——会吞掉/覆盖 herdr 等 local-only。
- **personal 也进 workspaces / 发布**：rejected——付发布税，违背分层。
- **lab 命名**：rejected——已拍板 `personal`。
- **顾问做成 @cnife 产品包或推上游**：out of scope。
- **仅软链顾问适配器、继续相对深 import 全局 npm**：rejected 作为正式方案——不可复现；改为包依赖（内部 deep import 仍标明脆点）。

## 后果

- 根 README / AGENTS / CONTEXT 需写清三层进门规则。
- CI 不碰 `personal/`（不在 workspaces 通配内）。
- 换机器：clone + `node scripts/sync-personal.mjs`；包型会在本机 `personal/*/node_modules` 装依赖（gitignore）。
- 上游 rpiv-advisor 内部路径变更时，顾问小包可能坏，需跟进。
- miscs 用户在 npm 上看到 Deprecated 说明后改走 personal 或自备。

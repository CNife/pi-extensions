# personal 分层、按条目同步与 miscs 退役

## 背景

仓库里的 pi 扩展实际分成两类，但目录与流程没有对应分层：

1. **产品**：认真做成安装包，别人 `pi install` 能用，愿付版本与文档税。
2. **个人向**：可公开参考、多机同步，但不值得单独做安装包。

现状只有 `packages/`（发布）和 `archive/`（退役插件）。个人扩展散落在本机扩展目录，无 git 历史、难同步。`@cnife/pi-miscs` 把小工具做成安装包后装上即全量加载，不适合继续当杂项桶。

本机顾问适配器有真实价值（流式调用 + 自定义渲染），但依赖深路径且不能原样当产品包。

## 决定

### 三层目录

| 层 | 目录 | 进门条件 |
| --- | --- | --- |
| 产品 | `packages/` | 独立可叙述价值、安装面干净、依赖走公开面、愿付版本与文档税 |
| 个人 | `personal/` | 与 pi 全局扩展目录同构；不进 workspaces；不 publish |
| 退役 | `archive/` | 收停用插件：曾为产品的包，或不再需要的个人扩展 |

（2026-08-01 更新：archive 放宽为也收 personal 层停用的扩展，先例 `sh-guard.ts`、`agent_template`。）

`personal/` **不是** lab/示例集第二命名；新产品不得误扔进 personal，personal 也不得进发布流水线。

### 按条目同步（软链同构）

`scripts/sync-personal.mjs` 扫描 `personal/` 顶层，一律软链进 `~/.pi/agent/extensions/`：

- **文件型**（`*.ts`）：软链文件。
- **包型**（子目录含 `package.json`）：先在目录内 `npm install`，再软链**整个目录**。
- 绝不整树替换全局扩展目录，以便 herdr 等 local-only 文件继续留在本机且不进 git。
- 对已存在的非链接冲突失败并提示。
- **不修改** `settings.json`。pi 会自动发现 `extensions/` 下的包目录（并跳过 `node_modules`）。

issue 原文「加载分叉丙」曾要求包型走 settings 本地路径、禁止软链。本机验证后：目录软链即可被 pi 加载，改 settings 无必要；双加载风险来自「settings 与 extensions 同时挂同一包」，只软链则无此问题。以 territory 为准回写。

### 依赖安装

issue 原文假设「本地路径 `pi install` 会装依赖」。对照当前
`@earendil-works/pi-coding-agent` 的 `DefaultPackageManager.install()`：
对 `type === "local"` 仅校验路径存在后返回，**不**调用 `npm install`。

因此：**包型依赖安装由同步脚本负责**（`npm install --omit=dev --omit=peer`），
软链只负责让 pi 发现入口。依赖落在 `personal/<pkg>/node_modules`（gitignore）。

### miscs 两阶段退役

1. **阶段一**（包仍在 `packages/`）：patch +1、description 加 `[Deprecated]`、README 废弃横幅；合入默认分支发最终废弃版；registry 确认。
2. **阶段二**（阶段一 publish 成功之后）：`git mv` 入 `archive/`、根 README 去掉该包（**不**新建 Deprecated 表）、archive 表加行、打 `retired-miscs-<date>` tag、更新 lock。

两个小工具（exit、debug-request-body）在归档前后落位于 `personal/`，自用不断档。

### 顾问小包

- 形态：`personal/advisor-adapter/` 文件夹小包，`dependencies` 声明 `@juicesharp/rpiv-advisor`；软链到 `extensions/advisor-adapter`。
- 入口代理 `registerTool`：拦截 advisor 工具，注入流式 execute + renderCall/renderResult；原 factory 其余命令与生命周期透传。
- 不要在 settings 再挂原版顾问独立扩展；依赖仅在小包 `node_modules`，原 factory 当库调用（用户自行 `pi remove` 旧条目）。
- **脆点**：不得不 deep-import 上游内部模块（`advisor/messages.ts` 等）。上游内部 API **无兼容承诺**；可工作但不稳定。

### 不进仓

dcg-guard、herdr 状态/生成物、subagent 残留配置、密钥与会话数据。

## 原因

- 目录表达产品 vs 个人 vs 退役，避免每次新扩展争论放哪。
- 个人树进 git → 多机拉仓 + 跑脚本即可；按条目软链保留 local-only。
- 包型软链目录 + 脚本装依赖，import 走包内 `node_modules`，避免「扩展碰巧躺在 agent 目录旁」的相对深路径。
- miscs 退役给 registry 最终废弃信号，源码进 archive 可查。

## 考虑过的选项

- **整树把 `extensions/` 指到 personal**：rejected——会吞掉/覆盖 herdr 等 local-only。
- **personal 也进 workspaces / 发布**：rejected——付发布税，违背分层。
- **lab 命名**：rejected——已拍板 `personal`。
- **顾问做成 @cnife 产品包或推上游**：out of scope。
- **settings 注册本地路径、禁止软链包目录**（issue 分叉丙）：rejected——本机验证目录软链即被 pi 发现，改 settings 多余，且易与 extensions 双挂。
- **仅软链单文件适配器、继续相对深 import 全局 npm**：rejected 作为正式方案——不可复现；改为包目录 + 包依赖（内部 deep import 仍标明脆点）。

## 后果

- 根 README / AGENTS / CONTEXT 需写清三层进门规则。
- CI 不碰 `personal/`（不在 workspaces 通配内）。
- 换机器：clone + `node scripts/sync-personal.mjs`；包型会在本机 `personal/*/node_modules` 装依赖（gitignore）。
- 上游 rpiv-advisor 内部路径变更时，顾问小包可能坏，需跟进。
- miscs 用户在 npm 上看到 Deprecated 说明后改走 personal 或自备。

## 修订：分发机制（软链 -> monorepo git 包）

> 2026-08-02：`scripts/sync-personal.mjs` 软链方案整体退役。本段取代上文「按条目同步」「依赖安装」两节及「后果」中「换机器」一条。

### 背景

软链方案的根本问题：软链指向**本机绝对路径**，每台机器都要维护仓库克隆 + 记得 `git pull` + 手动跑同步脚本，常忘，导致各机 personal 扩展版本漂移；包型依赖安装也由脚本负责，同样会忘。

### 决定

把 monorepo 根本身变成一个 pi 包：根 `package.json` 增加 `pi` manifest（只暴露 `personal/` 下资源）与一条运行时依赖 `@juicesharp/rpiv-advisor`。所有机器（含主力开发机）改用 pi 原生 git 包机制：

```bash
pi install git:github.com/CNife/pi-extensions   # 不 pin ref，跟踪 main
pi update --extensions                          # 各机拉新
```

- **根 manifest**：`extensions: ["personal/*.ts", "personal/*/extensions"]`、`skills: ["personal/*/skills"]`。`personal/*.ts` 收文件型条目；`personal/*/extensions` 收包型条目的扩展目录（pi glob 匹配目录后按约定扫 `.ts`）；`personal/*/skills` 收 nmem-lite 技能。`packages/` 产品包不被根包暴露，无双加载。
- **依赖**：pi 装 git 包时只在克隆根跑一次 `npm install`，npm 只认根依赖与 workspaces；personal 不进 workspaces（分层不变）。`@juicesharp/rpiv-advisor` 是唯一真实运行时依赖，声明在根 `dependencies`，落在克隆根 `node_modules`；`advisor-adapter` 的 deep-import 沿目录向上解析到根 `node_modules`。`@earendil-works/*` 仍全走 peerDependencies。
- **`personal/*/package.json` 保留**（本地 `pi -e personal/<pkg>` 隔离开发用），但其 `pi` manifest 在 git 包模式下不生效--git 包只有根 manifest 生效，无嵌套发现。
- **不 pin ref**：仓库 public，https 免认证。freshness 由 `pi update --extensions` 保证（机制上限：push + update 才生效，接受延迟）。
- **根 `package.json` 不带 `pi-package` keyword**：monorepo 不进公共 package gallery。
- **`scripts/sync-personal.mjs` 及其测试删除**（git 历史保留）；不归档（archive 收停用插件，脚本不是插件）。

### thinking-fold 布局归一

`thinking-fold`（PR #146，本修订前新增）原本入口在包根 `./index.ts`，与 `advisor-adapter`/`nmem-lite` 的 `extensions/` 约定不一致，会被根 manifest glob `personal/*/extensions` 漏掉。本次将其归一：`index.ts` 移入 `extensions/`，`./renderer.ts` 改 `../renderer.ts`，自身 manifest 改 `["./extensions"]`。属结构归一，非功能改动。

### 本机迁移（地雷）

`~/.pi/agent/git/github.com/CNife/pi-extensions` 旧的全量加载技巧是指向开发克隆的软链。pi 更新 git 包时会 `reset --hard` + clean 克隆；若顺软链操作会毁掉开发克隆未提交的工作。故 `pi install` 前**必须先删**该软链，并清掉 `~/.pi/agent/extensions/` 下所有指向 `personal/` 的软链（文件型 exit / stash-input / debug-request-body，包型 advisor-adapter / nmem-lite / thinking-fold）与 `~/.pi/agent/skills/` 下 nmem 技能软链，避免双加载。其他机器无旧软链，直接 install。

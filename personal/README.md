# personal/

个人扩展树：随 monorepo 根 pi 包（git 安装）分发，**不进** npm workspaces、**不**发布。根 [`package.json`](../package.json) 的 `pi` manifest 只暴露 `personal/` 下资源（文件型 `*.ts`、包型 `*/extensions`、技能 `*/skills`），`packages/` 里的产品包不会被根包重复加载。

产品包放 `packages/`；停用的插件（曾为产品的包、不再需要的个人扩展）放 `archive/`。本目录只收「可公开参考 / 多机自用、但不值得付发布税」的扩展。

## 分发

整个 monorepo 根本身就是一个 pi 包（`package.json` 带 `pi` manifest）。所有机器（含主力开发机）用 pi 原生 git 包机制安装：

```bash
pi install git:github.com/CNife/pi-extensions   # 不 pin ref，跟踪 main
pi update --extensions                          # 各机拉新
```

git 包不 pin ref 时，`pi update --extensions` 会拉取 main 最新。这是机制上限：push + update 才生效，接受这个延迟。与 `settings.json` 中已有的 `npm:` 产品包共存（npm 包装到 `~/.pi/agent/npm/`，git 包装到 `~/.pi/agent/git/<host>/<path>`，各自独立 module root，不互相污染）。

### 依赖

pi 安装 git 包时只在克隆根跑一次 `npm install`，npm 只认根依赖与 workspaces。因此唯一的真实运行时依赖 `@juicesharp/rpiv-advisor`（`advisor-adapter` 用）声明在**根** `package.json` 的 `dependencies`，落在克隆根 `node_modules`；`advisor-adapter` 的 deep-import 沿目录向上解析到根 `node_modules`。`@earendil-works/*` 仍全部走 peerDependencies（pi 运行时提供）。

`personal/*/package.json` 保留各自的 `pi` manifest，仅供本地 `pi -e personal/<pkg>` 隔离开发用；git 包模式下只有根 manifest 生效，无嵌套发现。`personal/*/node_modules` 由本地 `npm install` 维护（已 gitignore）；`personal/*/package-lock.json` 进仓以固定传递依赖。

### 本地开发

```bash
# 临时加载整个仓库（不写入 settings，不影响已装扩展）
pi --no-extensions -e .
# 隔离加载单个 personal 条目
pi --no-extensions -e personal/<pkg>
```

## 本机迁移（从旧软链方案）

旧方案用 `scripts/sync-personal.mjs` 把 personal 条目软链到 `~/.pi/agent/extensions/`。迁移到 git 包前**必须**先清掉软链残留，否则双加载：

1. 删除 `~/.pi/agent/extensions/` 下所有指向 `personal/` 的软链（文件型 `exit.ts` / `stash-input.ts` / `debug-request-body.ts`，包型 `advisor-adapter` / `nmem-lite` / `thinking-fold`）与 `~/.pi/agent/skills/` 下 nmem 技能软链（`save-thread` / `search-memory` / `distill-memory` / `read-working-memory` / `status`）；
2. **先于 install** 删除 `~/.pi/agent/git/github.com/CNife/pi-extensions` 处的旧软链（旧的全量加载技巧）--pi 更新 git 包时会 `reset --hard` + clean 克隆，若顺软链操作会毁掉开发克隆未提交的工作；
3. `pi install git:github.com/CNife/pi-extensions`。

其他机器没有旧软链，直接 `pi install` 即可。

## 当前内容

| 条目 | 类型 | 说明 |
| --- | --- | --- |
| `exit.ts` | 文件 | 输入 `exit` 退出会话（自 miscs） |
| `debug-request-body.ts` | 文件 | `PI_DEBUG_REQUEST_BODY` 门闩下写请求体（自 miscs） |
| `stash-input.ts` | 文件 | alt+s 暂存/恢复输入框文本：有内容时暂存并清空（已有暂存时需双击确认覆盖），空时恢复 |
| `advisor-adapter/` | 包 | 代理 `@juicesharp/rpiv-advisor`：流式 thinking/正文 + 自定义 header/footer 渲染 |
| `nmem-lite/` | 包 | nmem 会话自动同步 + 精简引导；召回/保存走官方 `nmem` CLI + 技能（替代 `npm:@cnife/pi-nmem`） |
| `thinking-fold/` | 包 | 推理块尾部预览 + 完成折叠 + Ctrl+T 展开（trace-only，基于 `@99percentpeople/pi-thinking-fold` 简化重写，替代 `npm:@99percentpeople/pi-thinking-fold`） |

## 不进仓（local-only 边界）

以下留在本机扩展目录，**不要**迁入本树：

- `dcg-guard.ts`（由 DCG 侧维护）
- `herdr-agent-state.ts` / herdr 生成物
- `subagent/` 残留配置（无入口）
- 密钥、会话数据

## 顾问小包

- 不要在 settings 里挂 `npm:@juicesharp/rpiv-advisor`；它只是根包的运行时依赖（根 `package.json` `dependencies`），原 factory 当库调用。
- **脆点**：适配器 deep-import 上游内部模块（`@juicesharp/rpiv-advisor/advisor/*`）。上游对这些路径**无兼容承诺**；上游大改时需跟进本包。
- **备选偏离**：若 advisor 深路径 import 无法解析到根 node_modules，把 `advisor-adapter` 摊平为 `personal/` 下单文件扩展。

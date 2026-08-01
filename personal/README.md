# personal/

个人扩展树：与 pi 全局扩展目录（`~/.pi/agent/extensions/`）**同构**，**不进** npm workspaces、**不**发布。

产品包放 `packages/`；停用的插件（曾为产品的包、不再需要的个人扩展）放 `archive/`。本目录只收「可公开参考 / 多机自用、但不值得付发布税」的扩展。

## 挂载

```bash
# 预览
node scripts/sync-personal.mjs --dry-run

# 写入本机
node scripts/sync-personal.mjs
```

脚本按**条目**软链到 `~/.pi/agent/extensions/`，绝不整树替换：

| 条目类型 | 判定 | 动作 |
| --- | --- | --- |
| 文件型 | 顶层 `*.ts` | 软链文件 |
| 包型 | 子目录含 `package.json` | 目录内 `npm install`，再软链**整个目录** |
| 包内技能 | 包型条目下 `skills/<sub>/SKILL.md` | 额外软链 `skills/<sub>` 到 `~/.pi/agent/skills/<sub>` |
| 其他 | `README.md`、无清单目录等 | 跳过 |

pi 会自动发现 `extensions/` 下的包目录（并跳过其 `node_modules`），**不必**把 personal 条目写进 `settings.json` 的 `packages`。

包型仍要在目录内装依赖：pi 对本地路径不会跑 `npm install`，由本脚本负责（`--omit=dev --omit=peer`）。

### 幂等与冲突

- 重复运行安全：已指向正确源的软链不动。
- 目标已存在且**不是**软链 → **失败并提示**，避免覆盖 herdr 等 local-only 文件。

### 与 settings 的边界

本脚本**不修改** `settings.json`。若仍安装着会被 personal 取代的 npm 包，请自行卸掉以免双加载，例如：

```bash
# 退役 miscs / 原版顾问后（若还在 packages 列表里）
pi remove npm:@cnife/pi-miscs
pi remove npm:@juicesharp/rpiv-advisor
# 被 nmem-lite 取代后
pi remove npm:@cnife/pi-nmem
```

原版顾问只应作为顾问小包的 `node_modules` 依赖存在，不要再当独立扩展安装。

## 当前内容

| 条目 | 类型 | 说明 |
| --- | --- | --- |
| `exit.ts` | 文件 | 输入 `exit` 退出会话（自 miscs） |
| `debug-request-body.ts` | 文件 | `PI_DEBUG_REQUEST_BODY` 门闩下写请求体（自 miscs） |
| `stash-input.ts` | 文件 | alt+s 暂存/恢复输入框文本：有内容时暂存并清空（已有暂存时需双击确认覆盖），空时恢复 |
| `advisor-adapter/` | 包 | 代理 `@juicesharp/rpiv-advisor`：流式 thinking/正文 + 自定义 header/footer 渲染 |
| `nmem-lite/` | 包 | nmem 会话自动同步 + 精简引导；召回/保存走官方 `nmem` CLI + 技能（替代 `npm:@cnife/pi-nmem`） |

## 不进仓（local-only 边界）

以下留在本机扩展目录，**不要**迁入本树：

- `dcg-guard.ts`（由 DCG 侧维护）
- `herdr-agent-state.ts` / herdr 生成物
- `subagent/` 残留配置（无入口）
- 密钥、会话数据

## 顾问小包

- 不要在 settings 里挂 `npm:@juicesharp/rpiv-advisor`；依赖只在本包 `node_modules`，原 factory 当库调用。
- **脆点**：适配器 deep-import 上游内部模块（`@juicesharp/rpiv-advisor/advisor/*`）。上游对这些路径**无兼容承诺**；上游大改时需跟进本包。

### 迁移旧 standalone 适配器

若本机仍有 `~/.pi/agent/extensions/advisor-adapter.ts`（文件）：

```bash
rm ~/.pi/agent/extensions/advisor-adapter.ts   # 或 mv 成 .bak
node scripts/sync-personal.mjs
```

同步后应出现目录软链：`extensions/advisor-adapter` → `personal/advisor-adapter`。

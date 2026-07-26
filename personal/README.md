# personal/

个人扩展树：与 pi 全局扩展目录（`~/.pi/agent/extensions/`）**同构**，**不进** npm workspaces、**不**发布。

产品包放 `packages/`；曾为产品、现停更的放 `archive/`。本目录只收「可公开参考 / 多机自用、但不值得付发布税」的扩展。

## 挂载

```bash
# 预览
node scripts/sync-personal.mjs --dry-run

# 写入本机
node scripts/sync-personal.mjs
```

脚本按**条目**处理，绝不把全局扩展目录整根指到 `personal/`：

| 条目类型 | 判定 | 动作 |
| --- | --- | --- |
| 文件型 | 顶层 `*.ts` | 软链到 `~/.pi/agent/extensions/<name>.ts` |
| 包型 | 子目录且含 `package.json` | 在目录内 `npm install`，并把**绝对路径**写入 `settings.json` 的 `packages` |
| 其他 | `README.md`、无清单目录等 | 跳过 |

包型**禁止**再软链同一条目，防止双加载。

### 幂等与冲突

- 重复运行安全：已指向正确源的软链不动；settings 去重。
- 目标已存在且**不是**软链 → **失败并提示**，避免覆盖 herdr 等 local-only 文件。
- 包型若发现同名 standalone 扩展文件（如旧的 `extensions/advisor-adapter.ts`）→ 失败，需先备份/删除。

### 重要修正

当前 pi 对本地路径的 `pi install` **只校验路径存在，不跑 `npm install`**。包型依赖安装由本脚本负责（`--omit=dev --omit=peer`）。

## 当前内容

| 条目 | 类型 | 说明 |
| --- | --- | --- |
| `exit.ts` | 文件 | 输入 `exit` 退出会话（自 miscs） |
| `debug-request-body.ts` | 文件 | `PI_DEBUG_REQUEST_BODY` 门闩下写请求体（自 miscs） |
| `advisor-adapter/` | 包 | 代理 `@juicesharp/rpiv-advisor`：流式 thinking/正文 + 自定义 header/footer 渲染 |

## 不进仓（local-only 边界）

以下留在本机扩展目录，**不要**迁入本树：

- `dcg-guard.ts`（由 DCG 侧维护）
- `herdr-agent-state.ts` / herdr 生成物
- `subagent/` 残留配置（无入口）
- 密钥、会话数据

## 顾问小包

- settings 中**不要**再挂 `npm:@juicesharp/rpiv-advisor` 作为独立扩展；依赖只存在于本包 `node_modules`，原 factory 当库调用。
- 同步脚本会从 settings 移除 `npm:@juicesharp/rpiv-advisor` 与 `npm:@cnife/pi-miscs`。
- **脆点**：适配器 deep-import 上游内部模块（`@juicesharp/rpiv-advisor/advisor/*`）。上游对这些路径**无兼容承诺**；上游大改时需跟进本包。

### 迁移旧 standalone 适配器

若本机仍有 `~/.pi/agent/extensions/advisor-adapter.ts`：

```bash
mv ~/.pi/agent/extensions/advisor-adapter.ts \
   ~/.pi/agent/extensions/advisor-adapter.ts.pre-personal.bak
node scripts/sync-personal.mjs
```

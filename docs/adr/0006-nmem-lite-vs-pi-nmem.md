# nmem-lite 与 @cnife/pi-nmem 分工：同一后端的两个实现

## 背景

仓库里有两套连同一个 nmem 后端的实现：

1. **产品包** `packages/nmem`（`@cnife/pi-nmem`）：自定义工具（`nmem_search` 等）、`/nmem-config`、Context Bundle 自动注入、插件配置文件。
2. **personal 层** `personal/nmem-lite`：会话自动同步在扩展内自实现，召回/保存走官方 `nmem` CLI + 技能（当前为 `nmem-guide`）。

两者曾血脉同源（`nowledge-mem-pi` → `pi-nmem` → `pi-nmem-lite`），但 nmem-lite 长期落后于 OMP 侧插件（`~/code/omp-extensions/plugins/nmem`）。本轮把它的同步语义对齐 OMP 侧已验证的行为，并显式记下宿主差异。问题在于：仓库里为什么有两套？各自负责什么？

## 决定

1. **personal 层保留 nmem-lite**：召回/保存走官方 `nmem` CLI + `nmem-guide` 技能（不做自定义工具、不做 `/nmem-*` 命令、不做插件配置、不注入 Context Bundle）；会话同步在扩展内自实现（REST + 整份快照 + 后端去重）。
2. **同步语义与 OMP 侧插件同构**：快照在到点时构建、队列只排最新快照、每轮自带预算、刚性 flush 取消防抖 flush、前台放弃由「下次全量快照」补齐。
3. **宿主差异是显式偏离，不是遗漏**：
   - `source_app` 固定 `pi`，不加环境变量覆盖（`thread_id` 的 `pi-` 前缀跨三代插件保持稳定）。
   - 用全局 `setTimeout`/`clearTimeout`（pi 的 `ExtensionContext` 没有 OMP 宿主的 `ctx.setTimeout`/`clearTimer` 隔离机制）。
   - 防抖挂 `agent_settled`（`agent_end` 每次底层 run 都响，不是最终空闲信号）。
   - 刚性只挂 `session_shutdown` + `session_before_compact`，**不挂** `session_before_switch`：pi 在 before_switch 之后会先 `await session.abort()` 把中断的 turn 落盘再发 shutdown，shutdown 时刻的快照更完整；挂两处会让 `/new`、`/resume` 连跑两次刚性同步。
   - 前台预算自己封（单请求 3s、整条队列最多等 6s、不重试）：pi 没有宿主级 shutdown 超时，OMP 靠宿主 2s 硬杀，它的 800ms/不重试不能照抄。
   - 引导走结构化 prompt section 且总是注入（返回 `systemPrompt` 等于 `forceSystemPrompt`，会整段替换系统提示）。
4. **不合并两套实现，也不把 nmem-lite 提升为产品包。**

## 原因

- nmem-lite 是自用：CLI 路线让模型用自然语言 + 官方 CLI 干活，避免维护工具 schema 与配置面；产品包那套自定义工具是给「别人 `pi install` 即用」的场景付发布税。
- 同步语义不必重造：OMP 侧插件已在真实使用中验证过预算、快照新鲜度、队列与触发点，nmem-lite 沿用同一套并只改宿主相关处。
- 前台不重试的理由写在代码注释里（`FOREGROUND_FLUSH_OPTIONS`）：重试的作用已被「同步永远写整份快照 + 后端去重」取代，成本却是用户盯着一个已经停掉的界面翻倍等待。

## 考虑过的选项

- **装回 `npm:@cnife/pi-nmem`**：rejected——回到自定义工具与 Context Bundle 注入，放弃技能路线，且个人层要多维护一份插件配置。
- **把 nmem-lite 提升为产品包**：rejected——付发布税，且与 `@cnife/pi-nmem` 功能重叠，用户面会困惑。
- **给前台预算单独立 ADR**：rejected——决策的理由放进代码注释更贴近改动点；本 ADR 只记录分工与宿主差异。

## 后果

- 两套实现各自演进；nmem-lite 的同步语义靠 OMP 侧参考实现与本文档对齐，回退会被 `personal/nmem-lite/test/` 的单测兜住。
- 后端契约（创建线程 / 追加 / 去重）是两个实现的共同依赖，谁都不能单方面改。
- 改 `source_app` 或 `thread_id` 前缀会破坏已有线程连续性；历史线程不做迁移或回填。

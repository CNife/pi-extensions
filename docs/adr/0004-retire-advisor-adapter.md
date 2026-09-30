# 0004 - advisor-adapter 退役

日期：2026-09-30；状态：已接受。取代 [ADR 0003](0003-personal-layer-miscs-retirement.md) 中「顾问小包」一节及其修订段中「根 dependencies 挂 `@juicesharp/rpiv-advisor`」的安排。

## 决定

`personal/advisor-adapter/` 退役，整体移入 `archive/advisor-adapter/`（user 授权，2026-09-30）。

随退役落地的清理：

- 根 `package.json` 删除 `dependencies` 中唯一的运行时依赖 `@juicesharp/rpiv-advisor`（该依赖仅为 advisor-adapter 而设），lock 同步。
- `personal/README.md` 移除 advisor-adapter 条目与「顾问小包」章节。
- `archive/README.md` 补归档行。

## 原因

- 适配器 deep-import 上游内部模块（`@juicesharp/rpiv-advisor/advisor/*`），上游对这些路径无兼容承诺，是 ADR 0003 即已记录的长期脆点。
- 该包是根包需要携带运行时依赖的唯一原因；退役后根 `package.json` 回到零运行时依赖，git 包安装面更干净。

## 后果

- 各机 `pi update --extensions` 拉取后，advisor-adapter 不再随根包加载。
- 仍需 advisor 功能的机器直接安装上游扩展：`pi install npm:@juicesharp/rpiv-advisor`（失去自定义流式渲染）。
- `~/.pi/agent/extensions/` 下若残留指向 `personal/advisor-adapter` 的旧软链（仅旧方案迁移机器），迁移步骤中已有的清理项仍然适用。

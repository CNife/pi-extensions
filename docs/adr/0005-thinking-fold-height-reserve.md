# thinking-fold 用高度留白消除折叠位移

日期：2026-10-16；状态：已接受。

## 背景

fullscreen（pi 1.3.0 默认，`TuiAltScreen` + follow-end `ScrollView`）下，transcript 变矮时 `ScrollView.updateLayout` 会把 `scrollTop` 钉到 `contentHeight - viewportHeight`——内容少一行，视口就整体下移一行。

thinking-fold 的折叠正好是一次骤减：流式时推理块占「label + 尾 10 行预览」，完成时只剩 label 一行，一次砍掉约 10 行。于是折叠瞬间屏幕上已有内容整体下移一截（**折叠位移**）；紧接着工具块出现又长高，画面再顶回来。这一下一上就是肉眼可见的闪烁。

regular 模式（`--tui-mode regular`）走主屏 + scrollback，内容变矮只清底部空行、不移动历史，没有这个问题。

## 决定

折叠时在 transcript 内容末尾（`chatContainer` 之后）输出等量空行，把「砍掉的高度」记成**高度债**；后续内容每长高一行就撤掉一行留白，债务归零后恢复正常滚动。原理是让 transcript 总高度在折叠全程保持恒定，follow-end 视口因此完全静止。

留白挂在内容容器末尾而非消息组件内部，因为工具块是 assistant 组件的兄弟节点：只有留白位于工具块**下方**，才形成「工具块顶边钉死、从留白顶部向下生长」的几何——信息流始终向下。

## 考虑过的方案

- **推迟/合并折叠时机**：把折叠延后到工具块落地的那一帧，只留一次位移。改动最小，但位移量不变（仍砍掉 10 行），只是少了反向抖动；且工具块何时出现由模型决定，时机不可靠。
- **永久占位**：折叠后永远留 10 行空。零位移，但每段推理都在历史里留一片空白，密度永久变差。
- **定时衰减**：留白在数百毫秒内逐帧收缩。位移从「瞬移」变成「慢滑」，折叠显得拖沓，且仍非零位移。
- **在 dock 里撑高抵消**（`setWidget` + `aboveEditor`）：已排除。dock 渲染顺序为 `pendingMessages → status → widgetsAbove → editor → footer`，撑高 dock 会把 `⠇ Working` 状态行一起推上去——位移只是从 transcript 搬到状态行，并未消除。

选择高度留白，因为只有它让**屏幕在内容流式涌入期间真正静止**，且用真实内容（而非计时器或永久空白）偿还留白。

## 后果

- 留白期间折叠块下方短暂空白，工具块 header 在下一帧（约 16ms）才出现于留白顶部。这是该方案的固有天花板，已接受。
- 一轮结束（`agent_settled`）时债务一次性清零，屏幕可能轻刷一下，作为收尾代价接受。
- 机制**只对 fullscreen 生效**（用 pi-tui 的 `isViewportTUI` 判定）；regular 模式整个机制 no-op，既无此问题也不该往 scrollback 塞空行。
- 需要 patch `ToolExecutionComponent` / `AssistantMessageComponent` 的 `render` 来观测高度增长，与既有的 `AssistantMessageComponent.updateContent` patch 同属「依赖 pi 内部结构」的一类脆点。

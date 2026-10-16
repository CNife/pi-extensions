# thinking-fold

`personal/thinking-fold` 扩展的领域术语：推理块折叠预览在 fullscreen transcript 里的渲染行为。

## 语言

**折叠位移**：
推理块折叠使 transcript 变矮、follow-end 视口随之移动，屏幕上已有内容整体下移的现象。
_避免_：闪烁、抖动（那是用户对整体观感的描述，不是这个具体现象）

**高度留白**：
折叠时在 transcript 内容末尾输出的等量空行，用于抵消折叠位移。
_避免_：占位符、spacer（`Spacer` 是 pi-tui 的具体组件名，不是这个概念）

**高度债**：
当前仍挂着的高度留白行数。折叠时增加，内容增长时减少，归零即恢复正常滚动。
_避免_：欠债、补偿量

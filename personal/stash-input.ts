import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// alt+s：输入框有内容时暂存并清空（方便先输入 / 或 ! 命令），
// 输入框为空时恢复上次暂存的文本。仅存内存，pi 重启或 /reload 后清空。
// 已有暂存时需双击 Alt+S 才覆盖，避免误覆盖之前的暂存。
const DOUBLE_CLICK_MS = 500;
let stash: string | undefined;
let lastPressAt: number | undefined;

export default function (pi: ExtensionAPI) {
  pi.registerShortcut("alt+s", {
    description: "暂存/恢复输入框文本：有内容时暂存并清空，空时恢复",
    handler: async (ctx) => {
      const current = ctx.ui.getEditorText();
      if (current.trim().length > 0) {
        if (stash === undefined) {
          stash = current;
          ctx.ui.setEditorText("");
          ctx.ui.notify(`已暂存 ${current.length} 字符`, "info");
          lastPressAt = undefined;
          return;
        }
        // 已有暂存 -> 需双击 Alt+S 覆盖
        const now = Date.now();
        if (lastPressAt !== undefined && now - lastPressAt < DOUBLE_CLICK_MS) {
          stash = current;
          ctx.ui.setEditorText("");
          ctx.ui.notify("已覆盖暂存文本", "info");
          lastPressAt = undefined;
          return;
        }
        lastPressAt = now;
        ctx.ui.notify(
          `已有暂存文本（${stash.length} 字符），双击 Alt+S 覆盖`,
          "warning",
        );
        return;
      }
      // 输入框为空 -> 恢复（恢复消费暂存，并重置双击计时）
      lastPressAt = undefined;
      if (stash === undefined) {
        ctx.ui.notify("没有暂存的文本", "warning");
        return;
      }
      ctx.ui.setEditorText(stash);
      ctx.ui.notify("已恢复暂存文本", "info");
      stash = undefined;
    },
  });
}

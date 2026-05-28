import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.on("input", async (event, ctx) => {
    if (event.text.trim() === "exit") {
      ctx.shutdown();
      return { action: "handled" };
    }
    return { action: "continue" };
  });
}

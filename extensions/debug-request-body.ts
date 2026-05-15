import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs";
import * as path from "node:path";

export default function (pi: ExtensionAPI) {
  const debugDir = process.env.PI_DEBUG_REQUEST_BODY;
  if (!debugDir) return;

  fs.mkdirSync(debugDir, { recursive: true });

  pi.on("before_provider_request", (event, _ctx) => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const payload = event.payload as Record<string, unknown>;
    const modelId = (payload.model as string) ?? "unknown";
    const filename = `${timestamp}--${modelId}.json`;
    const filePath = path.join(debugDir, filename);

    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf-8");

    console.log(`[debug-request-body] wrote ${filePath}`);
  });
}

/**
 * nmem-lite 引导注入测试 — 经扩展入口注册的真实 before_agent_start handler 观测。
 *
 * 契约来自 pi 1.4.0 的 before_agent_start 事件：event.systemPromptOptions 可原地改，
 * 返回 systemPrompt 会被记为 forceSystemPrompt（整段替换，丢掉结构化 section 的
 * 增量与缓存友好性）。所以断言的是「写进 sections」而不是「返回新 systemPrompt」。
 *
 * 运行：仓库根 \`npm test\`。
 */

import { ok, strictEqual } from "node:assert";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { test } from "vitest";
import nmemLite from "../extensions/nmem-lite.ts";

type Handler = (event: unknown, ctx: unknown) => unknown;

/** 捕获扩展入口注册的 handler（入口只做注册，无副作用）。 */
function registeredHandlers(): Record<string, Handler | undefined> {
  const handlers: Record<string, Handler | undefined> = {};
  const pi = {
    on: (name: string, handler: Handler) => {
      handlers[name] = handler;
    },
  };
  nmemLite(pi as unknown as ExtensionAPI);
  return handlers;
}

test("before_agent_start: 总是把引导写进 systemPromptOptions.sections", async () => {
  const handler = registeredHandlers().before_agent_start;
  ok(handler, "入口应注册 before_agent_start");

  // 独立性：另建输入对象，避免 handler 原地改写后两边一起变、断言自我满足。
  const original = "<project-context>\ncwd: /tmp/demo\n</project-context>";
  const sections: Record<string, string> = { "project-context": original };
  const event = {
    type: "before_agent_start",
    messageType: "user",
    prompt: "hi",
    systemPrompt: "<rendered prompt>",
    systemPromptOptions: { sections },
  };

  const result = await handler(event, {});

  // 原地改 section：原有 section 原样保留，不整段替换系统提示
  strictEqual(
    event.systemPromptOptions.sections["project-context"],
    original,
    "已有 section 不该被覆盖",
  );
  strictEqual(
    "forceSystemPrompt" in event.systemPromptOptions,
    false,
    "不该设置 forceSystemPrompt",
  );
  const returned = (result ?? {}) as Record<string, unknown>;
  strictEqual(
    "systemPrompt" in returned,
    false,
    "不该返回 systemPrompt（那等于整段替换）",
  );

  const guidance = sections.nowledge_mem;
  ok(
    typeof guidance === "string" && guidance.trim().length > 0,
    `应在 nowledge_mem section 写入引导，实际：${JSON.stringify(guidance)}`,
  );
  ok(
    guidance.includes("## Nowledge Mem"),
    `引导应说明 nmem 可用，实际：${guidance}`,
  );
  ok(
    guidance.includes("nmem-guide"),
    `引导应点名 nmem-guide 技能，实际：${guidance}`,
  );
  // 粘连痕迹：不该把旧 section 内容带进来
  ok(
    !guidance.includes("project-context"),
    `引导 section 里不该出现旧 section 内容：${guidance}`,
  );
});

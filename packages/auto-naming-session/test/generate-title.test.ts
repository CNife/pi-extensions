/**
 * generateTitle 的 complete() 调用参数回归测试。
 *
 * 背景：auto-naming-session 在 opencode-go 等 provider 下静默不生成标题：
 *   1. complete() 缺 sessionId -> provider 要求会话 header，请求 400
 *      MissingSessionID；
 *   2. maxTokens=60 太小 -> 推理模型先输出 thinking，响应被 length 截断，
 *      content 无 text。
 *
 * Run: npx vitest run packages/auto-naming-session/test/generate-title.test.ts
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { expect, test } from "vitest";
import { type AutoNamingConfig, generateTitle } from "../extensions/index.ts";

const CONFIG: AutoNamingConfig = {
  auto_refresh_turns: 10,
  model: null,
  language: "english",
};

type CompleteOptions = { maxTokens?: number; sessionId?: string };

function makeCtx(
  response: { stopReason: string; content: unknown[] },
  calls: CompleteOptions[],
  sessionId = "session-1",
): ExtensionContext {
  const model = { provider: "test", id: "test-model" };
  return {
    model,
    modelRegistry: {
      find: () => undefined,
      hasConfiguredAuth: () => true,
      complete: async (
        _model: unknown,
        _context: unknown,
        opts: CompleteOptions,
      ) => {
        calls.push(opts);
        return response;
      },
    },
    sessionManager: { getSessionId: () => sessionId },
  } as unknown as ExtensionContext;
}

test("generateTitle: complete() 带上 sessionId（provider 会话路由必需）", async () => {
  const calls: CompleteOptions[] = [];
  const ctx = makeCtx(
    { stopReason: "stop", content: [{ type: "text", text: "A Title" }] },
    calls,
    "abc-123",
  );

  expect(await generateTitle(ctx, CONFIG, "user: hi")).toBe("A Title");
  expect(calls).toHaveLength(1);
  expect(calls[0]?.sessionId).toBe("abc-123");
});

test("generateTitle: maxTokens 足够容纳 thinking + 标题", async () => {
  const calls: CompleteOptions[] = [];
  const ctx = makeCtx({ stopReason: "stop", content: [] }, calls);

  await generateTitle(ctx, CONFIG, "user: hi");
  expect(calls[0]?.maxTokens).toBeGreaterThan(60);
});

test("generateTitle: stopReason=length 时不写入截断标题", async () => {
  const calls: CompleteOptions[] = [];
  const ctx = makeCtx(
    { stopReason: "length", content: [{ type: "text", text: "half" }] },
    calls,
  );

  expect(await generateTitle(ctx, CONFIG, "user: hi")).toBeNull();
});

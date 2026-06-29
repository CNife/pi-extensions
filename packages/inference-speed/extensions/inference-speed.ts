import type {
  AssistantMessage,
  AssistantMessageEvent,
} from "@earendil-works/pi-ai";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";

/**
 * Inference Speed — 在 pi footer 常驻显示当前 assistant message 的
 * 推理速度（TPS，tokens/s）和首 token 延迟（TTFT，秒）。
 *
 * - TPS = usage.output / message 生成耗时（output/elapsed 公式参考 tps.ts），显示为 `NN.NT/s`
 * - TTFT = 首 token 时刻 − 请求发出时刻（before_provider_request → 首个 _delta），显示为 `FTN.Ns`
 * - 每条 assistant message 结束后刷新 footer，保持到下一条
 */

const STATUS_KEY = "inference-speed";
const EMPTY = "--.-T/s FT -.-s";

type SpeedSample = {
  tps: number;
  ttft: number;
};

function isAssistantMessage(message: unknown): message is AssistantMessage {
  if (!message || typeof message !== "object") return false;
  return (message as { role?: unknown }).role === "assistant";
}

function isDeltaEvent(event: AssistantMessageEvent): boolean {
  return event.type.endsWith("_delta");
}

function publish(ctx: ExtensionContext, sample: SpeedSample | null): void {
  if (!sample) {
    ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("dim", EMPTY));
    return;
  }
  const text = `${sample.tps.toFixed(1)}T/s FT${sample.ttft.toFixed(1)}s`;
  ctx.ui.setStatus(STATUS_KEY, text);
}

export default function (pi: ExtensionAPI) {
  // 当前 message 的计时锚点；requestAt 在 before_provider_request 记录，
  // firstDeltaAt 在首个 _delta 记录，message_end 消费后清空。
  let requestAt: number | null = null;
  let firstDeltaAt: number | null = null;

  const reset = (ctx: ExtensionContext) => {
    requestAt = null;
    firstDeltaAt = null;
    publish(ctx, null);
  };

  pi.on("session_start", (_event, ctx) => reset(ctx));
  pi.on("session_tree", (_event, ctx) => reset(ctx));
  pi.on("session_compact", (_event, ctx) => reset(ctx));
  pi.on("model_select", (_event, ctx) => reset(ctx));

  pi.on("before_provider_request", () => {
    // 每次 provider 请求发出前触发，与 assistant message 1:1 配对。
    // payload 为 unknown 且无时间戳，用 Date.now() 作为请求发出时刻。
    requestAt = Date.now();
    firstDeltaAt = null;
  });

  pi.on("message_update", (event, _ctx) => {
    if (requestAt === null) return;
    if (firstDeltaAt !== null) return;
    if (!isAssistantMessage(event.message)) return;
    if (isDeltaEvent(event.assistantMessageEvent)) {
      firstDeltaAt = Date.now();
    }
  });

  pi.on("message_end", (event, ctx) => {
    if (!isAssistantMessage(event.message)) return;
    const message = event.message as AssistantMessage;
    if (message.stopReason === "aborted" || message.stopReason === "error") {
      reset(ctx);
      return;
    }

    const output = message.usage.output;
    // 结束时刻用 message_end 触发时的 Date.now()，与 tps.ts 同源（不依赖 message.timestamp 语义）。
    // elapsed = 结束 − 请求发出，含网络 + 排队 + 生成，与 tps.ts 口径一致。
    if (requestAt === null || output <= 0) {
      reset(ctx);
      return;
    }
    const elapsedSeconds = (Date.now() - requestAt) / 1000;
    if (elapsedSeconds <= 0) {
      reset(ctx);
      return;
    }

    const tps = output / elapsedSeconds;
    const ttft = firstDeltaAt !== null ? (firstDeltaAt - requestAt) / 1000 : 0;

    publish(ctx, { tps, ttft });

    // 消费完毕，清空锚点等待下一条 message 的 before_provider_request。
    requestAt = null;
    firstDeltaAt = null;
  });
}

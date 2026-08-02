/**
 * capture.ts - 抓取 pi 实际发送的请求 payload 和收到的响应，输出结构化 JSONL。
 *
 * 用途：调试 models.json 配置（thinkingLevelMap / compat / 缓存 / tool 格式）。
 * 加载：`pi --extension <path>/capture.ts --print --model <provider/model> "<task>"`
 * 日志：$PI_CAPTURE_LOG（默认 /tmp/pi-capture.jsonl），不脱敏，调试结束删除。
 *
 * 输出格式：一行一个聚合 CALL 块（JSONL）。
 *   - assistant 块：{callIndex, role, startTime, request:{payload,headers}, responses[], message:{...}}
 *   - user/toolResult 块：精简结构（callIndex=null，无 request/responses）
 * 消费：用 jq 提取四维度（见 SKILL.md step 7）。
 *
 * 事件组合（按触发顺序）：
 *   before_provider_headers -> before_provider_request -> after_provider_response
 *   message_end（user / assistant / toolResult 都会触发）
 *
 * 配对策略：before_provider_headers 开请求槽 -> before_provider_request 填 payload
 *   -> after_provider_response 填响应 -> assistant message_end flush 聚合块
 *   user/toolResult 的 message_end 单独 flush 精简块
 *
 * 已知局限：
 * - before_provider_headers 拿不到 Authorization（pi 在事件返回后才注入 auth）
 * - 日志不脱敏，含 payload 完整内容，调试完请删除
 */
import { appendFileSync, writeFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// ---- 日志路径 ----
const LOG_PATH = process.env.PI_CAPTURE_LOG ?? "/tmp/pi-capture.jsonl";

// ---- 一次 HTTP 请求的槽 ----
interface RequestSlot {
	callIndex: number;
	startTime: string;
	headers?: Record<string, string | null>;
	payload?: unknown;
	responses: Array<{ status: number; headers: Record<string, string> }>;
}

// 尚未被 assistant message_end 消费的请求槽（按顺序）。
const pendingSlots: RequestSlot[] = [];
let callCount = 0;

function newSlot(): RequestSlot {
	callCount += 1;
	return {
		callIndex: callCount,
		startTime: new Date().toISOString(),
		responses: [],
	};
}

function writeLine(obj: unknown): void {
	appendFileSync(LOG_PATH, JSON.stringify(obj) + "\n", "utf8");
}

export default function (pi: ExtensionAPI) {
	// 启动时清空旧日志：每次新 run 重新开始
	try {
		writeFileSync(LOG_PATH, "", "utf8");
	} catch (e) {
		console.error(`[capture.ts] Failed to init log at ${LOG_PATH}:`, e);
	}

	// ---- 1. 请求头（HTTP 请求链起点）----
	// 注意：实际 Authorization 等敏感头在此事件返回后才注入，故拿不到
	pi.on("before_provider_headers", (event, _ctx) => {
		try {
			const slot = newSlot();
			slot.headers = event.headers as Record<string, string | null>;
			pendingSlots.push(slot);
		} catch (e) {
			console.error("[capture.ts] before_provider_headers error:", e);
		}
	});

	// ---- 2. 请求体（已应用 thinkingLevelMap/compat 的最终 payload）----
	pi.on("before_provider_request", (event, _ctx) => {
		try {
			// 填到最近开的槽里
			const slot = pendingSlots[pendingSlots.length - 1];
			if (slot) {
				slot.payload = event.payload;
			} else {
				// 理论上不会发生（headers 先到），防御性开一个槽
				const s = newSlot();
				s.payload = event.payload;
				pendingSlots.push(s);
			}
		} catch (e) {
			console.error("[capture.ts] before_provider_request error:", e);
		}
	});

	// ---- 3. 响应状态 + 响应头（不含 body，stream consume 前触发）----
	pi.on("after_provider_response", (event, _ctx) => {
		try {
			const slot = pendingSlots[pendingSlots.length - 1];
			if (slot) {
				slot.responses.push({
					status: event.status,
					headers: event.headers as Record<string, string>,
				});
			}
		} catch (e) {
			console.error("[capture.ts] after_provider_response error:", e);
		}
	});

	// ---- 4. 最终 message（响应主来源）----
	pi.on("message_end", (event, _ctx) => {
		try {
			const msg = event.message;

			// assistant 消息：消费一个待处理请求槽，产出聚合 CALL 块
			if (msg.role === "assistant") {
				const slot = pendingSlots.shift() ?? newSlot(); // 防御性
				flushAssistantBlock(slot, msg);
				return;
			}

			// user / toolResult：没有对应 provider 请求，单独 flush 精简块
			flushNonAssistantBlock(msg);
		} catch (e) {
			console.error("[capture.ts] message_end error:", e);
		}
	});
}

// ---- 内容摘要（避免日志爆炸，仅记计数与 toolCall 元信息）----
function summarizeContent(content: any[]): {
	textBlocks: number;
	textChars: number;
	thinkingBlocks: number;
	thinkingChars: number;
	toolCalls: Array<{ name: string; argKeys: string[] }>;
} {
	const textBlocks = content.filter((b: any) => b?.type === "text") as Array<{ text: string }>;
	const thinkingBlocks = content.filter((b: any) => b?.type === "thinking") as Array<{
		thinking: string;
	}>;
	const toolCalls = content.filter((b: any) => b?.type === "toolCall") as Array<{
		name: string;
		arguments: Record<string, unknown>;
	}>;
	return {
		textBlocks: textBlocks.length,
		textChars: textBlocks.reduce((s, b) => s + (b.text?.length ?? 0), 0),
		thinkingBlocks: thinkingBlocks.length,
		thinkingChars: thinkingBlocks.reduce((s, b) => s + (b.thinking?.length ?? 0), 0),
		toolCalls: toolCalls.map((t) => ({
			name: t.name,
			argKeys: t.arguments ? Object.keys(t.arguments) : [],
		})),
	};
}

// ---- assistant 聚合 CALL 块 ----
function flushAssistantBlock(slot: RequestSlot, msg: any): void {
	const content: any[] = msg.content ?? [];
	writeLine({
		callIndex: slot.callIndex,
		role: "assistant",
		startTime: slot.startTime,
		request: {
			payload: slot.payload ?? null,
			headers: slot.headers ?? null,
		},
		responses: slot.responses,
		message: {
			model: msg.model ?? null,
			responseModel: msg.responseModel ?? null,
			stopReason: msg.stopReason ?? null,
			errorMessage: msg.errorMessage ?? null,
			usage: msg.usage ?? null,
			content: summarizeContent(content),
		},
	});
}

// ---- user / toolResult 精简块 ----
function flushNonAssistantBlock(msg: any): void {
	const entry: Record<string, unknown> = {
		callIndex: null,
		role: msg.role,
		startTime: new Date().toISOString(),
		note: "non-assistant message_end - no provider request",
	};

	if (msg.role === "toolResult") {
		const content: any[] = msg.content ?? [];
		entry.toolName = msg.toolName ?? null;
		entry.toolCallId = msg.toolCallId ?? null;
		entry.isError = msg.isError ?? false;
		entry.textChars = summarizeContent(content).textChars;
	} else if (msg.role === "user") {
		const c = msg.content;
		entry.userPreview =
			typeof c === "string" ? c.slice(0, 200) : JSON.stringify(c).slice(0, 200);
	}

	// user/toolResult 块不计入 callCount（callCount 只数真实 LLM 调用）
	writeLine(entry);
}

// ──── PROTOTYPE: first-title timing (#58) ───────────────────────────
// 场景数据。每个场景是一个事件序列，模拟 pi 的事件时序：
//   user_message_end     → 扩展处理器运行时，该 user 消息尚未 append 到 branch
//   assistant_message_end → 同上，assistant 消息尚未 append
//   agent_end            → branch 完整（所有 message_end→appendMessage 已串行完成）
//
// 模拟器（index.ts）会维护一个共享 branch，在每个事件点拍下快照，
// 并分别计算方案 A / 方案 B 的决策。

import type { Entry, Message } from "./transcript.ts";

export type TimelineEvent =
  | { kind: "user_message_end"; message: Message; label: string }
  | { kind: "assistant_message_end"; message: Message; label: string }
  | { kind: "agent_end"; label: string };

export interface Scenario {
  name: string;
  description: string;
  initialBranch: Entry[];
  events: TimelineEvent[];
}

// ──── 辅助：构造 entry ─────────────────────────────────────────────

let _idSeq = 0;
function id(prefix: string): string {
  _idSeq += 1;
  return `${prefix}${_idSeq}`;
}

function userMsg(text: string): Entry {
  return {
    type: "message",
    id: id("u"),
    message: { role: "user", content: text },
  };
}
function assistantMsg(text: string): Entry {
  return {
    type: "message",
    id: id("a"),
    message: { role: "assistant", content: text },
  };
}
function compactionEntry(summary: string): Entry {
  return { type: "compaction", id: id("c"), summary };
}
function autoNamingTitleEntry(title: string): Entry {
  return {
    type: "custom",
    id: id("t"),
    customType: "auto-naming-title",
    data: { title, timestamp: Date.now() },
  };
}
function foreignCustomEntry(customType: string): Entry {
  return { type: "custom", id: id("x"), customType, data: {} };
}

// ──── 场景 1：全新会话 ─────────────────────────────────────────────
// 展示即时性差异。branch 起始为空。
//   方案 B：首条 user_message_end 即生成标题（assistant 还没开始响应）
//   方案 A：等到 agent_end（assistant 响应完成后）才生成标题

export const newSession: Scenario = {
  name: "1. new-session",
  description:
    "全新会话。branch 空。验证 US5「首条消息后立即生成标题」：B 在 user_message_end 即出标题，A 要等 assistant 响应完。",
  initialBranch: [],
  events: [
    {
      kind: "user_message_end",
      label: "user 提交首条消息（message_end 触发，消息尚未入 branch）",
      message: {
        role: "user",
        content: "帮我把 auth 模块拆分成单独的文件",
      },
    },
    {
      kind: "assistant_message_end",
      label: "assistant 响应完成（message_end 触发，消息尚未入 branch）",
      message: {
        role: "assistant",
        content: "我先读一下当前的 auth 代码，然后按职责拆分……",
      },
    },
    {
      kind: "agent_end",
      label: "agent_end 触发（branch 此时完整）",
    },
  ],
};

// ──── 场景 2：会话重载（branch 已有历史，无 title entry）──────────
// 关键边界 case：首个 user_message_end 时 branch 非空（6 条历史消息）。
//   方案 B：transcript = buildFullTranscript(历史) + 当前 user 消息（拼接有意义）
//   方案 A：等 agent_end，branch = 历史 + 新 user + 新 assistant

export const reloadWithHistory: Scenario = {
  name: "2. reload-with-history",
  description:
    "会话重载。branch 已有 6 条历史消息，但无 auto-naming-title entry。验证 B 的拼接在「旧消息 + 新 user」下正确。",
  initialBranch: [
    userMsg("搭建 Postgres 连接"),
    assistantMsg("配好了连接池"),
    userMsg("建用户表模型"),
    assistantMsg("User model 已建好"),
    userMsg("写测试"),
    assistantMsg("测试全绿"),
  ],
  events: [
    {
      kind: "user_message_end",
      label: "重载后首条 user 消息（message_end 触发，尚未入 branch）",
      message: {
        role: "user",
        content: "现在给 API 加上速率限制",
      },
    },
    {
      kind: "assistant_message_end",
      label: "assistant 响应完成（message_end 触发，尚未入 branch）",
      message: {
        role: "assistant",
        content: "我加一个 rate limiter 中间件……",
      },
    },
    {
      kind: "agent_end",
      label:
        "agent_end 触发（branch 此时完整：6 历史 + 新 user + 新 assistant）",
    },
  ],
};

// ──── 场景 3：混合 entry（验证 buildFullTranscript 跳过逻辑）──────
// branch 含 compaction entry + auto-naming-title custom entry + 外部 custom entry。
// firstTitleGenerated=true（已有 title entry），走 refresh 路径。
// 验证：buildFullTranscript 只收集 4 条 user/assistant 文本，跳过所有非 message entry。

export const mixedEntries: Scenario = {
  name: "3. mixed-entries (refresh 路径)",
  description:
    "branch 含 compaction + 2 个 auto-naming-title custom + 外部 custom entry。firstTitleGenerated=true，走 refresh。验证 buildFullTranscript 正确跳过所有非 message entry。",
  initialBranch: [
    userMsg("搭建数据库"),
    assistantMsg("连接池配好了"),
    compactionEntry("早期搭建工作摘要"),
    autoNamingTitleEntry("数据库搭建"),
    userMsg("加迁移脚本"),
    assistantMsg("迁移已建好"),
    autoNamingTitleEntry("数据库搭建与迁移"),
    foreignCustomEntry("bookmark"),
  ],
  events: [
    {
      kind: "user_message_end",
      label: "user 新消息（message_end 触发，尚未入 branch）",
      message: {
        role: "user",
        content: "现在播种测试数据",
      },
    },
    {
      kind: "assistant_message_end",
      label: "assistant 响应完成（message_end 触发，尚未入 branch）",
      message: {
        role: "assistant",
        content: "已用测试数据填充……",
      },
    },
    {
      kind: "agent_end",
      label:
        "agent_end 触发（refresh：buildFullTranscript 应含 6 条消息文本，跳过 compaction/custom）",
    },
  ],
};

export const SCENARIOS: Scenario[] = [
  newSession,
  reloadWithHistory,
  mixedEntries,
];

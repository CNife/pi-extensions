#!/usr/bin/env node
/**
 * nmem TUI Render Prototype — Final
 *
 * 定稿规格（见 #87 共识）：
 * - 配色：pi 标准 ThemeColor（accent/success/warning/error/muted/dim/text/toolOutput）
 * - 标签：全小写，dim 色
 * - 字段值着色按值类型：标识符→muted、数值→toolOutput、枚举分类→accent、自由文本→text
 * - 标题分隔符：中点 ·
 * - save_memory 折叠态：✓ created/updated <id>，展开态字段列表
 * - footer：折叠态 `N <unit>`，展开态 `N <unit> · returned R · offset O`
 * - read_thread 展开态：纵向一行一字段，标题行去重
 * - 文案：如实显示后端返回文本，不翻译
 * - score 精度：折叠展开统一 toFixed(4)
 *
 * Usage: node packages/nmem/prototype/render-prototype.mjs
 */

// ============================================================================
// ANSI 颜色工具（模拟 pi TUI theme.fg，token 映射 pi 标准 ThemeColor）
// ============================================================================
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";

// 映射 pi 标准 ThemeColor → 256 色（仅原型演示用，正式实现走 theme.fg(token, ...)）
const COLORS = {
  toolTitle: "\x1b[38;5;39m", // 蓝色
  success: "\x1b[38;5;76m", // 绿色
  warning: "\x1b[38;5;214m", // 橙色
  error: "\x1b[38;5;196m", // 红色
  muted: "\x1b[38;5;244m", // 灰色
  dim: "\x1b[38;5;240m", // 暗灰
  accent: "\x1b[38;5;141m", // 紫色（主强调）
  text: "\x1b[38;5;255m", // 默认文本
  toolOutput: "\x1b[38;5;81m", // 工具输出文本
};

function bold(s) {
  return `${BOLD}${s}${RESET}`;
}
function fg(c, s) {
  return `${c}${s}${RESET}`;
}
function dim(s) {
  return `${DIM}${s}${RESET}`;
}

// 字段值着色（按值类型）
const valueColor = {
  id: (v) => fg(COLORS.muted, v), // 标识符
  number: (v) => fg(COLORS.toolOutput, v), // 数值
  enum: (v) => fg(COLORS.accent, v), // 枚举分类
  text: (v) => fg(COLORS.text, v), // 自由文本
};

// ============================================================================
// 模拟数据
// ============================================================================
const MOCK_SEARCH_MEMORIES = {
  returned: 3,
  memories: [
    {
      id: "abc123",
      title: "Wayfinder 规划方法论与工单规范",
      content:
        "Wayfinder 是一种针对宽泛模糊目标的规划方法论，通过在 Issue 追踪器中创建共享地图（带 wayfinder:map 标签的 Issue）来规划决策。其核心原则是「计划，不执行」：工单解决决策点，当路线清晰后才转入执行。",
      score: 0.9125,
      importance: 0.9,
      unit_type: "fact",
      created_at: "2026-07-13T11:02:56+00:00",
    },
    {
      id: "def456",
      title: "OneReason 后端 issue tracker 全切决策",
      content:
        "onereason-backend-mono 仓 issue tracker 于 2026-07-09 从本地 Wayfinder(.wayfinder/)全切到 GitLab Issues(glab, gitlab.zhejianglab.com/onereason/onereason-backend-mono)。全切决策：放弃 Wayfinder 的 plan-don't-do，决策/实施/外部 incoming 都进 GitLab。",
      score: 0.8245,
      importance: 0.9,
      unit_type: "decision",
      created_at: "2026-07-08T01:48:58+00:00",
    },
    {
      id: "ghi789",
      title: "LLM 驱动的系统设计关键词检索策略",
      content:
        "设计基于 LLM 的系统时，采用关键词检索和质量评估平衡效果与成本。记忆检索触发规则：在「建立上下文」阶段无条件调用 search-memory，依靠技能层过滤处理噪音。",
      score: 0.7712,
      importance: 0.8,
      unit_type: "fact",
      created_at: "2026-07-10T14:30:00+00:00",
    },
  ],
};

const MOCK_SEARCH_THREADS = {
  total: 2,
  threads: [
    {
      id: "pi-thread-001",
      title: "nmem TOON 优化方案讨论",
      message_count: 34,
      matches: 5,
    },
    {
      id: "pi-thread-002",
      title: "#81 清理与重构",
      message_count: 12,
      matches: 3,
    },
  ],
};

const MOCK_READ_THREAD = {
  title: "nmem TOON 优化方案讨论",
  created_at: "2026-07-15",
  total_messages: 34,
  offset: 0,
  returned: 5,
  messages: [
    { index: 0, role: "user", content: "我们来看看 nmem 的 token 消耗情况。" },
    {
      index: 1,
      role: "assistant",
      content:
        "TOON vs pretty JSON 节省 token——search 29%、read_thread 45%、save 33%。",
    },
    {
      index: 2,
      role: "user",
      content: "TUI 渲染呢？现在直接 dump JSON 很不友好。",
    },
    {
      index: 3,
      role: "assistant",
      content: "对，三个工具都需要自定义 renderCall/renderResult。",
    },
    {
      index: 4,
      role: "system",
      content: "注：execute-python 的 renderCall/renderResult 可作为参考。",
    },
  ],
};

const MOCK_SAVE_MEMORY_CREATE = {
  action: "created",
  id: "nmem-abc-123",
  title: "TUI 渲染形态原型设计决策",
};

const MOCK_SAVE_MEMORY_UPDATE = {
  action: "updated",
  id: "nmem-abc-123",
  title: "TUI 渲染形态原型设计决策",
  updated_fields: ["title", "content", "importance"],
};

const MOCK_SAVE_MEMORY_WARNING = {
  action: "updated",
  id: "nmem-abc-123",
  title: "TUI 渲染形态原型设计决策",
  updated_fields: ["title", "content"],
  warnings: ["labels 未变更，nmem 后端限制"],
};

const MOCK_ERROR = {
  code: "backend_unreachable",
  message: "Connection refused: http://127.0.0.1:14242",
};

// role → 颜色 token（user→accent、assistant→text、system→muted）
function roleColor(role) {
  if (role === "user") return COLORS.accent;
  if (role === "assistant") return COLORS.text;
  return COLORS.muted;
}

// ============================================================================
// 主渲染函数
// ============================================================================
function render() {
  const s = [];

  s.push(`\n${fg(COLORS.toolTitle, bold("═══ nmem TUI Render · Final ═══"))}`);
  s.push(
    dim(
      "pi standard ThemeColor · No emoji · No borders · Value-type coloring",
    ) + "\n",
  );

  // ------------------------------------------------------------------
  // nmem_search — memories (折叠)
  // ------------------------------------------------------------------
  s.push(bold("▎nmem_search · memories"));
  s.push(`  ${fg(COLORS.text, 'Search "规划设计", 3 results')}`);
  MOCK_SEARCH_MEMORIES.memories.forEach((m, i) => {
    s.push(
      `    ${fg(COLORS.accent, `${i + 1}.`)} ${m.title}  ${dim(`score ${m.score.toFixed(4)}`)}`,
    );
  });
  s.push(dim("    Expand for details") + "\n");

  // ------------------------------------------------------------------
  // nmem_search — memories (展开)
  // ------------------------------------------------------------------
  s.push(bold(`▎nmem_search · memories  Search "规划设计" · 3 results`));
  s.push("");
  for (const m of MOCK_SEARCH_MEMORIES.memories) {
    s.push(`  ${bold(m.title)}`);
    s.push(`    ${dim("id")}         ${valueColor.id(m.id)}`);
    s.push(`    ${dim("score")}      ${valueColor.number(m.score.toFixed(4))}`);
    s.push(`    ${dim("type")}       ${valueColor.enum(m.unit_type)}`);
    s.push(
      `    ${dim("importance")} ${valueColor.number(m.importance.toFixed(2))}`,
    );
    s.push(`    ${dim("content")}    ${valueColor.text(m.content)}`);
    s.push("");
  }
  s.push(`  ${dim("3 results")}\n`);

  // ------------------------------------------------------------------
  // nmem_search — threads (折叠)
  // ------------------------------------------------------------------
  s.push(bold("▎nmem_search · threads"));
  s.push(`  ${fg(COLORS.text, 'Search "nmem", found 2 threads')}`);
  MOCK_SEARCH_THREADS.threads.forEach((t, i) => {
    s.push(
      `    ${fg(COLORS.accent, `${i + 1}.`)} ${t.title}  ${dim(`${t.message_count} messages, ${t.matches} matches`)}`,
    );
  });
  s.push(dim("    Expand for details") + "\n");

  // ------------------------------------------------------------------
  // nmem_search — threads (展开)
  // ------------------------------------------------------------------
  s.push(bold(`▎nmem_search · threads  Search "nmem" · found 2 threads`));
  s.push("");
  for (const t of MOCK_SEARCH_THREADS.threads) {
    s.push(`  ${bold(t.title)}`);
    s.push(`    ${dim("id")}       ${valueColor.id(t.id)}`);
    s.push(`    ${dim("messages")} ${valueColor.number(t.message_count)}`);
    s.push(`    ${dim("matches")}  ${valueColor.number(t.matches)}`);
  }
  s.push(`  ${dim("2 threads")}\n`);

  // ------------------------------------------------------------------
  // nmem_read_thread — 折叠
  // ------------------------------------------------------------------
  s.push(bold("▎nmem_read_thread"));
  s.push(`  ${fg(COLORS.text, MOCK_READ_THREAD.title)}`);
  s.push(
    `  ${dim(`${MOCK_READ_THREAD.total_messages} messages · returned ${MOCK_READ_THREAD.returned} · offset ${MOCK_READ_THREAD.offset}`)}`,
  );
  s.push(dim("    Expand for details") + "\n");

  // ------------------------------------------------------------------
  // nmem_read_thread — 展开
  // ------------------------------------------------------------------
  s.push(bold(`▎nmem_read_thread · ${MOCK_READ_THREAD.title}`));
  s.push(
    `    ${dim("created")} ${valueColor.text(MOCK_READ_THREAD.created_at)}`,
  );
  s.push("");
  for (const msg of MOCK_READ_THREAD.messages) {
    s.push(
      `  ${fg(roleColor(msg.role), `[${msg.role}]`.padEnd(11))} ${valueColor.text(msg.content)}`,
    );
  }
  s.push("");
  s.push(
    `  ${dim(`${MOCK_READ_THREAD.total_messages} messages · returned ${MOCK_READ_THREAD.returned} · offset ${MOCK_READ_THREAD.offset}`)}\n`,
  );

  // ------------------------------------------------------------------
  // nmem_save_memory — 创建 (折叠)
  // ------------------------------------------------------------------
  s.push(bold("▎nmem_save_memory · created"));
  s.push(
    `  ${fg(COLORS.success, "✓ created")} ${valueColor.id(MOCK_SAVE_MEMORY_CREATE.id)} ${valueColor.text(MOCK_SAVE_MEMORY_CREATE.title)}`,
  );
  s.push("");

  // ------------------------------------------------------------------
  // nmem_save_memory — 创建 (展开)
  // ------------------------------------------------------------------
  s.push(bold("▎nmem_save_memory · created (expanded)"));
  s.push(`  ${dim("id")}         ${valueColor.id(MOCK_SAVE_MEMORY_CREATE.id)}`);
  s.push(
    `  ${dim("title")}     ${valueColor.text(MOCK_SAVE_MEMORY_CREATE.title)}`,
  );
  s.push(
    `  ${dim("content")}   ${valueColor.text("Final TUI render spec for 3 nmem tools: collapsed/expanded/error states, pi standard ThemeColor, value-type coloring, no emoji, no borders.")}`,
  );
  s.push(`  ${dim("type")}      ${valueColor.enum("decision")}`);
  s.push(`  ${dim("importance")} ${valueColor.number("0.80")}`);
  s.push("");

  // ------------------------------------------------------------------
  // nmem_save_memory — 更新 (折叠)
  // ------------------------------------------------------------------
  s.push(bold("▎nmem_save_memory · updated"));
  s.push(
    `  ${fg(COLORS.success, "✓ updated")} ${valueColor.id(MOCK_SAVE_MEMORY_UPDATE.id)} ${valueColor.text(MOCK_SAVE_MEMORY_UPDATE.title)}`,
  );
  s.push("");

  // ------------------------------------------------------------------
  // nmem_save_memory — 更新 (展开)
  // ------------------------------------------------------------------
  s.push(bold("▎nmem_save_memory · updated (expanded)"));
  s.push(`  ${dim("id")}         ${valueColor.id(MOCK_SAVE_MEMORY_UPDATE.id)}`);
  s.push(
    `  ${dim("title")}     ${valueColor.text(MOCK_SAVE_MEMORY_UPDATE.title)}`,
  );
  s.push(`  ${dim("type")}      ${valueColor.enum("decision")}`);
  s.push(`  ${dim("importance")} ${valueColor.number("0.90")}`);
  s.push(
    `  ${dim("updated")}   ${valueColor.text("title, content, importance")}`,
  );
  s.push("");

  // ------------------------------------------------------------------
  // nmem_save_memory — 带警告 (折叠)
  // ------------------------------------------------------------------
  s.push(bold("▎nmem_save_memory · updated (1 warning)"));
  s.push(
    `  ${fg(COLORS.success, "✓ updated")} ${valueColor.id(MOCK_SAVE_MEMORY_WARNING.id)} ${valueColor.text(MOCK_SAVE_MEMORY_WARNING.title)} ${fg(COLORS.warning, "(1 warning)")}`,
  );
  s.push("");

  // ------------------------------------------------------------------
  // nmem_save_memory — 带警告 (展开)
  // ------------------------------------------------------------------
  s.push(bold("▎nmem_save_memory · updated (1 warning) (expanded)"));
  s.push(
    `  ${dim("id")}         ${valueColor.id(MOCK_SAVE_MEMORY_WARNING.id)}`,
  );
  s.push(
    `  ${dim("title")}     ${valueColor.text(MOCK_SAVE_MEMORY_WARNING.title)}`,
  );
  s.push(`  ${dim("type")}      ${valueColor.enum("decision")}`);
  s.push(`  ${dim("importance")} ${valueColor.number("0.70")}`);
  s.push(`  ${dim("updated")}   ${valueColor.text("title, content")}`);
  s.push(
    `  ${dim("warning")}   ${valueColor.text("labels 未变更，nmem 后端限制")}`,
  );
  s.push("");

  // ------------------------------------------------------------------
  // 错误态
  // ------------------------------------------------------------------
  s.push(bold("▎nmem_search · error"));
  s.push(
    `  ${fg(COLORS.error, `[${MOCK_ERROR.code}]`)} ${fg(COLORS.error, MOCK_ERROR.message)}`,
  );
  s.push(`  ${dim("Check: nmem backend running? apiUrl correct?")}`);

  return s.join("\n");
}

console.log(render());

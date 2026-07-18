#!/usr/bin/env node
/**
 * nmem_list_threads TUI Render Prototype (#96)
 *
 * 问题：nmem_list_threads 的人面 TUI 渲染长什么样？
 * 探索 issue #96 的 4 个决策点：
 *   1. summary（实测 avg 150 / max 244 字符）在 collapsed 显示多少
 *   2. date 展示格式（后端给自然语言 "Jul 18, 2026"，原样 or 转 ISO）
 *   3. 分页 hint/total/has_more 页脚呈现
 *   4. 对齐 renderThreadsCollapsed/Expanded 还是另起布局
 *
 * 方法：3 个变体，聚焦 collapsed 的 summary 处理（scan / judge / read 三种
 * 信息层级），expanded 统一。date 用自然语言（#87「如实显示后端文本，不翻译」）、
 * footer 用 hint，跨变体一致以干净对比 summary 轴；ISO date 与结构化 footer
 * 作旁注呈现，让 #96 记录显式决策。
 *
 * 数据：真实 GET /threads?limit=20 快照（2026-07-18，total=2083），嵌入以保证
 * 可独立运行；summary 非空 19/20、中位 145、max 244，与 #95 实测吻合。
 *
 * 配色遵循 #87：pi 标准 ThemeColor、label 小写+dim、值类型着色
 * （id→muted、number→toolOutput、enum→accent、text→text）、`·` 分隔。
 *
 * Usage: node packages/nmem/prototype/list-threads-render-prototype.mjs
 */

// ============================================================================
// ANSI 颜色工具（模拟 pi TUI theme.fg，token 映射 pi 标准 ThemeColor）
// ============================================================================
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";

const COLORS = {
  toolTitle: "\x1b[38;5;39m",
  success: "\x1b[38;5;76m",
  warning: "\x1b[38;5;214m",
  error: "\x1b[38;5;196m",
  muted: "\x1b[38;5;244m",
  dim: "\x1b[38;5;240m",
  accent: "\x1b[38;5;141m",
  text: "\x1b[38;5;255m",
  toolOutput: "\x1b[38;5;81m",
};

function bold(s) { return `${BOLD}${s}${RESET}`; }
function fg(c, s) { return `${c}${s}${RESET}`; }
function dim(s) { return `${DIM}${s}${RESET}`; }

const valueColor = {
  id: (v) => fg(COLORS.muted, v),
  number: (v) => fg(COLORS.toolOutput, v),
  enum: (v) => fg(COLORS.accent, v),
  text: (v) => fg(COLORS.text, v),
};

// ============================================================================
// 显示宽度工具（CJK 双宽，原型用；正式实现应走 pi 的宽度感知截断）
// ============================================================================
function charWidth(c) {
  const code = c.codePointAt(0);
  if (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0x33bf) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0x4e00 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff01 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x20000 && code <= 0x2fffd)
  )
    return 2;
  return 1;
}
function dispWidth(s) {
  let w = 0;
  for (const c of s) w += charWidth(c);
  return w;
}
function hardBreak(s, maxW) {
  const parts = [];
  let w = 0,
    out = "";
  for (const c of s) {
    const cw = charWidth(c);
    if (w + cw > maxW && out) {
      parts.push(out);
      out = c;
      w = cw;
    } else {
      out += c;
      w += cw;
    }
  }
  if (out) parts.push(out);
  return parts;
}
// 词感知截断：硬截到 maxW-1 后回退到最后一个空格（避免断在词中间），加 …。
function truncateWidth(s, maxW) {
  if (dispWidth(s) <= maxW) return s;
  let w = 0,
    out = "";
  for (const c of s) {
    const cw = charWidth(c);
    if (w + cw > maxW - 1) break; // 留 1 给 …
    out += c;
    w += cw;
  }
  const lastSpace = out.lastIndexOf(" ");
  if (lastSpace > maxW * 0.5) out = out.slice(0, lastSpace);
  return out.replace(/\s+$/, "") + "…";
}
// 词感知换行：尽量在空格处断行，仅对超宽的无空格 CJK 串硬断；保留原文空格。
function wrapWidth(s, maxW) {
  const lines = [];
  let line = "",
    lineW = 0;
  for (const tok of s.split(/(\s+)/)) {
    if (tok === "") continue;
    const tokW = dispWidth(tok);
    if (/^\s+$/.test(tok)) {
      if (lineW === 0) continue;
      if (lineW + tokW <= maxW) {
        line += tok;
        lineW += tokW;
      } else {
        lines.push(line);
        line = "";
        lineW = 0;
      }
    } else if (lineW === 0) {
      if (tokW <= maxW) {
        line = tok;
        lineW = tokW;
      } else {
        const parts = hardBreak(tok, maxW);
        for (let k = 0; k < parts.length - 1; k++) lines.push(parts[k]);
        line = parts[parts.length - 1];
        lineW = dispWidth(line);
      }
    } else if (lineW + tokW <= maxW) {
      line += tok;
      lineW += tokW;
    } else {
      lines.push(line);
      if (tokW <= maxW) {
        line = tok;
        lineW = tokW;
      } else {
        const parts = hardBreak(tok, maxW);
        for (let k = 0; k < parts.length - 1; k++) lines.push(parts[k]);
        line = parts[parts.length - 1];
        lineW = dispWidth(line);
      }
    }
  }
  if (line) lines.push(line);
  return lines;
}

// ============================================================================
// 真实数据快照（GET /threads?limit=20, 2026-07-18, total=2083）
// ThreadListItem shape (spec #95): { id, title, summary, date, source, message_count }
// ============================================================================
const RAW_THREADS = [
  { id: "pi-019f7606-7393-7440-aa94-330ce4243a94", title: "审查 spec #95 及用户决策反馈", summary: "用户请求对 spec #95 进行审查，助手逐项验证后提出五个决策问题。用户回复确认了大多数推荐，并对 Q3 和 Q6 做出了具体指示，要求拆分子议题并调整范围。", date: "Jul 18, 2026", source: "pi", message_count: 69 },
  { id: "pi-019f75a2-215b-7839-8643-b2164eb65172", title: "#93/#94 变更决策：暴露会话开始时刻与设计 nmem_list_threads 工具", summary: "通过 grill-with-docs 会话确定了两个 GitHub issue 的变更方案：1) 在 read_thread 返回中暴露 messages[0].timestamp 作为会话开始时刻，并移除不可靠的导入时间 created_at；2) 设计了新的 nmem_list_threads 工具，包含 summary 字段，但由于后端不支持时间过滤，仅保留导入日期 date 作为降级粗筛，并确定了测试策略（保持真实后端，无 fetch mock）。", date: "Jul 18, 2026", source: "pi", message_count: 80 },
  { id: "pi-019f759e-77e9-7f8a-8592-0bf756184cb0", title: "pi-extensions 分支状态梳理与 #93/#94 新分支创建", summary: "用户检查了 pi-extensions 项目的分支与工作区状态，确认多个本地分支已合入 main 可清理。随后，用户根据 GitHub issues #93 (暴露 thread timestamp) 和 #94 (新增 list_threads 工具) 的需求，将相关的研究文档 (r3, r4) 从原分支迁移到新建的分支 feat/nmem-tools-timestamp-and-list 上，为开始这两个 issue 的开发做好了环境准备。", date: "Jul 18, 2026", source: "pi", message_count: 38 },
  { id: "pi-019f754a-6cdd-7248-a4f3-f0a4f8dccdc8", title: "daily-recap技能适配nmem插件的优化决策与具体方案", summary: "讨论并确定了daily-recap技能适配nmem插件的迁移策略：深度读取远程线程内容使用插件（nmem_read_thread），而列表生成等不支持的功能仍使用nmem CLI。用户决策采用4:00 CST作为日期分割点，并提交了功能增强issue（#93暴露timestamp，#94新增列举工具）到pi-extensions项目。详细确认了需要修复的P0级数据路径缺陷（日期解析统一到CST、搜索逻辑改进、空集兜底）。", date: "Jul 18, 2026", source: "pi", message_count: 105 },
  { id: "pi-019f7567-4358-766e-8912-08b10ec61963", title: "nmem CLI 线程精确创建时刻调研", summary: "用户正在调研 nmem CLI 能否读取线程（thread）的精确创建时刻（带时分秒）。背景是需要为 daily-recap 技能按 CST 04:00 分界处理远程会话。当前对话显示正在通过 CLI 实测、检查 REST API 文档和源码进行技术验证。", date: "Jul 18, 2026", source: "pi", message_count: 36 },
  { id: "pi-019f7568-9f18-7067-89ea-57de386a70fa", title: "nmem CLI 线程时间戳调研及结论", summary: "", date: "Jul 18, 2026", source: "pi", message_count: 85 },
  { id: "pi-019f753c-0518-76b7-bedd-7ae8b8b770c6", title: "daily-recap 技能结构审查与改进建议", summary: "对 knowledge/daily-recap/ 技能进行了基于 writing-great-skills 框架的审查，并结合历史会话追踪了其三版演进过程。主要发现是 Step 0 与 Step 1a 存在职责重叠（实为v2->v3刻意简化遗留）、对外部 obsidian-diary 技能存在依赖风险、以及代码与文档中存在三处描述重复。报告结合会话历史修正了初始判断，提出了具体重构建议，如明确步骤边界、内联完成原则、统一说明位置。", date: "Jul 18, 2026", source: "pi", message_count: 52 },
  { id: "pi-019f7539-5e4a-78e9-b443-589cb38c3d5c", title: "pi-context-prune 插件功能说明", summary: "用户询问名为“pi-context-prune”的插件功能。AI助理从项目 README.md 中读取了详细说明，解释了该插件用于压缩和总结大型语言模型（LLM）编码代理会话中的工具调用输出，以节省上下文空间，并介绍了其核心工作流程、触发模式及特点。", date: "Jul 18, 2026", source: "pi", message_count: 6 },
  { id: "pi-019f7534-ca5c-74a0-820d-058a31607fd8", title: "批量技能翻译：中英对照分段", summary: "对话内容包括对 batch-grill-me 技能文件（SKILL.md 和 openai.yaml）进行中英文逐段对照翻译，以及对比分析 grill-me 与 grill-with-docs 两个相关技能的功能差异（两者均委托 /grilling 会话，后者额外挂载 /domain-modeling 生成文档）。", date: "Jul 18, 2026", source: "pi", message_count: 26 },
  { id: "pi-019f74fa-920e-7a3b-92d6-75b47caf8e4f", title: "howaboua/pi-stuff 仓库及其 pi-ask 插件功能详解", summary: "用户询问 howaboua/pi-stuff 仓库的用途及其内部 pi-ask 插件的功能。该仓库是一个以 monorepo 形式发布的 Pi 编码代理扩展与技能集合，旨在增强代理在长会话中的实用性。对话随后深入解析了 pi-ask 插件的架构、工具定义、两种交互后端（TUI 和 Pi UI）以及核心的提示词设计模型。", date: "Jul 18, 2026", source: "pi", message_count: 22 },
  { id: "pi-019f72f2-174f-710a-8cef-31ce52b34d03", title: "pix-footer 依赖关系探究", summary: "该线程探讨了@xynogen/pix-footer扩展的依赖关系，将其划分为四类机制：显式声明的pix-*包依赖、与Pi编码代理运行时的深度耦合、对pix-core分层架构的适配，以及内部实现的工具函数。", date: "Jul 18, 2026", source: "pi", message_count: 12 },
  { id: "pi-019f7130-5899-777e-89dd-bdb9fe96902a", title: "HashLine编辑工具历史调研与错误模式总结", summary: "对Pi生态中的编辑工具（pi原生edit、pi-readseek、pi-hashline-edit）进行了三阶段历史梳理与性能分析。核心结论指出，当前pi-hashline-edit（LINE#HASH锚点）的整体错误率为13.06%，会话恢复率达95%，并详细对比了三种工具在机制、错误模式与恢复路径上的差异。", date: "Jul 17, 2026", source: "pi", message_count: 25 },
  { id: "pi-019f7127-a5a7-7144-8243-75a622861414", title: "多机Agent会话日报整理流程", summary: "用户执行了完整的daily-recap技能流程，从nmem和本地JSONL文件中提取多台机器上2026-07-17的AI Agent会话。将总计72个会话（52个本机、20个纯远程）进行主题识别与聚合，区分为工作日志与个人日记，并最终补全写入了对应的Obsidian日记文件。", date: "Jul 17, 2026", source: "pi", message_count: 40 },
  { id: "pi-019f7119-f88c-725b-a9ab-a125c473c5a6", title: "GLM-5.2多设备用量统计与缓存定价分析", summary: "用户使用tokscale工具统计了2026-06-14至2026-07-17期间，ark-coding-plan提供的GLM-5.2模型在本机和远程工作机（cnife.work-pc）上的token用量与费用。统计显示两台设备合计输入3704万、输出1159万、缓存读取7.41亿，总费用为295.59美元。用户随后对比了智谱官方价格与火山方舟Coding Plan套餐的折扣，并分析了输入、输出、缓存三项的token数量与费用占比，以及与DeepSeek V4 Pro缓存折扣率的差异。", date: "Jul 17, 2026", source: "pi", message_count: 91 },
  { id: "omp-019f710b-3a05-7000-b15e-70c0c41ac010", title: "将 pi 的模型供应商与密钥迁移至 omp", summary: "该对话详细记录了从 pi 工具迁移模型供应商和 API 密钥到 omp 工具的全过程。主要工作包括识别并迁移了 ollama-cloud 与 crof 两个供应商及其密钥，为 ark-coding-plan 和 xcode-best 两个现有供应商补充了缺失的模型配置（如 minimax-m3, kimi-k2.7-code, gpt-5.6-luna/terra/sol），并对修改后的配置进行了功能验证。", date: "Jul 17, 2026", source: "omp", message_count: 108 },
  { id: "omp-019f7121-9d30-7000-9e29-73d98c03295d", title: "Just say 'OK' once.", summary: "这是一个极简的指令-执行交互。用户要求助手只说一次“OK”，助手以思考状态回复了“OK”。", date: "Jul 17, 2026", source: "omp", message_count: 2 },
  { id: "pi-019f710e-74a2-7000-b59e-17733aa37962", title: "omp pi插件 nmem 测试与工具注册调试", summary: "用户在 omp 中测试自定义 pi 插件 @cnife/pi-nmem，验证其连接 nmem 后端成功，但发现调用 nmem_search 工具时因主题渲染函数 (theme.bold) 错误导致 TUI 冻结。随后，用户卸载原插件并安装了新插件 nowledge-mem-omp@0.1.0 以继续调试。", date: "Jul 17, 2026", source: "pi", message_count: 84 },
  { id: "omp-019f711a-582d-7000-bb1a-4ad8f17583ac", title: "用户要求助手说“OK”", summary: "用户发送了一条消息，要求助手仅说一次“OK”。助手遵循了指令，回复了“OK”。这是一个非常简单的交互，没有包含实质性的技术讨论或决策内容。", date: "Jul 17, 2026", source: "omp", message_count: 2 },
  { id: "omp-019f7119-ae60-7000-a915-682006e35624", title: "只说一次‘OK’", summary: "用户指示 AI 只说一次‘OK’。AI 遵照指令，回复了‘OK’。", date: "Jul 17, 2026", source: "omp", message_count: 2 },
  { id: "omp-019f7119-300a-7000-a49d-ad431afa3b20", title: "一次简单的‘OK’确认", summary: "用户向 MiMo 发出明确指令，要求仅回复“OK”一次。助理遵循指令，给出了简单的“OK”作为回应，对话结束。", date: "Jul 17, 2026", source: "omp", message_count: 2 },
];

// ThreadListResult (spec #95, 扁平): { returned, threads, total, has_more, hint, note? }
// 后端原始 pagination 无 hint 字段；hint 由 shaping 层按 has_more 生成。
const LIST_RESULT = {
  returned: 20,
  threads: RAW_THREADS,
  total: 2083,
  has_more: true,
  hint: "2063 more · offset 20",
  note: undefined,
};
const END_RESULT = {
  returned: 3,
  threads: RAW_THREADS.slice(0, 3),
  total: 2083,
  has_more: false,
  hint: "no more · 2083 total",
  note: undefined,
};
const EMPTY_RESULT = {
  returned: 0,
  threads: [],
  total: 0,
  has_more: false,
  hint: "",
  note: "no synced threads",
};

// ============================================================================
// renderCall（共享，对齐现有三工具：toolTitle+bold 工具名 · dim 参数回显）
// ============================================================================
function renderCall(args) {
  const parts = [fg(COLORS.toolTitle, bold("nmem_list_threads"))];
  if (args.limit) parts.push(fg(COLORS.dim, ` · limit ${args.limit}`));
  if (args.source) parts.push(fg(COLORS.dim, ` · source ${args.source}`));
  return parts.join("");
}

// ============================================================================
// 共享片段
// ============================================================================
function headerLine(r) {
  return `  ${fg(COLORS.text, `${r.returned} of ${r.total} threads`)}`;
}
function footerHint(r) {
  return `  ${dim(r.hint)}`;
}
function expandHint() {
  return dim("    Expand for details");
}
// collapsed 元信息：全 dim（对齐 search 的 `${mc} messages, ${m} matches` 全 dim 风格）
function metaSuffix(t) {
  return dim(`${t.date} · ${t.message_count} messages · ${t.source}`);
}

// ============================================================================
// Variant A · minimal — summary 在 collapsed 隐藏（scan：扫标题挑读）
// ============================================================================
function renderA_collapsed(r) {
  const s = [];
  s.push(headerLine(r));
  r.threads.forEach((t, i) => {
    s.push(`  ${fg(COLORS.accent, `${i + 1}.`)} ${valueColor.text(t.title)}  ${metaSuffix(t)}`);
  });
  s.push(footerHint(r));
  s.push(expandHint());
  return s.join("\n");
}

// ============================================================================
// Variant B · summary-forward — summary 截断一行（judge：读摘要判断）
// ============================================================================
const TRUNC_W = 78; // 显示宽（CJK 双宽），5 空格缩进后约填 100 列终端
function renderB_collapsed(r) {
  const s = [];
  s.push(headerLine(r));
  r.threads.forEach((t, i) => {
    s.push(`  ${fg(COLORS.accent, `${i + 1}.`)} ${valueColor.text(t.title)}  ${metaSuffix(t)}`);
    const sum = t.summary ? truncateWidth(t.summary, TRUNC_W) : dim("(no summary)");
    s.push(`     ${valueColor.text(sum)}`);
  });
  s.push(footerHint(r));
  s.push(expandHint());
  return s.join("\n");
}

// ============================================================================
// Variant C · full body — summary 全文换行（read：当摘要列表通读）
// ============================================================================
const WRAP_W = 80;
function renderC_collapsed(r) {
  const s = [];
  s.push(headerLine(r));
  r.threads.forEach((t, i) => {
    s.push(`  ${fg(COLORS.accent, `${i + 1}.`)} ${valueColor.text(t.title)}  ${metaSuffix(t)}`);
    if (t.summary) {
      for (const ln of wrapWidth(t.summary, WRAP_W)) {
        s.push(`     ${valueColor.text(ln)}`);
      }
    } else {
      s.push(`     ${dim("(no summary)")}`);
    }
  });
  s.push(footerHint(r));
  s.push(expandHint());
  return s.join("\n");
}

// ============================================================================
// expanded（A/B/C 共享：全字段块 + 全文 summary 单行，对齐 memories expanded）
// ============================================================================
function renderExpanded(r, maxItems = 6) {
  const s = [];
  const items = r.threads.slice(0, maxItems);
  for (const t of items) {
    s.push(`  ${bold(valueColor.text(t.title))}`);
    s.push(`    ${dim("id")}       ${valueColor.id(t.id)}`);
    s.push(`    ${dim("date")}     ${valueColor.text(t.date)}`);
    s.push(`    ${dim("source")}   ${valueColor.enum(t.source)}`);
    s.push(`    ${dim("messages")} ${valueColor.number(`${t.message_count}`)}`);
    s.push(`    ${dim("summary")}  ${valueColor.text(t.summary || "(empty)")}`);
    s.push("");
  }
  s.push(`  ${dim(`${r.returned} of ${r.total} threads · ${r.hint}`)}`);
  return s.join("\n");
}

// ============================================================================
// 空状态
// ============================================================================
function renderEmpty(r) {
  const s = [];
  s.push(`  ${fg(COLORS.text, "0 threads")}`);
  s.push(`  ${dim(r.note)}`);
  return s.join("\n");
}

// ============================================================================
// 错误态（复用 renderError 模式：toolTitle · error + error 文本）
// ============================================================================
function renderError(msg) {
  const title = `${fg(COLORS.toolTitle, bold("nmem_list_threads"))} ${fg(COLORS.error, "· error")}`;
  return `${title}\n  ${fg(COLORS.error, msg)}`;
}

// ============================================================================
// 旁注：date 格式 / footer 格式（让 #96 记录显式决策）
// ============================================================================
function sideNoteDate() {
  const t = RAW_THREADS[0];
  const s = [];
  s.push(`  ${dim("natural（后端原样，#87 不翻译）:")} ${valueColor.text(t.date)}`);
  s.push(`  ${dim("ISO（client 解析转换）:        ")} ${valueColor.text("2026-07-18")}`);
  return s.join("\n");
}
function sideNoteFooter(r) {
  const s = [];
  s.push(`  ${dim("hint 风格（默认，对齐 read_thread）:")} ${dim(r.hint)}`);
  s.push(`  ${dim("structured 风格:                 ")} ${dim(`${r.returned}/${r.total} · ↓ has_more`)}`);
  return s.join("\n");
}

// ============================================================================
// 主渲染
// ============================================================================
function section(title) {
  return `\n${bold(fg(COLORS.toolTitle, `▎${title}`))}`;
}

function render() {
  const s = [];
  s.push(`\n${fg(COLORS.toolTitle, bold("═══ nmem_list_threads · TUI Render Prototype (#96) ═══"))}`);
  s.push(dim("3 variants on collapsed summary treatment · expanded shared · #87 colors") + "\n");

  s.push(section("renderCall（对齐现有三工具：toolTitle+bold 工具名 · dim 参数回显）"));
  s.push(`  ${renderCall({})}  ${dim("(defaults，无回显)")}`);
  s.push(`  ${renderCall({ limit: 20 })}`);
  s.push(`  ${renderCall({ limit: 20, source: "pi" })}`);

  s.push(section("Variant A · minimal — summary 在 collapsed 隐藏（scan）"));
  s.push(dim("  对齐 renderThreadsCollapsed：编号 + 标题 + dim 元信息，无 summary"));
  s.push(renderA_collapsed(LIST_RESULT));

  s.push(section("Variant B · summary-forward — summary 截断一行（judge）"));
  s.push(dim("  两行/条：标题+元信息 / 截断 summary（~78 显示宽 + …）"));
  s.push(renderB_collapsed(LIST_RESULT));

  s.push(section("Variant C · full body — summary 全文换行（read）"));
  s.push(dim("  多行/条：标题+元信息 / 全文 summary 换行（~80 显示宽）"));
  s.push(renderC_collapsed(LIST_RESULT));

  s.push(section("expanded（A/B/C 共享：全字段块 + 全文 summary 单行，显示 6/20）"));
  s.push(renderExpanded(LIST_RESULT, 6));

  s.push(section("分页状态 · has_more=false（末页，Variant A 风格）"));
  s.push(renderA_collapsed(END_RESULT));

  s.push(section("分页状态 · empty（空结果 + note）"));
  s.push(renderEmpty(EMPTY_RESULT));

  s.push(section("错误态（复用 renderError）"));
  s.push(renderError("Connection refused: http://127.0.0.1:14242"));

  s.push(section("旁注 · date 格式（#96 决策点 2）"));
  s.push(sideNoteDate());

  s.push(section("旁注 · footer 格式（#96 决策点 3）"));
  s.push(sideNoteFooter(LIST_RESULT));

  return s.join("\n");
}

console.log(render());

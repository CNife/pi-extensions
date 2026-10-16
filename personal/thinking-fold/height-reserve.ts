import {
  AssistantMessageComponent,
  ToolExecutionComponent,
  UserMessageComponent,
} from "@earendil-works/pi-coding-agent";
import {
  type Component,
  Container,
  isViewportTUI,
  type TUI,
} from "@earendil-works/pi-tui";

/**
 * 高度留白（issue #187 / ADR 0005）。
 *
 * fullscreen 下 transcript 变矮会把 follow-end 视口整体顶下去。折叠砍掉多少行，
 * 就在 transcript 内容末尾补多少行空行（**高度留白**），把这笔高度记成
 * **高度债**；后续内容每长高一行就撤掉一行留白。总高度恒定则视口静止。
 *
 * regular 模式走主屏 + scrollback，没有这个问题也不该往 scrollback 塞空行，
 * 因此用 `isViewportTUI` 判定后整个机制 no-op。
 */

// ============================================================================
// 债务算术（可单独测试的纯函数）
// ============================================================================

/**
 * 单段推理折叠后腾出来的高度：流式预览本就只显示尾 `previewLines` 行，
 * 所以折掉的高度以预览行数封顶。
 *
 * 封顶是必需的：推理很短（只渲染了 3 行）时多留 10 行会有还不完的余债。
 * 按**段**封顶：一条消息里被文本隔开的两段推理各自折掉各自的高度，
 * 对总数封顶会把后面的段漏掉。
 */
export function foldedHeight(
  previewLines: number,
  renderedLineCount: number,
): number {
  return Math.min(Math.max(0, previewLines), Math.max(0, renderedLineCount));
}

/** 折叠时新增的高度债：把各段腾出的高度累加起来（已按段封顶）。 */
export function foldDebt(debt: number, freedLines: number): number {
  return Math.max(0, debt) + Math.max(0, freedLines);
}

/**
 * 一帧渲染后的高度债：只对增长计偿还（折叠那一帧是变矮的，增量自然被钳到 0），
 * 组件首帧按「上帧 = 0」计，债务不落到负数。
 */
export function nextDebt(
  debt: number,
  previousHeight: number,
  currentHeight: number,
): number {
  const grown = Math.max(0, currentHeight - previousHeight);
  return Math.max(0, Math.max(0, debt) - grown);
}

// ============================================================================
// render patch：只读高度，不改行为
// ============================================================================

interface RenderTarget {
  render(width: number): string[];
}

interface HeightPatch {
  target: RenderTarget;
  original: RenderTarget["render"];
  wrapper: RenderTarget["render"];
}

const liveReserves = new Set<HeightReserve>();
let heightPatches: HeightPatch[] | undefined;

function observeHeight(component: Component, height: number): void {
  for (const reserve of liveReserves) reserve.observe(component, height);
}

/**
 * 折叠后长高的 transcript 内容（助手文本、工具块、用户消息）是留白的偿还来源；
 * 这里只量高，不动渲染结果。不进这条路的（状态行、编辑器）不参与偿还。
 */
function installHeightPatches(): void {
  if (heightPatches) return;
  const targets = [
    AssistantMessageComponent,
    ToolExecutionComponent,
    UserMessageComponent,
  ].map((component) => component.prototype as unknown as RenderTarget);
  // 全部确认可用后才动手，避免半途抛错留下半个 patch。
  if (targets.some((target) => typeof target.render !== "function"))
    throw new Error("Pi's transcript component rendering API is unavailable");

  heightPatches = targets.map((target) => {
    const original = target.render;
    const wrapper = function (this: Component, width: number): string[] {
      const lines = original.call(this, width);
      observeHeight(this, lines.length);
      return lines;
    };
    target.render = wrapper;
    return { target, original, wrapper };
  });
}

function uninstallHeightPatches(): void {
  if (!heightPatches) return;
  for (const { target, original, wrapper } of heightPatches) {
    // Another owner may have wrapped us in the meantime; leave their wrapper alone.
    if (target.render === wrapper) target.render = original;
  }
  heightPatches = undefined;
}

// ============================================================================
// 留白组件与债务状态
// ============================================================================

export interface HeightReserveHandle {
  /** 当前挂着的高度债行数（测试与排查用）。 */
  readonly debt: number;
  /** 折叠发生时上报本次折掉的行数；同一段推理只应上报一次，由调用方保证。 */
  noteFold(freedLines: number): void;
  /** 定位 transcript 内容容器并挂载留白；幂等，可每帧调用。 */
  sync(): void;
  /** 清债（本轮结束 / Ctrl+T 展开 / transcript 重建）。 */
  clear(): void;
  dispose(): void;
}

export interface HeightReserveOptions {
  /** 取当前 TUI。regular 模式下 `isViewportTUI` 判定失败，留白机制安静地不生效。 */
  getTui: () => TUI | undefined;
}

interface FollowingViewport {
  /** `TuiAltScreen` 的只读属性（不在 `ViewportTUI` 接口上，故结构读取）。 */
  isFollowingOutput?: boolean;
}

class HeightReserve implements Component, HeightReserveHandle {
  private debtLines = 0;
  private readonly heights = new WeakMap<Component, number>();
  private mounted?: Container;

  constructor(private readonly getTui: () => TUI | undefined) {
    liveReserves.add(this);
  }

  get debt(): number {
    return this.debtLines;
  }

  noteFold(freedLines: number): void {
    this.debtLines = foldDebt(this.debtLines, freedLines);
  }

  /**
   * 用某个 transcript 组件本帧的高度增长偿还债务。债务为 0 时也必须记录高度，
   * 否则旧组件在债务出现后的第一帧会被误判成「从 0 长高」，把已有高度当偿还。
   */
  observe(component: Component, height: number): void {
    const previous = this.heights.get(component) ?? 0;
    this.heights.set(component, height);
    if (this.debtLines <= 0) return;
    this.debtLines = nextDebt(this.debtLines, previous, height);
  }

  render(_width: number): string[] {
    // 用户滚离底部时暂停补偿：这时改几何会动到他正看着的区域。
    if (!this.isFollowing()) this.debtLines = 0;
    if (this.debtLines <= 0) return [];
    return new Array<string>(this.debtLines).fill("");
  }

  invalidate(): void {}

  sync(): void {
    const tui = this.getTui();
    if (!tui || !isViewportTUI(tui)) {
      // regular 模式走主屏 + scrollback：没有折叠位移，留白只会往历史里塞空行。
      this.unmount();
      this.clear();
      return;
    }
    const container = findTranscriptContainer(tui);
    if (!container) {
      // Pi 换了内部结构：安静降级，不抛错、不损坏渲染。
      this.unmount();
      return;
    }
    if (this.mounted && this.mounted !== container) {
      this.mounted.removeChild(this);
      this.mounted = undefined;
    }
    this.mounted = container;
    if (!container.children.includes(this)) container.addChild(this);
  }

  clear(): void {
    this.debtLines = 0;
  }

  dispose(): void {
    if (!liveReserves.delete(this)) return;
    this.unmount();
    if (liveReserves.size === 0) uninstallHeightPatches();
  }

  private isFollowing(): boolean {
    const tui = this.getTui();
    if (!tui || !isViewportTUI(tui)) return false;
    return (tui as TUI & FollowingViewport).isFollowingOutput !== false;
  }

  private unmount(): void {
    if (!this.mounted) return;
    this.mounted.removeChild(this);
    this.mounted = undefined;
  }
}

/**
 * 找 transcript 的内容容器（`chatContainer` 的父节点），留白挂在它的末尾、
 * 与 `chatContainer` 同级：挂进 `chatContainer.children` 会被 host 的
 * `splice` / `clear` 误伤。不依赖子节点顺序，只认「直接装着助手消息组件」。
 */
function findTranscriptContainer(tui: TUI): Container | undefined {
  for (const root of tui.children) {
    if (!(root instanceof Container)) continue;
    for (const child of root.children) {
      if (!(child instanceof Container)) continue;
      if (
        child.children.some((node) => node instanceof AssistantMessageComponent)
      )
        return root;
    }
  }
  return undefined;
}

export function installHeightReserve(
  getTui: HeightReserveOptions["getTui"],
): HeightReserveHandle {
  installHeightPatches();
  return new HeightReserve(getTui);
}

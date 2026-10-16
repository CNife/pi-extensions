import type { AssistantMessage } from "@earendil-works/pi-ai";
import {
  AssistantMessageComponent,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import { type Component, Markdown, Text } from "@earendil-works/pi-tui";
import { foldedHeight } from "./height-reserve.ts";

export interface ThinkingFoldOptions {
  getTheme?: () => Theme;
  previewLines: number;
  toggleKey: string;
}

export interface ThinkingTiming {
  startedAt: number;
  completedAt?: number;
}

export interface ThinkingDisplayState {
  timing?: ThinkingTiming;
  now?: number;
}

export const DEFAULT_THINKING_CURSOR_LABEL = "Thinking...";

export const DEFAULT_THINKING_FOLD_OPTIONS: ThinkingFoldOptions = {
  previewLines: 10,
  toggleKey: "ctrl+t",
};

// Fixed trace behavior: streaming shows a tail preview, completed collapses to
// a single timed line. No summary path, no per-model detection. Expanded turns
// return early in rebuild(), so only these two folded behaviors remain.
type EffectiveBehavior = "collapse" | "preview";

interface ComponentState {
  fullMessage?: AssistantMessage;
  renderedMessage?: AssistantMessage;
  isStreaming?: boolean;
  /** 已经折叠但还没把砍掉的高度上报出去（等这一帧渲染出真实行数）。 */
  foldPending?: boolean;
}

interface AssistantMessageInternals {
  contentContainer?: { children?: Component[] };
  hideThinkingBlock?: boolean;
  thinkingVisibilityOverrides?: Map<number, boolean>;
}

// Pi wraps each thinking section's Markdown in a MouseRegion (left click
// toggles that section's visibility). Stay structural: never import
// MouseRegion or its event types.
interface ThinkingMouseRegion extends Component {
  child: Component;
  handleMouse(event: {
    type: string;
    button?: string;
  }): { handled: true } | undefined;
}

function getThinkingMouseRegion(
  component: Component,
): ThinkingMouseRegion | undefined {
  const region = component as Partial<ThinkingMouseRegion>;
  return region.child &&
    (region.child instanceof Markdown ||
      region.child instanceof RenderedThinkingSection) &&
    typeof region.handleMouse === "function"
    ? (region as ThinkingMouseRegion)
    : undefined;
}

interface MarkdownInternals {
  text?: string;
  paddingX?: number;
}

interface PatchRecord {
  owners: number;
  expanded: boolean;
  now: number;
  options: ThinkingFoldOptions;
  originalUpdate: (
    this: AssistantMessageComponent,
    message: AssistantMessage,
    isStreaming?: boolean,
  ) => void;
  states: WeakMap<AssistantMessageComponent, ComponentState>;
  components: Set<WeakRef<AssistantMessageComponent>>;
  knownComponents: WeakSet<AssistantMessageComponent>;
  timings: Map<number, ThinkingTiming>;
  hooks?: ThinkingFoldHooks;
  /** 正在上报折叠的时间戳；只有这一次重建算「折叠那一帧」。 */
  foldingTimestamp?: number;
  /**
   * 递增的代数。清债（收尾 / 展开 / transcript 重建）会 +1，
   * 让已经挂起但还没渲染的那次上报作废。
   */
  foldGeneration: number;
  updateOptions(options: Partial<ThinkingFoldOptions>): void;
  setExpanded(expanded: boolean): void;
  setMessageTiming(timestamp: number, timing: ThinkingTiming): void;
  beginMessage(message: AssistantMessage, startedAt?: number): void;
  completeMessage(message: AssistantMessage, completedAt?: number): void;
  tick(now?: number): void;
  rerenderAll(): void;
  rerenderTimestamp(timestamp: number): void;
  cancelPendingFolds(): void;
}

/**
 * 折叠发生时的上报钩子。高度留白机制靠它知道自己该留多少行：
 * 折叠砍掉的高度按**段**封顶后累加（见 height-reserve.ts 的 \`foldedHeight\`）。
 */
export interface ThinkingFoldHooks {
  /** 本次折叠腾出的高度（各行按预览行数逐段封顶后累加）。 */
  onFold?(freedLines: number): void;
}

export interface ThinkingFoldPatchHandle {
  readonly expanded: boolean;
  readonly options: ThinkingFoldOptions;
  updateOptions(options: Partial<ThinkingFoldOptions>): void;
  setExpanded(expanded: boolean): void;
  toggle(): void;
  setMessageTiming(timestamp: number, timing: ThinkingTiming): void;
  beginMessage(message: AssistantMessage, startedAt?: number): void;
  completeMessage(message: AssistantMessage, completedAt?: number): void;
  tick(now?: number): void;
  /** 作废已挂起但还没渲染的折叠上报；清债时调用。 */
  cancelPendingFolds(): void;
  dispose(): void;
}

const PATCH_SYMBOL = Symbol.for(
  "@99percentpeople/pi-thinking-fold/assistant-message-patch",
);

function normalizedOptions(
  options: Partial<ThinkingFoldOptions>,
): ThinkingFoldOptions {
  const previewLines =
    options.previewLines ?? DEFAULT_THINKING_FOLD_OPTIONS.previewLines;
  return {
    getTheme: options.getTheme,
    previewLines:
      Number.isInteger(previewLines) && previewLines > 0
        ? previewLines
        : DEFAULT_THINKING_FOLD_OPTIONS.previewLines,
    toggleKey:
      options.toggleKey?.trim() || DEFAULT_THINKING_FOLD_OPTIONS.toggleKey,
  };
}

export function formatThinkingSeconds(milliseconds: number): string {
  return `${(Math.max(0, milliseconds) / 1000).toFixed(1)}s`;
}

function createStreamingThinkingLabel(
  options: ThinkingFoldOptions,
  timing: ThinkingTiming | undefined,
  now: number,
  canExpand: boolean,
): string {
  const duration = timing
    ? formatThinkingSeconds(now - timing.startedAt)
    : "0.0s";
  return `Thinking ${duration}${canExpand ? `  (${options.toggleKey} to expand)` : ""}`;
}

function createCompletedThinkingLabel(
  options: ThinkingFoldOptions,
  timing: ThinkingTiming,
  canExpand: boolean,
): string {
  const completedAt = timing.completedAt ?? timing.startedAt;
  const duration = formatThinkingSeconds(completedAt - timing.startedAt);
  return `Thought for ${duration}${canExpand ? `  (${options.toggleKey} to expand)` : ""}`;
}

interface NativeThinkingRun {
  start: number;
  end: number;
  text: string;
}

interface MarkedThinkingSection {
  marker: string;
  text: string;
  showLabel: boolean;
}

interface MarkedThinkingMessage {
  message: AssistantMessage;
  sections: MarkedThinkingSection[];
}

/**
 * Shared render state for all thinking sections in one assistant message.
 * Every section is rendered first; only then do we decide whether content is
 * actually hidden and whether the expansion hint belongs in the header.
 */
class RenderedThinkingContext {
  readonly sections: RenderedThinkingSection[] = [];
  canExpand = false;
  private preparedWidth?: number;

  constructor(
    readonly behavior: EffectiveBehavior,
    readonly previewLines: number,
    readonly collapseCanExpand: boolean,
    readonly labelFor: (canExpand: boolean) => string,
    readonly getTheme: (() => Theme) | undefined,
    /**
     * 折叠当前帧才携带：折叠砍掉的高度只有真正渲染过才知道（Markdown 换行依赖
     * 终端宽度），所以在 prepare() 拿到宽度、行数落地之后才上报。
     */
    readonly onFold: ((freedLines: number) => void) | undefined,
  ) {}

  add(section: RenderedThinkingSection): void {
    this.sections.push(section);
  }

  /**
   * 折叠后腾出的高度：各段分别按预览行数封顶再累加。
   *
   * 逐段封顶而非对总数封顶——流式预览是每段各自只显示尾部 `previewLines` 行，
   * 一条消息里的多段推理各自折掉各自的高度。
   */
  get freedLineCount(): number {
    return this.sections.reduce(
      (total, section) =>
        total + foldedHeight(this.previewLines, section.renderedLineCount),
      0,
    );
  }

  prepare(width: number): void {
    if (this.preparedWidth === width) return;
    for (const section of this.sections) section.prepare(width);
    this.canExpand =
      this.behavior === "collapse"
        ? this.collapseCanExpand
        : this.sections.some(
            (section) => section.renderedLineCount > this.previewLines,
          );
    this.preparedWidth = width;
    if (this.behavior === "collapse") this.onFold?.(this.freedLineCount);
  }

  invalidate(): void {
    this.preparedWidth = undefined;
  }
}

/** Render Pi's native Markdown first, then retain its final terminal rows. */
class RenderedThinkingSection implements Component {
  private fullLines: string[] = [];
  private preparedWidth?: number;
  private labelText?: string;

  constructor(
    private readonly content: Markdown,
    private readonly label: Text | undefined,
    private readonly context: RenderedThinkingContext,
  ) {
    context.add(this);
  }

  get renderedLineCount(): number {
    return this.fullLines.length;
  }

  prepare(width: number): void {
    if (this.preparedWidth === width) return;
    this.fullLines = this.content.render(width);
    this.preparedWidth = width;
  }

  render(width: number): string[] {
    this.context.prepare(width);
    const contentLines =
      this.context.behavior === "collapse"
        ? []
        : this.fullLines.slice(-this.context.previewLines);
    if (!this.label) return contentLines;

    const labelText = this.context.labelFor(this.context.canExpand);
    const styledLabelText =
      this.context.getTheme?.().style(labelText, {
        fg: "thinkingText",
        italic: true,
      }) ?? labelText;
    if (styledLabelText !== this.labelText) {
      this.label.setText(styledLabelText);
      this.labelText = styledLabelText;
    }
    return [...this.label.render(width), ...contentLines];
  }

  invalidate(): void {
    this.content.invalidate();
    this.label?.invalidate();
    this.preparedWidth = undefined;
    this.context.invalidate();
  }
}

function collectThinkingRuns(message: AssistantMessage): NativeThinkingRun[] {
  const runs: NativeThinkingRun[] = [];
  let index = 0;
  while (index < message.content.length) {
    const block = message.content[index];
    if (!block || block.type !== "thinking") {
      index++;
      continue;
    }

    const start = index;
    const fragments: string[] = [];
    while (index < message.content.length) {
      const thinkingBlock = message.content[index];
      if (!thinkingBlock || thinkingBlock.type !== "thinking") break;
      const text = thinkingBlock.thinking.trim();
      if (text) fragments.push(text);
      index++;
    }
    runs.push({ start, end: index, text: fragments.join("\n\n") });
  }
  return runs;
}

function createMarkedThinkingMessage(
  message: AssistantMessage,
): MarkedThinkingMessage | undefined {
  const runs = collectThinkingRuns(message);
  const firstRun = runs[0];
  if (!firstRun) return undefined;

  const content = [...message.content];
  const sections: MarkedThinkingSection[] = [];
  const clearRun = (run: NativeThinkingRun) => {
    for (let index = run.start; index < run.end; index++) {
      const block = content[index];
      if (block?.type === "thinking")
        content[index] = { ...block, thinking: "" };
    }
  };
  const markRun = (
    run: NativeThinkingRun,
    runIndex: number,
    showLabel: boolean,
  ) => {
    clearRun(run);
    const block = content[run.start];
    if (!block || block.type !== "thinking") return;
    const marker = `\uE000thinking-fold:${message.timestamp}:${runIndex}\uE001`;
    content[run.start] = { ...block, thinking: marker };
    sections.push({ marker, text: run.text, showLabel });
  };

  // 每段推理都要保留成 section：折叠时高度债按「全部推理折掉的行数」计，
  // 只留第一段会漏记其余段的高度，留白补不够，位移照旧发生。
  for (const run of runs) clearRun(run);
  runs.forEach((run, runIndex) => {
    if (runIndex === 0 || run.text) markRun(run, runIndex, runIndex === 0);
  });

  return { message: { ...message, content }, sections };
}

function getMarkdownInternals(
  component: Component,
): MarkdownInternals | undefined {
  if (!(component instanceof Markdown)) return undefined;
  const internals = component as unknown as MarkdownInternals;
  return typeof internals.text === "string" &&
    typeof internals.paddingX === "number"
    ? internals
    : undefined;
}

function replaceMarkedThinkingSections(
  component: AssistantMessageComponent,
  marked: MarkedThinkingMessage,
  behavior: EffectiveBehavior,
  previewLines: number,
  collapseCanExpand: boolean,
  labelFor: (canExpand: boolean) => string,
  getTheme: (() => Theme) | undefined,
  onFold: ((freedLines: number) => void) | undefined,
): boolean {
  const internals = component as unknown as AssistantMessageInternals;
  const children = internals.contentContainer?.children;
  if (!children) return false;

  const pending = new Map(
    marked.sections.map((section) => [section.marker, section]),
  );
  const context = new RenderedThinkingContext(
    behavior,
    previewLines,
    collapseCanExpand,
    labelFor,
    getTheme,
    onFold,
  );
  for (let index = 0; index < children.length; index++) {
    const child = children[index];
    if (!child) continue;
    // Pi wraps thinking Markdown in a MouseRegion; replace inside it and
    // keep the region so native mouse routing stays intact.
    const region = getThinkingMouseRegion(child);
    const nativeMarkdown = region?.child ?? child;
    const markdown = getMarkdownInternals(nativeMarkdown);
    const section = markdown?.text ? pending.get(markdown.text) : undefined;
    if (!section || !markdown || !(nativeMarkdown instanceof Markdown))
      continue;

    nativeMarkdown.setText(section.text);
    const label = section.showLabel
      ? new Text("", markdown.paddingX, 0)
      : undefined;
    const replacement = new RenderedThinkingSection(
      nativeMarkdown,
      label,
      context,
    );
    if (region) region.child = replacement;
    else children[index] = replacement;
    pending.delete(section.marker);
  }
  return pending.size === 0;
}

function getPatchRecord(): PatchRecord | undefined {
  return (
    AssistantMessageComponent.prototype as unknown as Record<
      PropertyKey,
      unknown
    >
  )[PATCH_SYMBOL] as PatchRecord | undefined;
}

function setPatchRecord(record: PatchRecord | undefined): void {
  const prototype = AssistantMessageComponent.prototype as unknown as Record<
    PropertyKey,
    unknown
  >;
  if (record) prototype[PATCH_SYMBOL] = record;
  else delete prototype[PATCH_SYMBOL];
}

function rebuild(
  component: AssistantMessageComponent,
  state: ComponentState,
  record: PatchRecord,
): void {
  const message = state.fullMessage;
  if (!message) return;

  const internals = component as unknown as AssistantMessageInternals;
  const nativeHidden = internals.hideThinkingBlock;
  const nativeOverrides = internals.thinkingVisibilityOverrides;
  internals.hideThinkingBlock = false;
  // Native per-run hiding must not prevent marker discovery or Ctrl+T expansion.
  if (nativeOverrides) internals.thinkingVisibilityOverrides = new Map();
  try {
    if (
      record.expanded ||
      !message.content.some((block) => block.type === "thinking")
    ) {
      state.renderedMessage = message;
      record.originalUpdate.call(component, message, state.isStreaming);
      return;
    }

    const timing = record.timings.get(message.timestamp);
    const completed = timing?.completedAt !== undefined;
    const behavior: EffectiveBehavior = completed ? "collapse" : "preview";
    const marked = createMarkedThinkingMessage(message);
    if (!marked) {
      state.renderedMessage = message;
      record.originalUpdate.call(component, message, state.isStreaming);
      return;
    }

    const hasThinkingContent = message.content.some(
      (block) => block.type === "thinking" && block.thinking.trim(),
    );
    const labelFor = (canExpand: boolean) =>
      completed && timing
        ? createCompletedThinkingLabel(record.options, timing, canExpand)
        : createStreamingThinkingLabel(
            record.options,
            timing,
            record.now,
            canExpand,
          );

    // 置位而非赋值：折叠与渲染之间可能夹着多次重建（同一帧内的其它更新），
    // 上报要一直挂到某次真实渲染把它消费掉为止。
    if (record.foldingTimestamp === message.timestamp) state.foldPending = true;
    const generation = record.foldGeneration;
    const onFold = state.foldPending
      ? (freedLines: number) => {
          // 一次折叠只上报一次；期间被清债（收尾 / 展开 / 重建）也作废。
          if (!state.foldPending || record.foldGeneration !== generation)
            return;
          state.foldPending = false;
          record.hooks?.onFold?.(freedLines);
        }
      : undefined;

    state.renderedMessage = marked.message;
    record.originalUpdate.call(component, marked.message, state.isStreaming);
    const replaced = replaceMarkedThinkingSections(
      component,
      marked,
      behavior,
      record.options.previewLines,
      hasThinkingContent,
      labelFor,
      record.options.getTheme,
      onFold,
    );
    if (!replaced) {
      // Pi changed its internal child layout. Never leak markers or damage the
      // message: fall back to the complete native rendering for this component.
      state.renderedMessage = message;
      record.originalUpdate.call(component, message, state.isStreaming);
    }
  } finally {
    internals.hideThinkingBlock = nativeHidden;
    if (nativeOverrides)
      internals.thinkingVisibilityOverrides = nativeOverrides;
    // Native left click toggles per-run visibility, which fights the folded
    // representation. Rebind it to the same persistent toggle as Ctrl+T.
    for (const child of internals.contentContainer?.children ?? []) {
      const region = getThinkingMouseRegion(child);
      if (!region) continue;
      region.handleMouse = (event) => {
        if (event.type !== "click" || event.button !== "left") return undefined;
        record.setExpanded(!record.expanded);
        return { handled: true };
      };
    }
  }
}

function forEachLiveComponent(
  record: PatchRecord,
  callback: (
    component: AssistantMessageComponent,
    state: ComponentState,
  ) => void,
): void {
  for (const reference of record.components) {
    const component = reference.deref();
    if (!component) {
      record.components.delete(reference);
      continue;
    }
    const state = record.states.get(component);
    if (state) callback(component, state);
  }
}

function createPatchRecord(
  options: Partial<ThinkingFoldOptions>,
  hooks?: ThinkingFoldHooks,
): PatchRecord {
  const prototype = AssistantMessageComponent.prototype;
  const originalUpdate = prototype.updateContent;
  const record: PatchRecord = {
    owners: 0,
    expanded: false,
    now: Date.now(),
    options: normalizedOptions(options),
    hooks,
    foldGeneration: 0,
    originalUpdate,
    states: new WeakMap(),
    components: new Set(),
    knownComponents: new WeakSet(),
    timings: new Map(),
    updateOptions(next) {
      this.options = normalizedOptions({ ...this.options, ...next });
      this.rerenderAll();
    },
    setExpanded(expanded) {
      if (this.expanded === expanded) return;
      this.expanded = expanded;
      this.rerenderAll();
    },
    setMessageTiming(timestamp, timing) {
      this.timings.set(timestamp, { ...timing });
      this.rerenderTimestamp(timestamp);
    },
    beginMessage(message, startedAt = Date.now()) {
      this.timings.set(message.timestamp, { startedAt });
      this.now = startedAt;
      this.rerenderTimestamp(message.timestamp);
    },
    completeMessage(message, completedAt = Date.now()) {
      const timing = this.timings.get(message.timestamp) ?? {
        startedAt: Math.min(message.timestamp, completedAt),
      };
      if (timing.completedAt !== undefined) return;
      this.timings.set(message.timestamp, { ...timing, completedAt });
      this.now = completedAt;
      // Ctrl+T is a persistent global display preference. Auto-collapse only
      // controls the folded representation; completing a later turn must not
      // override an explicit expanded choice.
      //
      // 折叠恰好发生在这一次重建里：只有它算「折叠那一帧」，历史消息重放或
      // 后续内容更新都不会重复上报同一段推理。
      this.foldingTimestamp = message.timestamp;
      try {
        this.rerenderTimestamp(message.timestamp);
      } finally {
        this.foldingTimestamp = undefined;
      }
    },
    tick(now = Date.now()) {
      this.now = now;
      forEachLiveComponent(this, (component, state) => {
        const timestamp = state.fullMessage?.timestamp;
        if (
          timestamp === undefined ||
          this.timings.get(timestamp)?.completedAt !== undefined
        )
          return;
        rebuild(component, state, this);
      });
    },
    rerenderAll() {
      forEachLiveComponent(this, (component, state) =>
        rebuild(component, state, this),
      );
    },
    rerenderTimestamp(timestamp) {
      forEachLiveComponent(this, (component, state) => {
        if (state.fullMessage?.timestamp === timestamp)
          rebuild(component, state, this);
      });
    },
    cancelPendingFolds() {
      this.foldGeneration += 1;
      forEachLiveComponent(this, (_component, state) => {
        state.foldPending = false;
      });
    },
  };

  prototype.updateContent = function (
    message: AssistantMessage,
    isStreaming?: boolean,
  ): void {
    const state = record.states.get(this) ?? {};
    if (isStreaming !== undefined) state.isStreaming = isStreaming;

    // Container.invalidate() passes Pi's last display-only marker clone back
    // through updateContent(). Never mistake that clone for session source data.
    if (message !== state.renderedMessage) state.fullMessage = message;

    record.states.set(this, state);
    if (!record.knownComponents.has(this)) {
      record.knownComponents.add(this);
      record.components.add(new WeakRef(this));
    }
    rebuild(this, state, record);
  };

  setPatchRecord(record);
  return record;
}

export function installThinkingFoldPatch(
  options: Partial<ThinkingFoldOptions> = {},
  hooks?: ThinkingFoldHooks,
): ThinkingFoldPatchHandle {
  const prototype = AssistantMessageComponent.prototype;
  if (
    typeof prototype.updateContent !== "function" ||
    typeof prototype.render !== "function"
  ) {
    throw new Error(
      "Pi's AssistantMessageComponent rendering API is unavailable",
    );
  }

  const record = getPatchRecord() ?? createPatchRecord(options, hooks);
  record.owners += 1;
  if (hooks) record.hooks = hooks;
  record.updateOptions(options);
  let disposed = false;

  return {
    get expanded() {
      return record.expanded;
    },
    get options() {
      return { ...record.options };
    },
    updateOptions(next) {
      record.updateOptions(next);
    },
    setExpanded(expanded) {
      record.setExpanded(expanded);
    },
    toggle() {
      record.setExpanded(!record.expanded);
    },
    setMessageTiming(timestamp, timing) {
      record.setMessageTiming(timestamp, timing);
    },
    beginMessage(message, startedAt) {
      record.beginMessage(message, startedAt);
    },
    completeMessage(message, completedAt) {
      record.completeMessage(message, completedAt);
    },
    tick(now) {
      record.tick(now);
    },
    cancelPendingFolds() {
      record.cancelPendingFolds();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      record.owners -= 1;
      if (record.owners > 0 || getPatchRecord() !== record) return;

      prototype.updateContent = record.originalUpdate;
      setPatchRecord(undefined);
      // Drop display clones and mouse callbacks that close over this record.
      forEachLiveComponent(record, (component, state) => {
        if (state.fullMessage) {
          record.originalUpdate.call(
            component,
            state.fullMessage,
            state.isStreaming,
          );
        }
      });
    },
  };
}

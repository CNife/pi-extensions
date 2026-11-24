/**
 * 压缩阈值的纯算术与状态机（无 pi 依赖，可单独测试）。
 *
 * 阈值 = min(绝对上限, 窗口 × 比例)，即「已用 token 到了这个数就压缩」。
 * pi 内建的 `compaction.reserveTokens` 与 `compaction.modelOverrides` 都只能
 * 写死 per-model 常量、没有「按窗口自动算」的能力，换个窗口的模型就得手工
 * 重算，所以阈值放到扩展里按当前模型的窗口实时算。
 */

/** 已用 token 的绝对上限。 */
export const MAX_USED_TOKENS = 300_000;

/** 占窗口的比例上限。 */
export const TRIGGER_PERCENT = 0.85;

/** 同一次超标最多尝试几次压缩，超过就放弃、交给 pi 内建兜底。 */
export const MAX_ATTEMPTS = 3;

/** 窗口无效（负数、NaN、缺失）时返回 null，表示不参与判断。 */
export function compactionThreshold(
  contextWindow: number | null | undefined,
): number | null {
  if (
    contextWindow === null ||
    contextWindow === undefined ||
    !Number.isFinite(contextWindow) ||
    contextWindow <= 0
  ) {
    return null;
  }
  return Math.floor(Math.min(MAX_USED_TOKENS, contextWindow * TRIGGER_PERCENT));
}

export interface CompactionState {
  /** 已触发压缩、正等占用降回阈值以下 */
  suppressed: boolean;
  /** 本轮超标已经尝试过几次压缩 */
  attempts: number;
}

export const INITIAL_STATE: CompactionState = Object.freeze({
  suppressed: false,
  attempts: 0,
});

export interface CompactionDecision {
  /** 本轮是否该触发压缩 */
  trigger: boolean;
  /** 下一次判断要带着的状态 */
  state: CompactionState;
}

/**
 * 决定是否触发压缩，并返回下一次判断要带着的状态。
 *
 * 语义是「超过阈值就压，一次超标内允许有界重试」：
 *
 * - 降到阈值以下 → 解除抑制、清零尝试次数，下次再超就再压；
 * - 已抑制（压缩完成、还没产生新回复所以占用未知）→ 不动，绝不每轮重压；
 * - 尝试次数用尽 → 保持抑制，放弃本次超标，交给 pi 内建的 98% 兜底。
 */
export function decideCompaction(
  tokens: number,
  threshold: number,
  state: CompactionState,
): CompactionDecision {
  if (tokens <= threshold) {
    return { trigger: false, state: INITIAL_STATE };
  }
  if (state.suppressed) {
    return { trigger: false, state };
  }
  if (state.attempts >= MAX_ATTEMPTS) {
    return { trigger: false, state: { ...state, suppressed: true } };
  }
  return {
    trigger: true,
    state: { suppressed: true, attempts: state.attempts + 1 },
  };
}

/** 压缩失败或被取消：解除抑制，下一个 run 收尾时还能再试（次数受 MAX_ATTEMPTS 限制）。 */
export function afterCompactionFailure(
  state: CompactionState,
): CompactionState {
  return { suppressed: false, attempts: state.attempts };
}

/** 压缩成功后的状态：保持抑制、清零次数，等占用降下来再重新武装。 */
export const AFTER_SUCCESS_STATE: CompactionState = Object.freeze({
  suppressed: true,
  attempts: 0,
});

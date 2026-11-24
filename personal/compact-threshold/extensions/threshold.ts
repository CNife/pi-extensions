/**
 * 压缩阈值的纯算术部分（无 pi 依赖，可单独测试）。
 *
 * 阈值 = min(绝对上限, 窗口 × 比例)，即「已用 token 到了这个数就压缩」。
 * pi 内建的 `compaction.reserveTokens` 只能写死常量，换个窗口的模型就得
 * 手工重算，所以阈值放到扩展里按当前模型的窗口实时算。
 */

export interface ThresholdOptions {
  /** 已用 token 的绝对上限 */
  maxUsedTokens: number;
  /** 占窗口的比例上限 */
  triggerPercent: number;
}

/** 300K 或 85%，取较小者。 */
export const DEFAULT_THRESHOLD_OPTIONS: ThresholdOptions = {
  maxUsedTokens: 300_000,
  triggerPercent: 0.85,
};

/** 窗口无效（负数、NaN、缺失）时返回 null，表示不参与判断。 */
export function compactionThreshold(
  contextWindow: number | null | undefined,
  options: ThresholdOptions = DEFAULT_THRESHOLD_OPTIONS,
): number | null {
  if (
    contextWindow === null ||
    contextWindow === undefined ||
    !Number.isFinite(contextWindow) ||
    contextWindow <= 0
  ) {
    return null;
  }
  return Math.floor(
    Math.min(options.maxUsedTokens, contextWindow * options.triggerPercent),
  );
}

export interface CompactionDecision {
  /** 本轮是否该触发压缩 */
  trigger: boolean;
  /** 下一次判断时传入的抑制标记 */
  suppressed: boolean;
}

/**
 * 决定是否触发压缩，并返回下一次判断要带着的状态。
 *
 * 语义是「超过阈值就压一次」，用抑制标记保证同一次超标只压一次：
 *
 * - 降到阈值以下 → 解除抑制，下次再超就再压；
 * - 仍在阈值之上（压缩没压到位、正在压）→ 保持抑制，绝不每轮重压；
 * - 首次采样就超标（例如 resume 一个已经很长的会话）→ 直接触发，不需要
 *   先看到「从下往上跨过」的过程。
 */
export function decideCompaction(
  tokens: number | null,
  threshold: number | null,
  suppressed: boolean,
): CompactionDecision {
  if (tokens === null || threshold === null) {
    return { trigger: false, suppressed };
  }
  if (tokens <= threshold) {
    return { trigger: false, suppressed: false };
  }
  if (suppressed) {
    return { trigger: false, suppressed: true };
  }
  return { trigger: true, suppressed: true };
}

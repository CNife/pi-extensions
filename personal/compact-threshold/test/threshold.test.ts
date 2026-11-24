import { describe, expect, it } from "vitest";
import {
  AFTER_SUCCESS_STATE,
  afterCompactionFailure,
  type CompactionState,
  compactionThreshold,
  decideCompaction,
  INITIAL_STATE,
  MAX_ATTEMPTS,
  MAX_USED_TOKENS,
  TRIGGER_PERCENT,
} from "../extensions/threshold.ts";

const armed: CompactionState = { suppressed: false, attempts: 0 };

describe("compactionThreshold", () => {
  it("1M 窗口取绝对上限 300K（85% 是 850K，更大）", () => {
    expect(compactionThreshold(1_000_000)).toBe(MAX_USED_TOKENS);
    expect(compactionThreshold(1_048_576)).toBe(MAX_USED_TOKENS);
  });

  it("512K 窗口仍然取 300K（85% 是 435.2K）", () => {
    expect(compactionThreshold(512_000)).toBe(MAX_USED_TOKENS);
  });

  it("小窗口改用 85%，避免阈值超过窗口", () => {
    expect(compactionThreshold(262_144)).toBe(222_822);
    expect(compactionThreshold(32_768)).toBe(27_852);
  });

  it("无效窗口返回 null", () => {
    expect(compactionThreshold(null)).toBeNull();
    expect(compactionThreshold(undefined)).toBeNull();
    expect(compactionThreshold(0)).toBeNull();
    expect(compactionThreshold(Number.NaN)).toBeNull();
  });

  it("常量就是需求本身", () => {
    expect(MAX_USED_TOKENS).toBe(300_000);
    expect(TRIGGER_PERCENT).toBe(0.85);
  });
});

describe("decideCompaction", () => {
  const threshold = 300_000;

  it("超标且未抑制时触发，并记一次尝试", () => {
    expect(decideCompaction(320_000, threshold, armed)).toEqual({
      trigger: true,
      state: { suppressed: true, attempts: 1 },
    });
  });

  it("纯函数无记忆：超标即触发，不看上一轮", () => {
    expect(decideCompaction(900_000, threshold, INITIAL_STATE).trigger).toBe(
      true,
    );
  });

  it("已抑制时不再触发（防压缩循环）", () => {
    const suppressed: CompactionState = { suppressed: true, attempts: 1 };
    expect(decideCompaction(400_000, threshold, suppressed)).toEqual({
      trigger: false,
      state: suppressed,
    });
  });

  it("降到阈值以下解武装并清零次数", () => {
    const state: CompactionState = { suppressed: true, attempts: 2 };
    expect(decideCompaction(120_000, threshold, state)).toEqual({
      trigger: false,
      state: INITIAL_STATE,
    });
  });

  it("正好等于阈值不算超标", () => {
    expect(decideCompaction(threshold, threshold, armed).state).toEqual(
      INITIAL_STATE,
    );
  });

  it("尝试次数用尽后放弃并保持抑制", () => {
    const exhausted: CompactionState = {
      suppressed: false,
      attempts: MAX_ATTEMPTS,
    };
    expect(decideCompaction(400_000, threshold, exhausted)).toEqual({
      trigger: false,
      state: { suppressed: true, attempts: MAX_ATTEMPTS },
    });
  });
});

describe("压缩结果对状态的影响", () => {
  const threshold = 300_000;

  it("失败后解除抑制，下一个 run 还能再试", () => {
    const attempted: CompactionState = { suppressed: true, attempts: 1 };
    const afterFailure = afterCompactionFailure(attempted);
    expect(afterFailure).toEqual({ suppressed: false, attempts: 1 });
    expect(decideCompaction(400_000, threshold, afterFailure)).toEqual({
      trigger: true,
      state: { suppressed: true, attempts: 2 },
    });
  });

  it("连续失败最多尝试 MAX_ATTEMPTS 次，之后不再压", () => {
    let state = INITIAL_STATE;
    const triggers: boolean[] = [];
    for (let round = 0; round < MAX_ATTEMPTS + 2; round += 1) {
      const decision = decideCompaction(400_000, threshold, state);
      triggers.push(decision.trigger);
      state = decision.trigger
        ? afterCompactionFailure(decision.state)
        : decision.state;
    }
    expect(triggers.filter(Boolean)).toHaveLength(MAX_ATTEMPTS);
    expect(triggers.slice(MAX_ATTEMPTS)).toEqual([false, false]);
  });

  it("成功后保持抑制并清零次数，等占用降下来才重新武装", () => {
    const success = AFTER_SUCCESS_STATE;
    expect(success).toEqual({ suppressed: true, attempts: 0 });
    // 占用还没降下来（压缩刚完成、尚无新回复，或仍高于阈值）
    expect(decideCompaction(400_000, threshold, success).trigger).toBe(false);
    // 降下来之后重新武装
    expect(decideCompaction(100_000, threshold, success).state).toEqual(
      INITIAL_STATE,
    );
  });

  it("压一次 → 保持 → 降回 → 再超标，共压两次", () => {
    let state = INITIAL_STATE;
    const rounds = [320_000, 340_000, 90_000, 310_000];
    const triggers = rounds.map((tokens) => {
      const decision = decideCompaction(tokens, threshold, state);
      state = decision.state;
      return decision.trigger;
    });
    expect(triggers).toEqual([true, false, false, true]);
  });
});

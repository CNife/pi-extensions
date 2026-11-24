import { describe, expect, it } from "vitest";
import {
  compactionThreshold,
  DEFAULT_THRESHOLD_OPTIONS,
  decideCompaction,
} from "../extensions/threshold.ts";

describe("compactionThreshold", () => {
  it("1M 窗口取绝对上限 300K（85% 是 850K，更大）", () => {
    expect(compactionThreshold(1_000_000)).toBe(300_000);
    expect(compactionThreshold(1_048_576)).toBe(300_000);
  });

  it("512K 窗口仍然取 300K（85% 是 435.2K）", () => {
    expect(compactionThreshold(512_000)).toBe(300_000);
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

  it("选项可覆盖默认值", () => {
    const options = { maxUsedTokens: 50_000, triggerPercent: 0.5 };
    expect(compactionThreshold(1_000_000, options)).toBe(50_000);
    expect(compactionThreshold(80_000, options)).toBe(40_000);
    expect(DEFAULT_THRESHOLD_OPTIONS.maxUsedTokens).toBe(300_000);
  });
});

describe("decideCompaction", () => {
  const threshold = 300_000;

  it("超过阈值且未被抑制时触发，并上抑制标记", () => {
    expect(decideCompaction(320_000, threshold, false)).toEqual({
      trigger: true,
      suppressed: true,
    });
  });

  it("首次采样就超标（resume 长会话）也触发", () => {
    expect(decideCompaction(900_000, threshold, false).trigger).toBe(true);
  });

  it("已抑制时不再触发（防压缩循环）", () => {
    expect(decideCompaction(400_000, threshold, true)).toEqual({
      trigger: false,
      suppressed: true,
    });
  });

  it("降到阈值以下解除抑制", () => {
    expect(decideCompaction(120_000, threshold, true)).toEqual({
      trigger: false,
      suppressed: false,
    });
    expect(decideCompaction(120_000, threshold, false)).toEqual({
      trigger: false,
      suppressed: false,
    });
  });

  it("正好等于阈值不算超标", () => {
    expect(decideCompaction(threshold, threshold, false)).toEqual({
      trigger: false,
      suppressed: false,
    });
  });

  it("缺用量或缺窗口时不动状态", () => {
    expect(decideCompaction(null, threshold, false)).toEqual({
      trigger: false,
      suppressed: false,
    });
    expect(decideCompaction(400_000, null, true)).toEqual({
      trigger: false,
      suppressed: true,
    });
  });

  it("压一次 → 保持 → 降回 → 再超标，共压两次", () => {
    let suppressed = false;
    const rounds = [320_000, 340_000, 90_000, 310_000];
    const triggers = rounds.map((tokens) => {
      const decision = decideCompaction(tokens, threshold, suppressed);
      suppressed = decision.suppressed;
      return decision.trigger;
    });
    expect(triggers).toEqual([true, false, false, true]);
  });
});

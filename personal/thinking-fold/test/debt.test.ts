/**
 * 高度留白债务算术的直测（issue #187 的唯一测试接缝）。
 *
 * 只断言输入 → 输出：单段封顶、多段累加、增长偿还、折叠帧负增量钳零、
 * 首帧按「上帧 = 0」计、债不为负、债为 0 时增长无副作用。
 *
 * 运行：仓库根 `npm test`（vitest）。
 */

import { equal } from "node:assert";
import { test } from "vitest";

import { foldDebt, foldedHeight, nextDebt } from "../height-reserve.ts";

test("单段腾出的高度：按实际渲染行数计，预览行数封顶", () => {
  equal(foldedHeight(10, 42), 10);
  equal(foldedHeight(10, 4), 4);
  equal(foldedHeight(10, 0), 0);
});

test("折叠计入：各段腾出的高度累加", () => {
  // 一条消息里被文本隔开的两段推理，各自都超过预览行数：
  // 合计应为 2 × previewLines，而不是被总数封顶成一个 previewLines。
  equal(foldDebt(0, foldedHeight(10, 40) + foldedHeight(10, 30)), 20);
  equal(foldDebt(0, foldedHeight(10, 3) + foldedHeight(10, 2)), 5);
});

test("多段推理的债务不被总数封顶", () => {
  const sections = [40, 30, 25];
  const freed = sections.reduce(
    (sum, lines) => sum + foldedHeight(10, lines),
    0,
  );
  equal(freed, 30);
  equal(foldDebt(0, freed), 30);
});

test("折叠与已有债务累加", () => {
  equal(foldDebt(7, foldedHeight(10, 42)), 17);
});

test("增长偿还：长高多少行就扣多少债", () => {
  equal(nextDebt(10, 11, 14), 7);
});

test("折叠那一帧的负增量不算偿还", () => {
  equal(nextDebt(10, 11, 1), 10);
});

test("首帧按上帧 0 计，整段高度都算偿还", () => {
  equal(nextDebt(10, 0, 4), 6);
});

test("债务不落到负数", () => {
  equal(nextDebt(3, 0, 10), 0);
  equal(nextDebt(-5, 0, 1), 0);
  equal(foldDebt(-3, 2), 2);
});

test("债务为 0 时内容增长无副作用", () => {
  equal(nextDebt(0, 5, 50), 0);
  equal(foldDebt(0, 0), 0);
});

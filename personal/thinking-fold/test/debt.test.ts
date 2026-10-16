/**
 * 高度留白债务算术的直测（issue #187 的唯一测试接缝）。
 *
 * 只断言输入 → 输出：折叠计入、增长偿还、折叠帧负增量钳零、首帧按「上帧 = 0」计、
 * 债不为负、债为 0 时增长无副作用。
 *
 * 运行：仓库根 `npm test`（vitest）。
 */

import { equal } from "node:assert";
import { test } from "vitest";

import { foldDebt, nextDebt } from "../height-reserve.ts";

test("折叠计入：按实际渲染行数记债，折叠预览行数封顶", () => {
  equal(foldDebt(0, 10, 42), 10);
  equal(foldDebt(3, 10, 42), 13);
  equal(foldDebt(0, 10, 4), 4);
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
});

test("债务为 0 时内容增长无副作用", () => {
  equal(nextDebt(0, 5, 50), 0);
  equal(foldDebt(0, 0, 42), 0);
});

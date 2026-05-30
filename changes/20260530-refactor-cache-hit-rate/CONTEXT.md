# 20260530-refactor-cache-hit-rate

本次变更新增或修改的项目用语。

## 新增

**多指标**：
三个不同时间尺度的缓存命中率指标，类似 K 线图中的均线系统。包含 Current（当前单条 message）、Recent N（最近 N 条加权平均）、Total（会话累计）。
_避免_：短期趋势、长期趋势（太模糊，多指标明确指三个尺度）

**采样**：
以 assistant message 为单位采集缓存命中率数据。每个 assistant message 的 `input + cacheRead + cacheWrite > 0` 即是一个有效样本。
_避免_：数据点、测量点

**加权平均**：
Recent N 的计算方式——以每条 message 的 prompt token 数量为权重，计算命中率的加权平均。token 多的 message 在 Recent 中占更大比重。
_避免_：简单平均（指等权平均，和多指标设计不同）

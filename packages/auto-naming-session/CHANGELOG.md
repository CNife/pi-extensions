# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.0] - 2026-07-15

### Changed

- 删除 `lastEntryId` cursor，改用全量 transcript：每次刷新标题时遍历整个 branch 收集所有 user/assistant 消息文本，让标题反映会话全貌而非最近片段。
- 刷新资格判断改为基于 `auto-naming-title` custom entry 在 branch 中的位置实时计算，无持久化 cursor 状态。
- 首标题生成采用方案 B：`message_end` 时用全量 branch transcript + 当前消息拼接（pi 先发事件后持久化，故当前消息尚未入 branch）。
- `auto-naming-title` custom entry 的 data 从 `{ title, lastEntryId, timestamp }` 改为 `{ title, timestamp }`；读取时兼容旧 entry（忽略多余的 `lastEntryId` 字段）。

### Added

- 将 transcript 构建与刷新资格判断提取为独立纯函数模块 `extensions/transcript.ts`（`buildFullTranscript` / `buildFullTranscriptWithPending` / `hasAutoNamingTitle` / `shouldRefresh`），事件回调退化为薄编排层。
- 新增 36 个单元测试（`node:test` + `tsx`），覆盖 `buildFullTranscript` 各种 branch 形态与 `shouldRefresh` 各种 custom entry 排列。

### Fixed

- 消除 cursor 重放 bug：会话重载后不再从旧 cursor 恢复导致重放上一轮已处理消息、浪费 LLM 调用。bug 载体（`lastEntryId` 字段）被删除，整类「写旧读新」错误不再可能。

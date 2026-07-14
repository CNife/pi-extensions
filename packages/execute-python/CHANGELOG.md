# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- 新增系统提示词引导 AI 优先使用 `executePython` 执行 Python 代码。
- TUI 工具调用块顶部加 `python` 标题，与内置 read/bash/edit/write 工具风格一致。
- `executePython` 返回内核变量快照（`--- kernel state ---`），列出顶层变量名，让 AI 看到可复用的持久状态而不必重新定义。

### Removed

- 移除 bash 拦截钩子（运行时动态注入 `python -c` 提示），改由静态 `promptGuidelines` 引导。
- 移除 cell 计数（LLM 的 `[cell N]`、TUI 的 `cell N`、`details.execCount`），由内核变量快照替代。

### Fixed

- 折叠模式下完整显示 Python 异常信息（stderr/traceback），便于调试错误。

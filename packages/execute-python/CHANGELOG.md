# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- 新增系统提示词引导 AI 优先使用 `executePython` 执行 Python 代码。
- 当通过 bash 执行 `python -c` 时，自动追加提示引导使用 `executePython`。

### Fixed

- 折叠模式下完整显示 Python 异常信息（stderr/traceback），便于调试错误。

---
name: measure-tokens
description: 测量 pi 工具和插件的 LLM 上下文占用（token 数）
argument-hint: "[--analyze-only | --tokenizer <type> | --dir <path> | --help]"
---

# measure-tokens — 测量 pi 工具的 token 开销

测量 pi 工具和插件在 LLM 上下文中的 token 占用情况，帮助优化提示词和工具定义。

## 背景

pi 工具和插件会向 LLM 发送工具定义、系统提示等文本，这些都会占用上下文窗口。了解 token 占用情况有助于：

- 识别过大的工具定义
- 优化提示词长度
- 避免上下文溢出
- 比较不同工具的 token 效率

## 触发方式

```bash
# 分析现有 payload 文件
pi run skill:measure-tokens --analyze-only

# 指定 tokenizer 类型
pi run skill:measure-tokens --tokenizer auto

# 捕获新的 payload（需要设置环境变量）
PI_DEBUG_REQUEST_BODY=1 pi [原始命令]
```

## 使用步骤

### 1. 捕获 payload

设置环境变量 `PI_DEBUG_REQUEST_BODY=1` 运行任何 pi 命令，会将完整请求 payload 保存到临时文件：

```bash
PI_DEBUG_REQUEST_BODY=1 pi list
PI_DEBUG_REQUEST_BODY=1 pi run skill:some-skill
```

每个请求会生成一个 JSON 文件，包含发送给 LLM 的完整内容。

### 2. 分析 token 占用

运行分析脚本：

```bash
# 分析当前目录下的所有 payload 文件
uv run packages/miscs/skills/measure-tokens/measure-tokens.py --analyze-only

# 指定特定目录
uv run packages/miscs/skills/measure-tokens/measure-tokens.py --analyze-only --dir /path/to/payloads

# 使用特定 tokenizer（deepseek, cl100k_base, o200k_base, auto）
uv run packages/miscs/skills/measure-tokens/measure-tokens.py --tokenizer o200k_base

# 查看帮助
uv run packages/miscs/skills/measure-tokens/measure-tokens.py --help
```

### 3. 解读输出

脚本会输出：

- 每个 payload 文件的 token 统计
- 按工具/系统提示分类的 token 占用
- 总 token 数和占比
- 识别最大的 token 消耗者

### 4. 优化建议

根据分析结果：

- **工具定义过大**：考虑拆分工具或简化描述
- **系统提示过长**：精简或分段加载
- **重复内容**：合并相似工具或使用模板
- **上下文溢出**：减少同时注册的工具数量

## 输出格式

```text
=== Token Analysis Report ===
Payload: /tmp/pi-request-20260602-100234.json
Total tokens: 15,432

Breakdown:
  System prompt: 2,456 tokens (15.9%)
  Tool definitions: 8,976 tokens (58.2%)
    - tool1: 1,234 tokens
    - tool2: 2,345 tokens
    - ...
  Messages: 4,000 tokens (25.9%)

Largest consumers:
  1. tool3 (3,456 tokens)
  2. tool1 (1,234 tokens)
  3. system (2,456 tokens)
```

## 停止条件

- 分析完成并输出报告 → 停止
- 无 payload 文件且 `--analyze-only` → 报告无文件并停止
- 用户中断 → 停止

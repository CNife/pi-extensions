# 改进 executePython 工具描述

## 问题

AI 调用 executePython 工具的积极性不强，更喜欢直接调用 bash。原因：
1. 工具描述没有明确"什么时候用我 vs bash"
2. packages 参数（依赖管理）是核心优势，但埋没在参数列表里

## 目标

让 AI 根据任务复杂度合理选择 executePython vs bash，而不是无脑用 bash。

## 方案

### 1. 调整工具定位

**executePython**：执行复杂任务（复杂计算、多步数据处理、heredoc 脚本）
**bash**：简单命令或短管道（≤3 个 |）

### 2. 添加三层描述结构

参考 pi 官方工具定义模式，添加：

- **description**：详细功能说明
- **promptSnippet**：一句话定位
- **promptGuidelines**：具体使用指南数组（关键！）

### 3. 强调依赖管理优势

在 `promptGuidelines` 和 `packages` 参数描述中强调：
- 总是用 `packages` 参数声明依赖
- uv 自动管理 venv，不需要手动 pip install

## 具体改动

### execute-python.ts

```typescript
const executePythonTool = defineTool({
  name: "executePython",
  label: "Execute Python",
  
  description: [
    "Execute Python code with uv. No bash escaping needed, auto-manages dependencies.",
    "Output is streamed in real-time with PYTHONUNBUFFERED=1.",
    "Optionally provide timeout in seconds."
  ].join(" "),
  
  promptSnippet: "Execute Python code (prefer over bash for complex tasks)",
  
  promptGuidelines: [
    "Use for complex tasks: heavy computation, multi-step data processing, heredoc-style scripts",
    "Use packages param to declare ALL third-party dependencies (uv auto-manages venv)",
    "Prefer bash for simple commands or short pipes (≤3 |)",
    "No bash escaping needed — write Python code directly"
  ],
  
  parameters: Type.Object({
    code: Type.String({
      description: "Python code to execute, no escaping needed",
    }),
    packages: Type.Optional(
      Type.Array(Type.String(), {
        description: "PyPI dependencies to auto-install, e.g. ['requests', 'pandas>=2.0']. uv handles venv automatically.",
        default: [],
      }),
    ),
    // ... 其他参数不变
  }),
  
  // ... execute, renderCall, renderResult 不变
});
```

## 验证方式

改完后测试几个场景，看 AI 是否能合理选择：
- "用 Python 抓取网页" → 应选 executePython（需要 requests）
- "处理这个 CSV 文件" → 应选 executePython（多步数据处理）
- "列出当前目录文件" → 应选 bash（简单命令）
- "git status" → 应选 bash（系统命令）

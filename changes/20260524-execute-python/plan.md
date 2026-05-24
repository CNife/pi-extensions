# 变更方案

## 目标

优化 executePython 的输出格式和 UI 体验，使其与 bash 工具一致：实时流式输出、代码回显、格式化展示、耗时显示。

## 背景

当前 executePython 的问题：
1. 无实时输出——等待执行完成才返回结果
2. 返回 JSON 格式，在 pi 界面上不直观
3. 无代码回显——用户看不到执行了什么代码
4. 无耗时显示

参考 bash 工具的实现（`packages/coding-agent/src/core/tools/bash.ts`），需要接入：
- `onUpdate` 回调实现实时流式输出
- `renderCall` / `renderResult` 自定义 TUI 渲染

## 最终方案

### 核心改造

#### 1. 实时流式输出（`onUpdate`）

```typescript
// 在 spawn 后实时收集 stdout/stderr，通过 onUpdate 推送
child.stdout?.on("data", (chunk) => {
    stdout += chunk;
    scheduleOutputUpdate();  // 节流更新
});

child.stderr?.on("data", (chunk) => {
    stderr += chunk;
    scheduleOutputUpdate();
});

// 节流函数，每 100ms 最多推送一次
const scheduleOutputUpdate = () => {
    if (!onUpdate) return;
    updateDirty = true;
    const delay = 100 - (Date.now() - lastUpdateAt);
    if (delay <= 0) emitOutputUpdate();
    else updateTimer ??= setTimeout(emitOutputUpdate, delay);
};
```

#### 2. 自定义渲染（TUI 组件）

**renderCall** — 显示执行的 Python 代码：

```typescript
renderCall(args, theme, _context) {
    const code = args.code;
    const preview = code.length > 80 ? code.slice(0, 77) + "..." : code;
    let text = theme.fg("toolTitle", theme.bold(">>> "));
    text += theme.fg("accent", preview);
    if (args.packages?.length) {
        text += theme.fg("dim", ` (packages: ${args.packages.join(", ")})`);
    }
    return new Text(text, 0, 0);
}
```

**renderResult** — 显示输出 + exitCode + 耗时：

```typescript
renderResult(result, { expanded, isPartial }, theme, context) {
    const state = context.state;
    
    // 部分结果（执行中）
    if (isPartial) {
        return new Text(theme.fg("warning", "Running..."), 0, 0);
    }
    
    const details = result.details as ExecutePythonResult;
    let text = "";
    
    // exitCode
    if (details.exitCode === 0) {
        text += theme.fg("success", "exit 0");
    } else {
        text += theme.fg("error", `exit ${details.exitCode}`);
    }
    
    // stdout 行数
    const stdoutLines = details.stdout ? details.stdout.split("\n").length : 0;
    const stderrLines = details.stderr ? details.stderr.split("\n").length : 0;
    if (stdoutLines) text += theme.fg("dim", ` (stdout: ${stdoutLines} lines)`);
    if (stderrLines) text += theme.fg("warning", ` (stderr: ${stderrLines} lines)`);
    
    // 展开模式：显示完整输出
    if (expanded) {
        if (details.stdout) {
            text += "\n" + theme.fg("muted", "--- stdout ---");
            for (const line of details.stdout.split("\n").slice(0, 30)) {
                text += "\n" + theme.fg("dim", line);
            }
        }
        if (details.stderr) {
            text += "\n" + theme.fg("muted", "--- stderr ---");
            for (const line of details.stderr.split("\n").slice(0, 10)) {
                text += "\n" + theme.fg("warning", line);
            }
        }
    }
    
    // 耗时
    if (state.startedAt) {
        const duration = ((state.endedAt ?? Date.now()) - state.startedAt) / 1000;
        text += "\n" + theme.fg("muted", `Took ${duration.toFixed(1)}s`);
    }
    
    return new Text(text, 0, 0);
}
```

#### 3. content 字段（供 LLM 消费）

保持纯文本分块格式，作为 LLM 的上下文：

```
--- code ---
print("Hello World")
--- stdout ---
Hello World
--- stderr ---
(无)
exitCode: 0
```

### 进程管理修复

1. **添加 `detached: true`**：使 `process.kill(-pid)` 进程组终止生效
2. **接入 `signal`**：监听 abort 事件，触发时终止子进程

```typescript
const child = spawn("uv", args, {
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
    windowsHide: true,
});

// 处理 abort signal
if (signal) {
    if (signal.aborted) killProcessTree(child.pid);
    else signal.addEventListener("abort", () => {
        if (child.pid) killProcessTree(child.pid);
    }, { once: true });
}
```

### 代码变更范围

| 文件 | 变更 |
|------|------|
| extensions/execute-python.ts | 完整重写：onUpdate + renderCall + renderResult + 进程管理 |
| tests/execute-python.test.sh | 更新测试用例 |
| tests/execute-python.e2e.sh | 更新端到端测试 |

### 依赖

- `@earendil-works/pi-tui`：TUI 组件（Text）
- 仅使用 pi 生态已有的依赖，不引入新依赖

## 关键决策

| # | 决策 | 理由 |
|---|------|------|
| 1 | 使用 onUpdate 实时流式输出 | 与 bash 工具体验一致 |
| 2 | renderCall 显示代码预览 | 用户看到「跑了什么」 |
| 3 | renderResult 显示 exitCode + 行数 + 耗时 | 快速判断执行结果 |
| 4 | expanded 模式显示完整输出 | 按需查看详情 |
| 5 | content 保持纯文本格式 | 供 LLM 理解执行结果 |
| 6 | detached + signal 处理 | 正确的进程生命周期管理 |

## 用语

**executePython 输出格式**：
实时流式输出 + TUI 自定义渲染（renderCall 显示代码，renderResult 显示结果 + 耗时），content 为纯文本供 LLM 消费。
_避免_：JSON 格式返回

**代码回显**：
renderCall 中显示执行的 Python 代码预览（前 80 字符），类似 bash 的 `$ command` 显示。
_避免_：隐藏执行代码

## 假设

无。

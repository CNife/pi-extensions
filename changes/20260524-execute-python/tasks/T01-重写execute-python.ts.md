---
status: 完成
priority: 高
depends_on: []
---
# T01: 重写 execute-python.ts

**目标**：完整重写 execute-python.ts，实现实时流式输出、TUI 自定义渲染、进程管理修复

**涉及文件**：
- extensions/execute-python.ts

**验证方式**：
1. TypeScript 编译通过：`npx tsc --noEmit extensions/execute-python.ts`
2. pi 加载 extension 成功：`pi -e ./extensions/execute-python.ts` 启动无报错
3. 手动测试：执行 `print("Hello World")` 验证实时输出 + 渲染效果

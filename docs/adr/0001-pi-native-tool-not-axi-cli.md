# pi-nmem 走 pi-native custom tool，不写 AXI CLI

## 背景

pi-nmem 包要替代 nowledge-mem-pi。nowledge-mem-pi 的 skill 调用裸 `nmem` CLI 有三个痛点：① `--json` 输出冗长 ② AI 乱猜参数 ③ add 记忆与 bash 转义搏斗。根源是 "LLM -> shell -> nmem CLI" 中介层。参考项目 axi/gh-axi/aityp-cli 都是 AXI CLI（在 CLI 层用 TOON/fail-loud/stdin 打补丁），但 pi 提供 `pi.registerTool()` 可让 LLM 直接调用结构化工具，跳过 shell。

## 决定

pi-nmem 走 pi-native custom tool 路线：extension 注册 3 个 tool（`nmem_search` / `nmem_read_thread` / `nmem_save_memory`），内部纯打 nmem 后端 REST。不写 CLI，不做 axi 版 skill。

## 原因

tool 路线根治三痛点（参数结构化无转义、schema 强约束无乱猜、返回结构化 content 无 JSON 解析）。对 pi 这个特定 harness，pi-native tool 比 axi CLI 严格更优：无进程 spawn、无 shell 解析、无输出序列化、in-process REST 与 ambient sync 复用同通道。AXI 之于 MCP 的基准优势（无网络/协议开销）不适用于 vs pi-native tool--后者无 MCP 开销。

## 考虑过的选项

- **AXI CLI**（包装 `nmem` CLI + axi 版 skill + fork extension）：符合参考项目范式，但三痛点只在 CLI 层缓解、不根治，仍经 shell。
- **混合**（pi 内用 tool + 另提供 CLI 保跨 harness 通用）：rejected--维护两套接口，且用户即 pi 用户，跨 harness 通用性价值低。
- **pi-native tool**（采纳）。

## 后果

- 绑定 pi，失去跨 harness 通用性（可接受）。
- 偏离 AXI 范式：不是 catalog 意义上的 AXI（AXI 专指 shell CLI）。
- 运行时不依赖 nmem CLI（纯打 REST）；CLI 仅留给用户手动做低频管理。
- AXI 的 10 条原则不再逐条适用，但其精神（token 高效、最小 schema、预计算聚合、明确空状态、结构化错误）仍作为 tool 设计纪律。

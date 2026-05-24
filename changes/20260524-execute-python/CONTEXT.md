# 20260524-execute-python

本次变更新增或修改的项目用语。

## 新增

**executePython 输出格式**：
纯文本分块展示，包含代码回显 + stdout + stderr + exitCode，模拟 bash 工具的界面体验。
_避免_：JSON 格式返回

**代码回显**：
executePython 返回结果中附带执行的 Python 代码，让用户看到「跑了什么」，类似 bash 的命令回显。
_避免_：隐藏执行代码

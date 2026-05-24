---
name: manage-change
description: 变更目录管理——创建、切换、查看状态、列出所有变更
argument-hint: "<new|switch|status|list> [名称]"
---

# Manage Change — 变更目录管理

管理 `changes/` 目录下的变更记录。

## 子命令

### `/manage-change new <简写>`

创建新的变更目录并设为 active。

**用法**：`/manage-change new <简写>`

**行为**：
1. 生成目录名：`YYYYMMDD-<简写>`（YYYYMMDD 为当天日期）
2. 创建目录：`changes/YYYYMMDD-<简写>/`
3. 设置 active：写入 `changes/.active_change`

**示例**：`/manage-change new refactor-auth` → 创建 `changes/20260524-refactor-auth/`

### `/manage-change switch [目录名]`

切换活动变更目录。

**用法**：`/manage-change switch [目录名]`

**行为**：
1. 如果提供了目录名，直接切换
2. 如果未提供，列出所有变更目录供选择
3. 更新 `changes/.active_change`

### `/manage-change status`

显示当前活动变更的状态。

**用法**：`/manage-change status`

**行为**：
1. 读取 `changes/.active_change` 获取活动目录
2. 检查目录下文件，判断状态：
   - 只有 plan.md → 构思
   - plan.md + tasks/ → 就绪
   - 有 task 为「进行中」→ 进行中
   - 所有 task 为「完成」→ 完成
3. 输出状态信息

### `/manage-change list`

列出所有变更目录。

**用法**：`/manage-change list`

**行为**：
1. 扫描 `changes/` 目录，找所有 `YYYYMMDD-*` 子目录
2. 按日期倒序排列
3. 标注当前 active 的目录

## 变更目录解析规则

各阶段技能均遵守以下规则确定当前变更目录（记为 `$CHANGE_DIR`）：

1. `$ARGUMENTS` 非空 → 直接作为目录名使用
2. `changes/.active_change` 存在 → 读取其内容作为目录名
3. 执行 `ls changes/` 找到最近 `YYYYMMDD-*` 子目录 → 向用户确认
4. 以上均无 → 提示用户先执行 `/manage-change new <简写>`

## 停止条件

- 子命令执行完毕 → 停止

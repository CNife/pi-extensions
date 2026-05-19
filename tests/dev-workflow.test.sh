#!/usr/bin/env bash
# 验证 development-workflow 变更的结构和内容正确性
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PASS=0
FAIL=0

ok() { echo "  ✅ $1"; PASS=$((PASS + 1)); }
fail() { echo "  ❌ $1"; FAIL=$((FAIL + 1)); }

echo "=== 目录结构 ==="

# prompts/ 目录存在且包含 9 个 .md 文件
if [ -d "$ROOT/prompts" ]; then
  count=$(ls "$ROOT/prompts"/*.md 2>/dev/null | wc -l)
  if [ "$count" -eq 9 ]; then
    ok "prompts/ 包含 9 个 .md 文件"
  else
    fail "prompts/ 期望 9 个 .md，实际 $count"
  fi
else
  fail "prompts/ 目录不存在"
fi

# skills/development-workflow/ 存在且包含 SKILL.md
if [ -f "$ROOT/skills/development-workflow/SKILL.md" ]; then
  ok "skills/development-workflow/SKILL.md 存在"
else
  fail "skills/development-workflow/SKILL.md 不存在"
fi

# extensions/dev-workflow.ts 存在
if [ -f "$ROOT/extensions/dev-workflow.ts" ]; then
  ok "extensions/dev-workflow.ts 存在"
else
  fail "extensions/dev-workflow.ts 不存在"
fi

# AGENTS.md 存在且包含分工说明
if [ -f "$ROOT/AGENTS.md" ]; then
  ok "AGENTS.md 存在"
  if grep -q "分工" "$ROOT/AGENTS.md"; then
    ok "AGENTS.md 包含分工说明"
  else
    fail "AGENTS.md 缺少分工说明"
  fi
else
  fail "AGENTS.md 不存在"
fi

# prompts-dev-workflow/ 已删除
if [ ! -d "$ROOT/prompts-dev-workflow" ]; then
  ok "prompts-dev-workflow/ 已删除"
else
  fail "prompts-dev-workflow/ 仍然存在"
fi

echo ""
echo "=== SKILL.md 内容 ==="

SKILL="$ROOT/skills/development-workflow/SKILL.md"

# 必须包含 name 和 description frontmatter
if grep -q "^name: development-workflow" "$SKILL"; then
  ok "SKILL.md 包含 name: development-workflow"
else
  fail "SKILL.md 缺少 name frontmatter"
fi

if grep -q "^description:" "$SKILL"; then
  ok "SKILL.md 包含 description"
else
  fail "SKILL.md 缺少 description frontmatter"
fi

# 必须包含 9 个阶段的命令
for cmd in write-plan review-plan plan-to-tasks write-code fix-code review-code write-test review-test write-docs; do
  if grep -q "/$cmd" "$SKILL"; then
    ok "SKILL.md 引用了 /$cmd"
  else
    fail "SKILL.md 缺少 /$cmd 引用"
  fi
done

# 必须包含变更目录解析规则
if grep -q "变更目录解析" "$SKILL"; then
  ok "SKILL.md 包含变更目录解析规则"
else
  fail "SKILL.md 缺少变更目录解析规则"
fi

echo ""
echo "=== Prompt 模板内容 ==="

# 每个 prompt 模板应引用 skill 而非自己展开解析逻辑
for f in "$ROOT/prompts"/*.md; do
  name=$(basename "$f")
  if grep -q "development-workflow skill" "$f"; then
    ok "$name 引用了 development-workflow skill"
  else
    fail "$name 未引用 development-workflow skill"
  fi

  # 不应该再包含完整的 4 条优先级解析逻辑
  if grep -q "以上均无" "$f"; then
    fail "$name 仍包含重复的变更目录解析逻辑（含 '以上均无'）"
  else
    ok "$name 已去掉重复解析逻辑"
  fi
done

echo ""
echo "=== Extension 内容 ==="

EXT="$ROOT/extensions/dev-workflow.ts"

# extension 不应包含 resources_discover
if grep -q "resources_discover" "$EXT"; then
  fail "dev-workflow.ts 仍包含 resources_discover"
else
  ok "dev-workflow.ts 已去掉 resources_discover"
fi

# extension 不应引用 prompts-dev-workflow
if grep -q "prompts-dev-workflow" "$EXT"; then
  fail "dev-workflow.ts 仍引用 prompts-dev-workflow"
else
  ok "dev-workflow.ts 不再引用 prompts-dev-workflow"
fi

# extension 应保留 /new-change 和 /switch-change
for cmd in new-change switch-change; do
  if grep -q "registerCommand(\"$cmd\"" "$EXT"; then
    ok "dev-workflow.ts 保留了 /$cmd 命令"
  else
    fail "dev-workflow.ts 缺少 /$cmd 命令"
  fi
done

echo ""
echo "=== README 内容 ==="

README="$ROOT/README.md"

# README 引用 AGENTS.md
if grep -q "AGENTS" "$README"; then
  ok "README.md 引用了 AGENTS.md"
else
  fail "README.md 未引用 AGENTS.md"
fi

if grep -q "skills/development-workflow" "$README"; then
  ok "README.md 包含 skills 章节"
else
  fail "README.md 缺少 skills 章节"
fi

if grep -q "prompts/" "$README" && ! grep -q "prompts-dev-workflow" "$README"; then
  ok "README.md 已更新目录描述，不再引用 prompts-dev-workflow"
else
  fail "README.md 仍引用旧目录名"
fi

echo ""
echo "=== References 结构 ==="

REFS="$ROOT/skills/development-workflow/references"

# 9 个 references 文件全部存在且非空
for phase in write-plan review-plan plan-to-tasks write-code review-code fix-code write-test review-test write-docs; do
  f="$REFS/$phase.md"
  if [ -f "$f" ]; then
    if [ -s "$f" ]; then
      ok "references/$phase.md 存在且非空"
    else
      fail "references/$phase.md 为空文件"
    fi
  else
    fail "references/$phase.md 不存在"
  fi
done

# 每个 references 文件以 # 标题开头
for phase in write-plan review-plan plan-to-tasks write-code review-code fix-code write-test review-test write-docs; do
  f="$REFS/$phase.md"
  if [ -f "$f" ] && head -1 "$f" | grep -q "^# "; then
    ok "references/$phase.md 以标题行开头"
  else
    fail "references/$phase.md 缺少标题行"
  fi
done

echo ""
echo "=== Prompt 模板元数据 ==="

# 每个 prompt 有 description 和 argument-hint frontmatter
for f in "$ROOT/prompts"/*.md; do
  name=$(basename "$f")
  if grep -q "^description:" "$f"; then
    ok "$name 包含 description"
  else
    fail "$name 缺少 description"
  fi
  if grep -q "^argument-hint:" "$f"; then
    ok "$name 包含 argument-hint"
  else
    fail "$name 缺少 argument-hint"
  fi
done

echo ""
echo "=== SKILL.md 完整结构 ==="

SKILL="$ROOT/skills/development-workflow/SKILL.md"

# 必须包含核心文件约定
if grep -q "核心文件约定" "$SKILL"; then
  ok "SKILL.md 包含核心文件约定"
else
  fail "SKILL.md 缺少核心文件约定"
fi

# 必须包含阶段跳转索引
if grep -q "阶段跳转索引" "$SKILL"; then
  ok "SKILL.md 包含阶段跳转索引"
else
  fail "SKILL.md 缺少阶段跳转索引"
fi

# 必须包含操作约束精简版
if grep -q "操作约束精简版" "$SKILL"; then
  ok "SKILL.md 包含操作约束精简版"
else
  fail "SKILL.md 缺少操作约束精简版"
fi

# 必须包含 Plannotator 审阅入口
if grep -q "Plannotator" "$SKILL"; then
  ok "SKILL.md 包含 Plannotator 审阅入口"
else
  fail "SKILL.md 缺少 Plannotator 审阅入口"
fi

# 必须为每个阶段引用相应的 references 文件
for phase in write-plan review-plan plan-to-tasks write-code review-code fix-code write-test review-test write-docs; do
  if grep -q "references/$phase\.md" "$SKILL"; then
    ok "SKILL.md 引用 references/$phase.md"
  else
    fail "SKILL.md 缺少 references/$phase.md 引用"
  fi
done

echo ""
echo "=== 结果 ==="
echo "通过: $PASS  失败: $FAIL"
if [ "$FAIL" -gt 0 ]; then
  echo "❌ 测试未通过"
  exit 1
else
  echo "✅ 全部通过"
fi

#!/usr/bin/env bash
# 发布单个子包到 npm
# 用法: ./scripts/publish.sh <包短名>
# 示例: ./scripts/publish.sh execute-python

set -euo pipefail

if [ $# -eq 0 ]; then
  echo "用法: $0 <包短名>"
  echo ""
  echo "可用的包:"
  for dir in packages/*/; do
    name=$(basename "$dir")
    pkg_name=$(node -p "require('./$dir/package.json').name")
    echo "  $name  →  $pkg_name"
  done
  exit 1
fi

SHORT_NAME="$1"
PKG_DIR="packages/$SHORT_NAME"

if [ ! -d "$PKG_DIR" ]; then
  echo "错误: 目录 $PKG_DIR 不存在"
  exit 1
fi

PKG_NAME=$(node -p "require('./$PKG_DIR/package.json').name")
VERSION=$(node -p "require('./$PKG_DIR/package.json').version")

echo "发布 $PKG_NAME@$VERSION ..."
npm publish --access public --workspace "$PKG_DIR"
echo "完成: $PKG_NAME@$VERSION"

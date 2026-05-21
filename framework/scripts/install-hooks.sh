#!/usr/bin/env bash
# install-hooks.sh — 把 spec-lint.sh 安装为 Git pre-commit hook
#
# 用法：在项目根目录运行
#   bash spec_copilot/scripts/install-hooks.sh

set -eu

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

if [[ ! -d "$ROOT_DIR/.git" ]]; then
  echo "✗ 未在 Git 仓库中（找不到 $ROOT_DIR/.git）"
  exit 1
fi

HOOK_FILE="$ROOT_DIR/.git/hooks/pre-commit"

if [[ -f "$HOOK_FILE" ]]; then
  echo "⚠ 已存在 pre-commit hook，备份为 pre-commit.bak.$(date +%s)"
  mv "$HOOK_FILE" "$HOOK_FILE.bak.$(date +%s)"
fi

cat > "$HOOK_FILE" <<'EOF'
#!/usr/bin/env bash
# spec_copilot pre-commit hook

ROOT_DIR="$(git rev-parse --show-toplevel)"
LINT="$ROOT_DIR/spec_copilot/scripts/spec-lint.sh"

if [[ -x "$LINT" ]]; then
  bash "$LINT" --hook
fi
EOF

chmod +x "$HOOK_FILE"
chmod +x "$SCRIPT_DIR/spec-lint.sh"

echo "✓ pre-commit hook 已安装到 $HOOK_FILE"
echo "  每次 commit 前会自动跑 spec-lint，检查 changes/ 下有改动的需求"
echo "  如需跳过：git commit --no-verify"

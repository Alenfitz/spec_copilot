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

PRE_HOOK="$ROOT_DIR/.git/hooks/pre-commit"
MSG_HOOK="$ROOT_DIR/.git/hooks/commit-msg"

# pre-commit：spec-lint
if [[ -f "$PRE_HOOK" ]]; then
  echo "⚠ 已存在 pre-commit hook，备份为 pre-commit.bak.$(date +%s)"
  mv "$PRE_HOOK" "$PRE_HOOK.bak.$(date +%s)"
fi
cat > "$PRE_HOOK" <<'EOF'
#!/usr/bin/env bash
# spec_copilot pre-commit hook
ROOT_DIR="$(git rev-parse --show-toplevel)"
LINT="$ROOT_DIR/spec_copilot/scripts/spec-lint.sh"
if [[ -x "$LINT" ]]; then
  bash "$LINT" --hook
fi
EOF
chmod +x "$PRE_HOOK"

# commit-msg：v2.1.0 引入 — 校验 task commit 必须含自评分卡
if [[ -f "$MSG_HOOK" ]]; then
  echo "⚠ 已存在 commit-msg hook，备份为 commit-msg.bak.$(date +%s)"
  mv "$MSG_HOOK" "$MSG_HOOK.bak.$(date +%s)"
fi
cat > "$MSG_HOOK" <<'EOF'
#!/usr/bin/env bash
# spec_copilot commit-msg hook — 校验 task commit 必须含自评分卡
# 跳过：git commit --no-verify
MSG_FILE="$1"
if ! command -v npx >/dev/null 2>&1; then
  exit 0  # 没装 npx 静默放行（用户可能离线）
fi
npx --no-install @alenfitz/spec-copilot scorecard "$MSG_FILE" 2>/dev/null
exit $?
EOF
chmod +x "$MSG_HOOK"

chmod +x "$SCRIPT_DIR/spec-lint.sh"

echo "✓ pre-commit hook 已安装到 $PRE_HOOK"
echo "✓ commit-msg hook 已安装到 $MSG_HOOK（校验 task commit 自评分卡）"
echo "  跳过 hook：git commit --no-verify"

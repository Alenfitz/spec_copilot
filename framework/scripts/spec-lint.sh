#!/usr/bin/env bash
# spec-lint.sh — 检查 changes/<变更名>/ 下 spec/tasks/log 三件套的完整性
#
# 用法：
#   ./scripts/spec-lint.sh <变更名>        检查指定需求
#   ./scripts/spec-lint.sh --all           检查 changes/ 下所有进行中的需求
#   ./scripts/spec-lint.sh --hook          作为 Git pre-commit hook 运行（仅检查有暂存改动的变更）
#
# 退出码：
#   0  全部通过
#   1  发现问题
#   2  用法错误

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CHANGES_DIR="$ROOT_DIR/changes"

RED=$'\033[31m'
YELLOW=$'\033[33m'
GREEN=$'\033[32m'
RESET=$'\033[0m'

ERRORS=0
WARNINGS=0

log_err()  { echo "${RED}✗ ERROR${RESET}   $1"; ERRORS=$((ERRORS+1)); }
log_warn() { echo "${YELLOW}⚠ WARN${RESET}    $1"; WARNINGS=$((WARNINGS+1)); }
log_ok()   { echo "${GREEN}✓ OK${RESET}      $1"; }

check_spec() {
  local change_dir="$1"
  local spec="$change_dir/spec.md"

  if [[ ! -f "$spec" ]]; then
    log_err "$spec 不存在"
    return
  fi

  local required_sections=(
    "## 1. 背景与目标"
    "## 2. 代码现状"
    "## 3. 功能点"
    "## 4. 业务规则"
    "## 9. 待澄清"
    "## 13. 确认记录"
  )

  for section in "${required_sections[@]}"; do
    if ! grep -q "^${section}" "$spec"; then
      log_err "$spec 缺少章节：$section"
    fi
  done

  if ! grep -qE "^> status: (propose|apply|review|done)" "$spec"; then
    log_err "$spec 缺少 status 字段或值非法"
  fi

  if ! grep -qE "^> complexity:" "$spec"; then
    log_err "$spec 缺少 complexity 字段"
  fi

  local status
  status=$(grep -oE "status: (propose|apply|review|done)" "$spec" | awk '{print $2}' | head -1)
  if [[ "$status" == "apply" || "$status" == "review" || "$status" == "done" ]]; then
    if awk '/^## 9\./,/^## 10\./' "$spec" | grep -qE "^- \[ \]"; then
      log_err "$spec status=$status 但 §9 待澄清仍有未勾选项"
    fi
  fi
}

check_tasks() {
  local change_dir="$1"
  local tasks="$change_dir/tasks.md"
  local spec="$change_dir/spec.md"

  if [[ -f "$spec" ]] && grep -q "complexity:.*🔴" "$spec"; then
    if [[ ! -f "$tasks" ]]; then
      log_err "$change_dir 是 🔴 复杂需求但缺少 tasks.md"
      return
    fi
  elif [[ ! -f "$tasks" ]]; then
    log_ok "$change_dir 非 🔴 复杂需求，tasks.md 可选"
    return
  fi

  if ! grep -q "^## 前置条件" "$tasks"; then
    log_err "$tasks 缺少 ## 前置条件 章节"
  fi

  if ! grep -qE "^## Task [0-9]+" "$tasks"; then
    log_err "$tasks 没有任何 Task"
  fi

  if grep -qE "^## Task [0-9]+" "$tasks"; then
    local tc vc
    tc=$(grep -cE "^## Task [0-9]+" "$tasks" 2>/dev/null); tc=${tc:-0}
    vc=$(grep -c "验证命令" "$tasks" 2>/dev/null); vc=${vc:-0}
    if [[ "${vc:-0}" -lt "${tc:-0}" ]]; then
      log_warn "$tasks 部分 Task 可能缺少'验证命令'（${vc}/${tc}）"
    fi
  fi

  if [[ -f "$spec" ]] && grep -qE "status: (review|done)" "$spec"; then
    if ! grep -q "^## 变更摘要" "$tasks"; then
      log_err "$tasks status 已进入 review/done 但缺少'变更摘要'章节"
    fi
  fi
}

check_log() {
  local change_dir="$1"
  local log="$change_dir/log.md"

  if [[ ! -f "$log" ]]; then
    log_err "$log 不存在"
    return
  fi

  local required=(
    "## 时间线"
    "## 知识发现"
    "## Spec-Code 偏差记录"
  )

  for section in "${required[@]}"; do
    if ! grep -q "^${section}" "$log"; then
      log_err "$log 缺少章节：$section"
    fi
  done
}

check_change() {
  local change_name="$1"
  local change_dir="$CHANGES_DIR/$change_name"

  echo ""
  echo "▶ 检查 $change_name"

  if [[ ! -d "$change_dir" ]]; then
    log_err "目录不存在：$change_dir"
    return
  fi

  check_spec "$change_dir"
  check_tasks "$change_dir"
  check_log "$change_dir"
}

case "${1:-}" in
  --all)
    for dir in "$CHANGES_DIR"/*/; do
      name=$(basename "$dir")
      [[ "$name" == "templates" ]] && continue
      check_change "$name"
    done
    ;;
  --hook)
    if ! staged=$(git diff --cached --name-only 2>/dev/null); then
      echo "不在 Git 仓库，跳过 hook 检查"
      exit 0
    fi
    changes=$(echo "$staged" | grep -oE "spec_copilot/changes/[^/]+" | sort -u | sed 's|spec_copilot/changes/||')
    if [[ -z "$changes" ]]; then
      exit 0
    fi
    for name in $changes; do
      [[ "$name" == "templates" ]] && continue
      check_change "$name"
    done
    ;;
  "")
    echo "用法：$0 <变更名> | --all | --hook"
    exit 2
    ;;
  -*)
    echo "未知参数：$1"
    exit 2
    ;;
  *)
    check_change "$1"
    ;;
esac

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if [[ $ERRORS -eq 0 && $WARNINGS -eq 0 ]]; then
  echo "${GREEN}全部通过${RESET}"
  exit 0
elif [[ $ERRORS -eq 0 ]]; then
  echo "${YELLOW}$WARNINGS 个警告（不阻塞）${RESET}"
  exit 0
else
  echo "${RED}$ERRORS 个错误 / $WARNINGS 个警告${RESET}"
  exit 1
fi

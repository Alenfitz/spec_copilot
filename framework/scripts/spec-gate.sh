#!/bin/bash
# spec-gate.sh — 阶段进入条件检查
# Usage: spec-gate.sh <变更名> <phase>
# Exit 0 = gate passed, exit 1 = gate failed (blocked)

set -euo pipefail

CHANGE="$1"
PHASE="$2"
CHANGE_DIR="spec_copilot/changes/${CHANGE}"

die() { echo "GATE FAILED: $1"; exit 1; }
ok()  { echo "  ✓ $1"; }

[ -d "$CHANGE_DIR" ] || die "变更目录不存在: $CHANGE_DIR"

SPEC="$CHANGE_DIR/spec.md"
TASKS="$CHANGE_DIR/tasks.md"
LOG="$CHANGE_DIR/log.md"

case "$PHASE" in
  apply)
    echo "→ 门禁检查: apply 阶段"
    [ -f "$SPEC" ] || die "spec.md 不存在 — 请先执行 /spec:propose"

    # HARD-GATE: §9 待澄清必须为空
    if grep -q '^[[:space:]]*- \[ \]' "$SPEC"; then
      echo ""
      echo "  §9 待澄清仍有未解决项:"
      grep '^[[:space:]]*- \[ \]' "$SPEC" || true
      die "HARD-GATE 未通过 — 待澄清全部解决后才能进入 /spec:apply"
    fi
    ok "§9 待澄清已清空"

    # 检查复杂度并验证相应制品
    if grep -q 'complexity:.*🔴' "$SPEC"; then
      [ -f "$TASKS" ] || die "🔴 复杂需求需要 tasks.md — 请重新执行 /spec:propose 生成 tasks"
      ok "tasks.md 已就绪（复杂需求）"

      # 检查 tasks.md 是否有未完成项（但允许进行中的 task）
      incomplete=$(grep -c '^\s*- \[ \]' "$TASKS" 2>/dev/null || true)
      if [ "${incomplete:-0}" -gt 0 ]; then
        echo "  ⚠ tasks.md 仍有 ${incomplete} 个未开始 task（AI 将逐 task 推进）"
      fi
    elif grep -q 'complexity:.*🟢' "$SPEC"; then
      die "🟢 简单需求不应进入 apply 流程 — 直接在对话中编码"
    fi

    echo "GATE PASSED → 可以开始编码"
    ;;

  smoke)
    echo "→ 门禁检查: smoke 阶段"
    [ -f "$SPEC" ] || die "spec.md 不存在"

    if [ -f "$LOG" ]; then
      ok "log.md 已就绪"
    else
      die "log.md 不存在 — 请先执行 /spec:propose"
    fi

    echo "GATE PASSED → 可以开始冒烟"
    ;;

  review)
    echo "→ 门禁检查: review 阶段"
    [ -f "$SPEC" ] || die "spec.md 不存在"

    # 检查冒烟通过
    if [ -f "$LOG" ]; then
      if grep -qi '冒烟.*通过\|smoke.*pass\|编译.*0.*error' "$LOG"; then
        ok "冒烟验证已通过"
      else
        die "log.md 中未找到冒烟通过记录 — 请先执行 /spec:smoke"
      fi
    else
      die "log.md 不存在 — 请先执行 /spec:smoke"
    fi

    # 检查所有 task 已提交
    if [ -f "$TASKS" ]; then
      if grep -q '^\s*- \[ \]' "$TASKS" 2>/dev/null; then
        echo "  ⚠ tasks.md 仍有未完成 task（可能影响审查完整性）"
      fi
    fi

    echo "GATE PASSED → 可以开始审查"
    ;;

  archive)
    echo "→ 门禁检查: archive 阶段"
    [ -f "$SPEC" ] || die "spec.md 不存在"

    # 检查审查通过
    if grep -qi '结论.*通过\|审查.*通过' "$SPEC"; then
      ok "审查结论: 通过"
    elif grep -qi '结论.*需修复\|审查.*未通过\|审查.*✗' "$SPEC"; then
      die "审查未通过 — 请先执行 /spec:fix 修复 Critical 问题"
    else
      die "spec.md 中未找到审查结论 — 请先执行 /spec:review"
    fi

    # 检查是否有未沉淀的知识发现
    if [ -f "$LOG" ]; then
      if grep -qi '知识发现\|knowledge\|#tip' "$LOG"; then
        echo "  ℹ log.md 含知识发现，归档时将提示沉淀到 knowledge/"
      fi
    fi

    echo "GATE PASSED → 可以归档"
    ;;

  test)
    echo "→ 门禁检查: test 阶段"
    [ -f "$SPEC" ] || die "spec.md 不存在"

    # 🔴 复杂需求必须跑测试
    if grep -q 'complexity:.*🔴' "$SPEC"; then
      ok "🔴 复杂需求 — 强制执行自动化测试"
    else
      die "此阶段仅适用于 🔴 复杂需求"
    fi

    echo "GATE PASSED → 可以生成测试"
    ;;

  *)
    echo "Usage: spec-gate.sh <变更名> <apply|smoke|review|archive|test>"
    exit 1
    ;;
esac

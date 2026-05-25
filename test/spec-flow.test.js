/**
 * v4.0.11: /spec:flow 行为合约测试
 *
 * /spec:flow 由 AI 解释执行，不由 CLI 跑流程。但其语义合约是可测的：
 *   - flow.md 必须明确"🟢 拒绝"、"🔴 接受"
 *   - flow.md 必须明确这是"逐 task 停顿"的显式豁免
 *   - AGENTS.md.template 必须对应说明此豁免
 *   - install 后 flow 命令必须落到正确路径
 *
 * 这些是防止 PR 误改文档导致语义漂移的回归保护。
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const REPO = path.resolve(__dirname, '..');

const flowMd = fs.readFileSync(path.join(REPO, 'commands', 'spec', 'flow.md'), 'utf-8');
const agentsTpl = fs.readFileSync(path.join(REPO, 'framework', 'AGENTS.md.template'), 'utf-8');
const adaptersJs = fs.readFileSync(path.join(REPO, 'adapters', 'index.js'), 'utf-8');

// ─── flow.md 内容合约 ──────────────────────────────────────

test('flow.md: 必须拒绝 🟢 轻量需求', () => {
  // 应包含 "🟢" 且和 "lite" / "终止" / "拒绝" 同句近距离出现
  assert.ok(/🟢/.test(flowMd), 'flow.md 应提及 🟢');
  assert.ok(/lite|终止|拒绝|建议改用/.test(flowMd),
    'flow.md 应包含转向 /spec:lite 或终止 flow 的指引');
});

test('flow.md: 必须接受 🔴 重量需求', () => {
  assert.ok(/🔴/.test(flowMd), 'flow.md 应提及 🔴');
  assert.ok(/继续执行|可继续|🔴.*继续|继续.*🔴/.test(flowMd),
    'flow.md 应明确 🔴 复杂需求可继续');
});

test('flow.md: 必须明确是"逐 task 停顿"的显式豁免', () => {
  assert.ok(/豁免|例外|显式|不停下|自主推进|自动模式/.test(flowMd),
    'flow.md 应明确这是逐 task 停顿规则的显式例外');
});

test('flow.md: 必须包含完整流水线五阶段', () => {
  const phases = ['propose', 'apply', 'smoke', 'review', 'archive'];
  for (const phase of phases) {
    assert.ok(new RegExp(phase, 'i').test(flowMd), `flow.md 应包含 ${phase} 阶段`);
  }
});

test('flow.md: 任一步骤失败即停，不继续', () => {
  assert.ok(/失败即停|任一.*失败|失败.*不继续|失败.*停|stop.*on.*fail/i.test(flowMd),
    'flow.md 应明确失败即停的语义');
});

// ─── AGENTS.md.template 一致性 ────────────────────────────

test('AGENTS.md.template: 核心法则中提到 /spec:flow 的豁免', () => {
  // 三条核心法则的"逐 Task 停顿"那条必须提到 flow 是例外
  const ruleSection = agentsTpl.match(/## 三条核心法则[\s\S]*?(?=^## |\Z)/m);
  assert.ok(ruleSection, '应能定位"三条核心法则"');
  assert.ok(/\/spec:flow/.test(ruleSection[0]),
    '"逐 Task 停顿"法则段必须提及 /spec:flow 作为豁免');
});

test('AGENTS.md.template: 意图确认表必须包含 /spec:flow', () => {
  assert.ok(/\| ".*自动完成.*"[^|]*\|[^|]*\/spec:flow/.test(agentsTpl) ||
            /\/spec:flow.*自动完成|自动完成.*\/spec:flow/.test(agentsTpl),
    '意图确认表应映射"自动完成"→ /spec:flow');
});

test('AGENTS.md.template: /spec:flow 不属于复杂度分级（两档只有 lite/propose）', () => {
  // 复杂度分级表里只能有 /spec:lite 和 /spec:propose，不能把 /spec:flow 混进来
  const complexitySection = agentsTpl.match(/## 复杂度分级[\s\S]*?(?=^## |\Z)/m);
  assert.ok(complexitySection, '应能定位"复杂度分级"');
  // 表格的命令列里不应该出现 /spec:flow
  const lines = complexitySection[0].split('\n').filter(l => l.includes('|') && (l.includes('🟢') || l.includes('🔴')));
  for (const line of lines) {
    assert.ok(!/\/spec:flow/.test(line),
      `复杂度分级表不应在命令列出现 /spec:flow（这是显式授权模式，不是复杂度档位），违例行: ${line}`);
  }
});

// ─── adapters 路由表 ───────────────────────────────────────

test('adapters/index.js: 命令路由表必须包含 spec:flow', () => {
  assert.ok(/\/spec:flow[^|]*\|[^|]*spec\/flow\.md/.test(adaptersJs),
    '路由表应包含 /spec:flow → commands/spec/flow.md 映射');
});

test('adapters/index.js: 路由表使用目录式命名（spec/flow.md 不是 spec:flow.md）', () => {
  // 防止任何人加回旧的冒号命名
  assert.ok(!/commands\/spec:flow\.md/.test(adaptersJs),
    '路由表不应再有 commands/spec:flow.md（Windows 不兼容）');
});

// ─── 文件名 Windows 兼容性 ────────────────────────────────

test('flow.md 必须在 commands/spec/ 目录下，不在 commands/ 根', () => {
  assert.ok(fs.existsSync(path.join(REPO, 'commands', 'spec', 'flow.md')),
    'commands/spec/flow.md 必须存在');
  assert.ok(!fs.existsSync(path.join(REPO, 'commands', 'spec:flow.md')),
    'commands/spec:flow.md 不应再存在（含冒号 Windows 不兼容）');
});

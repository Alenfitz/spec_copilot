/**
 * v4.0.12: smoke phase 结构化评分回归测试
 *
 * 守护：
 * 1. smoke 评分项开始使用稳定 code，而非纯日志正则
 * 2. 无输入场景应 skip，而不是默认给满分
 * 3. --no-e2e 不应误伤 smoke 评分
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execSync } = require('node:child_process');

const CLI = path.resolve(__dirname, '..', 'bin', 'cli.js');

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'spec-copilot-smoke-'));
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function runGate(projectRoot, name, phase, extraArgs = '') {
  try {
    return execSync(`node "${CLI}" gate ${name} ${phase} ${extraArgs}`.trim(), {
      cwd: projectRoot,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (e) {
    return (e.stdout || '') + (e.stderr || '');
  }
}

function setupSmokeProject(dir) {
  execSync(`node "${CLI}" install --tool claude-code`, { cwd: dir, stdio: ['pipe', 'pipe', 'pipe'] });
  const changeDir = path.join(dir, 'spec_copilot', 'changes', 'minimal');
  fs.mkdirSync(changeDir, { recursive: true });
  fs.writeFileSync(path.join(changeDir, 'spec.md'), `# 极简 smoke
> status: apply
> complexity: 🟢 轻

## 1. 背景
test
`);
}

test('smoke scoring: 无可构建项目 / 无前端源码 / --no-e2e 时应显示 skip', () => {
  const dir = mkTmp();
  try {
    setupSmokeProject(dir);
    const out = runGate(dir, 'minimal', 'smoke', '--no-e2e');

    assert.ok(/客观评分:/.test(out), `expected 客观评分, got tail:\n${out.slice(-600)}`);
    assert.ok(/⊝ 构建 \(跳过\/无输入\)/.test(out), `expected BUILD skip, got tail:\n${out.slice(-800)}`);
    assert.ok(/⊝ 骨架组件 \(跳过\/无输入\)/.test(out), `expected SKELETON skip, got tail:\n${out.slice(-800)}`);
    assert.ok(/⊝ E2E 页面 \(跳过\/无输入\)/.test(out), `expected E2E skip, got tail:\n${out.slice(-800)}`);
    assert.ok(/⊝ API 连通 \(跳过\/无输入\)/.test(out), `expected API skip, got tail:\n${out.slice(-800)}`);
    assert.ok(/⊝ 交互测试 \(跳过\/无输入\)/.test(out), `expected interaction skip, got tail:\n${out.slice(-800)}`);
    assert.ok(/⊝ 代码质量 \(跳过\/无输入\)/.test(out), `expected code quality skip, got tail:\n${out.slice(-800)}`);
  } finally {
    cleanup(dir);
  }
});

test('smoke scoring: score json breakdown 写出 status 字段', () => {
  const dir = mkTmp();
  try {
    setupSmokeProject(dir);
    runGate(dir, 'minimal', 'smoke', '--no-e2e');
    const scorePath = path.join(dir, 'spec_copilot', 'changes', 'minimal', '.gate-smoke-score.json');
    assert.ok(fs.existsSync(scorePath), 'expected smoke score json to exist');

    const data = JSON.parse(fs.readFileSync(scorePath, 'utf-8'));
    assert.strictEqual(data.phase, 'smoke');
    assert.ok(Array.isArray(data.breakdown));
    assert.ok(data.breakdown.some(item => item.name === '构建' && item.status === 'skip'));
    assert.ok(data.breakdown.some(item => item.name === 'E2E 页面' && item.status === 'skip'));
  } finally {
    cleanup(dir);
  }
});

test('smoke scoring: identity clean 不应因文案变动失去结构化状态', () => {
  const dir = mkTmp();
  try {
    setupSmokeProject(dir);
    const out = runGate(dir, 'minimal', 'smoke', '--no-e2e');
    assert.ok(/客观评分:/.test(out), `expected 客观评分, got tail:\n${out.slice(-700)}`);

    const scorePath = path.join(dir, 'spec_copilot', 'changes', 'minimal', '.gate-smoke-score.json');
    assert.ok(fs.existsSync(scorePath), 'expected smoke score json to exist');
    const data = JSON.parse(fs.readFileSync(scorePath, 'utf-8'));
    const identity = data.breakdown.find(item => item.name === '身份来源');
    assert.ok(!identity, 'smoke breakdown should not accidentally contain review-only IDENTITY item');
  } finally {
    cleanup(dir);
  }
});

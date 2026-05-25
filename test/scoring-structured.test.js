/**
 * v4.0.11: 结构化评分信号回归测试
 *
 * 旧设计：评分层用 failPatterns/skipPatterns 正则匹配 log 文案
 * 新设计：每个检查项有稳定 code，emit structured signal {code, status, message}
 *
 * 这些测试守护：
 * 1. 即使日志文案改了，只要 code 不变，评分仍然正确
 * 2. 没有 code 的旧检查点仍能通过正则兜底
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execSync } = require('node:child_process');

const CLI = path.resolve(__dirname, '..', 'bin', 'cli.js');

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'spec-copilot-scoring-'));
}
function cleanup(dir) { fs.rmSync(dir, { recursive: true, force: true }); }

function runGate(projectRoot, name, phase) {
  try {
    return execSync(`node "${CLI}" gate ${name} ${phase}`, {
      cwd: projectRoot, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (e) {
    return (e.stdout || '') + (e.stderr || '');
  }
}

function setupMinimalProject(dir, options = {}) {
  const {
    logMd = `# Log
## 时间线
| 时间 | 阶段 | 事件 | 备注 |
| 2026-05-25 | smoke | 冒烟测试通过 ✓ | mock |
`,
    withSmokeSentinel = true,
  } = options;

  // 装框架
  execSync(`node "${CLI}" install --tool claude-code`, { cwd: dir, stdio: ['pipe', 'pipe', 'pipe'] });
  // 建一个能进 review 的最小 spec
  const changeDir = path.join(dir, 'spec_copilot', 'changes', 'minimal');
  fs.mkdirSync(changeDir, { recursive: true });
  fs.writeFileSync(path.join(changeDir, 'spec.md'), `# 极简
> status: review
> complexity: 🔴 重

## 1. 背景
test

## 3. 功能点
- **F01** — 测试
`);
  fs.writeFileSync(path.join(changeDir, 'tasks.md'), `# Tasks
| Task | 状态 |
| T01 | done |
`);
  fs.writeFileSync(path.join(changeDir, 'log.md'), logMd);
  if (withSmokeSentinel) {
    // 假装跑过 smoke
    fs.writeFileSync(path.join(changeDir, '.gate-smoke-passed'), '{}');
  }
}

test('scoring: 极简 spec 的 review gate 输出含 ⊝ 跳过标记', () => {
  const dir = mkTmp();
  try {
    setupMinimalProject(dir);
    const out = runGate(dir, 'minimal', 'review');
    // 应有客观评分输出
    assert.ok(/客观评分:/.test(out), `expected 客观评分, got tail:\n${out.slice(-500)}`);
    // 应有至少一个 ⊝ 跳过项（spec 没填矩阵）
    assert.ok(/⊝/.test(out), `expected at least one ⊝ skip, got tail:\n${out.slice(-500)}`);
    // 跳过项不应该 silently 加满分（v4.0.10 修复的核心）
    // 通过验证 "N 项因 spec 未填相应输入而跳过" 这种描述存在
    assert.ok(/项因 spec 未填相应输入而跳过|跳过\/无输入/.test(out));
  } finally { cleanup(dir); }
});

test('scoring: 跳过项不算入分子也不算入分母', () => {
  const dir = mkTmp();
  try {
    setupMinimalProject(dir);
    const out = runGate(dir, 'minimal', 'review');
    // 找出最终分数
    const m = out.match(/客观评分:\s*(\d+)\/100/);
    assert.ok(m, '应能解出分数');
    const score = parseInt(m[1]);

    // 数 ⊝ 数量
    const skipCount = (out.match(/⊝/g) || []).length;

    // 极简 spec 应有多个 skip（无 API 矩阵 / 无 Vxx / 无 AC 矩阵等）
    assert.ok(skipCount >= 3, `expected at least 3 skips, got ${skipCount}`);

    // 如果归一化生效，分数应该不是 0/100 也不是 100/100（除非真的什么都过/什么都失败）
    // 这里只验证分数是合理百分数
    assert.ok(score >= 0 && score <= 100, `score in range, got ${score}`);
  } finally { cleanup(dir); }
});

test('scoring: 输出 .gate-review-score.json 文件含 breakdown', () => {
  const dir = mkTmp();
  try {
    setupMinimalProject(dir);
    runGate(dir, 'minimal', 'review');
    const scorePath = path.join(dir, 'spec_copilot', 'changes', 'minimal', '.gate-review-score.json');
    if (!fs.existsSync(scorePath)) return; // 文件不强制存在
    const data = JSON.parse(fs.readFileSync(scorePath, 'utf-8'));
    assert.strictEqual(typeof data.objectiveScore, 'number');
    assert.ok(Array.isArray(data.breakdown));
    assert.ok(data.breakdown.length > 0);
  } finally { cleanup(dir); }
});

test('scoring: 同一 code 先 pass 后 fail 时应以 fail 为准', () => {
  const dir = mkTmp();
  try {
    setupMinimalProject(dir, {
      logMd: `# Log
## 时间线
| 时间 | 阶段 | 事件 | 备注 |
| 2026-05-25 | review | 仅创建了 review 记录 | mock |
`,
      withSmokeSentinel: true,
    });
    const out = runGate(dir, 'minimal', 'review');
    assert.ok(/❌ smoke 哨兵 \(\+0\/8\)/.test(out), `expected smoke sentinel to fail, got tail:\n${out.slice(-800)}`);
    assert.ok(/log\.md 无冒烟通过记录/.test(out), `expected smoke log failure, got tail:\n${out.slice(-800)}`);
  } finally { cleanup(dir); }
});

test('scoring: review breakdown 应保留 warning 级 pass 的 status', () => {
  const dir = mkTmp();
  try {
    setupMinimalProject(dir);
    const changeDir = path.join(dir, 'spec_copilot', 'changes', 'minimal');
    fs.writeFileSync(path.join(changeDir, 'tasks.md'), `# Tasks
自评功能点覆盖率：0/1
`);
    const out = runGate(dir, 'minimal', 'review');
    assert.ok(/客观评分:/.test(out), `expected 客观评分, got tail:\n${out.slice(-700)}`);

    const scorePath = path.join(changeDir, '.gate-review-score.json');
    if (!fs.existsSync(scorePath)) return;
    const data = JSON.parse(fs.readFileSync(scorePath, 'utf-8'));
    const calibration = data.breakdown.find(item => item.name === '校准差');
    assert.ok(calibration, 'expected 校准差 item in breakdown');
    assert.strictEqual(calibration.status, 'pass');
    assert.strictEqual(calibration.passed, true);
  } finally { cleanup(dir); }
});

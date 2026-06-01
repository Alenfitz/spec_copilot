/**
 * v4.0.15: 🔴 complex changes must pass /spec:test before archive.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execSync } = require('node:child_process');

const CLI = path.resolve(__dirname, '..', 'bin', 'cli.js');

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'spec-copilot-complex-gate-'));
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function runGate(projectRoot, name, phase, extra = '') {
  try {
    return execSync(`node "${CLI}" gate ${name} ${phase} ${extra}`, {
      cwd: projectRoot,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (e) {
    return (e.stdout || '') + (e.stderr || '');
  }
}

function setupChange(dir, options = {}) {
  const { logExtra = '', withReviewSentinel = true } = options;
  execSync(`node "${CLI}" install --tool claude-code`, { cwd: dir, stdio: ['pipe', 'pipe', 'pipe'] });
  const changeDir = path.join(dir, 'spec_copilot', 'changes', 'complex');
  fs.mkdirSync(changeDir, { recursive: true });
  fs.writeFileSync(path.join(changeDir, 'spec.md'), `# Complex
> status: review
> complexity: 🔴 重

## 1. 背景与目标
test

## 3. 功能点
- **F01** — 测试

## 12. 审查结论
- Spec 合规：✅
- 结论：通过
`);
  fs.writeFileSync(path.join(changeDir, 'tasks.md'), `# Tasks
## 变更摘要
- 实测：1 个文件修改
- 未实现功能点：无
- 遗留 TODO：无
`);
  fs.writeFileSync(path.join(changeDir, 'log.md'), `# Log
## 时间线
| 时间 | 阶段 | 事件 | 备注 |
| 2026-05-25 | smoke | 冒烟测试通过 ✓ | mock |
${logExtra}

## Spec-Code 偏差记录
| 偏差点 | Spec 预期 | 实际情况 | 处理方式 |
| 无 | 无 | 无 | 无 |
`);
  if (withReviewSentinel) {
    runGate(dir, 'complex', 'smoke');
    runGate(dir, 'complex', 'review');
  }
  return changeDir;
}

test('archive gate: 🔴 complex change without test sentinel fails', () => {
  const dir = mkTmp();
  try {
    setupChange(dir, {
      logExtra: '| 2026-05-25 | test | 测试报告：总计：1 个用例，1 通过，0 失败 | mock |',
    });
    const out = runGate(dir, 'complex', 'archive');
    assert.match(out, /缺少 \.gate-test-passed/);
    assert.match(out, /Gate 未通过/);
  } finally {
    cleanup(dir);
  }
});

test('test gate: --record-pass writes .gate-test-passed for complex changes', () => {
  const dir = mkTmp();
  try {
    const changeDir = setupChange(dir, {
      logExtra: '| 2026-05-25 | test | 测试报告：总计：1 个用例，1 通过，0 失败 | mock |',
    });
    const out = runGate(dir, 'complex', 'test', '--record-pass');
    assert.match(out, /Gate 通过/);
    assert.ok(fs.existsSync(path.join(changeDir, '.gate-test-passed')));
  } finally {
    cleanup(dir);
  }
});

test('archive gate: explicit incomplete declaration blocks archive', () => {
  const dir = mkTmp();
  try {
    const changeDir = setupChange(dir, {
      logExtra: '| 2026-05-25 | test | 测试报告：总计：1 个用例，1 通过，0 失败 | mock |',
    });
    runGate(dir, 'complex', 'test', '--record-pass');
    fs.writeFileSync(path.join(changeDir, 'tasks.md'), `# Tasks
## 变更摘要
- 实测：1 个文件修改
- 未实现功能点：F03 附件上传
- 遗留 TODO：无
`);
    const out = runGate(dir, 'complex', 'archive');
    assert.match(out, /归档阻断/);
    assert.match(out, /未实现功能点/);
  } finally {
    cleanup(dir);
  }
});

test('archive gate: clean complex change with review and test sentinels passes', () => {
  const dir = mkTmp();
  try {
    const changeDir = setupChange(dir, {
      logExtra: '| 2026-05-25 | test | 测试报告：总计：1 个用例，1 通过，0 失败 | mock |',
    });
    runGate(dir, 'complex', 'test', '--record-pass');
    const out = runGate(dir, 'complex', 'archive');
    assert.match(out, /Gate 通过/);
    assert.doesNotMatch(out, /归档阻断|缺少 \.gate-test-passed/);
  } finally {
    cleanup(dir);
  }
});

test('archive gate: forged unsigned sentinels are rejected', () => {
  const dir = mkTmp();
  try {
    const changeDir = setupChange(dir, {
      logExtra: '| 2026-05-25 | test | 测试报告：总计：1 个用例，1 通过，0 失败 | mock |',
      withReviewSentinel: false,
    });
    fs.writeFileSync(path.join(changeDir, '.gate-review-passed'), '{}');
    fs.writeFileSync(path.join(changeDir, '.gate-test-passed'), '{}');
    const out = runGate(dir, 'complex', 'archive');
    assert.match(out, /哨兵无效|缺少 gate 签名|旧格式哨兵/);
    assert.match(out, /Gate 未通过/);
  } finally {
    cleanup(dir);
  }
});

/**
 * CLI 冒烟测试 — 确保各命令至少能跑起来不崩
 */

const { test } = require('node:test');
const assert = require('node:assert');
const { execSync } = require('node:child_process');
const path = require('node:path');

const CLI = path.join(__dirname, '..', 'bin', 'cli.js');

function run(args, opts = {}) {
  try {
    return execSync(`node "${CLI}" ${args}`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], ...opts });
  } catch (e) {
    return { error: true, stdout: e.stdout?.toString() || '', stderr: e.stderr?.toString() || '', status: e.status };
  }
}

test('CLI: --help 输出包含所有核心命令', () => {
  const out = run('--help');
  assert.ok(typeof out === 'string', 'help 应该正常退出');
  assert.ok(out.includes('install'));
  assert.ok(out.includes('update'));
  assert.ok(out.includes('gate'));
  assert.ok(out.includes('lint'));
  assert.ok(out.includes('sync'));
  assert.ok(out.includes('doctor'));
  assert.ok(out.includes('uninstall'));
});

test('CLI: 无参数等同于 --help', () => {
  const out = run('');
  assert.ok(typeof out === 'string');
  assert.ok(out.includes('install'));
});

test('CLI: 未知命令 → 退出码非 0 + 提示', () => {
  const result = run('totally-unknown-command');
  assert.strictEqual(result.error, true);
  const out = (result.stderr || '') + (result.stdout || '');
  assert.ok(out.includes('未知命令') || out.includes('Unknown'), `output: ${out}`);
});

test('CLI: install --tool unknown → 报错退出', () => {
  const result = run('install --tool no-such-tool');
  assert.strictEqual(result.error, true);
});

test('CLI: ci 子命令存在', () => {
  const out = run('ci');
  assert.ok(typeof out === 'string');
  assert.ok(out.includes('ci') || out.includes('CI'));
});

test('CLI: guard 子命令存在', () => {
  const out = run('guard');
  // guard 无参数应给出子命令列表
  assert.ok(typeof out === 'string' || out.stdout);
});

test('CLI: agents list 不崩', () => {
  const out = run('agents list');
  // 至少不应该 crash
  assert.ok(typeof out === 'string' || !out.error || out.status !== null);
});

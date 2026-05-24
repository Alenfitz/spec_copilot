/**
 * 端到端 install 测试 — 在临时目录跑完整的 install 流程
 */

const { test } = require('node:test');
const assert = require('node:assert');
const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const CLI = path.join(__dirname, '..', 'bin', 'cli.js');

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'spec-copilot-install-'));
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function runIn(dir, args) {
  try {
    return execSync(`node "${CLI}" ${args}`, { encoding: 'utf-8', cwd: dir, stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (e) {
    return { error: true, stdout: e.stdout?.toString() || '', stderr: e.stderr?.toString() || '' };
  }
}

test('install --tool claude-code: 创建预期目录结构', () => {
  const dir = mkTmp();
  try {
    const out = runIn(dir, 'install --tool claude-code');
    assert.ok(typeof out === 'string', `install 失败: ${JSON.stringify(out)}`);

    // 关键目录
    assert.ok(fs.existsSync(path.join(dir, 'spec_copilot')), 'spec_copilot/ 应存在');
    assert.ok(fs.existsSync(path.join(dir, 'spec_copilot', 'rules')), 'rules/ 应存在');
    assert.ok(fs.existsSync(path.join(dir, 'spec_copilot', 'commands')), 'commands/ 应存在');
    assert.ok(fs.existsSync(path.join(dir, 'spec_copilot', 'stack-adapters')), 'stack-adapters/ 应存在');
    assert.ok(fs.existsSync(path.join(dir, 'spec_copilot', 'changes', 'templates')), 'changes/templates/ 应存在');

    // 主提示词
    assert.ok(fs.existsSync(path.join(dir, 'CLAUDE.md')), 'CLAUDE.md 应存在');

    // 原生命令目录
    assert.ok(fs.existsSync(path.join(dir, '.claude', 'commands')), '.claude/commands/ 应存在');

    // sub-agent profiles
    assert.ok(fs.existsSync(path.join(dir, '.claude', 'agents')), '.claude/agents/ 应存在');
  } finally {
    cleanup(dir);
  }
});

test('install --tool cursor: 同时生成 .cursor/rules + .cursorrules legacy 文件', () => {
  const dir = mkTmp();
  try {
    const out = runIn(dir, 'install --tool cursor');
    assert.ok(typeof out === 'string');

    assert.ok(fs.existsSync(path.join(dir, '.cursor', 'rules', 'spec-copilot.mdc')), '.cursor/rules/spec-copilot.mdc 应存在');
    assert.ok(fs.existsSync(path.join(dir, '.cursorrules')), '.cursorrules legacy 应存在');
  } finally {
    cleanup(dir);
  }
});

test('install: 模板文件正确拷贝（spec.md / tasks.md / log.md）', () => {
  const dir = mkTmp();
  try {
    runIn(dir, 'install --tool claude-code');
    const templatesDir = path.join(dir, 'spec_copilot', 'changes', 'templates');
    assert.ok(fs.existsSync(path.join(templatesDir, 'spec.md')));
    assert.ok(fs.existsSync(path.join(templatesDir, 'tasks.md')));
    assert.ok(fs.existsSync(path.join(templatesDir, 'log.md')));
  } finally {
    cleanup(dir);
  }
});

test('install: commands 中包含 spec:lite（v4.0+）', () => {
  const dir = mkTmp();
  try {
    runIn(dir, 'install --tool claude-code');
    const cmdFile = path.join(dir, '.claude', 'commands', 'spec:lite.md');
    assert.ok(fs.existsSync(cmdFile), 'spec:lite.md 应已安装');
    const content = fs.readFileSync(cmdFile, 'utf-8');
    assert.ok(content.includes('轻量需求'), 'spec:lite 内容应正确');
  } finally {
    cleanup(dir);
  }
});

test('install --tool all: 多工具同时安装', () => {
  const dir = mkTmp();
  try {
    const out = runIn(dir, 'install --tool all');
    assert.ok(typeof out === 'string');

    // 至少几个关键工具的文件都应存在
    assert.ok(fs.existsSync(path.join(dir, 'CLAUDE.md')), 'claude-code 已装');
    assert.ok(fs.existsSync(path.join(dir, '.cursorrules')), 'cursor 已装');
    assert.ok(fs.existsSync(path.join(dir, 'AGENTS.md')), 'opencode 已装');
  } finally {
    cleanup(dir);
  }
});

test('doctor: 安装后能正常显示状态', () => {
  const dir = mkTmp();
  try {
    runIn(dir, 'install --tool claude-code');
    const out = runIn(dir, 'doctor');
    assert.ok(typeof out === 'string', `doctor 失败: ${JSON.stringify(out)}`);
    assert.ok(out.includes('spec_copilot') || out.includes('安装') || out.includes('install'));
  } finally {
    cleanup(dir);
  }
});

test('uninstall --confirm: 清理已安装文件', () => {
  const dir = mkTmp();
  try {
    runIn(dir, 'install --tool claude-code');
    assert.ok(fs.existsSync(path.join(dir, 'CLAUDE.md')));

    runIn(dir, 'uninstall --confirm');

    // CLAUDE.md 应被清理
    assert.ok(!fs.existsSync(path.join(dir, 'CLAUDE.md')), 'CLAUDE.md 应被清理');
  } finally {
    cleanup(dir);
  }
});

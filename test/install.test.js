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

test('install: spec_copilot/commands 为 14 个目录式命令文件', () => {
  const dir = mkTmp();
  try {
    runIn(dir, 'install --tool claude-code');
    const specDir = path.join(dir, 'spec_copilot', 'commands', 'spec');
    const files = fs.readdirSync(specDir).filter(name => name.endsWith('.md')).sort();
    assert.strictEqual(files.length, 14, `expected 14 commands, got ${files.length}: ${files.join(', ')}`);
    assert.ok(files.includes('agent-check.md'));
    assert.ok(files.includes('docs.md'));
    assert.ok(files.includes('flow.md'));
  } finally {
    cleanup(dir);
  }
});

test('install: 通用框架目录包含 agents', () => {
  const dir = mkTmp();
  try {
    runIn(dir, 'install --tool claude-code');
    assert.ok(fs.existsSync(path.join(dir, 'spec_copilot', 'agents')), 'spec_copilot/agents/ 应存在');
  } finally {
    cleanup(dir);
  }
});

test('update: 保留用户自定义 stack-adapter，同时刷新内置 nextjs/react-express', () => {
  const dir = mkTmp();
  try {
    runIn(dir, 'install --tool claude-code');

    const adapterDir = path.join(dir, 'spec_copilot', 'stack-adapters');
    const custom = path.join(adapterDir, 'my-team-stack.md');
    const builtin = path.join(adapterDir, 'nextjs.md');

    fs.writeFileSync(custom, '# custom adapter', 'utf-8');
    fs.writeFileSync(builtin, 'stale builtin adapter', 'utf-8');

    const out = runIn(dir, 'update --force --tool claude-code');
    assert.ok(typeof out === 'string', `update 失败: ${JSON.stringify(out)}`);

    const nextContent = fs.readFileSync(builtin, 'utf-8');
    assert.ok(nextContent.includes('Next.js'), '内置 nextjs adapter 应被刷新');
    assert.strictEqual(fs.readFileSync(custom, 'utf-8'), '# custom adapter', '自定义 adapter 应被保留');
  } finally {
    cleanup(dir);
  }
});

test('install: commands 中包含 spec/lite（v4.0.3+ 目录式命名）', () => {
  const dir = mkTmp();
  try {
    runIn(dir, 'install --tool claude-code');
    const cmdFile = path.join(dir, '.claude', 'commands', 'spec', 'lite.md');
    assert.ok(fs.existsSync(cmdFile), 'commands/spec/lite.md 应已安装');
    const content = fs.readFileSync(cmdFile, 'utf-8');
    assert.ok(content.includes('轻量需求'), 'spec/lite 内容应正确');
  } finally {
    cleanup(dir);
  }
});

test('update --force: 清理 v4.0.3 前的 spec:xxx 旧命令文件', {
  skip: process.platform === 'win32' ? 'Windows 文件系统不能创建 legacy spec:xxx.md 测试夹具' : false,
}, () => {
  const dir = mkTmp();
  try {
    runIn(dir, 'install --tool claude-code');
    const legacyProjectCommand = path.join(dir, 'spec_copilot', 'commands', 'spec:apply.md');
    const legacyNativeCommand = path.join(dir, '.claude', 'commands', 'spec:apply.md');
    fs.writeFileSync(legacyProjectCommand, 'legacy project command', 'utf-8');
    fs.writeFileSync(legacyNativeCommand, 'legacy native command', 'utf-8');

    const out = runIn(dir, 'update --force --tool claude-code');
    assert.ok(typeof out === 'string', `update 失败: ${JSON.stringify(out)}`);

    assert.ok(!fs.existsSync(legacyProjectCommand), 'spec_copilot/commands/spec:apply.md 应被清理');
    assert.ok(!fs.existsSync(legacyNativeCommand), '.claude/commands/spec:apply.md 应被清理');
    assert.ok(fs.existsSync(path.join(dir, 'spec_copilot', 'commands', 'spec', 'apply.md')), '目录式项目命令应保留');
    assert.ok(fs.existsSync(path.join(dir, '.claude', 'commands', 'spec', 'apply.md')), '目录式原生命令应保留');
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

test('install --tool opencode: 安装到 .opencode/agents 并使用 permission frontmatter', () => {
  const dir = mkTmp();
  try {
    runIn(dir, 'install --tool opencode');
    const agentFile = path.join(dir, '.opencode', 'agents', 'spec-compliance-reviewer.md');
    assert.ok(fs.existsSync(agentFile), '.opencode/agents/spec-compliance-reviewer.md 应存在');
    assert.ok(!fs.existsSync(path.join(dir, '.opencode', 'agent')), '不应再创建旧目录 .opencode/agent');

    const content = fs.readFileSync(agentFile, 'utf-8');
    assert.ok(/^mode:\s*subagent$/m.test(content), 'opencode agent 应声明 mode: subagent');
    assert.ok(/^permission:\s*$/m.test(content), 'opencode agent 应使用 permission 配置');
    assert.ok(!/^tools:\s*$/m.test(content), 'opencode agent 不应使用旧 tools 配置');
  } finally {
    cleanup(dir);
  }
});

test('agents verify: 能发现 opencode 旧目录残留', () => {
  const dir = mkTmp();
  try {
    runIn(dir, 'install --tool opencode');
    fs.mkdirSync(path.join(dir, '.opencode', 'agent'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.opencode', 'agent', 'spec-compliance-reviewer.md'), 'old', 'utf-8');

    const out = runIn(dir, 'agents verify --tool opencode');
    assert.ok(out && out.error, `verify 应失败但通过了: ${JSON.stringify(out)}`);
    assert.ok(
      `${out.stdout}\n${out.stderr}`.includes('旧版目录') ||
      `${out.stdout}\n${out.stderr}`.includes('agent verify 失败'),
      `verify 输出应说明旧目录问题: ${JSON.stringify(out)}`,
    );
  } finally {
    cleanup(dir);
  }
});

test('agents verify: opencode 新目录和 frontmatter 正确时通过', () => {
  const dir = mkTmp();
  try {
    runIn(dir, 'install --tool opencode');
    const out = runIn(dir, 'agents verify --tool opencode');
    assert.ok(out.includes('agent verify 通过'), `verify 输出异常: ${out}`);
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

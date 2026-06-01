/**
 * Adapter 模块测试 — 不依赖外部包，用 Node 内置 test runner
 * 运行：node --test test/
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { adapters, supportedTools, detectTools, detectStack, buildStackContext, parseAgentMeta, stripFrontmatter } = require('../adapters');

// ─── 工具：创建临时项目目录 ─────────────────────────────
function mkTmp(setup) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-copilot-test-'));
  setup(dir);
  return dir;
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

// ─── 基础结构 ──────────────────────────────────────────
test('adapters: 包含全部 6 个工具', () => {
  const names = supportedTools();
  assert.deepStrictEqual(names.sort(), ['claude-code', 'cline', 'copilot', 'cursor', 'opencode', 'windsurf'].sort());
});

test('adapters: 每个 adapter 有必备字段', () => {
  for (const name of supportedTools()) {
    const a = adapters[name];
    assert.ok(a.name, `${name} 缺 name`);
    assert.ok(a.displayName, `${name} 缺 displayName`);
    assert.ok(a.promptPath, `${name} 缺 promptPath`);
    assert.strictEqual(typeof a.detect, 'function', `${name} detect 不是函数`);
    assert.strictEqual(typeof a.formatPrompt, 'function', `${name} formatPrompt 不是函数`);
    assert.ok(Array.isArray(a.cleanupPaths), `${name} cleanupPaths 不是数组`);
  }
});

test('adapters: cursor / windsurf 有 legacyPath（v3.1.0+）', () => {
  assert.strictEqual(adapters.cursor.legacyPath, '.cursorrules');
  assert.strictEqual(adapters.windsurf.legacyPath, '.windsurfrules');
});

test('adapters: opencode / claude-code 支持 sub-agent profile', () => {
  assert.strictEqual(adapters.opencode.supportsSubagent, true);
  assert.strictEqual(adapters.opencode.agentsDir, '.opencode/agents');
  assert.strictEqual(adapters.opencode.legacyAgentsDir, '.opencode/agent');
  assert.strictEqual(adapters['claude-code'].supportsSubagent, true);
});

// ─── detect ────────────────────────────────────────────
test('detect: 空目录 → 检测不到任何工具', () => {
  const dir = mkTmp(() => {});
  try {
    const detected = detectTools(dir);
    assert.strictEqual(detected.length, 0);
  } finally {
    cleanup(dir);
  }
});

test('detect: 含 .claude/ 的项目 → 识别为 claude-code', () => {
  const dir = mkTmp(d => fs.mkdirSync(path.join(d, '.claude')));
  try {
    const detected = detectTools(dir);
    assert.strictEqual(detected.length, 1);
    assert.strictEqual(detected[0].name, 'claude-code');
  } finally {
    cleanup(dir);
  }
});

test('detect: 含 .cursorrules 的项目 → 识别为 cursor', () => {
  const dir = mkTmp(d => fs.writeFileSync(path.join(d, '.cursorrules'), 'test'));
  try {
    const detected = detectTools(dir);
    assert.strictEqual(detected.length, 1);
    assert.strictEqual(detected[0].name, 'cursor');
  } finally {
    cleanup(dir);
  }
});

// ─── detectStack ───────────────────────────────────────
test('detectStack: 空项目 → 各字段为 null/空', () => {
  const dir = mkTmp(() => {});
  try {
    const stack = detectStack(dir);
    assert.strictEqual(stack.frontend, null);
    assert.strictEqual(stack.backend, null);
    assert.deepStrictEqual(stack.language, []);
  } finally {
    cleanup(dir);
  }
});

test('detectStack: 含 vue 的 package.json → frontend=Vue', () => {
  const dir = mkTmp(d => {
    fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({
      dependencies: { vue: '^3.4.0' },
    }));
  });
  try {
    const stack = detectStack(dir);
    assert.strictEqual(stack.frontend, 'Vue 3');
  } finally {
    cleanup(dir);
  }
});

test('detectStack: 含 next 的 package.json → frontend=Next.js', () => {
  const dir = mkTmp(d => {
    fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({
      dependencies: { next: '^14.0.0', react: '^18.0.0' },
    }));
  });
  try {
    const stack = detectStack(dir);
    assert.strictEqual(stack.frontend, 'Next.js');
  } finally {
    cleanup(dir);
  }
});

test('detectStack: 含 pom.xml → backend=Spring Boot', () => {
  const dir = mkTmp(d => fs.writeFileSync(path.join(d, 'pom.xml'), '<project/>'));
  try {
    const stack = detectStack(dir);
    assert.strictEqual(stack.backend, 'Spring Boot');
    assert.ok(stack.language.includes('Java'));
  } finally {
    cleanup(dir);
  }
});

test('detectStack: 含 express 依赖 → backend=Express', () => {
  const dir = mkTmp(d => {
    fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({
      dependencies: { express: '^4.0.0' },
    }));
  });
  try {
    const stack = detectStack(dir);
    assert.strictEqual(stack.backend, 'Express');
  } finally {
    cleanup(dir);
  }
});

test('detectStack: 含 go.mod → backend=Go', () => {
  const dir = mkTmp(d => fs.writeFileSync(path.join(d, 'go.mod'), 'module test'));
  try {
    const stack = detectStack(dir);
    assert.strictEqual(stack.backend, 'Go');
  } finally {
    cleanup(dir);
  }
});

test('detectStack: 含 pnpm-lock.yaml → packageManager=pnpm', () => {
  const dir = mkTmp(d => {
    fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({ dependencies: { vue: '^3.0.0' } }));
    fs.writeFileSync(path.join(d, 'pnpm-lock.yaml'), 'lockfileVersion: 6');
  });
  try {
    const stack = detectStack(dir);
    assert.strictEqual(stack.packageManager, 'pnpm');
  } finally {
    cleanup(dir);
  }
});

// ─── buildStackContext ──────────────────────────────────
test('buildStackContext: 空 stack → 空字符串', () => {
  const ctx = buildStackContext({ frontend: null, backend: null, language: [], extras: [] });
  assert.strictEqual(ctx, '');
});

test('buildStackContext: 完整 stack → 含所有字段', () => {
  const ctx = buildStackContext({
    frontend: 'Vue 3', backend: 'Spring Boot',
    language: ['TypeScript', 'Java'], buildTool: 'Vite',
    packageManager: 'pnpm', db: 'MySQL', extras: ['Element UI'],
  });
  assert.ok(ctx.includes('Vue 3'));
  assert.ok(ctx.includes('Spring Boot'));
  assert.ok(ctx.includes('TypeScript, Java'));
  assert.ok(ctx.includes('MySQL'));
  assert.ok(ctx.includes('Element UI'));
});

// ─── parseAgentMeta ────────────────────────────────────
test('parseAgentMeta: 无 frontmatter → 空对象', () => {
  const m = parseAgentMeta('# Just content\nNo frontmatter');
  assert.strictEqual(m.name, '');
});

test('parseAgentMeta: 解析 name / role / tools', () => {
  const content = `---
name: reviewer
role: 审查者
tools: read, grep, bash
---
内容`;
  const m = parseAgentMeta(content);
  assert.strictEqual(m.name, 'reviewer');
  assert.strictEqual(m.role, '审查者');
  assert.deepStrictEqual(m.tools, ['read', 'grep', 'bash']);
});

// ─── stripFrontmatter ──────────────────────────────────
test('stripFrontmatter: 移除 YAML 前置数据', () => {
  const content = `---
name: test
---
正文`;
  const stripped = stripFrontmatter(content);
  assert.strictEqual(stripped.trim(), '正文');
});

test('stripFrontmatter: 无 frontmatter 时原样返回', () => {
  const content = '# 标题\n正文';
  assert.strictEqual(stripFrontmatter(content), content);
});

// ─── formatPrompt ──────────────────────────────────────
test('formatPrompt: cursor adapter 添加 frontmatter + 命令路由', () => {
  const formatted = adapters.cursor.formatPrompt('# 主提示词');
  assert.ok(formatted.includes('---'));
  assert.ok(formatted.includes('alwaysApply: true'));
  assert.ok(formatted.includes('# 主提示词'));
  assert.ok(formatted.includes('命令路由'));
});

test('formatPrompt: opencode adapter 原样返回（无修改）', () => {
  const input = '# 主提示词\n内容';
  const output = adapters.opencode.formatPrompt(input);
  assert.strictEqual(output, input);
});

test('formatAgent: opencode 使用 .opencode/agents + permission frontmatter', () => {
  const input = `---
name: reviewer
role: 审查者
tools: read, grep, bash
---
# Body`;
  const meta = parseAgentMeta(input);
  const output = adapters.opencode.formatAgent(input, meta);
  assert.ok(output.includes('mode: subagent'));
  assert.ok(output.includes('permission:'));
  assert.ok(output.includes('  read: allow'));
  assert.ok(output.includes('  edit: deny'));
  assert.ok(!/^tools:\s*$/m.test(output));
});

test('formatLegacy: cursor → 含命令路由', () => {
  const formatted = adapters.cursor.formatLegacy('# 主提示词');
  assert.ok(formatted.includes('# 主提示词'));
  assert.ok(formatted.includes('命令路由'));
});

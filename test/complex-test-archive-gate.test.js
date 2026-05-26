/**
 * v4.0.15: 🔴 complex changes must pass /spec:test before archive.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
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
  const { logExtra = '', withReviewSentinel = true, complexity = '🔴 重', specExtra = '' } = options;
  execSync(`node "${CLI}" install --tool claude-code`, { cwd: dir, stdio: ['pipe', 'pipe', 'pipe'] });
  const changeDir = path.join(dir, 'spec_copilot', 'changes', 'complex');
  fs.mkdirSync(changeDir, { recursive: true });
fs.writeFileSync(path.join(changeDir, 'spec.md'), `# Complex
> status: review
> complexity: ${complexity}

## 1. 背景与目标
test

## 3. 功能点
- **F01** — 测试

${specExtra}

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
    writeGateSentinel(dir, 'complex', 'smoke');
    writeGateSentinel(dir, 'complex', 'review');
  }
  writeApplySentinel(dir, 'complex');
  return changeDir;
}

function writeGateSentinel(projectRoot, changeName, phase) {
  const changeDir = path.join(projectRoot, 'spec_copilot', 'changes', changeName);
  const now = Date.now();
  const files = ['spec.md', 'tasks.md', 'log.md'];
  const hashes = Object.fromEntries(files.map(file => [
    file.replace('.md', 'Hash'),
    crypto
      .createHash('sha256')
      .update(fs.readFileSync(path.join(changeDir, file)))
      .digest('hex'),
  ]));
  const source = computeSourceHash(projectRoot, changeName);
  const sentinel = {
    generatedBy: 'spec-copilot-cli',
    phase,
    changeName,
    timestamp: now,
    version: 'test',
    evidence: {
      schemaVersion: 1,
      generatedBy: 'spec-copilot-cli',
      runId: `test-${phase}`,
      phase,
      changeName,
      version: 'test',
      timestamp: now,
      command: `spec-copilot gate ${changeName} ${phase}`,
      cwd: projectRoot,
      environment: { node: process.version, platform: process.platform, arch: process.arch },
      inputs: {
        specHash: hashes.specHash,
        tasksHash: hashes.tasksHash,
        logHash: hashes.logHash,
        sourceHash: source.hash,
        sourceFileCount: source.fileCount,
      },
      runtime: { pass: true },
    },
  };
  fs.writeFileSync(path.join(changeDir, `.gate-${phase}-passed`), JSON.stringify(sentinel, null, 2));
}

function writeApplySentinel(projectRoot, changeName) {
  const changeDir = path.join(projectRoot, 'spec_copilot', 'changes', changeName);
  const spec = fs.readFileSync(path.join(changeDir, 'spec.md'), 'utf-8');
  const sentinel = {
    generatedBy: 'spec-copilot-cli',
    phase: 'apply',
    changeName,
    timestamp: Date.now(),
    version: 'test',
    evidence: {
      schemaVersion: 1,
      generatedBy: 'spec-copilot-cli',
      phase: 'apply',
      changeName,
      version: 'test',
      timestamp: Date.now(),
      specContractHash: hashSpecContract(spec),
      runtime: { trustLevel: 'trusted', degraded: false, degradationReasons: [] },
    },
  };
  fs.writeFileSync(path.join(changeDir, '.gate-apply-passed'), JSON.stringify(sentinel, null, 2));
}

function shouldSkipEvidenceFile(relPath, changeName) {
  const rel = relPath.replace(/\\/g, '/');
  const first = rel.split('/')[0];
  if (
    rel === '.git' ||
    rel.startsWith('.git/') ||
    rel.includes('/.git/') ||
    first === 'node_modules' ||
    rel.includes('/node_modules/') ||
    first === 'dist' ||
    rel.includes('/dist/') ||
    first === 'target' ||
    rel.includes('/target/') ||
    first === 'build' ||
    rel.includes('/build/') ||
    first === 'coverage' ||
    rel.includes('/coverage/') ||
    first === '.next' ||
    rel.includes('/.next/') ||
    first === '.nuxt' ||
    rel.includes('/.nuxt/') ||
    rel.startsWith('.spec-copilot/screenshots/') ||
    rel.includes('/.spec-copilot/screenshots/')
  ) return true;
  if (/\.DS_Store$/.test(rel)) return true;
  if (rel.startsWith(`spec_copilot/changes/${changeName}/.gate-`)) return true;
  return false;
}

function computeSourceHash(projectRoot, changeName) {
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(projectRoot, full).replace(/\\/g, '/');
      if (shouldSkipEvidenceFile(rel, changeName)) continue;
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) files.push(rel);
    }
  };
  walk(projectRoot);
  files.sort();
  const h = crypto.createHash('sha256');
  for (const rel of files) {
    h.update(rel);
    h.update('\0');
    h.update(fs.readFileSync(path.join(projectRoot, rel)));
    h.update('\0');
  }
  return { hash: h.digest('hex'), fileCount: files.length };
}

function hashSpecContract(specContent) {
  const contractSections = {};
  const sectionRanges = [
    ['1', '## 2. 代码现状'],
    ['3', '## 4. 业务规则'],
    ['4', '## 5. 数据变更'],
    ['5', '## 6. 接口契约'],
    ['6', '## 7. 影响范围'],
    ['7', '## 8. 测试策略'],
    ['9', '## 10. 技术决策'],
  ];
  for (const [startNum, endMarker] of sectionRanges) {
    const startPattern = new RegExp(`^##\\s+${startNum}\\.[^\\n]*`, 'm');
    const start = specContent.search(startPattern);
    if (start === -1) continue;
    const tail = specContent.slice(start);
    const endIdx = endMarker ? tail.indexOf(`\n${endMarker}`) : -1;
    contractSections[startNum] = (endIdx === -1 ? tail : tail.slice(0, endIdx)).trim();
  }
  const h = crypto.createHash('sha256');
  for (const key of Object.keys(contractSections).sort()) {
    h.update(key);
    h.update('\0');
    h.update(contractSections[key]);
    h.update('\0');
  }
  return h.digest('hex');
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
    fs.writeFileSync(path.join(changeDir, '.gate-test-passed'), '{}');
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
    writeGateSentinel(dir, 'complex', 'test');
    const out = runGate(dir, 'complex', 'archive');
    assert.match(out, /Gate 通过/);
    assert.doesNotMatch(out, /归档阻断|缺少 \.gate-test-passed/);
  } finally {
    cleanup(dir);
  }
});

test('review gate: hand-written smoke sentinel fails evidence validation', () => {
  const dir = mkTmp();
  try {
    const changeDir = setupChange(dir, { withReviewSentinel: false });
    fs.writeFileSync(path.join(changeDir, '.gate-smoke-passed'), '{}');
    const out = runGate(dir, 'complex', 'review');
    assert.match(out, /smoke gate 哨兵无效/);
    assert.match(out, /缺少 CLI 签发证据|手写哨兵/);
    assert.match(out, /Gate 未通过/);
  } finally {
    cleanup(dir);
  }
});

test('archive gate: stale review sentinel fails after source changes', () => {
  const dir = mkTmp();
  try {
    setupChange(dir, {
      logExtra: '| 2026-05-25 | test | 测试报告：总计：1 个用例，1 通过，0 失败 | mock |',
    });
    writeGateSentinel(dir, 'complex', 'test');
    fs.appendFileSync(path.join(dir, 'spec_copilot', 'changes', 'complex', 'log.md'), '\n| 2026-05-25 | note | gate 后追加记录 | stale |\n');
    const out = runGate(dir, 'complex', 'archive');
    assert.match(out, /review gate 哨兵无效|已失效/);
    assert.match(out, /必须重跑 gate/);
    assert.match(out, /Gate 未通过/);
  } finally {
    cleanup(dir);
  }
});

test('review gate: spec contract change after apply is blocked', () => {
  const dir = mkTmp();
  try {
    const changeDir = setupChange(dir, {
      withReviewSentinel: false,
    });
    const specPath = path.join(changeDir, 'spec.md');
    const spec = fs.readFileSync(specPath, 'utf-8');
    fs.writeFileSync(specPath, spec.replace('- **F01** — 测试', '- **F01** — 测试\n- **F02** — apply 后新增需求'));
    const out = runGate(dir, 'complex', 'review');
    assert.match(out, /spec 契约冻结校验失败|spec 契约冻结失败/);
    assert.match(out, /specContractHash|改低需求|必须回到 \/spec:propose/);
    assert.match(out, /Gate 未通过/);
  } finally {
    cleanup(dir);
  }
});

test('archive gate: apply contract freeze does not block pure log updates', () => {
  const dir = mkTmp();
  try {
    const changeDir = setupChange(dir, {
      logExtra: '| 2026-05-25 | note | only log updated | ok |',
    });
    writeGateSentinel(dir, 'complex', 'test');
    const out = runGate(dir, 'complex', 'archive');
    assert.match(out, /Gate 通过/);
    assert.ok(fs.existsSync(path.join(changeDir, '.gate-apply-passed')));
  } finally {
    cleanup(dir);
  }
});

test('smoke gate: complex change cannot pass with --no-e2e', () => {
  const dir = mkTmp();
  try {
    const changeDir = setupChange(dir, { withReviewSentinel: false });
    const out = runGate(dir, 'complex', 'smoke', '--no-e2e');
    assert.match(out, /复杂需求不允许通过 --no-e2e/);
    assert.match(out, /Gate 未通过/);
    assert.ok(!fs.existsSync(path.join(changeDir, '.gate-smoke-passed')));
  } finally {
    cleanup(dir);
  }
});

test('smoke gate: non-complex --no-e2e writes degraded evidence', () => {
  const dir = mkTmp();
  try {
    const changeDir = setupChange(dir, {
      withReviewSentinel: false,
      complexity: '🟢 轻',
    });
    const out = runGate(dir, 'complex', 'smoke', '--no-e2e');
    assert.match(out, /Gate 通过/);
    const sentinel = JSON.parse(fs.readFileSync(path.join(changeDir, '.gate-smoke-passed'), 'utf-8'));
    assert.strictEqual(sentinel.generatedBy, 'spec-copilot-cli');
    assert.strictEqual(sentinel.evidence.runtime.trustLevel, 'degraded');
    assert.ok(sentinel.evidence.inputs.specHash);
  } finally {
    cleanup(dir);
  }
});

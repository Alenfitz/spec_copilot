/**
 * v4.0.20: completed tasks with self-declared gaps must not silently pass review.
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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'spec-copilot-task-self-'));
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function runGate(projectRoot, name, phase) {
  try {
    return execSync(`node "${CLI}" gate ${name} ${phase}`, {
      cwd: projectRoot,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (e) {
    return (e.stdout || '') + (e.stderr || '');
  }
}

function setupChange(dir, tasksBody, options = {}) {
  const { decisionRows = '| 无 | | | | | |' } = options;
  execSync(`node "${CLI}" install --tool claude-code`, { cwd: dir, stdio: ['pipe', 'pipe', 'pipe'] });
  const changeDir = path.join(dir, 'spec_copilot', 'changes', 'self');
  fs.mkdirSync(changeDir, { recursive: true });
  fs.writeFileSync(path.join(changeDir, 'spec.md'), `# Self Assessment
> status: review
> complexity: 🔴 重

## 1. 背景与目标
test

## 3. 功能点
- **F01** — 测试
`);
  fs.writeFileSync(path.join(changeDir, 'tasks.md'), tasksBody);
  fs.writeFileSync(path.join(changeDir, 'log.md'), `# Log
## 时间线
| 时间 | 阶段 | 事件 | 备注 |
| 2026-05-26 | smoke | 冒烟测试通过 ✓ | mock |

## Spec-Code 偏差记录
| 偏差点 | Spec 预期 | 实际情况 | 处理方式 |
| 无 | 无 | 无 | 无 |

## 用户决策记录
| ID | 阶段/Task | 类型 | 影响范围 | 用户决策 | 后续处理 |
|----|-----------|------|----------|----------|----------|
${decisionRows}
`);
  writeApplySentinel(dir, 'self');
  writeGateSentinel(dir, 'self', 'smoke');
  return changeDir;
}

function writeApplySentinel(projectRoot, changeName) {
  const changeDir = path.join(projectRoot, 'spec_copilot', 'changes', changeName);
  const spec = fs.readFileSync(path.join(changeDir, 'spec.md'), 'utf-8');
  fs.writeFileSync(path.join(changeDir, '.gate-apply-passed'), JSON.stringify({
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
  }, null, 2));
}

function writeGateSentinel(projectRoot, changeName, phase) {
  const changeDir = path.join(projectRoot, 'spec_copilot', 'changes', changeName);
  const now = Date.now();
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
        specHash: hashFile(path.join(changeDir, 'spec.md')),
        tasksHash: hashFile(path.join(changeDir, 'tasks.md')),
        logHash: hashFile(path.join(changeDir, 'log.md')),
        sourceHash: source.hash,
        sourceFileCount: source.fileCount,
      },
      runtime: { pass: true },
    },
  };
  fs.writeFileSync(path.join(changeDir, `.gate-${phase}-passed`), JSON.stringify(sentinel, null, 2));
}

function hashFile(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
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
    rel.includes('/.nuxt/')
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

function taskBody(overrides = {}) {
  const {
    score = 100,
    incomplete = '无',
    defects = '无',
    degraded = '无',
    accepted = '否',
  } = overrides;
  return `# Tasks

## Task 1: 自评闭环
- **目标**：测试
- 状态：✅

### 完成时必填字段

**1. 实际验证结果**
\`\`\`
$ echo ok
ok
\`\`\`

**2. 实际文件清单**
- 计划：无
- 实际：无
- 遗漏：无

**3. 未实现声明**
- 本 task 未完成的功能点：${incomplete}
- 已知缺陷或 TODO：${defects}
- 简化或降级处理：${degraded}
- 用户确认接受降级：${accepted}

**4. 自评**
- 给用户拿这个代码，他能干什么/不能干什么：测试
- 自评分（0-100）：${score}/100（${score === 100 ? '无扣分' : '存在降级'}）

## 变更摘要
- **实测**：1 个文件修改
- **未实现功能点**：无
- **遗留 TODO**：无
`;
}

test('review gate: completed task with self score below 100 fails', () => {
  const dir = mkTmp();
  try {
    setupChange(dir, taskBody({ score: 85 }));
    const out = runGate(dir, 'self', 'review');
    assert.match(out, /Task 自评闭环检测失败/);
    assert.match(out, /自评分 85\/100/);
    assert.match(out, /Task 自评/);
    assert.match(out, /Gate 未通过/);
  } finally {
    cleanup(dir);
  }
});

test('review gate: completed task with unfinished declaration fails without user acceptance', () => {
  const dir = mkTmp();
  try {
    setupChange(dir, taskBody({ incomplete: 'F18 附件上传未实现' }));
    const out = runGate(dir, 'self', 'review');
    assert.match(out, /Task 自评闭环检测失败|显式未完成声明检测命中/);
    assert.match(out, /F18 附件上传未实现/);
    assert.match(out, /Gate 未通过/);
  } finally {
    cleanup(dir);
  }
});

test('review gate: user accepted degradation does not fail task self assessment', () => {
  const dir = mkTmp();
  try {
    setupChange(dir, taskBody({
      score: 90,
      degraded: '外部门户联调等待第三方环境',
      accepted: '是，见 D001',
    }), {
      decisionRows: '| D001 | apply/T1 | 接受降级 | 外部门户联调 | 本轮等待第三方环境 | review 可放行，archive 记录遗留 |',
    });
    const out = runGate(dir, 'self', 'review');
    assert.match(out, /Task 自评闭环：1 个已完成 task/);
    assert.doesNotMatch(out, /Task 自评闭环检测失败/);
  } finally {
    cleanup(dir);
  }
});

test('review gate: degradation acceptance must reference a decision id', () => {
  const dir = mkTmp();
  try {
    setupChange(dir, taskBody({
      score: 90,
      degraded: '外部门户联调等待第三方环境',
      accepted: '是',
    }));
    const out = runGate(dir, 'self', 'review');
    assert.match(out, /用户确认接受降级但未引用 Dxxx 用户决策记录/);
    assert.match(out, /Gate 未通过/);
  } finally {
    cleanup(dir);
  }
});

test('review gate: referenced decision id must exist in log decision ledger', () => {
  const dir = mkTmp();
  try {
    setupChange(dir, taskBody({
      score: 90,
      degraded: '外部门户联调等待第三方环境',
      accepted: '是，见 D404',
    }), {
      decisionRows: '| D001 | apply/T1 | 接受降级 | 其它事项 | 用户确认其它事项 | review 可放行 |',
    });
    const out = runGate(dir, 'self', 'review');
    assert.match(out, /引用的用户决策记录不存在于 log\.md：D404/);
    assert.match(out, /Gate 未通过/);
  } finally {
    cleanup(dir);
  }
});

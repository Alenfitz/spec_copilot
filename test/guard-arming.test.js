/**
 * Guard 默认上膛回归测试（v4.0.27）
 *
 * 锁定 test05 复盘后修复的行为，防止再退回"未安装即静默放行"：
 *   1. install 默认自动 guard install（生成 .spec-copilot/guard.json）
 *   2. 已锁定的 spec 被篡改 → gate 拦截（非零退出 + "guard 拦截"）
 *   3. 未安装 guard → gate 强警告"未生效"，而不是静默当成通过
 *   4. doctor 把"guard 未安装"计为 issue
 */

const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const CLI = path.join(__dirname, '..', 'bin', 'cli.js');

function mkTmp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-copilot-guard-'));
  // gate / install 需要项目根标记；spec_copilot 目录即可被识别
  return dir;
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

/** 同时捕获 stdout/stderr 和退出码，无论成功失败 */
function runIn(dir, args) {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd: dir, encoding: 'utf-8',
  });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

function writeMinimalChange(dir, name, status) {
  const changeDir = path.join(dir, 'spec_copilot', 'changes', name);
  fs.mkdirSync(changeDir, { recursive: true });
  fs.writeFileSync(path.join(changeDir, 'spec.md'),
    `status: ${status}\n# Spec\n## §9 待澄清\n（无）\n`);
  fs.writeFileSync(path.join(changeDir, 'tasks.md'), '# tasks\n');
  fs.writeFileSync(path.join(changeDir, 'log.md'), '# log\n');
  return changeDir;
}

function writeBlockedApplyChange(dir, name) {
  const changeDir = path.join(dir, 'spec_copilot', 'changes', name);
  fs.mkdirSync(changeDir, { recursive: true });
  fs.writeFileSync(path.join(changeDir, 'spec.md'),
    `status: propose\n# Spec\n## 9. 待澄清\n- [ ] 仍需用户确认\n## 10. 技术决策\n（无）\n`);
  fs.writeFileSync(path.join(changeDir, 'tasks.md'), '# tasks\n');
  fs.writeFileSync(path.join(changeDir, 'log.md'), '# log\n');
  return changeDir;
}

test('install 默认上膛：自动生成 .spec-copilot/guard.json', () => {
  const dir = mkTmp();
  try {
    runIn(dir, ['install', '--tool', 'claude-code']);
    assert.ok(
      fs.existsSync(path.join(dir, '.spec-copilot', 'guard.json')),
      'install 后 guard.json 应存在（默认上膛）'
    );
    assert.ok(
      fs.existsSync(path.join(dir, '.spec-copilot', 'locks.json')),
      'install 后 locks.json 应存在'
    );
  } finally {
    cleanup(dir);
  }
});

test('首跑回归：install 不锁空模板上下文（domain-rules / project-context 延后锁定）', () => {
  const dir = mkTmp();
  try {
    runIn(dir, ['install', '--tool', 'claude-code']);
    const locks = JSON.parse(fs.readFileSync(path.join(dir, '.spec-copilot', 'locks.json'), 'utf-8'));
    assert.ok(
      !locks.files['spec_copilot/rules/project-context.md'],
      'install 阶段不应锁定空模板 project-context.md（延后到首个 gate）'
    );
    assert.ok(
      !locks.files['spec_copilot/rules/domain-rules.md'],
      'install 阶段不应锁定空模板 domain-rules.md（延后到首个 gate）'
    );
  } finally {
    cleanup(dir);
  }
});

test('首跑回归：/spec:init 填充 project-context.md 后跑 gate 不被当成篡改', () => {
  const dir = mkTmp();
  try {
    runIn(dir, ['install', '--tool', 'claude-code']);

    // 模拟 /spec:init 正常填充项目上下文
    const ctx = path.join(dir, 'spec_copilot', 'rules', 'project-context.md');
    let ctxContent = fs.readFileSync(ctx, 'utf-8');
    ctxContent = ctxContent
      .replace('- 应用名：', '- 应用名：demo')
      .replace('- 简介：', '- 简介：guard first-run regression fixture')
      .replace('- 技术栈：', '- 技术栈：Spring Boot + Vue3');
    fs.writeFileSync(ctx, ctxContent, 'utf-8');

    writeMinimalChange(dir, 'demo', 'apply');
    const { out } = runIn(dir, ['gate', 'demo', 'apply']);

    // 关键：填充上下文是合法行为，绝不能被 guard 当成"被篡改"拦截
    assert.doesNotMatch(out, /guard 拦截/, '填充 project-context.md 不应触发 guard 拦截');
    assert.doesNotMatch(out, /完整性校验失败/, '填充 project-context.md 不应触发完整性校验失败');

    const locks = JSON.parse(fs.readFileSync(path.join(dir, '.spec-copilot', 'locks.json'), 'utf-8'));
    assert.ok(
      locks.files['spec_copilot/rules/project-context.md'],
      '首个 gate 后应锁定已填充的 project-context.md'
    );
    assert.ok(
      !locks.files['spec_copilot/rules/domain-rules.md'],
      'domain-rules.md 仍是示例模板时不应被自动锁定'
    );
  } finally {
    cleanup(dir);
  }
});

test('首跑回归：未填充上下文时首个 gate 不把空模板锁成可信事实', () => {
  const dir = mkTmp();
  try {
    runIn(dir, ['install', '--tool', 'claude-code']);
    writeMinimalChange(dir, 'demo', 'apply');

    const { out } = runIn(dir, ['gate', 'demo', 'apply']);
    assert.match(out, /暂未锁定|仍是未填充模板/, '应提示模板态上下文暂不锁定');

    const locks = JSON.parse(fs.readFileSync(path.join(dir, '.spec-copilot', 'locks.json'), 'utf-8'));
    assert.ok(
      locks.files['spec_copilot/changes/demo/spec.md'],
      'apply gate 后仍应锁定当前 spec.md'
    );
    assert.ok(
      !locks.files['spec_copilot/rules/project-context.md'],
      '未填充 project-context.md 不应被自动锁定'
    );
    assert.ok(
      !locks.files['spec_copilot/rules/domain-rules.md'],
      '示例 domain-rules.md 不应被自动锁定'
    );
  } finally {
    cleanup(dir);
  }
});

test('篡改已锁定的 spec → gate 拦截（非零退出）', () => {
  const dir = mkTmp();
  try {
    runIn(dir, ['install', '--tool', 'claude-code']);
    const changeDir = writeMinimalChange(dir, 'demo', 'apply');

    // 锁定（apply 状态会被 guard lock 记录 hash）
    runIn(dir, ['guard', 'lock']);
    const locks = JSON.parse(fs.readFileSync(path.join(dir, '.spec-copilot', 'locks.json'), 'utf-8'));
    const specKey = 'spec_copilot/changes/demo/spec.md';
    assert.ok(locks.files[specKey], 'apply 状态的 spec.md 应被锁定');

    // 篡改
    fs.appendFileSync(path.join(changeDir, 'spec.md'), '\nTAMPERED\n');

    const { code, out } = runIn(dir, ['gate', 'demo', 'apply']);
    assert.notStrictEqual(code, 0, '篡改后 gate 应非零退出');
    assert.match(out, /guard 拦截/, 'gate 输出应包含 guard 拦截');
    assert.match(out, /完整性校验失败/, 'gate 应指出完整性校验失败');
  } finally {
    cleanup(dir);
  }
});

test('未安装 guard → gate 强警告"未生效"，不静默放行', () => {
  const dir = mkTmp();
  try {
    runIn(dir, ['install', '--tool', 'claude-code']);
    writeMinimalChange(dir, 'demo', 'apply');

    // 模拟旧项目：移除 guard 安装痕迹
    fs.rmSync(path.join(dir, '.spec-copilot'), { recursive: true, force: true });

    const { out } = runIn(dir, ['gate', 'demo', 'apply']);
    assert.match(out, /未安装|未生效/, 'gate 应明确提示 guard 未安装/未生效');
    assert.match(out, /guard install/, 'gate 应给出一键启用命令');
  } finally {
    cleanup(dir);
  }
});

test('doctor 把"guard 未安装"计为 issue', () => {
  const dir = mkTmp();
  try {
    runIn(dir, ['install', '--tool', 'claude-code']);
    fs.rmSync(path.join(dir, '.spec-copilot'), { recursive: true, force: true });

    const { code, out } = runIn(dir, ['doctor']);
    assert.match(out, /Guard 护栏未安装/, 'doctor 应报告 guard 未安装');
    assert.notStrictEqual(code, 0, 'guard 未安装时 doctor 应非零退出（计为 issue）');
  } finally {
    cleanup(dir);
  }
});

test('gate 连续同类失败 3 次后触发止损提示', () => {
  const dir = mkTmp();
  try {
    runIn(dir, ['install', '--tool', 'claude-code']);
    writeBlockedApplyChange(dir, 'demo');

    const first = runIn(dir, ['gate', 'demo', 'apply']);
    assert.notStrictEqual(first.code, 0);
    assert.doesNotMatch(first.out, /连续失败止损/);

    const second = runIn(dir, ['gate', 'demo', 'apply']);
    assert.notStrictEqual(second.code, 0);
    assert.match(second.out, /下次仍失败将触发止损提示/);

    const third = runIn(dir, ['gate', 'demo', 'apply']);
    assert.notStrictEqual(third.code, 0);
    assert.match(third.out, /Gate 连续失败止损/);
    assert.match(third.out, /暂停并向用户汇报/);
  } finally {
    cleanup(dir);
  }
});

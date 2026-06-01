/**
 * guard.js — 代码级护栏系统（v2.6.0）
 *
 * 核心机制：hash 校验 @ gate 时
 *   不阻止 AI 修改文件，但修改后过不了 gate — 等于白改。
 *   AI 可以改 spec.md，但 gate 校验 hash 不一致 → fail。
 *
 * 流程：
 *   guard install → 初始化配置
 *   gate 通过 → 自动锁定 spec.md（记录 hash）
 *   下次 gate → 校验锁定文件 hash，不一致 → 拒绝通过
 *   guard unlock → 人类手动解锁（清除 hash 记录）
 *
 * 不依赖 chmod / git / 任何 VCS
 * 不需要特殊权限
 * 所有 AI 工具 / 所有平台通用
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ─── 常量 ────────────────────────────────────────────────────

const GUARD_DIR = '.spec-copilot';
const GUARD_CONFIG = 'guard.json';
const LOCKS_FILE = 'locks.json';

/** 默认保护规则 */
const DEFAULT_RULES = {
  version: 1,

  // 文件保护规则
  // lockAfter: 'apply' → gate apply 通过后自动锁定
  // lockAfter: 'always' → guard install 时立即锁定
  protectedFiles: [
    {
      pattern: 'spec_copilot/changes/*/spec.md',
      lockAfter: 'apply',
      reason: 'spec.md 在 apply 阶段审批后锁定，修改后 gate 将拒绝通过',
    },
    {
      pattern: 'spec_copilot/rules/domain-rules.md',
      lockAfter: 'always',
      reason: 'domain-rules.md 是项目铁律，修改后 gate 将拒绝通过',
    },
    {
      pattern: 'spec_copilot/rules/project-context.md',
      lockAfter: 'always',
      reason: 'project-context.md 是项目上下文，修改后 gate 将拒绝通过',
    },
  ],

  // 质量检查（gate 时执行）
  qualityChecks: {
    noSkeletonComponents: true,
  },
};

// ─── 工具函数 ────────────────────────────────────────────────

function sha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
}

function guardDir(projectRoot) {
  return path.join(projectRoot, GUARD_DIR);
}

function guardConfigPath(projectRoot) {
  return path.join(guardDir(projectRoot), GUARD_CONFIG);
}

function locksPath(projectRoot) {
  return path.join(guardDir(projectRoot), LOCKS_FILE);
}

function ensureGuardDir(projectRoot) {
  const dir = guardDir(projectRoot);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const gi = path.join(dir, '.gitignore');
  if (!fs.existsSync(gi)) {
    fs.writeFileSync(gi, '# spec-copilot guard\n*.tmp\n');
  }
}

/**
 * guard 是否已安装（已写过 guard.json）
 * 未安装时 gate 的 hash 校验等于没有保护 — 必须区别对待，不能静默当成"通过"
 */
function isInstalled(projectRoot) {
  return fs.existsSync(guardConfigPath(projectRoot));
}

function readConfig(projectRoot) {
  const cfgPath = guardConfigPath(projectRoot);
  if (fs.existsSync(cfgPath)) {
    try { return JSON.parse(fs.readFileSync(cfgPath, 'utf-8')); } catch { /* */ }
  }
  return DEFAULT_RULES;
}

function readLocks(projectRoot) {
  const lp = locksPath(projectRoot);
  if (fs.existsSync(lp)) {
    try { return JSON.parse(fs.readFileSync(lp, 'utf-8')); } catch { /* */ }
  }
  return { files: {} };
}

function writeLocks(projectRoot, locks) {
  ensureGuardDir(projectRoot);
  fs.writeFileSync(locksPath(projectRoot), JSON.stringify(locks, null, 2) + '\n');
}

// ─── Glob 匹配 ──────────────────────────────────────────────

function globMatch(pattern, filepath) {
  const p = pattern.replace(/\\/g, '/');
  const f = filepath.replace(/\\/g, '/');
  const regex = p
    .replace(/\./g, '\\.')
    .replace(/\*\*/g, '§§')
    .replace(/\*/g, '[^/]*')
    .replace(/§§/g, '.*');
  return new RegExp(`^${regex}$`).test(f);
}

function findMatchingFiles(projectRoot, pattern) {
  const results = [];
  const parts = pattern.split('/');

  function walk(dir, depth) {
    if (depth >= parts.length) return;
    const part = parts[depth];
    if (!fs.existsSync(dir)) return;

    if (part === '*') {
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            walk(path.join(dir, entry.name), depth + 1);
          } else if (depth === parts.length - 1) {
            const relPath = path.relative(projectRoot, path.join(dir, entry.name));
            if (globMatch(pattern, relPath)) results.push(relPath);
          }
        }
      } catch { /* */ }
    } else if (depth === parts.length - 1) {
      const filePath = path.join(dir, part);
      if (fs.existsSync(filePath)) {
        results.push(path.relative(projectRoot, filePath));
      }
    } else {
      walk(path.join(dir, part), depth + 1);
    }
  }

  walk(projectRoot, 0);
  return results;
}

// ─── 核心：Hash 校验 ────────────────────────────────────────

/**
 * 锁定文件：记录当前 hash
 */
function lockFile(projectRoot, relPath, reason) {
  const fullPath = path.join(projectRoot, relPath);
  if (!fs.existsSync(fullPath)) return false;

  const content = fs.readFileSync(fullPath, 'utf-8');
  const locks = readLocks(projectRoot);
  locks.files[relPath] = {
    hash: sha256(content),
    lockedAt: new Date().toISOString(),
    reason: reason || '手动锁定',
  };
  writeLocks(projectRoot, locks);
  return true;
}

/**
 * 解锁文件：删除 hash 记录
 */
function unlockFile(projectRoot, relPath) {
  const locks = readLocks(projectRoot);
  if (locks.files[relPath]) {
    delete locks.files[relPath];
    writeLocks(projectRoot, locks);
    return true;
  }
  return false;
}

/**
 * 校验所有锁定文件的 hash
 * 这是 guard 的核心 — 在 gate 时调用
 *
 * @returns {{ pass: boolean, violations: Array<{file, expected, actual, reason}> }}
 */
function verifyIntegrity(projectRoot) {
  const locks = readLocks(projectRoot);
  const violations = [];

  for (const [relPath, info] of Object.entries(locks.files)) {
    const fullPath = path.join(projectRoot, relPath);

    if (!fs.existsSync(fullPath)) {
      violations.push({
        file: relPath,
        expected: info.hash,
        actual: '<文件已删除>',
        reason: info.reason || '被保护文件被删除',
      });
      continue;
    }

    const currentHash = sha256(fs.readFileSync(fullPath, 'utf-8'));
    if (currentHash !== info.hash) {
      violations.push({
        file: relPath,
        expected: info.hash,
        actual: currentHash,
        reason: info.reason || '被保护文件被修改',
      });
    }
  }

  return { pass: violations.length === 0, violations };
}

function isTemplateProjectContext(content) {
  return /^- 应用名：\s*$/m.test(content) &&
    /^- 简介：\s*$/m.test(content) &&
    /^- 技术栈：\s*$/m.test(content);
}

function isTemplateDomainRules(content) {
  return /<!-- 示例 -->/.test(content) &&
    /<!-- 示例结束 -->/.test(content);
}

function shouldSkipAutoLock(relPath, content) {
  if (relPath === 'spec_copilot/rules/project-context.md' && isTemplateProjectContext(content)) {
    return 'project-context.md 仍是未填充模板，先执行 /spec:init 后再锁定';
  }
  if (relPath === 'spec_copilot/rules/domain-rules.md' && isTemplateDomainRules(content)) {
    return 'domain-rules.md 仍是示例模板，填写真正规则后再锁定';
  }
  return null;
}

/**
 * 检查骨架组件（在 gate 时调用）
 */
function checkSkeletonInStaged(projectRoot) {
  const config = readConfig(projectRoot);
  if (!config.qualityChecks || !config.qualityChecks.noSkeletonComponents) {
    return { pass: true, violations: [] };
  }

  // 尝试获取 staged 文件（有 git 时）
  let stagedFiles = [];
  try {
    const { execSync } = require('child_process');
    const output = execSync('git diff --cached --name-only', {
      cwd: projectRoot, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    if (output) stagedFiles = output.split('\n').filter(Boolean);
  } catch {
    return { pass: true, violations: [] }; // 无 git，跳过
  }

  const violations = [];
  const vueFiles = stagedFiles.filter(f => f.endsWith('.vue'));

  for (const file of vueFiles) {
    const fullPath = path.join(projectRoot, file);
    if (!fs.existsSync(fullPath)) continue;
    const content = fs.readFileSync(fullPath, 'utf-8');
    const templateMatch = content.match(/<template[^>]*>([\s\S]*?)<\/template>/);
    if (!templateMatch) continue;
    const templateContent = templateMatch[1].trim();

    if (/^<(el-empty|el-result|a-empty|a-result)\s*\/>$/i.test(templateContent)) {
      violations.push({
        file, rule: '骨架组件',
        reason: '仅包含占位组件 — 必须实现真实内容',
      });
      continue;
    }

    const stripped = templateContent.replace(/<!--[\s\S]*?-->/g, '').trim();
    if (stripped.length < 20 && /todo|待实现|placeholder/i.test(templateContent)) {
      violations.push({
        file, rule: '骨架组件',
        reason: '模板内容过少且含 TODO — 疑似未实现的骨架',
      });
    }
  }

  return { pass: violations.length === 0, violations };
}

// ─── Pre-commit Hook（可选附加层） ──────────────────────────

function generateHookScript() {
  return `#!/usr/bin/env bash
# spec-copilot guard pre-commit hook（可选附加层）
# 主防线是 gate 时的 hash 校验，此 hook 做骨架组件提交前拦截
# 跳过：git commit --no-verify

set -u

if command -v npx >/dev/null 2>&1; then
  npx --no-install @alenfitz/spec-copilot guard check --hook 2>/dev/null
  exit_code=$?
  if [ $exit_code -eq 1 ]; then
    echo ""
    echo "💡 人类可用 git commit --no-verify 跳过"
    exit 1
  fi
fi

# 保留原有的 spec-lint hook
ROOT_DIR="$(git rev-parse --show-toplevel)"
LINT="$ROOT_DIR/spec_copilot/scripts/spec-lint.sh"
if [[ -x "$LINT" ]]; then
  bash "$LINT" --hook
fi
`;
}

// ─── CLI 命令 ────────────────────────────────────────────────

const log = {
  ok: (msg) => console.log(`  ✅ ${msg}`),
  err: (msg) => console.log(`  ❌ ${msg}`),
  warn: (msg) => console.log(`  ⚠️  ${msg}`),
  info: (msg) => console.log(`  ℹ️  ${msg}`),
  title: (msg) => console.log(`\n${msg}\n${'─'.repeat(50)}`),
};

/**
 * guard install
 */
function cmdGuardInstall(projectRoot, opts = {}) {
  log.title('spec-copilot guard install');

  ensureGuardDir(projectRoot);

  // 写配置
  const cfgPath = guardConfigPath(projectRoot);
  if (!fs.existsSync(cfgPath)) {
    fs.writeFileSync(cfgPath, JSON.stringify(DEFAULT_RULES, null, 2) + '\n');
    log.ok(`配置: ${path.relative(projectRoot, cfgPath)}`);
  } else {
    log.info('配置已存在');
  }

  // 初始化 locks
  const lp = locksPath(projectRoot);
  if (!fs.existsSync(lp)) {
    writeLocks(projectRoot, { files: {} });
  }

  // 锁定 always 保护的文件
  const config = readConfig(projectRoot);
  let locked = 0;
  if (opts.deferAlwaysLock) {
    // 自动上膛（install 触发）场景：domain-rules / project-context 此刻还是空模板，
    // 等着 /spec:init 或用户填充。现在锁等于锁空模板，首次合法填充会被误判为篡改。
    // 因此延后到首个 gate（apply/smoke）通过后、内容已填充时再补锁（见 onGatePassed）。
    log.info('永久保护文件（domain-rules / project-context）延后到首个 gate 通过后锁定');
    log.info('  原因：避免锁定尚未填充的空模板，导致 /spec:init 正常填充被当成篡改');
  } else {
    for (const rule of (config.protectedFiles || [])) {
      if (rule.lockAfter !== 'always') continue;
      const files = findMatchingFiles(projectRoot, rule.pattern);
      for (const f of files) {
        const locks = readLocks(projectRoot);
        if (!locks.files[f]) {
          const content = fs.readFileSync(path.join(projectRoot, f), 'utf-8');
          const skipReason = shouldSkipAutoLock(f, content);
          if (skipReason) {
            log.info(`跳过锁定 ${f} — ${skipReason}`);
            continue;
          }
          lockFile(projectRoot, f, rule.reason);
          locked++;
          log.ok(`🔒 ${f} — hash 已记录`);
        }
      }
    }

    if (locked === 0) {
      log.info('无永久保护文件需要锁定（或文件尚不存在）');
    }
  }

  // 安装 git hook（可选）
  const gitDir = path.join(projectRoot, '.git');
  if (fs.existsSync(gitDir)) {
    const hooksDir = path.join(gitDir, 'hooks');
    if (!fs.existsSync(hooksDir)) fs.mkdirSync(hooksDir, { recursive: true });
    const hookPath = path.join(hooksDir, 'pre-commit');

    if (fs.existsSync(hookPath)) {
      const existing = fs.readFileSync(hookPath, 'utf-8');
      if (!existing.includes('spec-copilot guard')) {
        fs.copyFileSync(hookPath, `${hookPath}.bak.${Date.now()}`);
      }
    }
    fs.writeFileSync(hookPath, generateHookScript());
    fs.chmodSync(hookPath, '755');
    log.ok('Git pre-commit hook 已安装（可选附加层）');
  } else {
    log.info('非 Git 项目 — 跳过 hook（hash 校验不依赖 git）');
  }

  console.log('');
  log.info('机制：被保护文件的 hash 已记录，gate 运行时校验');
  log.info('AI 可以修改文件，但修改后 gate 拒绝通过 — 等于白改');
  log.info('人类解锁：spec-copilot guard unlock <文件路径>');
  return true;
}

/**
 * guard status
 */
function cmdGuardStatus(projectRoot) {
  log.title('spec-copilot guard status');

  const config = readConfig(projectRoot);
  const locks = readLocks(projectRoot);
  const lockedFiles = Object.keys(locks.files);

  if (lockedFiles.length === 0) {
    log.info('当前无锁定文件（运行 guard install 或 guard lock 锁定）');
    return;
  }

  // 校验完整性
  const result = verifyIntegrity(projectRoot);

  console.log(`\n锁定文件 (${lockedFiles.length}):`);
  for (const [file, info] of Object.entries(locks.files)) {
    const fullPath = path.join(projectRoot, file);
    const exists = fs.existsSync(fullPath);
    let status = '✅ 完整';

    if (!exists) {
      status = '❌ 已删除';
    } else {
      const currentHash = sha256(fs.readFileSync(fullPath, 'utf-8'));
      if (currentHash !== info.hash) {
        status = `❌ 已被篡改 (${info.hash} → ${currentHash})`;
      }
    }

    console.log(`  🔒 ${file}`);
    console.log(`     状态: ${status}`);
    console.log(`     原因: ${info.reason}`);
    console.log(`     锁定: ${info.lockedAt}`);
  }

  if (!result.pass) {
    console.log(`\n⚠️  ${result.violations.length} 个文件完整性异常 — 下次 gate 将拒绝通过`);
  }
}

/**
 * guard lock
 */
function cmdGuardLock(projectRoot, targets) {
  if (targets.length === 0) {
    // 自动按阶段锁定
    autoLockByPhase(projectRoot);
    return;
  }

  for (const target of targets) {
    if (!fs.existsSync(path.join(projectRoot, target))) {
      log.warn(`文件不存在: ${target}`);
      continue;
    }
    lockFile(projectRoot, target, '手动锁定');
    log.ok(`🔒 ${target} — hash 已记录`);
  }
}

function autoLockByPhase(projectRoot) {
  const config = readConfig(projectRoot);
  let count = 0;

  // always 保护
  for (const rule of (config.protectedFiles || [])) {
    if (rule.lockAfter !== 'always') continue;
    const files = findMatchingFiles(projectRoot, rule.pattern);
    for (const f of files) {
      const locks = readLocks(projectRoot);
      if (!locks.files[f]) {
        const content = fs.readFileSync(path.join(projectRoot, f), 'utf-8');
        const skipReason = shouldSkipAutoLock(f, content);
        if (skipReason) {
          log.info(`跳过锁定 ${f} — ${skipReason}`);
          continue;
        }
        lockFile(projectRoot, f, rule.reason);
        count++;
        log.ok(`🔒 ${f}`);
      }
    }
  }

  // 按阶段锁定 spec.md
  const changesDir = path.join(projectRoot, 'spec_copilot', 'changes');
  if (fs.existsSync(changesDir)) {
    const entries = fs.readdirSync(changesDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === 'templates') continue;
      const specPath = path.join(changesDir, entry.name, 'spec.md');
      if (!fs.existsSync(specPath)) continue;

      const content = fs.readFileSync(specPath, 'utf-8');
      const statusMatch = content.match(/status:\s*(propose|apply|review|done)/i);
      const status = statusMatch ? statusMatch[1].toLowerCase() : 'propose';

      if (['apply', 'review', 'done'].includes(status)) {
        const relPath = path.relative(projectRoot, specPath);
        const locks = readLocks(projectRoot);
        if (!locks.files[relPath]) {
          lockFile(projectRoot, relPath, `status=${status}，spec.md 已审批`);
          count++;
          log.ok(`🔒 ${relPath} (status: ${status})`);
        }
      }
    }
  }

  if (count === 0) log.info('无新文件需要锁定');
}

/**
 * guard unlock
 */
function cmdGuardUnlock(projectRoot, targets) {
  if (targets.length === 0) {
    console.log('用法: spec-copilot guard unlock <文件路径>');
    return;
  }

  for (const target of targets) {
    if (unlockFile(projectRoot, target)) {
      log.ok(`🔓 ${target} — 已解锁`);
    } else {
      log.info(`${target} — 未锁定`);
    }
  }
}

/**
 * guard check
 */
function cmdGuardCheck(projectRoot, isHook) {
  const allViolations = [];

  // 1. Hash 完整性校验
  const integrity = verifyIntegrity(projectRoot);
  for (const v of integrity.violations) {
    allViolations.push({
      file: v.file,
      rule: 'hash 完整性',
      reason: `${v.reason} (期望: ${v.expected}, 实际: ${v.actual})`,
    });
  }

  // 2. 骨架组件（仅 hook 模式 + 有 git 时）
  if (isHook) {
    const skel = checkSkeletonInStaged(projectRoot);
    allViolations.push(...skel.violations);
  }

  if (allViolations.length === 0) {
    if (!isHook) log.ok('所有检查通过');
    return true;
  }

  console.log('');
  console.log('🛑 spec-copilot guard 拦截');
  console.log('─'.repeat(50));
  for (const v of allViolations) {
    console.log(`  ❌ ${v.file}`);
    console.log(`     ${v.rule}: ${v.reason}`);
    console.log('');
  }
  return false;
}

// ─── 与 gate 集成 ────────────────────────────────────────────

/**
 * gate 通过后自动锁定 spec.md
 */
function onGatePassed(projectRoot, changeName, phase) {
  const result = { locked: [], skipped: [], failures: [] };
  if (phase !== 'smoke' && phase !== 'apply') return result;

  const tryLock = (relPath, reason, opts = {}) => {
    const full = path.join(projectRoot, relPath);
    if (!fs.existsSync(full)) return;
    try {
      const content = fs.readFileSync(full, 'utf-8');
      const skipReason = opts.skipTemplate ? shouldSkipAutoLock(relPath, content) : null;
      if (skipReason) {
        result.skipped.push({ file: relPath, reason: skipReason });
        return;
      }
      if (lockFile(projectRoot, relPath, reason)) result.locked.push(relPath);
    } catch (e) {
      result.failures.push({ file: relPath, error: e.message });
    }
  };

  // spec.md：apply/smoke 通过后锁定（Contract Freeze）
  tryLock(`spec_copilot/changes/${changeName}/spec.md`, `${phase} gate 通过后自动锁定`);

  // always 保护文件（domain-rules / project-context）：在首个 gate 检查点补锁。
  // 此时内容已被 /spec:init / 用户填充，不再是空模板，避免 install 时锁空模板导致首跑误伤。
  const config = readConfig(projectRoot);
  const locks = readLocks(projectRoot);
  for (const rule of (config.protectedFiles || [])) {
    if (rule.lockAfter !== 'always') continue;
    for (const f of findMatchingFiles(projectRoot, rule.pattern)) {
      if (!locks.files[f]) tryLock(f, rule.reason, { skipTemplate: true });
    }
  }

  return result;
}

/**
 * gate 运行前的 hash 校验
 * 返回 { pass, violations } — 由 cli.js 在 gate 逻辑中调用
 */
function onGateCheck(projectRoot) {
  return verifyIntegrity(projectRoot);
}

// ─── 导出 ────────────────────────────────────────────────────

module.exports = {
  cmdGuardInstall,
  cmdGuardStatus,
  cmdGuardLock,
  cmdGuardUnlock,
  cmdGuardCheck,
  onGatePassed,
  onGateCheck,
  verifyIntegrity,
  isInstalled,
  readConfig,
  readLocks,
  DEFAULT_RULES,
  GUARD_DIR,
};

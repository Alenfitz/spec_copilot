/**
 * guard.js — 代码级护栏系统（v2.5.1）
 *
 * 解决的核心问题：AI 工具不遵守提示词中的"铁律"。
 * 提示词是建议，代码是法律。
 *
 * 主防线：chmod 444（操作系统级只读）
 *   AI 工具调 write/edit → OS 拒绝 → 文件根本改不了
 *   比 git hook 更早拦截（写入时 vs 提交时）
 *   不依赖任何 VCS
 *
 * 附加层：git pre-commit hook（有 git 时自动加固）
 *   骨架组件检测、相位门禁等提交时检查
 *
 * 所有 AI 工具通用：Claude Code / Cursor / Windsurf / Copilot / Cline / opencode
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ─── 常量 ────────────────────────────────────────────────────

const GUARD_DIR = '.spec-copilot';
const GUARD_CONFIG = 'guard.json';
const LOCKS_FILE = 'locks.json';

/** 只读权限 / 可写权限 */
const READONLY_MODE = 0o444;
const WRITABLE_MODE = 0o644;

/** 默认保护规则 */
const DEFAULT_RULES = {
  version: 1,

  // 文件保护：这些文件在指定阶段后锁定
  // lockAfter: 'always' = 永久保护 | 'apply' = apply 阶段后锁定
  protectedFiles: [
    {
      pattern: 'spec_copilot/changes/*/spec.md',
      lockAfter: 'apply',
      reason: 'spec.md 在 apply 阶段审批后锁定，禁止 AI 擅自修改',
    },
    {
      pattern: 'spec_copilot/rules/domain-rules.md',
      lockAfter: 'always',
      reason: 'domain-rules.md 是项目铁律，任何阶段禁止 AI 修改',
    },
    {
      pattern: 'spec_copilot/rules/project-context.md',
      lockAfter: 'always',
      reason: 'project-context.md 是项目上下文，禁止 AI 覆盖',
    },
  ],

  // 相位门禁（git hook 附加层）
  phaseGates: {
    review: {
      requireSentinel: '.gate-smoke-passed',
      reason: '必须先通过 smoke gate 才能提交 review 相关变更',
    },
    archive: {
      requireSentinel: '.gate-review-passed',
      reason: '必须先通过 review gate 才能 archive',
    },
  },

  // 质量底线（git hook 附加层）
  qualityChecks: {
    noSkeletonComponents: true,
  },
};

// ─── 工具函数 ────────────────────────────────────────────────

function findProjectRoot() {
  let dir = process.cwd();
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, 'spec_copilot')) ||
        fs.existsSync(path.join(dir, '.spec-copilot'))) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  dir = process.cwd();
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    dir = path.dirname(dir);
  }
  return process.cwd();
}

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
  return { files: {}, phase: null, timestamp: null };
}

function writeLocks(projectRoot, locks) {
  ensureGuardDir(projectRoot);
  fs.writeFileSync(locksPath(projectRoot), JSON.stringify(locks, null, 2) + '\n');
}

/**
 * 检测是否为 Windows
 */
function isWindows() {
  return process.platform === 'win32';
}

// ─── chmod 核心操作 ─────────────────────────────────────────

/**
 * 将文件设为只读（chmod 444）
 * Windows 用 icacls 等效操作
 */
function setReadonly(filePath) {
  if (!fs.existsSync(filePath)) return false;
  try {
    if (isWindows()) {
      const { execSync } = require('child_process');
      execSync(`attrib +R "${filePath}"`, { stdio: 'pipe' });
    } else {
      fs.chmodSync(filePath, READONLY_MODE);
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * 将文件恢复为可写（chmod 644）
 */
function setWritable(filePath) {
  if (!fs.existsSync(filePath)) return false;
  try {
    if (isWindows()) {
      const { execSync } = require('child_process');
      execSync(`attrib -R "${filePath}"`, { stdio: 'pipe' });
    } else {
      fs.chmodSync(filePath, WRITABLE_MODE);
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * 检查文件是否为只读
 */
function isReadonly(filePath) {
  if (!fs.existsSync(filePath)) return false;
  try {
    const stat = fs.statSync(filePath);
    // 检查 owner 是否有写权限
    return (stat.mode & 0o200) === 0;
  } catch {
    return false;
  }
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

/**
 * 查找匹配 glob pattern 的实际文件
 */
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

// ─── 锁定 / 解锁 ───────────────────────────────────────────

/**
 * 锁定一个文件：chmod 444 + 记录到 locks.json
 */
function lockFile(projectRoot, relPath, reason) {
  const fullPath = path.join(projectRoot, relPath);
  if (!fs.existsSync(fullPath)) return false;

  const content = fs.readFileSync(fullPath, 'utf-8');
  const ok = setReadonly(fullPath);

  // 记录锁定状态
  const locks = readLocks(projectRoot);
  locks.files[relPath] = {
    locked: true,
    readonly: ok,
    lockedAt: new Date().toISOString(),
    reason: reason || '手动锁定',
    hash: sha256(content),
  };
  writeLocks(projectRoot, locks);
  return ok;
}

/**
 * 解锁一个文件：chmod 644 + 更新 locks.json
 */
function unlockFile(projectRoot, relPath) {
  const fullPath = path.join(projectRoot, relPath);
  const locks = readLocks(projectRoot);

  if (fs.existsSync(fullPath)) {
    setWritable(fullPath);
  }

  if (locks.files[relPath]) {
    locks.files[relPath].locked = false;
    locks.files[relPath].readonly = false;
    locks.files[relPath].unlockedAt = new Date().toISOString();
    writeLocks(projectRoot, locks);
  }
}

// ─── Git Hook 附加检查 ──────────────────────────────────────

/**
 * 检查相位门禁（git hook 用）
 */
function checkPhaseGates(projectRoot, stagedFiles) {
  const config = readConfig(projectRoot);
  const violations = [];

  for (const file of stagedFiles) {
    if (file.includes('/spec.md') && config.phaseGates.review) {
      const fullPath = path.join(projectRoot, file);
      if (fs.existsSync(fullPath)) {
        const content = fs.readFileSync(fullPath, 'utf-8');
        if (/status:\s*review/i.test(content)) {
          const changeDir = path.dirname(fullPath);
          const sentinel = path.join(changeDir, config.phaseGates.review.requireSentinel);
          if (!fs.existsSync(sentinel)) {
            violations.push({
              file,
              rule: '相位门禁: review',
              reason: config.phaseGates.review.reason,
            });
          }
        }
      }
    }
  }

  return { pass: violations.length === 0, violations };
}

/**
 * 检查骨架组件（git hook 用）
 */
function checkSkeletonComponents(projectRoot, stagedFiles) {
  const config = readConfig(projectRoot);
  if (!config.qualityChecks || !config.qualityChecks.noSkeletonComponents) {
    return { pass: true, violations: [] };
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
        reason: '仅包含占位组件 — 必须实现真实内容后才能提交',
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

/**
 * pre-commit hook 检查入口
 */
function runHookCheck(projectRoot) {
  const { execSync } = require('child_process');
  const allViolations = [];

  let stagedFiles = [];
  try {
    const output = execSync('git diff --cached --name-only', {
      cwd: projectRoot, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    if (output) stagedFiles = output.split('\n').filter(Boolean);
  } catch {
    return { pass: true, violations: [] };
  }

  if (stagedFiles.length === 0) return { pass: true, violations: [] };

  // 1. 相位门禁
  const phaseCheck = checkPhaseGates(projectRoot, stagedFiles);
  allViolations.push(...phaseCheck.violations);

  // 2. 骨架组件
  const skelCheck = checkSkeletonComponents(projectRoot, stagedFiles);
  allViolations.push(...skelCheck.violations);

  // 注意：文件保护不需要在 hook 里检查了
  // 因为 chmod 444 已经阻止了文件被修改，根本不会进入 staged

  return { pass: allViolations.length === 0, violations: allViolations };
}

// ─── Pre-commit Hook 脚本 ───────────────────────────────────

function generateHookScript() {
  return `#!/usr/bin/env bash
# spec-copilot guard pre-commit hook（附加层）
# 主防线是 chmod 文件保护，此 hook 做额外的骨架/相位检查
# 安装：npx @alenfitz/spec-copilot guard install
# 跳过：git commit --no-verify（仅限人类紧急操作）

set -u

if command -v npx >/dev/null 2>&1; then
  npx --no-install @alenfitz/spec-copilot guard check --hook 2>/dev/null
  exit_code=$?
  if [ $exit_code -eq 1 ]; then
    echo ""
    echo "💡 人类可用 git commit --no-verify 跳过（AI 工具无法使用此参数）"
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
 * guard install — 初始化配置 + chmod 保护 + 安装 git hook（如有 git）
 */
function cmdGuardInstall(projectRoot) {
  log.title('spec-copilot guard install');

  // 1. 初始化目录和配置
  ensureGuardDir(projectRoot);

  const cfgPath = guardConfigPath(projectRoot);
  if (!fs.existsSync(cfgPath)) {
    fs.writeFileSync(cfgPath, JSON.stringify(DEFAULT_RULES, null, 2) + '\n');
    log.ok(`配置文件已创建: ${path.relative(projectRoot, cfgPath)}`);
  } else {
    log.info('配置文件已存在');
  }

  const lp = locksPath(projectRoot);
  if (!fs.existsSync(lp)) {
    writeLocks(projectRoot, { files: {}, phase: null, timestamp: null });
  }

  // 2. 主防线：chmod 锁定永久保护的文件
  const config = readConfig(projectRoot);
  let chmodCount = 0;

  for (const rule of (config.protectedFiles || [])) {
    if (rule.lockAfter !== 'always') continue;
    const files = findMatchingFiles(projectRoot, rule.pattern);
    for (const f of files) {
      if (lockFile(projectRoot, f, rule.reason)) {
        chmodCount++;
        log.ok(`🔒 ${f} → 只读 (chmod 444)`);
      }
    }
  }

  if (chmodCount === 0) {
    log.info('无永久保护文件需要锁定（或文件尚不存在）');
  }

  // 3. 附加层：安装 git hook（如有 git）
  const gitDir = path.join(projectRoot, '.git');
  if (fs.existsSync(gitDir)) {
    const hooksDir = path.join(gitDir, 'hooks');
    if (!fs.existsSync(hooksDir)) fs.mkdirSync(hooksDir, { recursive: true });
    const hookPath = path.join(hooksDir, 'pre-commit');

    if (fs.existsSync(hookPath)) {
      const existing = fs.readFileSync(hookPath, 'utf-8');
      if (!existing.includes('spec-copilot guard')) {
        const backupPath = `${hookPath}.bak.${Date.now()}`;
        fs.copyFileSync(hookPath, backupPath);
        log.warn(`已备份原 pre-commit hook → ${path.basename(backupPath)}`);
      }
    }

    fs.writeFileSync(hookPath, generateHookScript());
    fs.chmodSync(hookPath, '755');
    log.ok('Git pre-commit hook 已安装（附加层：骨架/相位检查）');
  } else {
    log.info('非 Git 仓库 — 跳过 hook 安装（chmod 主防线仍然有效）');
  }

  console.log('');
  log.info('主防线：被保护文件已设为只读（chmod 444），AI 工具无法写入');
  log.info('人类解锁：npx @alenfitz/spec-copilot guard unlock <文件>');
  return true;
}

/**
 * guard status — 查看当前保护状态
 */
function cmdGuardStatus(projectRoot) {
  log.title('spec-copilot guard status');

  const config = readConfig(projectRoot);
  const locks = readLocks(projectRoot);

  // 检查 git hook
  const hookPath = path.join(projectRoot, '.git', 'hooks', 'pre-commit');
  if (fs.existsSync(hookPath) && fs.readFileSync(hookPath, 'utf-8').includes('spec-copilot guard')) {
    log.ok('Git pre-commit hook 已安装（附加层）');
  } else if (fs.existsSync(path.join(projectRoot, '.git'))) {
    log.warn('Git pre-commit hook 未安装（运行 guard install）');
  } else {
    log.info('非 Git 仓库（chmod 主防线可独立工作）');
  }

  // 显示保护规则和实际状态
  console.log('\n保护规则:');
  for (const rule of (config.protectedFiles || [])) {
    const matchedFiles = findMatchingFiles(projectRoot, rule.pattern);
    for (const f of matchedFiles) {
      const fullPath = path.join(projectRoot, f);
      const ro = isReadonly(fullPath);
      const lockInfo = locks.files[f];
      const locked = lockInfo && lockInfo.locked;
      const icon = ro ? '🔒' : (locked ? '⚠️' : '🔓');
      const status = ro ? '只读 (chmod 444)' : (locked ? '逻辑锁定但未 chmod' : '未保护');
      console.log(`  ${icon} ${f} — ${status}`);
      if (rule.reason) console.log(`     ${rule.reason}`);
    }
    if (matchedFiles.length === 0) {
      console.log(`  📄 ${rule.pattern} — 无匹配文件`);
    }
  }

  // 显示额外锁定的文件
  const extraLocked = Object.entries(locks.files)
    .filter(([f, v]) => v.locked && !config.protectedFiles.some(r => globMatch(r.pattern, f)));
  if (extraLocked.length > 0) {
    console.log('\n手动锁定:');
    for (const [file, info] of extraLocked) {
      const ro = isReadonly(path.join(projectRoot, file));
      console.log(`  ${ro ? '🔒' : '⚠️'} ${file} — ${info.reason || '手动锁定'}`);
    }
  }
}

/**
 * guard lock — 锁定文件（chmod 444）
 */
function cmdGuardLock(projectRoot, targets) {
  if (targets.length === 0) {
    autoLockByPhase(projectRoot);
    return;
  }

  for (const target of targets) {
    const fullPath = path.join(projectRoot, target);
    if (!fs.existsSync(fullPath)) {
      log.warn(`文件不存在: ${target}`);
      continue;
    }

    if (lockFile(projectRoot, target, '手动锁定')) {
      log.ok(`🔒 ${target} → 只读 (chmod 444)`);
    } else {
      log.err(`chmod 失败: ${target}`);
    }
  }
}

/**
 * 根据当前变更阶段自动锁定
 */
function autoLockByPhase(projectRoot) {
  const config = readConfig(projectRoot);
  let totalLocked = 0;

  // 锁定 always 保护的文件
  for (const rule of (config.protectedFiles || [])) {
    if (rule.lockAfter !== 'always') continue;
    const files = findMatchingFiles(projectRoot, rule.pattern);
    for (const f of files) {
      if (!isReadonly(path.join(projectRoot, f))) {
        if (lockFile(projectRoot, f, rule.reason)) {
          totalLocked++;
          log.ok(`🔒 ${f} → 只读`);
        }
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

      if (['apply', 'review', 'done'].includes(status) && !isReadonly(specPath)) {
        const relPath = path.relative(projectRoot, specPath);
        if (lockFile(projectRoot, relPath, `status=${status}，spec.md 已审批锁定`)) {
          totalLocked++;
          log.ok(`🔒 ${relPath} → 只读 (status: ${status})`);
        }
      }
    }
  }

  if (totalLocked === 0) {
    log.info('无新文件需要锁定');
  }
}

/**
 * guard unlock — 解锁文件（chmod 644）
 */
function cmdGuardUnlock(projectRoot, targets) {
  if (targets.length === 0) {
    console.log('用法: spec-copilot guard unlock <文件路径> [<文件路径>...]');
    console.log('示例: spec-copilot guard unlock spec_copilot/changes/user-login/spec.md');
    return;
  }

  for (const target of targets) {
    unlockFile(projectRoot, target);
    log.ok(`🔓 ${target} → 可写 (chmod 644)`);
  }
}

/**
 * guard check — 运行检查
 */
function cmdGuardCheck(projectRoot, isHook) {
  // 1. 检查 chmod 状态完整性（锁定的文件是否仍为只读）
  const locks = readLocks(projectRoot);
  const integrityIssues = [];

  for (const [file, info] of Object.entries(locks.files)) {
    if (!info.locked) continue;
    const fullPath = path.join(projectRoot, file);
    if (!fs.existsSync(fullPath)) continue;

    // 检查文件是否仍然只读
    if (!isReadonly(fullPath)) {
      integrityIssues.push({
        file,
        rule: 'chmod 完整性',
        reason: `文件已锁定但不是只读 — 可能被手动 chmod 解除了`,
      });
    }

    // 检查文件内容是否被篡改（通过临时解锁再改回来的方式）
    if (info.hash) {
      const currentHash = sha256(fs.readFileSync(fullPath, 'utf-8'));
      if (currentHash !== info.hash) {
        integrityIssues.push({
          file,
          rule: '内容完整性',
          reason: `文件内容与锁定时不一致 (hash: ${info.hash} → ${currentHash})`,
        });
      }
    }
  }

  // 2. Git hook 附加检查（仅在 --hook 模式下）
  let hookViolations = [];
  if (isHook) {
    const hookResult = runHookCheck(projectRoot);
    hookViolations = hookResult.violations;
  }

  const allViolations = [...integrityIssues, ...hookViolations];

  if (allViolations.length === 0) {
    if (!isHook) log.ok('所有检查通过');
    return true;
  }

  console.log('');
  console.log('🛑 spec-copilot guard 拦截');
  console.log('─'.repeat(50));
  for (const v of allViolations) {
    console.log(`  ❌ ${v.file}`);
    console.log(`     规则: ${v.rule}`);
    console.log(`     原因: ${v.reason}`);
    console.log('');
  }
  return false;
}

// ─── 与 gate 系统集成 ────────────────────────────────────────

/**
 * gate 通过后自动锁定 spec.md（chmod 444）
 */
function onGatePassed(projectRoot, changeName, phase) {
  if (phase !== 'smoke' && phase !== 'apply') return;

  const specRelPath = `spec_copilot/changes/${changeName}/spec.md`;
  const specFullPath = path.join(projectRoot, specRelPath);
  if (!fs.existsSync(specFullPath)) return;

  lockFile(projectRoot, specRelPath, `${phase} gate 通过后自动锁定`);
}

// ─── 导出 ────────────────────────────────────────────────────

module.exports = {
  cmdGuardInstall,
  cmdGuardStatus,
  cmdGuardLock,
  cmdGuardUnlock,
  cmdGuardCheck,
  runHookCheck,
  onGatePassed,
  readConfig,
  readLocks,
  DEFAULT_RULES,
  GUARD_DIR,
};

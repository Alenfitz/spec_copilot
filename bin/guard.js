/**
 * guard.js — 代码级护栏系统（v2.5.0）
 *
 * 解决的核心问题：AI 工具不遵守提示词中的"铁律"。
 * 提示词是建议，代码是法律 — 把关键约束从 AGENTS.md 搬到 git hook 里。
 *
 * 架构：
 *   1. guard.json   — 声明式配置（保护什么、什么阶段锁定）
 *   2. pre-commit   — git hook，提交时硬拦截
 *   3. guard lock/unlock — 相位锁管理
 *
 * 所有 AI 工具通用：Claude Code / Cursor / Windsurf / Copilot / Cline / opencode
 * 唯一依赖：git pre-commit hook（AI 绕不过）
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

  // 文件保护：这些文件在指定阶段后锁定，修改会被 pre-commit 拦截
  protectedFiles: [
    {
      pattern: 'spec_copilot/changes/*/spec.md',
      lockAfter: 'apply',
      reason: 'spec.md 在 apply 阶段审批后锁定，禁止 AI 擅自修改',
      allowUnlock: true,
    },
    {
      pattern: 'spec_copilot/rules/domain-rules.md',
      lockAfter: 'always',
      reason: 'domain-rules.md 是项目铁律，任何阶段禁止 AI 修改',
      allowUnlock: true,
    },
    {
      pattern: 'spec_copilot/rules/project-context.md',
      lockAfter: 'always',
      reason: 'project-context.md 是项目上下文，禁止 AI 覆盖',
      allowUnlock: true,
    },
  ],

  // 相位门禁：提交 review/archive 相关变更时，必须有对应哨兵
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

  // 质量底线：提交时检查
  qualityChecks: {
    // 骨架组件不允许提交
    noSkeletonComponents: true,
    // commit message 格式校验
    commitMessageFormat: true,
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
  // 回退：找 .git
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
  // .gitignore 中保留 locks.json 但忽略临时文件
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

// ─── Glob 匹配 ──────────────────────────────────────────────

/**
 * 简单 glob 匹配（支持 * 和 **）
 */
function globMatch(pattern, filepath) {
  // 标准化路径分隔符
  const p = pattern.replace(/\\/g, '/');
  const f = filepath.replace(/\\/g, '/');

  // 转换 glob 为正则
  const regex = p
    .replace(/\./g, '\\.')
    .replace(/\*\*/g, '§§')       // 临时占位
    .replace(/\*/g, '[^/]*')      // * 匹配单层
    .replace(/§§/g, '.*');        // ** 匹配多层
  return new RegExp(`^${regex}$`).test(f);
}

// ─── 核心检查逻辑 ────────────────────────────────────────────

/**
 * 检查 staged 文件是否违反保护规则
 * @param {string} projectRoot
 * @param {string[]} stagedFiles - git staged 文件列表（相对路径）
 * @returns {{ pass: boolean, violations: Array<{file: string, rule: string, reason: string}> }}
 */
function checkProtectedFiles(projectRoot, stagedFiles) {
  const config = readConfig(projectRoot);
  const locks = readLocks(projectRoot);
  const violations = [];

  for (const rule of (config.protectedFiles || [])) {
    for (const file of stagedFiles) {
      if (!globMatch(rule.pattern, file)) continue;

      // 检查是否被锁定
      if (rule.lockAfter === 'always') {
        // 永久保护 — 检查 locks 中是否有显式 unlock
        if (locks.files[file] && locks.files[file].unlocked) continue;
        violations.push({
          file,
          rule: `永久保护: ${rule.pattern}`,
          reason: rule.reason,
        });
      } else {
        // 相位锁定 — 检查是否在 lockAfter 阶段之后
        const lockEntry = locks.files[file];
        if (lockEntry && lockEntry.locked && !lockEntry.unlocked) {
          violations.push({
            file,
            rule: `相位锁定 (${rule.lockAfter} 后): ${rule.pattern}`,
            reason: rule.reason,
          });
        }
      }
    }
  }

  return { pass: violations.length === 0, violations };
}

/**
 * 检查相位门禁
 * @param {string} projectRoot
 * @param {string[]} stagedFiles
 * @returns {{ pass: boolean, violations: Array }}
 */
function checkPhaseGates(projectRoot, stagedFiles) {
  const config = readConfig(projectRoot);
  const violations = [];

  // 从 staged 文件推断当前操作属于哪个阶段
  for (const file of stagedFiles) {
    // 检测 review 阶段的变更
    if (file.includes('/spec.md') && config.phaseGates.review) {
      // 如果 spec.md 的 status 正在被改为 review
      const fullPath = path.join(projectRoot, file);
      if (fs.existsSync(fullPath)) {
        const content = fs.readFileSync(fullPath, 'utf-8');
        if (/status:\s*review/i.test(content)) {
          // 检查 smoke 哨兵
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
 * 检查骨架组件（简化版 — 只检查新增/修改的 .vue 文件）
 * @param {string} projectRoot
 * @param {string[]} stagedFiles
 * @returns {{ pass: boolean, violations: Array }}
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

    // 检测骨架组件特征
    const templateMatch = content.match(/<template[^>]*>([\s\S]*?)<\/template>/);
    if (!templateMatch) continue;

    const templateContent = templateMatch[1].trim();

    // 特征 1：只有 el-empty / el-result 占位
    if (/^<(el-empty|el-result|a-empty|a-result)\s*\/>$/i.test(templateContent)) {
      violations.push({
        file,
        rule: '骨架组件',
        reason: `仅包含占位组件 — 必须实现真实内容后才能提交`,
      });
      continue;
    }

    // 特征 2：template 只有注释或 TODO
    const stripped = templateContent.replace(/<!--[\s\S]*?-->/g, '').trim();
    if (stripped.length < 20 && /todo|待实现|placeholder/i.test(templateContent)) {
      violations.push({
        file,
        rule: '骨架组件',
        reason: `模板内容过少且含 TODO — 疑似未实现的骨架`,
      });
    }
  }

  return { pass: violations.length === 0, violations };
}

// ─── Pre-commit Hook 主逻辑 ─────────────────────────────────

/**
 * 生成 pre-commit hook 脚本内容
 */
function generateHookScript() {
  return `#!/usr/bin/env bash
# spec-copilot guard pre-commit hook
# 代码级护栏 — AI 工具绕不过的硬拦截
# 安装：npx @alenfitz/spec-copilot guard install
# 跳过：git commit --no-verify（仅限人类紧急操作）

set -u

# 用 Node.js 执行检查（跨平台兼容）
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

/**
 * pre-commit hook 的检查入口
 * 被 hook 脚本通过 `spec-copilot guard check --hook` 调用
 *
 * @param {string} projectRoot
 * @returns {{ pass: boolean, violations: Array }}
 */
function runHookCheck(projectRoot) {
  const { execSync } = require('child_process');
  const allViolations = [];

  // 获取 staged 文件列表
  let stagedFiles = [];
  try {
    const output = execSync('git diff --cached --name-only', {
      cwd: projectRoot, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    if (output) stagedFiles = output.split('\n').filter(Boolean);
  } catch {
    return { pass: true, violations: [] }; // 不在 git 仓库，放行
  }

  if (stagedFiles.length === 0) return { pass: true, violations: [] };

  // 1. 文件保护检查
  const fileCheck = checkProtectedFiles(projectRoot, stagedFiles);
  allViolations.push(...fileCheck.violations);

  // 2. 相位门禁检查
  const phaseCheck = checkPhaseGates(projectRoot, stagedFiles);
  allViolations.push(...phaseCheck.violations);

  // 3. 骨架组件检查
  const skelCheck = checkSkeletonComponents(projectRoot, stagedFiles);
  allViolations.push(...skelCheck.violations);

  return { pass: allViolations.length === 0, violations: allViolations };
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
 * guard install — 安装 pre-commit hook + 初始化配置
 */
function cmdGuardInstall(projectRoot) {
  log.title('spec-copilot guard install');

  // 1. 确保 .spec-copilot 目录
  ensureGuardDir(projectRoot);

  // 2. 写入默认配置（如不存在）
  const cfgPath = guardConfigPath(projectRoot);
  if (!fs.existsSync(cfgPath)) {
    fs.writeFileSync(cfgPath, JSON.stringify(DEFAULT_RULES, null, 2) + '\n');
    log.ok(`配置文件已创建: ${path.relative(projectRoot, cfgPath)}`);
  } else {
    log.info('配置文件已存在，跳过');
  }

  // 3. 初始化 locks
  const lp = locksPath(projectRoot);
  if (!fs.existsSync(lp)) {
    writeLocks(projectRoot, { files: {}, phase: null, timestamp: null });
    log.ok('锁定状态文件已创建');
  }

  // 4. 安装 pre-commit hook
  const gitDir = path.join(projectRoot, '.git');
  if (!fs.existsSync(gitDir)) {
    log.err('当前目录不是 Git 仓库');
    return false;
  }

  const hooksDir = path.join(gitDir, 'hooks');
  if (!fs.existsSync(hooksDir)) fs.mkdirSync(hooksDir, { recursive: true });

  const hookPath = path.join(hooksDir, 'pre-commit');
  const hookScript = generateHookScript();

  // 备份已有 hook
  if (fs.existsSync(hookPath)) {
    const existing = fs.readFileSync(hookPath, 'utf-8');
    if (existing.includes('spec-copilot guard')) {
      log.info('pre-commit hook 已包含 guard，更新中...');
    } else {
      const backupPath = `${hookPath}.bak.${Date.now()}`;
      fs.copyFileSync(hookPath, backupPath);
      log.warn(`已备份原 pre-commit hook → ${path.basename(backupPath)}`);
    }
  }

  fs.writeFileSync(hookPath, hookScript);
  fs.chmodSync(hookPath, '755');
  log.ok('pre-commit hook 已安装');

  // 5. 自动保护 always 类型的文件
  const config = readConfig(projectRoot);
  const locks = readLocks(projectRoot);
  let autoLocked = 0;
  for (const rule of (config.protectedFiles || [])) {
    if (rule.lockAfter !== 'always') continue;
    // 找到匹配的实际文件
    const actualFiles = findMatchingFiles(projectRoot, rule.pattern);
    for (const f of actualFiles) {
      if (!locks.files[f] || !locks.files[f].locked) {
        locks.files[f] = {
          locked: true,
          lockedAt: new Date().toISOString(),
          reason: rule.reason,
          hash: sha256(fs.readFileSync(path.join(projectRoot, f), 'utf-8')),
        };
        autoLocked++;
      }
    }
  }
  if (autoLocked > 0) {
    writeLocks(projectRoot, locks);
    log.ok(`${autoLocked} 个永久保护文件已自动锁定`);
  }

  console.log('');
  log.info('AI 工具提交被保护文件时将被 hook 拦截');
  log.info('人类紧急操作：git commit --no-verify');
  return true;
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
      // 匹配当前目录下的所有子目录
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            walk(path.join(dir, entry.name), depth + 1);
          } else if (depth === parts.length - 1) {
            // 最后一级如果是文件，检查是否匹配
            const relPath = path.relative(projectRoot, path.join(dir, entry.name));
            if (globMatch(pattern, relPath)) results.push(relPath);
          }
        }
      } catch { /* */ }
    } else if (depth === parts.length - 1) {
      // 最后一级 — 检查文件是否存在
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

/**
 * guard status — 查看当前保护状态
 */
function cmdGuardStatus(projectRoot) {
  log.title('spec-copilot guard status');

  const config = readConfig(projectRoot);
  const locks = readLocks(projectRoot);

  // 检查 hook 是否安装
  const hookPath = path.join(projectRoot, '.git', 'hooks', 'pre-commit');
  if (fs.existsSync(hookPath)) {
    const content = fs.readFileSync(hookPath, 'utf-8');
    if (content.includes('spec-copilot guard')) {
      log.ok('pre-commit hook 已安装');
    } else {
      log.warn('pre-commit hook 存在但不含 guard（运行 guard install 安装）');
    }
  } else {
    log.err('pre-commit hook 未安装（运行 guard install 安装）');
  }

  // 显示保护规则
  console.log('\n保护规则:');
  for (const rule of (config.protectedFiles || [])) {
    const matchedFiles = findMatchingFiles(projectRoot, rule.pattern);
    const lockedCount = matchedFiles.filter(f => locks.files[f] && locks.files[f].locked && !locks.files[f].unlocked).length;
    const icon = lockedCount > 0 ? '🔒' : (rule.lockAfter === 'always' ? '⚠️' : '🔓');
    console.log(`  ${icon} ${rule.pattern} — ${rule.lockAfter === 'always' ? '永久保护' : `${rule.lockAfter} 后锁定`} (${lockedCount}/${matchedFiles.length} 已锁)`);
  }

  // 显示锁定的文件
  const lockedFiles = Object.entries(locks.files).filter(([_, v]) => v.locked && !v.unlocked);
  if (lockedFiles.length > 0) {
    console.log(`\n锁定文件 (${lockedFiles.length}):`)
    for (const [file, info] of lockedFiles) {
      console.log(`  🔒 ${file} — ${info.reason || '手动锁定'} (${info.lockedAt || '?'})`);
    }
  } else {
    console.log('\n当前无锁定文件');
  }
}

/**
 * guard lock — 锁定文件
 */
function cmdGuardLock(projectRoot, targets) {
  if (targets.length === 0) {
    // 无参数：自动锁定当前阶段应该锁的文件
    autoLockByPhase(projectRoot);
    return;
  }

  const locks = readLocks(projectRoot);
  let count = 0;

  for (const target of targets) {
    const fullPath = path.join(projectRoot, target);
    if (!fs.existsSync(fullPath)) {
      log.warn(`文件不存在: ${target}`);
      continue;
    }

    const content = fs.readFileSync(fullPath, 'utf-8');
    locks.files[target] = {
      locked: true,
      lockedAt: new Date().toISOString(),
      reason: '手动锁定',
      hash: sha256(content),
    };
    count++;
    log.ok(`已锁定: ${target}`);
  }

  if (count > 0) writeLocks(projectRoot, locks);
}

/**
 * 根据当前变更阶段自动锁定文件
 */
function autoLockByPhase(projectRoot) {
  const config = readConfig(projectRoot);
  const locks = readLocks(projectRoot);
  const changesDir = path.join(projectRoot, 'spec_copilot', 'changes');
  if (!fs.existsSync(changesDir)) {
    log.info('无 changes 目录');
    return;
  }

  let totalLocked = 0;

  // 遍历所有变更目录
  const entries = fs.readdirSync(changesDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === 'templates') continue;

    const changeDir = path.join(changesDir, entry.name);
    const specPath = path.join(changeDir, 'spec.md');
    if (!fs.existsSync(specPath)) continue;

    const specContent = fs.readFileSync(specPath, 'utf-8');

    // 判断当前阶段
    const statusMatch = specContent.match(/status:\s*(propose|apply|review|done)/i);
    const currentStatus = statusMatch ? statusMatch[1].toLowerCase() : 'propose';

    // apply 阶段及之后：锁定 spec.md
    if (['apply', 'review', 'done'].includes(currentStatus)) {
      const relPath = path.relative(projectRoot, specPath);
      if (!locks.files[relPath] || !locks.files[relPath].locked) {
        locks.files[relPath] = {
          locked: true,
          lockedAt: new Date().toISOString(),
          reason: `status=${currentStatus}，spec.md 已审批锁定`,
          hash: sha256(specContent),
        };
        totalLocked++;
        log.ok(`已锁定: ${relPath} (status: ${currentStatus})`);
      }
    }
  }

  // 锁定 always 保护的文件
  for (const rule of (config.protectedFiles || [])) {
    if (rule.lockAfter !== 'always') continue;
    const files = findMatchingFiles(projectRoot, rule.pattern);
    for (const f of files) {
      if (!locks.files[f] || !locks.files[f].locked) {
        locks.files[f] = {
          locked: true,
          lockedAt: new Date().toISOString(),
          reason: rule.reason,
          hash: sha256(fs.readFileSync(path.join(projectRoot, f), 'utf-8')),
        };
        totalLocked++;
        log.ok(`已锁定: ${f}`);
      }
    }
  }

  writeLocks(projectRoot, locks);
  if (totalLocked === 0) {
    log.info('无新文件需要锁定');
  } else {
    log.ok(`共锁定 ${totalLocked} 个文件`);
  }
}

/**
 * guard unlock — 解锁文件（仅限人类操作）
 */
function cmdGuardUnlock(projectRoot, targets) {
  if (targets.length === 0) {
    console.log('用法: spec-copilot guard unlock <文件路径> [<文件路径>...]');
    return;
  }

  const locks = readLocks(projectRoot);
  let count = 0;

  for (const target of targets) {
    if (locks.files[target] && locks.files[target].locked) {
      locks.files[target].unlocked = true;
      locks.files[target].unlockedAt = new Date().toISOString();
      count++;
      log.ok(`已解锁: ${target}`);
    } else {
      log.info(`未锁定: ${target}`);
    }
  }

  if (count > 0) writeLocks(projectRoot, locks);
}

/**
 * guard check — 运行检查（供 hook 调用或手动运行）
 */
function cmdGuardCheck(projectRoot, isHook) {
  const result = runHookCheck(projectRoot);

  if (result.pass) {
    if (!isHook) log.ok('所有检查通过');
    return true;
  }

  // 输出违规
  console.log('');
  console.log('🛑 spec-copilot guard 拦截');
  console.log('─'.repeat(50));
  for (const v of result.violations) {
    console.log(`  ❌ ${v.file}`);
    console.log(`     规则: ${v.rule}`);
    console.log(`     原因: ${v.reason}`);
    console.log('');
  }
  return false;
}

// ─── 与 gate 系统集成 ────────────────────────────────────────

/**
 * gate 通过后自动锁定 spec.md
 * 由 cli.js 中 gate 通过后调用
 */
function onGatePassed(projectRoot, changeName, phase) {
  if (phase !== 'smoke' && phase !== 'apply') return;

  const locks = readLocks(projectRoot);
  const specRelPath = `spec_copilot/changes/${changeName}/spec.md`;
  const specFullPath = path.join(projectRoot, specRelPath);

  if (!fs.existsSync(specFullPath)) return;

  const content = fs.readFileSync(specFullPath, 'utf-8');
  locks.files[specRelPath] = {
    locked: true,
    lockedAt: new Date().toISOString(),
    reason: `${phase} gate 通过后自动锁定`,
    hash: sha256(content),
    phase,
  };
  writeLocks(projectRoot, locks);
}

// ─── 导出 ────────────────────────────────────────────────────

module.exports = {
  // CLI 命令
  cmdGuardInstall,
  cmdGuardStatus,
  cmdGuardLock,
  cmdGuardUnlock,
  cmdGuardCheck,

  // 内部函数（供 cli.js 集成）
  runHookCheck,
  onGatePassed,
  readConfig,
  readLocks,

  // 常量
  DEFAULT_RULES,
  GUARD_DIR,
};

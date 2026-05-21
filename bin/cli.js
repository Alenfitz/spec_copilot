#!/usr/bin/env node

/**
 * @alenfitz/spec-copilot CLI — 渐进式 Spec 编码框架（多工具统一版）
 *
 * 支持工具：opencode / claude-code / cursor / windsurf / copilot / cline
 *
 * 命令：
 *   npx @alenfitz/spec-copilot install [--tool <name>]   初始化项目
 *   npx @alenfitz/spec-copilot update [--force]           升级框架文件
 *   npx @alenfitz/spec-copilot gate <name> <phase>        阶段门禁检查
 *   npx @alenfitz/spec-copilot lint [name]                Spec 完整性检查
 *   npx @alenfitz/spec-copilot doctor                     检查安装状态
 *   npx @alenfitz/spec-copilot uninstall [--confirm]      移除框架文件
 *
 * 零外部依赖，仅使用 Node.js 内置模块。
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { adapters, detectTools, supportedTools } = require('../adapters');

// ─── 常量 ───────────────────────────────────────────────────

const BUILTIN_ADAPTERS = ['_template.md', 'README.md', 'spring-boot-vue3.md'];
const TOOL_STATE_FILE = '.spec-copilot-tool'; // 记录使用的工具

// ─── 工具函数 ───────────────────────────────────────────────

const log = {
  ok(msg)   { console.log(`\x1b[32m✓\x1b[0m ${msg}`); },
  warn(msg) { console.log(`\x1b[33m⚠\x1b[0m ${msg}`); },
  err(msg)  { console.log(`\x1b[31m✗\x1b[0m ${msg}`); },
  info(msg) { console.log(`  ${msg}`); },
  title(msg){ console.log(`\n\x1b[1m${msg}\x1b[0m`); },
};

function copyDir(src, dest, options = {}) {
  const { overwrite = true, exclude = [] } = options;
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (exclude.includes(entry.name)) continue;
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath, options);
    } else if (overwrite || !fs.existsSync(destPath)) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function rmDirRecursive(dirPath) {
  if (!fs.existsSync(dirPath)) return;
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const p = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      rmDirRecursive(p);
    } else {
      fs.unlinkSync(p);
    }
  }
  fs.rmdirSync(dirPath);
}

function findProjectRoot(startDir = process.cwd()) {
  let dir = path.resolve(startDir);
  while (true) {
    if (fs.existsSync(path.join(dir, '.git')) ||
        fs.existsSync(path.join(dir, 'package.json'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

function pkgRoot() {
  return path.resolve(__dirname, '..');
}

function readVersion() {
  try {
    return fs.readFileSync(path.join(pkgRoot(), 'framework', 'VERSION'), 'utf-8').trim();
  } catch {
    return 'unknown';
  }
}

function renderPromptTemplate() {
  const templatePath = path.join(pkgRoot(), 'framework', 'AGENTS.md.template');
  const template = fs.readFileSync(templatePath, 'utf-8');
  return template.replace(/\{\{VERSION\}\}/g, readVersion());
}

/** 从 framework/ 读取文件 */
function readFrameworkFile(filename) {
  const filepath = path.join(pkgRoot(), 'framework', filename);
  if (!fs.existsSync(filepath)) {
    throw new Error(`框架文件不存在: ${filename}`);
  }
  return fs.readFileSync(filepath, 'utf-8');
}

/** 解析 --tool 参数或自动检测 */
function resolveAdapter(args, projectRoot) {
  const toolIdx = args.indexOf('--tool');
  if (toolIdx !== -1 && args[toolIdx + 1]) {
    const toolName = args[toolIdx + 1];
    if (!adapters[toolName]) {
      log.err(`未知工具: ${toolName}`);
      log.info(`支持的工具: ${supportedTools().join(', ')}`);
      process.exit(1);
    }
    return adapters[toolName];
  }

  // 从状态文件读取（已安装时）
  const stateFile = path.join(projectRoot, 'spec_copilot', TOOL_STATE_FILE);
  if (fs.existsSync(stateFile)) {
    const savedTool = fs.readFileSync(stateFile, 'utf-8').trim();
    if (adapters[savedTool]) return adapters[savedTool];
  }

  // 自动检测
  const detected = detectTools(projectRoot);
  if (detected.length === 1) {
    return detected[0];
  } else if (detected.length > 1) {
    log.warn(`检测到多个工具: ${detected.map(a => a.displayName).join(', ')}`);
    log.info(`请用 --tool <name> 指定: ${detected.map(a => a.name).join(', ')}`);
    process.exit(1);
  }

  return null; // install 时 null 会触发提示
}

// ─── 安装 ───────────────────────────────────────────────────

function cmdInstall(args) {
  const projectRoot = findProjectRoot();
  const srcRoot = pkgRoot();
  let adapter = resolveAdapter(args, projectRoot);

  if (!adapter) {
    log.err('未检测到 AI 编码工具，请用 --tool 指定：');
    log.info('');
    for (const a of Object.values(adapters)) {
      log.info(`  --tool ${a.name.padEnd(12)} ${a.description}`);
    }
    process.exit(1);
  }

  log.title(`@alenfitz/spec-copilot install → ${adapter.displayName}`);
  log.info(`项目根目录: ${projectRoot}`);
  log.info(`框架版本:   ${readVersion()}`);
  log.info(`目标工具:   ${adapter.displayName}`);

  // 1. 创建 spec_copilot/ 目录结构
  const scDir = path.join(projectRoot, 'spec_copilot');
  const dirs = [
    scDir,
    path.join(scDir, 'rules'),
    path.join(scDir, 'stack-adapters'),
    path.join(scDir, 'changes', 'templates'),
    path.join(scDir, 'scripts'),
    path.join(scDir, 'knowledge'),
    path.join(scDir, 'archives'),
    path.join(scDir, 'commands'),
  ];
  for (const d of dirs) {
    fs.mkdirSync(d, { recursive: true });
  }

  // 2. 拷贝通用框架文件
  const frameworkSrc = path.join(srcRoot, 'framework');
  log.info('拷贝通用框架文件...');
  copyDir(path.join(frameworkSrc, 'rules'), path.join(scDir, 'rules'), {
    exclude: ['project-context.md', 'domain-rules.md'],
  });
  copyDir(path.join(frameworkSrc, 'stack-adapters'), path.join(scDir, 'stack-adapters'));
  copyDir(path.join(frameworkSrc, 'changes', 'templates'), path.join(scDir, 'changes', 'templates'));
  copyDir(path.join(frameworkSrc, 'scripts'), path.join(scDir, 'scripts'));

  ['VERSION', 'CHANGELOG.md'].forEach(f => {
    const src = path.join(frameworkSrc, f);
    const dest = path.join(scDir, f);
    if (fs.existsSync(src)) fs.copyFileSync(src, dest);
  });

  // 3. 设置脚本可执行
  for (const s of ['spec-lint.sh', 'spec-gate.sh', 'install-hooks.sh']) {
    const scriptPath = path.join(scDir, 'scripts', s);
    if (fs.existsSync(scriptPath)) {
      try { fs.chmodSync(scriptPath, 0o755); } catch {}
    }
  }

  // 4. 创建项目专属文件（仅当不存在时）
  for (const rel of ['rules/project-context.md', 'rules/domain-rules.md', 'knowledge/index.md']) {
    const dest = path.join(scDir, rel);
    if (!fs.existsSync(dest)) {
      const content = readFrameworkFile(rel);
      fs.writeFileSync(dest, content, 'utf-8');
      log.ok(`创建 spec_copilot/${rel}`);
    } else {
      log.warn(`跳过 spec_copilot/${rel}（已存在，保护项目内容）`);
    }
  }

  // 5. 安装命令文件
  const commandsSrc = path.join(srcRoot, 'commands');
  if (adapter.hasNativeCommands && adapter.commandsDir) {
    // 有原生命令支持 → 拷贝到工具命令目录
    const cmdDest = path.join(projectRoot, adapter.commandsDir);
    fs.mkdirSync(cmdDest, { recursive: true });
    copyDir(commandsSrc, cmdDest);
    const cmdCount = fs.readdirSync(commandsSrc).filter(f => f.endsWith('.md')).length;
    log.ok(`${adapter.commandsDir}/ 已安装（${cmdCount} 个斜杠命令）`);
  }

  // 同时拷贝到 spec_copilot/commands/（所有工具都有，供引用）
  copyDir(commandsSrc, path.join(scDir, 'commands'));
  if (!adapter.hasNativeCommands) {
    const cmdCount = fs.readdirSync(commandsSrc).filter(f => f.endsWith('.md')).length;
    log.ok(`spec_copilot/commands/ 已安装（${cmdCount} 个命令，通过 prompt 路由）`);
  }

  // 6. 生成提示词文件
  const promptPath = path.join(projectRoot, adapter.promptPath);
  const promptDir = path.dirname(promptPath);
  if (!fs.existsSync(promptPath)) {
    fs.mkdirSync(promptDir, { recursive: true });
    const rawPrompt = renderPromptTemplate();
    const formattedPrompt = adapter.formatPrompt(rawPrompt);
    fs.writeFileSync(promptPath, formattedPrompt, 'utf-8');
    log.ok(`${adapter.promptPath} 已创建`);
  } else {
    log.warn(`${adapter.promptPath} 已存在，跳过（update --force 覆盖）`);
  }

  // 7. 记录使用的工具
  fs.writeFileSync(path.join(scDir, TOOL_STATE_FILE), adapter.name, 'utf-8');

  // 8. Git hook
  installGitHook(projectRoot);

  log.title('安装完成');
  log.info('');
  log.info('接下来：');
  if (adapter.hasNativeCommands) {
    log.info('  1. 执行 /spec:init（自动加载规范 + 扫描项目 + 报告状态）');
  } else {
    log.info('  1. 对 AI 说："读取 spec_copilot/ 目录下的规范，执行 /spec:init"');
  }
  log.info('  2. 选择或创建 stack-adapters/<你的栈>.md');
  log.info('  3. 填写 rules/domain-rules.md 业务约束（可选）');
  log.info('  4. 开始使用：/spec:propose <你的第一个需求>');
  log.info('');
  log.info('验证安装：npx @alenfitz/spec-copilot doctor');
}

// ─── 升级 ───────────────────────────────────────────────────

function cmdUpdate(args) {
  const force = args.includes('--force');
  const projectRoot = findProjectRoot();
  const srcRoot = pkgRoot();
  const scDir = path.join(projectRoot, 'spec_copilot');

  if (!fs.existsSync(scDir)) {
    log.err('未找到 spec_copilot/ 目录，请先运行 install');
    process.exit(1);
  }

  const adapter = resolveAdapter(args, projectRoot);
  if (!adapter) {
    log.err('无法确定工具类型，请用 --tool 指定');
    process.exit(1);
  }

  log.title(`@alenfitz/spec-copilot update → ${adapter.displayName}`);

  const localVersionPath = path.join(scDir, 'VERSION');
  const localVersion = fs.existsSync(localVersionPath)
    ? fs.readFileSync(localVersionPath, 'utf-8').trim()
    : 'unknown';
  log.info(`本地版本: ${localVersion}`);
  log.info(`包版本:   ${readVersion()}`);

  if (localVersion === readVersion() && !force) {
    log.ok('已是最新版本（使用 --force 强制更新）');
    return;
  }

  const frameworkSrc = path.join(srcRoot, 'framework');
  log.info('更新通用框架文件...');

  copyDir(path.join(frameworkSrc, 'rules'), path.join(scDir, 'rules'), {
    exclude: ['project-context.md', 'domain-rules.md'],
  });

  const adapterDir = path.join(scDir, 'stack-adapters');
  const userAdapters = fs.existsSync(adapterDir)
    ? fs.readdirSync(adapterDir).filter(f => !BUILTIN_ADAPTERS.includes(f))
    : [];
  copyDir(path.join(frameworkSrc, 'stack-adapters'), adapterDir, {
    exclude: userAdapters,
  });

  copyDir(path.join(frameworkSrc, 'changes', 'templates'), path.join(scDir, 'changes', 'templates'));
  copyDir(path.join(frameworkSrc, 'scripts'), path.join(scDir, 'scripts'));

  ['VERSION', 'CHANGELOG.md'].forEach(f => {
    const src = path.join(frameworkSrc, f);
    const dest = path.join(scDir, f);
    if (fs.existsSync(src)) fs.copyFileSync(src, dest);
  });

  // 更新命令
  const commandsSrc = path.join(srcRoot, 'commands');
  copyDir(commandsSrc, path.join(scDir, 'commands'));
  if (adapter.hasNativeCommands && adapter.commandsDir) {
    const cmdDest = path.join(projectRoot, adapter.commandsDir);
    fs.mkdirSync(cmdDest, { recursive: true });
    copyDir(commandsSrc, cmdDest);
    log.ok(`${adapter.commandsDir}/ 已更新`);
  }

  // 更新 prompt
  const promptPath = path.join(projectRoot, adapter.promptPath);
  if (force || !fs.existsSync(promptPath)) {
    fs.mkdirSync(path.dirname(promptPath), { recursive: true });
    const rawPrompt = renderPromptTemplate();
    const formattedPrompt = adapter.formatPrompt(rawPrompt);
    fs.writeFileSync(promptPath, formattedPrompt, 'utf-8');
    log.ok(`${adapter.promptPath} 已更新`);
  } else {
    log.warn(`${adapter.promptPath} 已跳过（使用 --force 覆盖）`);
  }

  // 更新工具记录
  fs.writeFileSync(path.join(scDir, TOOL_STATE_FILE), adapter.name, 'utf-8');

  log.title('升级完成');
  log.info('保留的项目专属内容：');
  log.info('  - rules/project-context.md');
  log.info('  - rules/domain-rules.md');
  log.info('  - knowledge/');
  log.info('  - changes/（进行中的需求）');
  log.info('  - archives/');
  if (userAdapters.length > 0) {
    log.info(`  - 自定义 stack-adapters：${userAdapters.join(', ')}`);
  }
}

// ─── Gate ───────────────────────────────────────────────────

function cmdGate(args) {
  const changeName = args[0];
  const phase = args[1];

  if (!changeName || !phase) {
    log.err('用法: npx @alenfitz/spec-copilot gate <变更名> <phase>');
    log.info('phase: apply | review | test | archive');
    process.exit(2);
  }

  const validPhases = ['apply', 'review', 'test', 'archive'];
  if (!validPhases.includes(phase)) {
    log.err(`未知 phase: ${phase}（可选: ${validPhases.join(', ')}）`);
    process.exit(2);
  }

  const projectRoot = findProjectRoot();
  const changeDir = path.join(projectRoot, 'spec_copilot', 'changes', changeName);

  if (!fs.existsSync(changeDir)) {
    log.err(`变更目录不存在: spec_copilot/changes/${changeName}/`);
    process.exit(1);
  }

  log.title(`Gate 检查: ${changeName} → ${phase}`);

  let pass = true;
  const fail = (msg) => { log.err(msg); pass = false; };

  const specPath = path.join(changeDir, 'spec.md');
  const tasksPath = path.join(changeDir, 'tasks.md');
  const logPath = path.join(changeDir, 'log.md');

  if (!fs.existsSync(specPath)) {
    fail('spec.md 不存在');
    log.err(`Gate 未通过 — 无法进入 ${phase} 阶段`);
    process.exit(1);
  }

  const specContent = fs.readFileSync(specPath, 'utf-8');
  const isComplex = specContent.includes('complexity:') && specContent.includes('🔴');

  switch (phase) {
    case 'apply': {
      const section9Match = specContent.match(/## 9\. 待澄清[\s\S]*?(?=## 10\.)/);
      if (section9Match && /- \[ \]/.test(section9Match[0])) {
        fail('§9 待澄清仍有未解决项 — 必须全部解决后才能 apply');
      } else {
        log.ok('§9 待澄清已清空');
      }
      if (isComplex && !fs.existsSync(tasksPath)) {
        fail('🔴 复杂需求缺少 tasks.md');
      } else if (isComplex) {
        log.ok('tasks.md 存在（🔴 复杂需求）');
      }
      if (!fs.existsSync(logPath)) {
        fail('log.md 不存在');
      } else {
        log.ok('log.md 存在');
      }
      break;
    }
    case 'review': {
      if (!fs.existsSync(logPath)) {
        fail('log.md 不存在');
      } else {
        const logContent = fs.readFileSync(logPath, 'utf-8');
        if (/smoke.*通过|冒烟.*通过|smoke.*✓/i.test(logContent)) {
          log.ok('log.md 含冒烟通过记录');
        } else {
          fail('log.md 无冒烟通过记录 — 请先运行 /spec:smoke');
        }
      }
      if (fs.existsSync(tasksPath)) {
        const tasksContent = fs.readFileSync(tasksPath, 'utf-8');
        const pendingTasks = tasksContent.match(/状态：待完成/g) || [];
        if (pendingTasks.length > 0) {
          fail(`tasks.md 中有 ${pendingTasks.length} 个未完成 task`);
        }
      }

      // Check: spec feature points should have corresponding code evidence
      const featurePoints = specContent.match(/F\d{2}[：:]/g) || specContent.match(/功能点\s*\d+/g) || [];
      if (featurePoints.length > 0) {
        log.ok(`spec.md 含 ${featurePoints.length} 个功能点 — review 时必须逐条 grep 验证`);
      }

      // Check: log.md Spec-Code deviation section should not be suspiciously empty for complex changes
      if (isComplex && fs.existsSync(logPath)) {
        const logContent = fs.readFileSync(logPath, 'utf-8');
        const deviationMatch = logContent.match(/Spec-Code 偏差记录[\s\S]*?(?=##|$)/);
        if (deviationMatch) {
          const deviationSection = deviationMatch[0].replace(/Spec-Code 偏差记录/, '').trim();
          const hasContent = deviationSection.replace(/[-\s|>*]/g, '').length > 5;
          if (!hasContent) {
            log.warn('⚠️  log.md Spec-Code 偏差记录为空 — 🔴 复杂需求应关注是否存在未记录的偏差');
          } else {
            log.ok('log.md Spec-Code 偏差记录已填写');
          }
        }
      }

      // Check: tasks.md change summary should be filled
      if (fs.existsSync(tasksPath)) {
        const tasksContent = fs.readFileSync(tasksPath, 'utf-8');
        const summaryMatch = tasksContent.match(/变更摘要[\s\S]*$/);
        if (summaryMatch) {
          const summarySection = summaryMatch[0].replace(/变更摘要/, '').trim();
          const hasContent = summarySection.replace(/[-\s|>*⚠️/]/g, '').length > 10;
          if (!hasContent) {
            fail('tasks.md 变更摘要未填写 — apply 完成后必须填写');
          } else {
            log.ok('tasks.md 变更摘要已填写');
          }
        }
      }
      break;
    }
    case 'test': {
      if (!isComplex) {
        log.warn('非 🔴 复杂需求，test 为可选');
      }
      if (/结论：通过|Spec 合规：✅/.test(specContent)) {
        log.ok('spec.md §12 审查已通过');
      } else {
        fail('spec.md §12 审查结论未通过或未填写');
      }
      break;
    }
    case 'archive': {
      if (/结论：通过/.test(specContent)) {
        log.ok('spec.md §12 审查结论为通过');
      } else {
        fail('spec.md §12 审查结论未通过');
      }
      break;
    }
  }

  console.log('');
  if (pass) {
    log.ok(`Gate 通过 ✓ — 可以进入 ${phase} 阶段`);
    process.exit(0);
  } else {
    log.err(`Gate 未通过 ✗ — 无法进入 ${phase} 阶段`);
    process.exit(1);
  }
}

// ─── Lint ───────────────────────────────────────────────────

function cmdLint(args) {
  const projectRoot = findProjectRoot();
  const lintScript = path.join(projectRoot, 'spec_copilot', 'scripts', 'spec-lint.sh');

  if (!fs.existsSync(lintScript)) {
    log.err('未找到 spec-lint.sh，请先运行 install');
    process.exit(1);
  }

  const target = args[0] || '';
  try {
    execSync(`bash "${lintScript}" ${target}`, { cwd: projectRoot, stdio: 'inherit' });
  } catch (e) {
    process.exit(e.status || 1);
  }
}

// ─── Doctor ─────────────────────────────────────────────────

function cmdDoctor() {
  const projectRoot = findProjectRoot();
  log.title('@alenfitz/spec-copilot doctor');
  log.info(`项目根目录: ${projectRoot}`);
  log.info(`框架版本:   ${readVersion()}`);

  let issues = 0;
  const scDir = path.join(projectRoot, 'spec_copilot');

  // 检查 spec_copilot/ 目录
  if (fs.existsSync(scDir)) {
    log.ok('spec_copilot/ 目录存在');
  } else {
    log.err('spec_copilot/ 目录不存在');
    issues++;
    log.err(`发现 ${issues} 个问题，运行 install 修复`);
    return;
  }

  // 检测工具
  const stateFile = path.join(scDir, TOOL_STATE_FILE);
  let adapter = null;
  if (fs.existsSync(stateFile)) {
    const toolName = fs.readFileSync(stateFile, 'utf-8').trim();
    adapter = adapters[toolName];
    if (adapter) {
      log.ok(`工具: ${adapter.displayName}`);
    }
  }
  if (!adapter) {
    const detected = detectTools(projectRoot);
    if (detected.length > 0) {
      adapter = detected[0];
      log.warn(`工具未记录，自动检测: ${adapter.displayName}`);
    } else {
      log.warn('未检测到 AI 编码工具');
    }
  }

  // 检查 prompt 文件
  if (adapter) {
    const promptPath = path.join(projectRoot, adapter.promptPath);
    if (fs.existsSync(promptPath)) {
      log.ok(`提示词文件: ${adapter.promptPath}`);
    } else {
      log.err(`提示词文件缺失: ${adapter.promptPath}`);
      issues++;
    }

    if (adapter.hasNativeCommands && adapter.commandsDir) {
      const cmdDir = path.join(projectRoot, adapter.commandsDir);
      if (fs.existsSync(cmdDir)) {
        const cmdFiles = fs.readdirSync(cmdDir).filter(f => f.endsWith('.md'));
        log.ok(`${adapter.commandsDir}/ 已安装（${cmdFiles.length} 个命令）`);
      } else {
        log.err(`${adapter.commandsDir}/ 不存在`);
        issues++;
      }
    }
  }

  // 检查命令文件
  const cmdDir = path.join(scDir, 'commands');
  if (fs.existsSync(cmdDir)) {
    const cmdFiles = fs.readdirSync(cmdDir).filter(f => f.endsWith('.md'));
    log.ok(`spec_copilot/commands/ 已安装（${cmdFiles.length} 个命令）`);
  } else {
    log.err('spec_copilot/commands/ 不存在');
    issues++;
  }

  // 检查关键文件
  const checkFiles = [
    ['spec_copilot/rules/coding-style.md', '编码规范'],
    ['spec_copilot/rules/security.md', '安全红线'],
    ['spec_copilot/rules/project-context.md', '项目上下文'],
    ['spec_copilot/knowledge/index.md', '知识索引'],
    ['spec_copilot/scripts/spec-lint.sh', 'Lint 脚本'],
  ];
  for (const [rel, label] of checkFiles) {
    if (fs.existsSync(path.join(projectRoot, rel))) {
      log.ok(`${label}（${rel}）`);
    } else {
      log.err(`缺少 ${label}（${rel}）`);
      issues++;
    }
  }

  // 检查 project-context.md 是否已填充
  const pcPath = path.join(scDir, 'rules', 'project-context.md');
  if (fs.existsSync(pcPath)) {
    const content = fs.readFileSync(pcPath, 'utf-8');
    if (content.match(/- 应用名：$/m)) {
      log.warn('project-context.md 未填充 → 请执行 /spec:init');
    }
  }

  // 检查 Git hook
  const hookPath = path.join(projectRoot, '.git', 'hooks', 'pre-commit');
  if (fs.existsSync(hookPath)) {
    const hookContent = fs.readFileSync(hookPath, 'utf-8');
    if (hookContent.includes('spec_copilot')) {
      log.ok('Git pre-commit hook 已安装');
    } else {
      log.warn('pre-commit hook 存在但不是 spec_copilot 的');
    }
  } else if (fs.existsSync(path.join(projectRoot, '.git'))) {
    log.warn('Git pre-commit hook 未安装（可选）');
  }

  // 检查 stack adapter
  const saDir = path.join(scDir, 'stack-adapters');
  if (fs.existsSync(saDir)) {
    const sas = fs.readdirSync(saDir)
      .filter(f => f.endsWith('.md') && f !== 'README.md' && f !== '_template.md');
    if (sas.length > 0) {
      log.ok(`技术栈适配：${sas.map(f => f.replace('.md', '')).join(', ')}`);
    } else {
      log.warn('无自定义栈适配（可基于 _template.md 创建）');
    }
  }

  console.log('');
  if (issues === 0) {
    log.ok('全部检查通过');
  } else {
    log.err(`发现 ${issues} 个问题，运行 install 修复`);
  }
}

// ─── 卸载 ───────────────────────────────────────────────────

function cmdUninstall(args) {
  const confirm = args.includes('--confirm');
  const projectRoot = findProjectRoot();
  log.title('@alenfitz/spec-copilot uninstall');
  log.info(`项目根目录: ${projectRoot}`);

  const scDir = path.join(projectRoot, 'spec_copilot');

  // 读取工具信息
  const adapter = resolveAdapter(args, projectRoot);

  // 检查有无重要数据
  const changesDir = path.join(scDir, 'changes');
  if (fs.existsSync(changesDir)) {
    const activeChanges = fs.readdirSync(changesDir)
      .filter(d => d !== 'templates' && fs.existsSync(path.join(changesDir, d)) &&
        fs.statSync(path.join(changesDir, d)).isDirectory());
    if (activeChanges.length > 0) {
      log.warn(`发现 ${activeChanges.length} 个进行中的变更: ${activeChanges.join(', ')}`);
    }
  }
  const archivesDir = path.join(scDir, 'archives');
  if (fs.existsSync(archivesDir)) {
    try {
      const archives = fs.readdirSync(archivesDir).filter(d =>
        fs.statSync(path.join(archivesDir, d)).isDirectory());
      if (archives.length > 0) log.warn(`发现 ${archives.length} 个归档目录`);
    } catch {}
  }

  console.log('');
  log.info('将删除以下内容：');
  if (fs.existsSync(scDir)) log.info('  - spec_copilot/');
  if (adapter) {
    const promptPath = path.join(projectRoot, adapter.promptPath);
    if (fs.existsSync(promptPath)) log.info(`  - ${adapter.promptPath}`);
    if (adapter.hasNativeCommands && adapter.commandsDir) {
      const cmdDir = path.join(projectRoot, adapter.commandsDir);
      if (fs.existsSync(cmdDir)) log.info(`  - ${adapter.commandsDir}/`);
    }
  }

  if (!confirm) {
    console.log('');
    log.warn('确认卸载请运行: npx @alenfitz/spec-copilot uninstall --confirm');
    return;
  }

  // 执行删除
  if (adapter) {
    const promptPath = path.join(projectRoot, adapter.promptPath);
    if (fs.existsSync(promptPath)) {
      fs.unlinkSync(promptPath);
      log.ok(`已删除 ${adapter.promptPath}`);
    }
    if (adapter.hasNativeCommands && adapter.commandsDir) {
      const cmdDir = path.join(projectRoot, adapter.commandsDir);
      if (fs.existsSync(cmdDir)) {
        rmDirRecursive(cmdDir);
        log.ok(`已删除 ${adapter.commandsDir}/`);
      }
    }
  }
  if (fs.existsSync(scDir)) {
    rmDirRecursive(scDir);
    log.ok('已删除 spec_copilot/');
  }

  // 移除 Git hook
  const hookPath = path.join(projectRoot, '.git', 'hooks', 'pre-commit');
  if (fs.existsSync(hookPath)) {
    const hookContent = fs.readFileSync(hookPath, 'utf-8');
    if (hookContent.includes('spec_copilot')) {
      fs.unlinkSync(hookPath);
      log.ok('已删除 Git pre-commit hook');
    }
  }

  log.title('卸载完成');
}

// ─── 辅助 ───────────────────────────────────────────────────

function installGitHook(projectRoot) {
  const hookScript = path.join(projectRoot, 'spec_copilot', 'scripts', 'install-hooks.sh');
  if (!fs.existsSync(hookScript)) return;

  const gitDir = path.join(projectRoot, '.git');
  if (!fs.existsSync(gitDir)) {
    log.warn('不在 Git 仓库中，跳过 pre-commit hook 安装');
    return;
  }

  try {
    execSync(`bash "${hookScript}"`, { cwd: projectRoot, stdio: 'pipe' });
    log.ok('Git pre-commit hook 已安装');
  } catch {
    log.warn('pre-commit hook 安装失败（不影响其他功能）');
  }
}

// ─── 入口 ────────────────────────────────────────────────────

function showHelp() {
  console.log(`
@alenfitz/spec-copilot — 渐进式 Spec 编码框架（多工具统一版）

支持工具: ${supportedTools().join(', ')}

用法:
  npx @alenfitz/spec-copilot install [--tool <name>]    初始化项目
  npx @alenfitz/spec-copilot update [--force]            升级框架
  npx @alenfitz/spec-copilot gate <name> <phase>         阶段门禁检查
  npx @alenfitz/spec-copilot lint [name]                 Spec 完整性检查
  npx @alenfitz/spec-copilot doctor                      检查安装状态
  npx @alenfitz/spec-copilot uninstall [--confirm]       移除框架文件

示例:
  npx @alenfitz/spec-copilot install --tool cursor
  npx @alenfitz/spec-copilot install --tool claude-code
  npx @alenfitz/spec-copilot gate user-login apply
  npx @alenfitz/spec-copilot doctor
`);
}

const args = process.argv.slice(2);
const cmd = args[0];

switch (cmd) {
  case 'install':
    cmdInstall(args.slice(1));
    break;
  case 'update':
  case 'upgrade':
    cmdUpdate(args.slice(1));
    break;
  case 'gate':
    cmdGate(args.slice(1));
    break;
  case 'lint':
    cmdLint(args.slice(1));
    break;
  case 'doctor':
  case 'check':
    cmdDoctor();
    break;
  case 'uninstall':
  case 'remove':
    cmdUninstall(args.slice(1));
    break;
  case '--help':
  case '-h':
  case undefined:
    showHelp();
    break;
  default:
    log.err(`未知命令: ${cmd}`);
    showHelp();
    process.exit(1);
}

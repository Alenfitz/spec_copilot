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
const { adapters, detectTools, supportedTools, parseAgentMeta, detectStack, buildStackContext } = require('../adapters');
const {
  detectSkeletonComponents,
  checkBuildable,
  detectAnyAbuse,
  checkTaskInterleaving,
  checkTaskGranularity,
  checkFrontendEvidence,
} = require('./frontend-checks');
const {
  checkContractConsistency,
  checkHardcodedIdentities,
} = require('./review-checks');

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

function isFrameworkRepo(projectRoot) {
  return path.resolve(projectRoot) === pkgRoot();
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

/** 解析 --tool 参数，支持 --tool all 和 --tool cursor,claude-code */
function resolveAdapters(args, projectRoot) {
  const toolIdx = args.indexOf('--tool');
  if (toolIdx !== -1 && args[toolIdx + 1]) {
    const toolArg = args[toolIdx + 1];
    if (toolArg === 'all') {
      return Object.values(adapters);
    }
    const names = toolArg.split(',').map(s => s.trim());
    const result = [];
    for (const name of names) {
      if (!adapters[name]) {
        log.err(`未知工具: ${name}`);
        log.info(`支持的工具: ${supportedTools().join(', ')}`);
        process.exit(1);
      }
      result.push(adapters[name]);
    }
    return result;
  }
  return null;
}

/** 解析 --tool 参数或自动检测（单工具） */
function resolveAdapter(args, projectRoot) {
  const multi = resolveAdapters(args, projectRoot);
  if (multi && multi.length === 1) return multi[0];
  if (multi && multi.length > 1) return multi[0]; // 向后兼容：非 install 场景取第一个

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

  // 多工具支持：--tool all 或 --tool cursor,claude-code
  let targetAdapters = resolveAdapters(args, projectRoot);
  if (!targetAdapters) {
    // 单工具兼容
    const single = resolveAdapter(args, projectRoot);
    if (!single) {
      log.err('未检测到 AI 编码工具，请用 --tool 指定：');
      log.info('');
      for (const a of Object.values(adapters)) {
        log.info(`  --tool ${a.name.padEnd(12)} ${a.description}`);
      }
      log.info('');
      log.info('  --tool all             全部工具同时安装');
      log.info('  --tool cursor,copilot  多工具同时安装');
      process.exit(1);
    }
    targetAdapters = [single];
  }

  const toolNames = targetAdapters.map(a => a.displayName).join(', ');
  log.title(`@alenfitz/spec-copilot install → ${toolNames}`);
  log.info(`项目根目录: ${projectRoot}`);
  log.info(`框架版本:   ${readVersion()}`);
  log.info(`目标工具:   ${toolNames}`);

  // 0. 检测项目技术栈
  const stack = detectStack(projectRoot);
  const stackCtx = buildStackContext(stack);
  if (stackCtx) {
    const parts = [];
    if (stack.frontend) parts.push(stack.frontend);
    if (stack.backend) parts.push(stack.backend);
    log.ok(`检测到技术栈: ${parts.join(' + ') || '通用'}`);
  }

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
  if (fs.existsSync(path.join(frameworkSrc, 'agents'))) {
    copyDir(path.join(frameworkSrc, 'agents'), path.join(scDir, 'agents'));
  }

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

  // 5. 安装命令文件（通用 + 各工具专属）
  const commandsSrc = path.join(srcRoot, 'commands');
  copyDir(commandsSrc, path.join(scDir, 'commands'));

  // 6. 为每个目标工具安装适配
  const rawPrompt = renderPromptTemplate();
  const promptWithStack = stackCtx ? rawPrompt + '\n' + stackCtx : rawPrompt;

  for (const adapter of targetAdapters) {
    log.info('');
    log.info(`─── 安装 ${adapter.displayName} 适配 ───`);

    // 6a. 原生命令目录
    if (adapter.hasNativeCommands && adapter.commandsDir) {
      const cmdDest = path.join(projectRoot, adapter.commandsDir);
      fs.mkdirSync(cmdDest, { recursive: true });
      copyDir(commandsSrc, cmdDest);
      const cmdCount = fs.readdirSync(commandsSrc).filter(f => f.endsWith('.md')).length;
      log.ok(`${adapter.commandsDir}/ 已安装（${cmdCount} 个斜杠命令）`);
    } else {
      const cmdCount = fs.readdirSync(commandsSrc).filter(f => f.endsWith('.md')).length;
      log.ok(`spec_copilot/commands/ 已安装（${cmdCount} 个命令，通过 prompt 路由）`);
    }

    // 6b. Sub-agent
    installAgentsForAdapter(adapter, srcRoot, projectRoot);

    // 6c. 主提示词文件
    const promptPath = path.join(projectRoot, adapter.promptPath);
    const promptDir = path.dirname(promptPath);
    if (!fs.existsSync(promptPath)) {
      fs.mkdirSync(promptDir, { recursive: true });
      const formattedPrompt = adapter.formatPrompt(promptWithStack);
      fs.writeFileSync(promptPath, formattedPrompt, 'utf-8');
      log.ok(`${adapter.promptPath} 已创建`);
    } else {
      log.warn(`${adapter.promptPath} 已存在，跳过（update --force 覆盖）`);
    }

    // 6d. Legacy 根目录文件（.cursorrules / .windsurfrules）
    if (adapter.legacyPath && adapter.formatLegacy) {
      const legacyFile = path.join(projectRoot, adapter.legacyPath);
      if (!fs.existsSync(legacyFile)) {
        const legacyContent = adapter.formatLegacy(promptWithStack);
        fs.writeFileSync(legacyFile, legacyContent, 'utf-8');
        log.ok(`${adapter.legacyPath} 已创建（legacy 兼容）`);
      } else {
        log.warn(`${adapter.legacyPath} 已存在，跳过`);
      }
    }
  }

  // 7. 记录使用的工具（多工具用逗号分隔）
  const toolState = targetAdapters.map(a => a.name).join(',');
  fs.writeFileSync(path.join(scDir, TOOL_STATE_FILE), toolState, 'utf-8');

  // 8. Git hook
  installGitHook(projectRoot);

  log.title('安装完成');
  log.info('');
  log.info('接下来：');
  const hasNative = targetAdapters.some(a => a.hasNativeCommands);
  if (hasNative) {
    log.info('  1. 执行 /spec:init（自动加载规范 + 扫描项目 + 报告状态）');
  } else {
    log.info('  1. 对 AI 说："读取 spec_copilot/ 目录下的规范，执行 /spec:init"');
  }
  log.info('  2. 选择或创建 stack-adapters/<你的栈>.md');
  log.info('  3. 填写 rules/domain-rules.md 业务约束（可选）');
  log.info('  4. 开始使用：/spec:propose <你的第一个需求>');
  log.info('');
  log.info('验证安装：npx @alenfitz/spec-copilot doctor');
  if (targetAdapters.length > 1) {
    log.info('');
    log.info(`已安装 ${targetAdapters.length} 个工具适配: ${toolNames}`);
    log.info('运行 spec-copilot sync 可随时同步所有适配器文件');
  }
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
  if (fs.existsSync(path.join(frameworkSrc, 'agents'))) {
    copyDir(path.join(frameworkSrc, 'agents'), path.join(scDir, 'agents'));
  }

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

  // 更新 sub-agent profile
  installAgentsForAdapter(adapter, srcRoot, projectRoot);

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

async function cmdGate(args) {
  const changeName = args[0];
  const phase = args[1];

  if (!changeName || !phase) {
    log.err('用法: npx @alenfitz/spec-copilot gate <变更名> <phase>');
    log.info('phase: apply | smoke | review | test | archive');
    log.info('smoke flags: --headed | --base-url <url> | --backend-url <url> | --no-e2e');
    process.exit(2);
  }

  const validPhases = ['apply', 'smoke', 'review', 'test', 'archive'];
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

  // ── guard 硬拦截：hash 校验 ──
  // 如果被保护文件被修改，gate 直接失败，不再执行后续检查
  try {
    const guard = require('./guard');
    const integrity = guard.onGateCheck(projectRoot);
    if (!integrity.pass) {
      console.log('');
      console.log('🛑 spec-copilot guard 拦截 — 被保护文件完整性校验失败');
      console.log('─'.repeat(50));
      for (const v of integrity.violations) {
        console.log(`  ❌ ${v.file}`);
        console.log(`     ${v.reason}`);
        console.log(`     期望 hash: ${v.expected}  实际: ${v.actual}`);
        console.log('');
      }
      console.log('💡 如需合法修改，人类先运行: spec-copilot guard unlock <文件>');
      console.log('');
      process.exit(1);
    }
  } catch { /* guard 未安装时静默跳过 */ }

  let pass = true;
  const failReasons = [];  // v2.9.0: 收集所有失败原因用于客观评分
  const fail = (msg) => { log.err(msg); pass = false; failReasons.push(msg); };

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

      // ─── 前端治本检查 1：tasks.md 前后端交织 ───
      if (fs.existsSync(tasksPath)) {
        const tasksContent = fs.readFileSync(tasksPath, 'utf-8');
        const specMentionsFE = /前端|页面|组件|\.vue|Vue|React|UI 交互|界面/.test(specContent);
        if (specMentionsFE) {
          try {
            const interleave = checkTaskInterleaving(tasksContent);
            if (!interleave.pass) {
              for (const f of interleave.failures) { fail(f); }
            } else if (interleave.feCount > 0) {
              log.ok(`前后端交织检查：后端 ${interleave.beCount} / 前端 ${interleave.feCount}，最大连续后端 ${interleave.maxConsecutiveBe}（≤ 3）`);
            }
          } catch (e) {
            log.warn(`前后端交织检查跳过：${e.message.split('\n')[0]}`);
          }

          // ─── 前端治本检查 2：前端 task 粒度上限 ───
          try {
            const granularity = checkTaskGranularity(tasksContent);
            if (granularity.oversized.length > 0) {
              const details = granularity.oversized.map(o =>
                `${o.task}（${o.title}）涉及 ${o.vueCount} 个 .vue 文件: ${o.files.join(', ')}${o.vueCount > o.files.length ? ' ...' : ''}`
              ).join('\n   ');
              fail(`前端 task 粒度超标（单 task ≤ ${granularity.maxAllowed} 个 .vue 文件）：\n   ${details}\n   ⚠️ task 粒度过大会导致 context 耗尽、后半段组件降级为骨架`);
            } else {
              log.ok(`前端 task 粒度检查：均在 ${granularity.maxAllowed} 个 .vue 文件以内`);
            }
          } catch (e) {
            log.warn(`前端 task 粒度检查跳过：${e.message.split('\n')[0]}`);
          }
        }
      }
      break;
    }
    case 'smoke': {
      // ─── smoke gate：客观构建验证 + 骨架检测（不依赖 AI 自述） ───

      // 1. 构建验证
      log.info('执行构建验证...');
      try {
        const buildResults = checkBuildable(projectRoot);
        if (buildResults.frontend) {
          if (buildResults.frontend.pass) {
            log.ok(`前端构建成功（${buildResults.frontend.cmd} @ ${buildResults.frontend.dir}）`);
          } else {
            fail(`前端构建失败（${buildResults.frontend.cmd} @ ${buildResults.frontend.dir}）：\n   ${buildResults.frontend.error}`);
          }
        }
        if (buildResults.backend) {
          if (buildResults.backend.pass) {
            log.ok(`后端构建成功（${buildResults.backend.cmd} @ ${buildResults.backend.dir}）`);
          } else {
            fail(`后端构建失败（${buildResults.backend.cmd} @ ${buildResults.backend.dir}）：\n   ${buildResults.backend.error}`);
          }
        }
        if (!buildResults.frontend && !buildResults.backend) {
          log.warn('未检测到可构建项目（无 package.json 或 pom.xml）');
        }
      } catch (e) {
        log.warn(`构建验证跳过：${e.message.split('\n')[0]}`);
      }

      // 2. 骨架组件检测
      try {
        const skeletonResult = detectSkeletonComponents(projectRoot);
        if (skeletonResult.skeletons.length > 0) {
          const details = skeletonResult.skeletons.map(s => `${s.file}: ${s.reason}`).join('\n   ');
          fail(`骨架组件检测命中（${skeletonResult.skeletons.length}/${skeletonResult.total} 个组件为骨架）：\n   ${details}\n   ⚠️ 骨架组件 = 未完成。必须实现真实交互后才能通过 smoke`);
        } else if (skeletonResult.total > 0) {
          log.ok(`骨架组件检测：${skeletonResult.total} 个组件均有实质内容`);
        }
      } catch (e) {
        log.warn(`骨架组件检测跳过：${e.message.split('\n')[0]}`);
      }

      // 3. any 泛滥检测（warning 级别，不阻断）
      try {
        const anyResult = detectAnyAbuse(projectRoot);
        if (anyResult.abusers.length > 0) {
          const details = anyResult.abusers.slice(0, 8).map(a =>
            `${a.file}: ${a.anyCount} 处 any / ${a.lineCount} 行（${a.ratio}%）`
          ).join('\n   ');
          log.warn(`TypeScript any 泛滥警告（全局 ${anyResult.totalAnys} 处 / ${anyResult.totalLines} 行 = ${anyResult.globalRatio}%）：\n   ${details}`);
        } else if (anyResult.totalLines > 0) {
          log.ok(`TypeScript any 检测：${anyResult.totalAnys} 处 / ${anyResult.totalLines} 行 = ${anyResult.globalRatio}%`);
        }
      } catch (e) {
        log.warn(`any 泛滥检测跳过：${e.message.split('\n')[0]}`);
      }

      // 3.5 前后端契约一致性（强阻断）
      try {
        const contractResult = checkContractConsistency(projectRoot);
        if (!contractResult.pass) {
          const details = contractResult.mismatches.map(item => {
            const issues = [];
            if (item.missingOnFe.length > 0) issues.push(`前端缺少必填字段 [${item.missingOnFe.join(', ')}]`);
            if (item.nonSnakeFe.length > 0) issues.push(`前端非 snake_case [${item.nonSnakeFe.join(', ')}]`);
            if (item.nonSnakeBe.length > 0) issues.push(`后端非 snake_case [${item.nonSnakeBe.join(', ')}]`);
            return `${item.method} ${item.path} :: ${item.frontFile}#${item.frontFn} ↔ ${item.backFile}#${item.backFn} — ${issues.join(' / ')}`;
          }).join('\n   ');
          fail(`前后端契约一致性检查失败（${contractResult.mismatches.length}/${contractResult.checked} 个 API 不一致）：\n   ${details}`);
        } else if (contractResult.checked > 0) {
          log.ok(`前后端契约一致性：${contractResult.checked} 个 API 检查通过`);
        }
      } catch (e) {
        log.warn(`前后端契约一致性检查跳过：${e.message.split('\n')[0]}`);
      }

      // 3.6 硬编码业务身份检测（强阻断）
      try {
        const identityResult = checkHardcodedIdentities(projectRoot);
        if (!identityResult.pass) {
          const details = identityResult.violations
            .slice(0, 15)
            .map(v => `${v.file}:${v.line} ${v.detail} — ${v.snippet}`)
            .join('\n   ');
          fail(`硬编码业务身份检测命中（${identityResult.violations.length} 项）：\n   ${details}\n   ⚠️ 当前登录人/业务身份必须由调用方或状态管理提供，不能在页面中写死`);
        } else {
          log.ok('硬编码业务身份检测：clean');
        }
      } catch (e) {
        log.warn(`硬编码业务身份检测跳过：${e.message.split('\n')[0]}`);
      }

      // 4. E2E 浏览器冒烟（可选，需目标项目安装 Playwright）
      if (!args.includes('--no-e2e')) {
        try {
          const { runE2ESmoke } = require('./e2e-smoke');
          const e2eOpts = {
            timeout: 30000,
            headed: args.includes('--headed'),
          };
          // 解析 --base-url / --backend-url
          const baseUrlIdx = args.indexOf('--base-url');
          if (baseUrlIdx !== -1 && args[baseUrlIdx + 1]) e2eOpts.baseUrl = args[baseUrlIdx + 1];
          const beUrlIdx = args.indexOf('--backend-url');
          if (beUrlIdx !== -1 && args[beUrlIdx + 1]) e2eOpts.backendUrl = args[beUrlIdx + 1];

          log.info('执行 E2E 浏览器冒烟...');
          const e2eResult = await runE2ESmoke(projectRoot, specContent, e2eOpts);

          if (!e2eResult.available) {
            log.warn(`E2E 浏览器冒烟跳过：${e2eResult.skipReason}`);
            if (e2eResult.installHint) log.info(`  ${e2eResult.installHint}`);
          } else if (e2eResult.startupError) {
            fail(`E2E 服务器启动失败：${e2eResult.startupError}`);
          } else if (e2eResult.skipReason) {
            log.warn(`E2E 浏览器冒烟跳过：${e2eResult.skipReason}`);
          } else if (e2eResult.pass) {
            const s = e2eResult.summary;
            log.ok(`E2E 浏览器冒烟通过（${s.passedPages}/${s.totalPages} 页面${s.totalApis > 0 ? ` / ${s.passedApis}/${s.totalApis} API` : ''}）`);
            // v2.7.0: 显示 API 交互摘要
            if (e2eResult.apiInteractionSummary && e2eResult.apiInteractionSummary.total > 0) {
              const ai = e2eResult.apiInteractionSummary;
              log.info(`  API 交互: ${ai.total} 请求（${ai.ok} 正常${ai.client4xx ? ` / ${ai.client4xx} 4xx` : ''}${ai.server5xx ? ` / ${ai.server5xx} 5xx` : ''}${ai.nonJson ? ` / ${ai.nonJson} 非JSON` : ''}）`);
            }
            // v2.8.0: 显示交互测试摘要
            if (e2eResult.interactionSummary && e2eResult.interactionSummary.totalInteractions > 0) {
              const is = e2eResult.interactionSummary;
              const tested = [];
              if (is.searchTested) tested.push('搜索');
              if (is.paginationTested) tested.push('分页');
              log.ok(`  交互测试: ${is.totalInteractions} 项交互${tested.length ? `（${tested.join('、')}）` : ''}${is.failures ? ` / ${is.failures} 项失败` : ''}`);
            }
            // v3.0.0: 显示 API Schema 校验结果
            if (e2eResult.schemaViolations && e2eResult.schemaViolations.length > 0) {
              for (const v of e2eResult.schemaViolations) {
                log.warn(`  API Schema 不匹配 ${v.api}: 缺少字段 [${v.missing.join(', ')}]`);
              }
            }
            // v3.0.0: 显示截图变化
            if (e2eResult.screenshotChanges && e2eResult.screenshotChanges.length > 0) {
              for (const sc of e2eResult.screenshotChanges) {
                log.warn(`  UI 变化 ${sc.route}: ${sc.detail}`);
              }
            }
            if (e2eResult.servers.alreadyRunning) {
              log.info('  使用已运行的开发服务器');
            }
            // 显示 warnings
            for (const page of e2eResult.pages) {
              if (page.warnings && page.warnings.length > 0) {
                for (const w of page.warnings) {
                  log.warn(`  ${page.route}: ${w}`);
                }
              }
            }
          } else {
            const failedPages = e2eResult.pages.filter(p => !p.pass);
            const failedApis = (e2eResult.apiResults || []).filter(a => !a.pass && (a.status === 0 || a.status >= 500));
            const details = [];
            for (const p of failedPages) {
              details.push(`${p.route} (${p.specRef}): ${p.failures.join('; ')}`);
            }
            for (const a of failedApis) {
              details.push(`API ${a.method} ${a.path}: ${a.error || 'HTTP ' + a.status}`);
            }
            // v2.7.0: 显示 API 交互摘要
            if (e2eResult.apiInteractionSummary && e2eResult.apiInteractionSummary.total > 0) {
              const ai = e2eResult.apiInteractionSummary;
              details.push(`── API 交互摘要: ${ai.total} 请求（${ai.ok} 正常 / ${ai.client4xx} 4xx / ${ai.server5xx} 5xx / ${ai.nonJson} 非JSON / ${ai.failed} 连接失败）`);
            }
            fail(`E2E 浏览器冒烟失败（${failedPages.length} 页面异常${failedApis.length > 0 ? ` / ${failedApis.length} API 失败` : ''}）：\n   ${details.slice(0, 18).join('\n   ')}${details.length > 18 ? `\n   ... 还有 ${details.length - 18} 项` : ''}`);
          }
        } catch (e) {
          log.warn(`E2E 浏览器冒烟跳过：${e.message.split('\n')[0]}`);
        }
      } else {
        log.info('E2E 浏览器冒烟已通过 --no-e2e 跳过');
      }

      break;
    }
    case 'review': {
      // ─── smoke gate 哨兵检查（v2.2.0）───
      const smokeSentinel = path.join(changeDir, '.gate-smoke-passed');
      if (fs.existsSync(smokeSentinel)) {
        try {
          const smokeData = JSON.parse(fs.readFileSync(smokeSentinel, 'utf-8'));
          const ageMin = Math.round((Date.now() - smokeData.timestamp) / 60000);
          log.ok(`smoke gate 哨兵有效（${ageMin} 分钟前通过）`);
        } catch {
          log.ok('smoke gate 哨兵有效');
        }
      } else {
        log.warn('未检测到 smoke gate 哨兵（.gate-smoke-passed）— 建议先运行 `gate <name> smoke`');
      }

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
        const pendingTasks = tasksContent.match(/状态[：:]\s*(待完成|未完成|进行中|todo|wip)/gi) || [];
        if (pendingTasks.length > 0) {
          fail(`tasks.md 中有 ${pendingTasks.length} 个未完成 task`);
        }
      }

      // ─── 程序化覆盖率检查：spec 功能点 → 代码实现（加权：前+后端均有 = 1 分；仅后端 = 0.5；仅前端 = 0.5；都无 = 0） ───
      const featurePointIds = [...new Set(specContent.match(/F\d{2,}/g) || [])];
      // 简化的前后端文件分类
      const isFrontendFile = (f) =>
        /\.(vue|tsx|jsx)$/.test(f) ||
        (/\.(ts|js|css|scss|less)$/.test(f) && /(src|app|pages|views|components)\//.test(f));
      const isBackendFile = (f) =>
        /\.(java|kt|py|go|rb|cs|php)$/.test(f);

      let featureMatched = 0; // 用于校准差检测时复用
      if (featurePointIds.length > 0) {
        const isGitRepo = (() => {
          try {
            execSync('git rev-parse --is-inside-work-tree', { cwd: projectRoot, stdio: 'ignore' });
            return true;
          } catch { return false; }
        })();

        const specMentionsFE = /前端|页面|组件|\.vue|Vue|React|UI 交互|界面/.test(specContent);
        let weightedScore = 0;
        const fullHits = [];      // 前后端都命中
        const beOnlyHits = [];    // 仅后端命中
        const feOnlyHits = [];    // 仅前端命中
        const missing = [];

        for (const fpId of featurePointIds) {
          let beHit = false, feHit = false;
          if (isGitRepo) {
            try {
              const result = execSync(`git grep -l -- "${fpId}"`, {
                cwd: projectRoot, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore']
              }).trim();
              const codeMatches = result.split('\n').filter(f =>
                f && !f.startsWith('spec_copilot/') && !f.includes('.md')
              );
              beHit = codeMatches.some(isBackendFile);
              feHit = codeMatches.some(isFrontendFile);
            } catch {}
          }
          if (beHit && feHit) { weightedScore += 1; fullHits.push(fpId); featureMatched++; }
          else if (beHit)     { weightedScore += specMentionsFE ? 0.5 : 1; beOnlyHits.push(fpId); featureMatched++; }
          else if (feHit)     { weightedScore += 0.5; feOnlyHits.push(fpId); featureMatched++; }
          else                { missing.push(fpId); }
        }

        const rawCoverage = (featureMatched / featurePointIds.length * 100).toFixed(1);
        const weightedCoverage = (weightedScore / featurePointIds.length * 100).toFixed(1);

        if (!isGitRepo) {
          log.warn(`非 git 仓库，跳过功能点覆盖率检查（spec 含 ${featurePointIds.length} 个功能点）`);
        } else if (weightedCoverage < 80) {
          const detail = [
            `前+后端均命中 ${fullHits.length}`,
            `仅后端 ${beOnlyHits.length}`,
            `仅前端 ${feOnlyHits.length}`,
            `未命中 ${missing.length}`,
          ].join(' / ');
          fail(`加权功能点覆盖率 ${weightedCoverage}% (raw ${rawCoverage}%) — 低于 80% 红线\n   ${detail}\n   未命中：${missing.slice(0, 10).join(', ')}${missing.length > 10 ? ' ...' : ''}${specMentionsFE && beOnlyHits.length > 0 ? `\n   ⚠️ 仅后端命中：${beOnlyHits.slice(0, 10).join(', ')}${beOnlyHits.length > 10 ? ' ...' : ''}（spec 提及前端，每项扣 0.5 分）` : ''}`);
        } else {
          log.ok(`加权功能点覆盖率 ${weightedCoverage}% (raw ${rawCoverage}%): 前+后端 ${fullHits.length} / 仅后端 ${beOnlyHits.length} / 仅前端 ${feOnlyHits.length} / 未命中 ${missing.length}`);
        }
      }

      // ─── 反"太嗨"机制 6：前端死代码检测（文件存在但无引用） ───
      // 针对"创建 5 个票模板但 index.vue hardcode 一种"这类场景：
      // 扫描 src/views 和 src/components 下的 .vue / .tsx / .jsx 文件，
      // 用 git grep 检查是否在任何其它文件里被 import 或在路由中引用
      try {
        const feRoots = ['app/src', 'src'].filter(r => fs.existsSync(path.join(projectRoot, r)));
        if (feRoots.length > 0) {
          const candidates = [];
          for (const root of feRoots) {
            const walk = (dir) => {
              if (!fs.existsSync(dir)) return;
              for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
                const full = path.join(dir, f.name);
                if (f.isDirectory()) {
                  if (!/node_modules|dist|\.git/.test(f.name)) walk(full);
                } else if (/\.(vue|tsx|jsx)$/.test(f.name)) {
                  // 排除入口文件（main / index / app / router 一律不查）
                  if (!/^(main|index|App|router)\.(vue|tsx|jsx)$/i.test(f.name)) {
                    candidates.push(path.relative(projectRoot, full));
                  }
                }
              }
            };
            walk(path.join(projectRoot, root));
          }

          const deadFiles = [];
          for (const file of candidates) {
            const baseName = path.basename(file).replace(/\.(vue|tsx|jsx)$/, '');
            // grep 整个项目找 import / from 引用，排除自身
            try {
              const result = execSync(
                `git grep -l "${baseName}" -- ':!${file}' ':!spec_copilot/*' ':!*.md'`,
                { cwd: projectRoot, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] }
              ).trim();
              const refs = result.split('\n').filter(Boolean);
              if (refs.length === 0) {
                deadFiles.push(file);
              }
            } catch {
              // git grep 无命中会 exit 1，视为死文件
              deadFiles.push(file);
            }
          }

          if (deadFiles.length > 0) {
            fail(`前端死代码检测命中（文件存在但从未被 import）：\n   ${deadFiles.slice(0, 15).join('\n   ')}${deadFiles.length > 15 ? `\n   ... 还有 ${deadFiles.length - 15} 个` : ''}\n   ⚠️ 这些组件不会出现在任何用户路径上 = 等同未实现`);
          } else if (candidates.length > 0) {
            log.ok(`前端死代码检测：${candidates.length} 个组件均被引用`);
          }
        }
      } catch (e) {
        log.warn(`前端死代码检测跳过：${e.message.split('\n')[0]}`);
      }

      // ─── 反"太嗨"机制 7：前端严格检查（v2.1.0） ───
      // 拦"前端骨架级糊弄"的系统性问题：
      //   1. stub handler（@click 后接空函数/TODO/alert）
      //   2. 路由覆盖（src/views 下的 .vue 必须在 router 配置中出现）
      //   3. dialog 挂载（XxxDialog.vue 必须在某父组件里实例化）
      //   4. API 覆盖（spec §6 声明的 API 路径必须在前端 src/api/ 中出现）
      try {
        const feRoots = ['app/src', 'src'].filter(r => fs.existsSync(path.join(projectRoot, r)));
        if (feRoots.length > 0) {
          const feFailures = [];

          // 4.1 stub handler 检测
          for (const root of feRoots) {
            const vueFiles = [];
            const walk = (dir) => {
              if (!fs.existsSync(dir)) return;
              for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
                const full = path.join(dir, f.name);
                if (f.isDirectory()) {
                  if (!/node_modules|dist|\.git/.test(f.name)) walk(full);
                } else if (/\.(vue|tsx|jsx)$/.test(f.name)) {
                  vueFiles.push(full);
                }
              }
            };
            walk(path.join(projectRoot, root));

            for (const file of vueFiles) {
              const content = fs.readFileSync(file, 'utf-8');
              // @click="handlerName" 后查 handlerName 是否是空体/TODO/alert
              const handlerMatches = [...content.matchAll(/@click(?:\.[a-z]+)?\s*=\s*["']([a-zA-Z_$][\w$]*)["']/g)];
              const handlerNames = [...new Set(handlerMatches.map(m => m[1]))];
              for (const hn of handlerNames) {
                // 找 const hn = (...) => { body } 或 function hn(...){ body } 或 method hn(){ body }
                const fnRegex = new RegExp(
                  `(?:const\\s+${hn}\\s*=\\s*(?:async\\s+)?\\([^)]*\\)\\s*=>\\s*\\{([\\s\\S]*?)\\}` +
                  `|function\\s+${hn}\\s*\\([^)]*\\)\\s*\\{([\\s\\S]*?)\\}` +
                  `|\\b${hn}\\s*\\([^)]*\\)\\s*\\{([\\s\\S]*?)\\})`
                );
                const fm = content.match(fnRegex);
                if (fm) {
                  const body = (fm[1] || fm[2] || fm[3] || '').trim();
                  const isStub =
                    body.length < 3 ||                          // 空体或几乎空
                    /^\/[\/*]\s*TODO/i.test(body) ||             // 仅 TODO 注释
                    /^console\.log\([^)]*\)\s*;?\s*$/.test(body) ||  // 仅 console.log
                    /^alert\([^)]*\)\s*;?\s*$/.test(body) ||      // 仅 alert
                    /^ElMessage\.(info|warning)\(['"]\s*(未实现|TODO|占位|敬请期待)['"]\)\s*;?\s*$/.test(body);
                  if (isStub) {
                    feFailures.push(`${path.relative(projectRoot, file)}: @click="${hn}" handler 是占位（body: "${body.slice(0, 50)}..."）`);
                  }
                }
              }
            }
          }

          // 4.2 路由覆盖检测
          const routerCandidates = [];
          for (const root of feRoots) {
            for (const name of ['router/index.ts', 'router/index.js', 'router.ts', 'router.js']) {
              const p = path.join(projectRoot, root, name);
              if (fs.existsSync(p)) routerCandidates.push(p);
            }
          }
          if (routerCandidates.length > 0) {
            const routerContent = routerCandidates.map(p => fs.readFileSync(p, 'utf-8')).join('\n');
            // 找 src/views 下的所有 .vue 文件，看其 basename（去 .vue）是否在 router 内被引用
            for (const root of feRoots) {
              const viewsDir = path.join(projectRoot, root, 'views');
              if (!fs.existsSync(viewsDir)) continue;
              const collectViews = (dir, acc = []) => {
                for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
                  const full = path.join(dir, f.name);
                  if (f.isDirectory()) collectViews(full, acc);
                  else if (/\.(vue|tsx|jsx)$/.test(f.name)) acc.push(full);
                }
                return acc;
              };
              const views = collectViews(viewsDir);
              for (const v of views) {
                const rel = path.relative(path.join(projectRoot, root), v).replace(/\\/g, '/');
                const baseName = path.basename(v).replace(/\.(vue|tsx|jsx)$/, '');
                // 在 router 里搜该文件路径片段（去掉 views/）或同名 import
                const stripped = rel.replace(/^views\//, '').replace(/\.(vue|tsx|jsx)$/, '');
                const found =
                  routerContent.includes(stripped) ||
                  routerContent.includes(`/${baseName}`) ||
                  new RegExp(`from\\s+['"][^'"]*${baseName}['"]`).test(routerContent) ||
                  // 排除子组件型 view（被父 view import 的情况）
                  (() => {
                    try {
                      const r = execSync(
                        `git grep -l "${baseName}" -- ':!${path.relative(projectRoot, v)}' ':!spec_copilot/*' ':!*.md'`,
                        { cwd: projectRoot, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] }
                      ).trim();
                      return r.split('\n').filter(Boolean).length > 0;
                    } catch { return false; }
                  })();
                if (!found && !/^(index|App|main)$/i.test(baseName)) {
                  feFailures.push(`${rel}: view 文件未在 router 中声明也未被任何文件引用（无用户路径可达）`);
                }
              }
            }
          }

          // 4.3 Dialog 挂载检测
          for (const root of feRoots) {
            const componentsDirs = [
              path.join(projectRoot, root, 'components'),
              path.join(projectRoot, root, 'components', 'business'),
            ].filter(d => fs.existsSync(d));
            for (const cdir of componentsDirs) {
              const dialogs = fs.readdirSync(cdir).filter(f => /Dialog\.(vue|tsx|jsx)$/.test(f));
              for (const dlg of dialogs) {
                const baseName = dlg.replace(/\.(vue|tsx|jsx)$/, '');
                // 转 kebab-case 用于 template 实例化检测：<my-dialog 或 <MyDialog
                const kebab = baseName.replace(/([A-Z])/g, (_, c, i) => (i === 0 ? c.toLowerCase() : '-' + c.toLowerCase()));
                try {
                  const r = execSync(
                    `git grep -lE "<${baseName}[ />]|<${kebab}[ />]" -- ':!${path.relative(projectRoot, path.join(cdir, dlg))}' ':!spec_copilot/*' ':!*.md'`,
                    { cwd: projectRoot, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] }
                  ).trim();
                  if (!r) {
                    feFailures.push(`${path.relative(projectRoot, path.join(cdir, dlg))}: Dialog 未在任何父组件中实例化（即使 import 也不算挂载）`);
                  }
                } catch {
                  feFailures.push(`${path.relative(projectRoot, path.join(cdir, dlg))}: Dialog 未在任何父组件中实例化`);
                }
              }
            }
          }

          // 4.4 API 覆盖检测（spec §6 声明的路径是否在前端 src/api/ 中出现）
          const apiPaths = [...new Set((specContent.match(/\/api\/[a-zA-Z][\w\-\/{}]*/g) || []))];
          if (apiPaths.length > 0) {
            for (const root of feRoots) {
              const apiDir = path.join(projectRoot, root, 'api');
              if (!fs.existsSync(apiDir)) {
                feFailures.push(`${root}/api/ 目录不存在 — spec 声明 ${apiPaths.length} 个 API 路径但前端无 API 层`);
                continue;
              }
              const apiContent = fs.readdirSync(apiDir)
                .filter(f => /\.(ts|js)$/.test(f))
                .map(f => fs.readFileSync(path.join(apiDir, f), 'utf-8'))
                .join('\n');
              const missingApis = [];
              for (const ap of apiPaths) {
                // 用 path 前缀做匹配（如 /api/work-ticket/list 也匹配 work-ticket/list）
                const stem = ap.replace(/^\/api\//, '').replace(/\{[^}]+\}/g, '');
                if (!apiContent.includes(stem) && !apiContent.includes(ap)) {
                  missingApis.push(ap);
                }
              }
              if (missingApis.length > 0) {
                feFailures.push(`${root}/api/ 缺失 ${missingApis.length} 个 API 调用：${missingApis.slice(0, 8).join(', ')}${missingApis.length > 8 ? ' ...' : ''}`);
              }
            }
          }

          if (feFailures.length > 0) {
            fail(`前端严格检查命中（${feFailures.length} 项）：\n   ${feFailures.slice(0, 20).join('\n   ')}${feFailures.length > 20 ? `\n   ... 还有 ${feFailures.length - 20} 项` : ''}`);
          } else {
            log.ok('前端严格检查：clean（无 stub handler / 路由覆盖完整 / dialog 挂载完整 / API 全覆盖）');
          }
        }
      } catch (e) {
        log.warn(`前端严格检查跳过：${e.message.split('\n')[0]}`);
      }

      // ─── 反"太嗨"机制 8：骨架组件检测（v2.2.0） ───
      // 拦截"文件存在、被引用、但内容是空壳"的组件 —— 现有 stub/死代码检测的盲区
      try {
        const skeletonResult = detectSkeletonComponents(projectRoot);
        if (skeletonResult.skeletons.length > 0) {
          const details = skeletonResult.skeletons.map(s => `${s.file}: ${s.reason}`).join('\n   ');
          fail(`骨架组件检测命中（${skeletonResult.skeletons.length}/${skeletonResult.total} 个组件为骨架）：\n   ${details}\n   ⚠️ 骨架组件被引用但无实质内容 = 用户可达但不可用`);
        } else if (skeletonResult.total > 0) {
          log.ok(`骨架组件检测：${skeletonResult.total} 个组件均有实质内容`);
        }
      } catch (e) {
        log.warn(`骨架组件检测跳过：${e.message.split('\n')[0]}`);
      }

      // ─── 前端 task 功能性自证检测（v2.2.0） ───
      if (fs.existsSync(tasksPath)) {
        try {
          const tasksContentForEvidence = fs.readFileSync(tasksPath, 'utf-8');
          const evidenceResult = checkFrontendEvidence(tasksContentForEvidence);
          if (evidenceResult.failures.length > 0) {
            fail(`前端 task 功能性自证缺失：\n   ${evidenceResult.failures.join('\n   ')}\n   ⚠️ 前端 task 必须包含构建验证输出 + 用户操作路径描述`);
          } else {
            log.ok('前端 task 功能性自证：完整');
          }
        } catch (e) {
          log.warn(`前端功能性自证检测跳过：${e.message.split('\n')[0]}`);
        }
      }

      // ─── 前后端工作量均衡检查 ───
      const specMentionsFrontend = /前端|页面|组件|\.vue|Vue|React|UI 交互|界面/.test(specContent);
      if (specMentionsFrontend) {
        try {
          // 优先用 feature 分支与 main 的差异；失败则退化为已 staged + committed 文件
          let diffOutput = '';
          try {
            diffOutput = execSync('git diff --name-only main...HEAD', {
              cwd: projectRoot, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore']
            }).trim();
          } catch {
            try {
              diffOutput = execSync('git diff --name-only master...HEAD', {
                cwd: projectRoot, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore']
              }).trim();
            } catch { diffOutput = ''; }
          }

          if (diffOutput) {
            const files = diffOutput.split('\n').filter(f => f && !f.startsWith('spec_copilot/'));
            const isBackend = (f) =>
              /\.(java|kt|py|go|rb|cs|php)$/.test(f) && !/test/i.test(f);
            const isFrontend = (f) =>
              /\.(vue|tsx|jsx)$/.test(f) ||
              (/\.(ts|js|css|scss|less)$/.test(f) && /(src|app|pages|views|components)\//.test(f));

            const beCount = files.filter(isBackend).length;
            const feCount = files.filter(isFrontend).length;

            if (beCount > 0 && feCount === 0) {
              fail(`spec 提及前端，但本次变更前端文件数为 0（后端 ${beCount} 文件）— 前端不得缺席`);
            } else if (beCount > 0 && feCount > 0) {
              const ratio = beCount / feCount;
              if (ratio > 3) {
                fail(`前后端文件数失衡：后端 ${beCount}，前端 ${feCount}（比 ${ratio.toFixed(1)}:1，超过 3:1 红线）— 前端实现严重不足`);
              } else {
                log.ok(`前后端文件数比 ${beCount}:${feCount}（在 3:1 内）`);
              }
            }
          }
        } catch (e) {
          log.warn(`前后端比例检查跳过：${e.message.split('\n')[0]}`);
        }
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

      // Check: tasks.md change summary should be filled (只截取到下一个 ## 标题，避免把其它段落算进来)
      if (fs.existsSync(tasksPath)) {
        const tasksContent = fs.readFileSync(tasksPath, 'utf-8');
        // 用 multiline + 非贪婪 + lookahead 截到下一个 ## 标题或 EOF
        const summaryMatch = tasksContent.match(/##\s*变更摘要([\s\S]*?)(?=^##\s|\Z)/m);
        if (summaryMatch) {
          let body = summaryMatch[1];
          // 剥掉 markdown 噪音（提示块、引用、空白、装饰符）
          body = body
            .replace(/^\s*>[^\n]*$/gm, '')      // 引用行 (> ⚠️ 提示)
            .replace(/[-\s|>*⚠️/_]/g, '')       // 装饰符
            .replace(/[:：]/g, '');             // 单独冒号
          if (body.length < 20) {
            fail('tasks.md 变更摘要未填写 — apply 完成后必须填写');
          } else {
            log.ok('tasks.md 变更摘要已填写');
          }
        }
      }

      // ─── 反"太嗨"机制 1：嗨语言检测 ───
      const HYPE_WORDS = [
        '基本完成', '大部分', '核心已实现', '完美', '圆满', '非常好',
        '整体可用', '初步可用', '差不多', '一气呵成', '大功告成', '基本可用'
      ];
      const filesToScan = [
        { path: specPath, name: 'spec.md' },
        { path: tasksPath, name: 'tasks.md' },
        { path: logPath, name: 'log.md' }
      ];
      const hypeHits = [];
      for (const f of filesToScan) {
        if (!fs.existsSync(f.path)) continue;
        const content = fs.readFileSync(f.path, 'utf-8');
        for (const word of HYPE_WORDS) {
          // 跳过 AGENTS 自身列出禁用词的语境（如出现在"禁用"/"禁止"附近）
          const regex = new RegExp(`(?<!禁用[^\\n]{0,20}|禁止[^\\n]{0,20}|✗[^\\n]{0,40})${word}`, 'g');
          const matches = content.match(regex);
          if (matches) {
            hypeHits.push(`${f.name}: "${word}" × ${matches.length}`);
          }
        }
      }
      if (hypeHits.length > 0) {
        fail(`嗨语言检测命中（必须改写为可量化表述）：\n   ${hypeHits.join('\n   ')}`);
      } else {
        log.ok('嗨语言检测：clean');
      }

      // ─── 反"太嗨"机制 1.5：高分比例自夸检测 ───
      // 形如 "22/23 功能点已实现"、"已完成 95%" 这类"分子接近分母"声明 ——
      // 必须同时附带"未实现清单"，否则视为夸大。
      const overstatementHits = [];
      for (const f of filesToScan) {
        if (!fs.existsSync(f.path)) continue;
        const content = fs.readFileSync(f.path, 'utf-8');
        // 模式 A：分式 X/Y 后接"已实现/完成/通过"等正向词
        const fracRegex = /(\d+)\s*\/\s*(\d+)\s*(?:个)?(?:功能点|项|条|任务|test|用例)?\s*(?:已)?(?:实现|完成|通过|落地)/g;
        let m;
        while ((m = fracRegex.exec(content)) !== null) {
          const num = parseInt(m[1], 10);
          const den = parseInt(m[2], 10);
          if (den >= 5 && num / den >= 0.9 && num < den) {
            // 分子接近分母（>= 90% 且 != 100%），必须在附近 200 字内提到"未实现"
            const ctx = content.slice(Math.max(0, m.index - 100), Math.min(content.length, m.index + m[0].length + 200));
            if (!/未实现|缺失|未做|skipped|TODO|占位/i.test(ctx)) {
              overstatementHits.push(`${f.name}: "${m[0].trim()}" 未列出未实现清单（声称 ${num}/${den} 完成，剩余 ${den - num} 项需明确说明哪些没做）`);
            }
          }
          // 100% 完成声明也要求附带"实现位置"或"无遗漏"标记
          if (den >= 10 && num === den) {
            const ctx = content.slice(Math.max(0, m.index - 100), Math.min(content.length, m.index + m[0].length + 200));
            if (!/见.*\.java|见.*\.vue|见.*\.ts|文件:|行号|无遗漏|完整覆盖/i.test(ctx)) {
              overstatementHits.push(`${f.name}: "${m[0].trim()}" 声称 100% 完成但未给出代码证据（需附"文件:行号"或"无遗漏"声明）`);
            }
          }
        }
        // 模式 B：百分比 >= 90% 的完成声明
        const pctRegex = /(?:覆盖|完成|实现|通过)\s*率?\s*[:：]?\s*(\d+(?:\.\d+)?)\s*%/g;
        while ((m = pctRegex.exec(content)) !== null) {
          const pct = parseFloat(m[1]);
          if (pct >= 90 && pct < 100) {
            const ctx = content.slice(Math.max(0, m.index - 50), Math.min(content.length, m.index + m[0].length + 200));
            if (!/未实现|缺失|未做|TODO/i.test(ctx)) {
              overstatementHits.push(`${f.name}: 声称 ${pct}% 完成但未列出缺失项`);
            }
          }
        }
      }
      if (overstatementHits.length > 0) {
        fail(`高分比例自夸检测（声称接近完成必须列出未完成项）：\n   ${overstatementHits.join('\n   ')}`);
      } else {
        log.ok('高分比例自夸检测：clean');
      }

      // ─── 反"太嗨"机制 2：原始输出粘贴检测 ───
      // 使用固定窗口截取，避免复杂 lookahead 在不同 markdown 层级下漏匹配
      const sliceAfter = (text, marker, len = 800) => {
        const idx = text.indexOf(marker);
        return idx === -1 ? null : text.slice(idx + marker.length, idx + marker.length + len);
      };
      if (fs.existsSync(tasksPath)) {
        const tasksContent = fs.readFileSync(tasksPath, 'utf-8');
        const taskBlocks = tasksContent.split(/(?=^## Task \d+)/m).filter(b => /^## Task \d+/.test(b));
        const evidenceFailures = [];
        for (const block of taskBlocks) {
          const titleMatch = block.match(/^## (Task \d+)/);
          const taskName = titleMatch ? titleMatch[1] : '?';
          const isDone = /状态[：:]\s*(✅|已完成|完成|已交付|done)/i.test(block) || /实际验证结果/.test(block);
          if (!isDone) continue;
          const window = sliceAfter(block, '实际验证结果');
          if (window !== null) {
            const hasRawOutput = /\$\s|>>>\s|HTTP\/[0-9]/.test(window);
            if (!hasRawOutput) {
              evidenceFailures.push(`${taskName}: 实际验证结果未粘贴原始输出（需以 $ / >>> / HTTP/ 开头）`);
            }
          }
        }
        if (evidenceFailures.length > 0) {
          fail(`原始输出粘贴检测失败：\n   ${evidenceFailures.join('\n   ')}`);
        } else if (taskBlocks.length > 0) {
          log.ok(`原始输出粘贴检测：${taskBlocks.length} 个 task 均有原始输出`);
        }
      }

      // ─── 反"太嗨"机制 3：强制负面声明 + 失败场景检测 ───
      if (fs.existsSync(tasksPath)) {
        const tasksContent = fs.readFileSync(tasksPath, 'utf-8');
        const taskBlocks = tasksContent.split(/(?=^## Task \d+)/m).filter(b => /^## Task \d+/.test(b));
        const declarationFailures = [];

        // 字段必填检查函数：找到字段标签后，下一行/段落不能为空
        const checkFieldFilled = (block, fieldName, taskName) => {
          // 匹配 "- **字段名**（...）：内容" 或 "字段名：内容"
          const regex = new RegExp(`${fieldName}[^\\n]*?[：:]\\s*([^\\n]*)`, 'm');
          const m = block.match(regex);
          if (!m) return null; // 字段不存在，跳过（兼容旧模板）
          const val = (m[1] || '').replace(/[（(].*?[)）]/g, '').trim();
          if (val.length < 1) {
            return `${taskName}: "${fieldName}" 字段留空（无内容写"无"）`;
          }
          return null;
        };

        for (const block of taskBlocks) {
          const titleMatch = block.match(/^## (Task \d+)/);
          const taskName = titleMatch ? titleMatch[1] : '?';
          const isDone = /状态[：:]\s*(✅|已完成|完成|已交付|done)/i.test(block) || /实际验证结果/.test(block);
          if (!isDone) continue;

          // 强制负面声明三件套
          for (const field of ['未实现功能点', '已知缺陷', '简化或降级处理', '简化/降级处理']) {
            const err = checkFieldFilled(block, field, taskName);
            if (err) declarationFailures.push(err);
          }

          // 失败场景自我攻击：必须有至少 3 个非空场景
          const scenarioWindow = sliceAfter(block, '失败场景自我攻击', 1500);
          if (scenarioWindow !== null) {
            const scenarios = [...scenarioWindow.matchAll(/失败场景[：:]\s*([^\n]+)/g)]
              .map(m => m[1].replace(/_+/g, '').replace(/[（(].*?[)）]/g, '').trim())
              .filter(s => s.length > 4);
            if (scenarios.length < 3) {
              declarationFailures.push(`${taskName}: 失败场景自我攻击只有 ${scenarios.length} 个有效场景（要求 ≥ 3）`);
            }
          }
        }
        if (declarationFailures.length > 0) {
          fail(`负面声明/失败场景检测失败：\n   ${declarationFailures.join('\n   ')}`);
        } else if (taskBlocks.length > 0) {
          log.ok(`负面声明/失败场景：${taskBlocks.length} 个 task 全部完整`);
        }
      }

      // ─── 反"太嗨"机制 4：校准差检测（自评 vs 实测） ───
      if (fs.existsSync(tasksPath)) {
        const tasksContent = fs.readFileSync(tasksPath, 'utf-8');
        // 提取自评数字
        const selfCoverageMatch = tasksContent.match(/自评功能点覆盖率[：:][\s\S]{0,40}?(\d+)\s*\/\s*(\d+)/);
        const selfBeMatch = tasksContent.match(/自评后端文件数[：:][\s\S]{0,30}?(\d+)/);
        const selfFeMatch = tasksContent.match(/自评前端文件数[：:][\s\S]{0,30}?(\d+)/);

        // 实测：复用前面 grep 出的 featurePointIds 和 featureMatched（加权前的命中数）
        if (selfCoverageMatch && featurePointIds.length > 0) {
          const selfPct = parseInt(selfCoverageMatch[1]) / parseInt(selfCoverageMatch[2]) * 100;
          try {
            const actualPctNum = featureMatched / featurePointIds.length * 100;
            const delta = Math.abs(selfPct - actualPctNum);
            if (delta > 30) {
              fail(`校准差超标：自评覆盖率 ${selfPct.toFixed(1)}%，实测 ${actualPctNum.toFixed(1)}%，偏差 ${delta.toFixed(1)}% > 30% 红线 — 模型自我评估严重失准`);
            } else if (delta > 10) {
              log.warn(`校准差警告：自评 ${selfPct.toFixed(1)}% vs 实测 ${actualPctNum.toFixed(1)}%（偏差 ${delta.toFixed(1)}%）`);
            } else {
              log.ok(`校准差正常：自评 ${selfPct.toFixed(1)}% vs 实测 ${actualPctNum.toFixed(1)}%`);
            }
          } catch {}
        }
      }

      // ─── v2.8.0 独立 Reviewer：代码级 spec-to-code 验证 ───
      try {
        const { runReviewChecks } = require('./review-checks');
        log.info('执行独立 Reviewer 检查...');
        const reviewResult = runReviewChecks(projectRoot, specContent);

        for (const check of reviewResult.checks) {
          if (check.error) {
            log.warn(`${check.name} 跳过：${check.error.split('\n')[0]}`);
            continue;
          }

          if (check.name === 'API 契约校验') {
            if (check.message) {
              log.info(`${check.name}：${check.message}`);
            } else if (check.pass) {
              log.ok(`API 契约校验：${check.total} 个端点前后端均匹配`);
            } else {
              const details = [];
              if (check.feMissing.length > 0) {
                details.push(`前端未调用: ${check.feMissing.slice(0, 5).map(a => `${a.method} ${a.path}`).join(', ')}`);
              }
              if (check.beMissing.length > 0) {
                details.push(`后端未实现: ${check.beMissing.slice(0, 5).map(a => `${a.method} ${a.path}`).join(', ')}`);
              }
              if (check.bothMissing.length > 0) {
                details.push(`前后端均未找到: ${check.bothMissing.slice(0, 5).map(a => `${a.method} ${a.path}`).join(', ')}`);
              }
              fail(`API 契约不匹配（${check.matched}/${check.total} 匹配）：\n   ${details.join('\n   ')}`);
            }
          }

          if (check.name === '前后端契约一致性') {
            if (check.pass) {
              log.ok(`前后端契约一致性：${check.checked} 个 API 检查通过`);
            } else {
              const msgs = check.mismatches.map(item => {
                const parts = [];
                if (item.missingOnFe.length > 0) parts.push(`前端缺少 [${item.missingOnFe.join(', ')}]`);
                if (item.nonSnakeFe.length > 0) parts.push(`前端非 snake_case [${item.nonSnakeFe.join(', ')}]`);
                if (item.nonSnakeBe.length > 0) parts.push(`后端非 snake_case [${item.nonSnakeBe.join(', ')}]`);
                return `${item.method} ${item.path}: ${parts.join(' / ')}`;
              });
              fail(`前后端契约一致性失败：\n   ${msgs.join('\n   ')}`);
            }
          }

          if (check.name === '错误处理审计') {
            if (check.totalApiCalls === 0) {
              log.info('错误处理审计：未检测到前端 API 调用');
            } else {
              const ratio = check.totalApiCalls > 0 ? ((check.noHandling / check.totalApiCalls) * 100).toFixed(0) : 0;
              if (check.noHandling === 0 && check.emptyCatch === 0) {
                log.ok(`错误处理审计：${check.totalApiCalls} 个 API 调用均有错误处理`);
              } else if (ratio > 50) {
                fail(`错误处理缺失严重（${check.noHandling}/${check.totalApiCalls} = ${ratio}% 无 catch）：\n   ${check.violations.slice(0, 5).map(v => `${v.file}:${v.line} — ${v.detail}`).join('\n   ')}`);
              } else {
                log.warn(`错误处理警告（${check.noHandling} 无 catch / ${check.emptyCatch} 空 catch / ${check.totalApiCalls} 总调用）：\n   ${check.violations.slice(0, 3).map(v => `${v.file}:${v.line} — ${v.detail}`).join('\n   ')}`);
              }
            }
          }

          if (check.name === '硬编码数据检测') {
            if (check.suspects && check.suspects.length > 0) {
              log.warn(`硬编码数据警告（${check.suspects.length} 处疑似 mock 数据）：\n   ${check.suspects.slice(0, 5).map(s => `${s.file}:${s.line} — ${s.detail}`).join('\n   ')}`);
            }
          }

          if (check.name === '硬编码业务身份检测') {
            if (!check.pass) {
              const msgs = check.violations.slice(0, 10).map(v => `${v.file}:${v.line} ${v.detail}`);
              fail(`硬编码业务身份检测失败（${check.violations.length} 处）：\n   ${msgs.join('\n   ')}`);
            } else {
              log.ok('硬编码业务身份检测：clean');
            }
          }

          if (check.name === '路由完整性') {
            if (check.message) {
              log.info(`${check.name}：${check.message}`);
            } else if (check.pass) {
              log.ok(`路由完整性：spec 声明的 ${check.total} 个路由均已注册`);
            } else {
              fail(`路由缺失（${check.matched}/${check.total} 匹配）：\n   缺失: ${check.missing.slice(0, 10).join(', ')}`);
            }
          }
        }
      } catch (e) {
        log.warn(`独立 Reviewer 检查跳过：${e.message.split('\n')[0]}`);
      }

      // ─── v3.0.0 对抗性测试（有运行中的后端时自动执行）───
      try {
        const { runAdversarialTests } = require('./adversarial-test');
        // 检测后端是否在运行
        const STACK_PROFILES = require('./e2e-smoke').resolvePlaywright ? null : null; // 不依赖 playwright
        const backendPorts = [8080, 8081, 3000, 3001, 5000];
        let backendUrl = null;

        for (const port of backendPorts) {
          try {
            const net = require('net');
            const isUp = await new Promise((resolve) => {
              const socket = net.createConnection({ port, host: '127.0.0.1' });
              const timer = setTimeout(() => { socket.destroy(); resolve(false); }, 1000);
              socket.on('connect', () => { clearTimeout(timer); socket.destroy(); resolve(true); });
              socket.on('error', () => { clearTimeout(timer); resolve(false); });
            });
            if (isUp) { backendUrl = `http://127.0.0.1:${port}`; break; }
          } catch { /* continue */ }
        }

        if (backendUrl) {
          log.info(`执行对抗性测试（后端: ${backendUrl}）...`);
          const advResult = await runAdversarialTests(backendUrl, specContent);

          if (advResult.message) {
            log.info(`对抗性测试：${advResult.message}`);
          } else if (advResult.pass) {
            log.ok(`对抗性测试通过（${advResult.tested} 项测试 / ${advResult.passed} 通过）`);
          } else {
            const details = advResult.vulnerabilities.slice(0, 5).map(v =>
              `${v.api}: ${v.test} — ${v.detail}`
            ).join('\n   ');
            log.warn(`对抗性测试发现 ${advResult.vulnerabilities.length} 个问题（${advResult.tested} 项测试 / ${advResult.failed} 失败）：\n   ${details}`);
            // 对抗性测试结果为 warning 级别（不阻断 gate，但显著提示）
          }
        } else {
          log.info('对抗性测试跳过（未检测到运行中的后端）');
        }
      } catch (e) {
        log.warn(`对抗性测试跳过：${e.message.split('\n')[0]}`);
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
      // 1. spec §12 必须显式通过（保留原检查）
      if (/结论：通过/.test(specContent)) {
        log.ok('spec.md §12 审查结论为通过');
      } else {
        fail('spec.md §12 审查结论未通过');
      }

      // 2. 必须有 review gate 通过的哨兵文件（防止模型自己写"通过"绕过 review gate）
      const reviewSentinel = path.join(changeDir, '.gate-review-passed');
      if (!fs.existsSync(reviewSentinel)) {
        fail('缺少 .gate-review-passed 哨兵 — 模型不能仅靠在 spec.md §12 写"通过"就 archive，必须实际跑过 `gate <name> review` 且通过');
      } else {
        // 3. 哨兵的 mtime 必须不早于 spec/tasks/log 的最后修改时间（任何后续编辑都会失效）
        const sentinelTime = fs.statSync(reviewSentinel).mtimeMs;
        const stale = [];
        const tolerance = 2000; // 2 秒容差，避免同秒写入误判
        for (const f of [specPath, tasksPath, logPath]) {
          if (!fs.existsSync(f)) continue;
          const ft = fs.statSync(f).mtimeMs;
          if (ft > sentinelTime + tolerance) {
            stale.push(`${path.basename(f)}（晚于 review 通过时间 ${Math.round((ft - sentinelTime) / 1000)} 秒）`);
          }
        }
        if (stale.length > 0) {
          fail(`review 通过后下列文件被修改：${stale.join('，')} — 必须重新运行 \`gate <name> review\``);
        } else {
          // 读取哨兵记录的 review 时间和版本
          try {
            const sentinelData = JSON.parse(fs.readFileSync(reviewSentinel, 'utf-8'));
            const ageMin = Math.round((Date.now() - sentinelData.timestamp) / 60000);
            log.ok(`review gate 哨兵有效（${ageMin} 分钟前通过 / framework v${sentinelData.version}）`);
          } catch {
            log.ok('review gate 哨兵有效');
          }
        }
      }
      break;
    }
  }

  // ─── v2.9.0 客观评分 ───
  // 基于 failReasons 中的关键词，精确计算各维度得分
  if (phase === 'smoke' || phase === 'review') {
    try {
      let scoreItems;

      if (phase === 'smoke') {
        scoreItems = [
          { name: '构建', weight: 15, failPatterns: [/构建失败/] },
          { name: '骨架组件', weight: 15, failPatterns: [/骨架组件/] },
          { name: 'E2E 页面', weight: 20, failPatterns: [/E2E.*失败/, /浏览器冒烟失败/, /白屏/, /框架错误/] },
          { name: 'API 连通', weight: 20, failPatterns: [/API.*失败/, /API.*4xx/, /API.*5xx/, /API.*非.*JSON/, /连接失败/] },
          { name: '交互测试', weight: 15, failPatterns: [/表单提交/, /搜索.*未触发/, /分页.*API.*报错/] },
          { name: '代码质量', weight: 15, failPatterns: [/any.*泛滥/, /TypeScript any/] },
        ];
      } else {
        scoreItems = [
          { name: 'smoke 哨兵', weight: 8, failPatterns: [/smoke.*哨兵/, /冒烟.*通过/] },
          { name: '功能点覆盖', weight: 20, failPatterns: [/覆盖率.*低于/, /功能点覆盖率/] },
          { name: 'API 契约', weight: 20, failPatterns: [/API.*契约/, /前端未调用/, /后端未实现/] },
          { name: '契约一致性', weight: 12, failPatterns: [/契约一致性/, /缺少必填字段/, /snake_case/] },
          { name: '错误处理', weight: 10, failPatterns: [/错误处理缺失/, /无.*catch/] },
          { name: '死代码', weight: 10, failPatterns: [/死代码/, /从未被.*import/] },
          { name: '路由完整', weight: 8, failPatterns: [/路由缺失/] },
          { name: '前端检查', weight: 10, failPatterns: [/stub.*handler/, /dialog.*未挂载/, /API.*覆盖/] },
          { name: '身份来源', weight: 10, failPatterns: [/硬编码业务身份/, /当前登录人.*写死/, /硬编码用户 ID/] },
          { name: '校准差', weight: 10, failPatterns: [/校准差超标/, /自我评估.*失准/] },
        ];
      }

      let totalWeight = 0;
      let earned = 0;
      const breakdown = [];

      for (const item of scoreItems) {
        totalWeight += item.weight;
        const failed = failReasons.some(r => item.failPatterns.some(p => p.test(r)));
        if (!failed) {
          earned += item.weight;
          breakdown.push(`  ✅ ${item.name} (+${item.weight})`);
        } else {
          breakdown.push(`  ❌ ${item.name} (+0/${item.weight})`);
        }
      }

      const objectiveScore = Math.round((earned / totalWeight) * 100);

      console.log('');
      console.log(`📊 客观评分: ${objectiveScore}/100（代码计算，非 AI 自评）`);
      console.log('─'.repeat(40));
      for (const line of breakdown) console.log(line);
      console.log('─'.repeat(40));

      // 从 spec.md 读取 AI 自评分数
      const selfScoreMatch = specContent.match(/完成度[^\d]*?(\d{1,3})\s*[%％分]/);
      const coverageMatch = specContent.match(/(?:自评|评分|得分|score)[^\d]*?(\d{1,3})\s*[%％分]/i);
      const selfScore = selfScoreMatch ? parseInt(selfScoreMatch[1]) : (coverageMatch ? parseInt(coverageMatch[1]) : null);

      if (selfScore !== null) {
        const delta = selfScore - objectiveScore;
        if (delta > 20) {
          log.warn(`AI 自评 ${selfScore} 分 vs 客观 ${objectiveScore} 分 — 偏差 ${delta} 分（自评虚高）`);
          if (delta > 30) {
            fail(`AI 自评与客观评分偏差过大（${selfScore} vs ${objectiveScore}，差 ${delta} > 30 红线）— 自评不可信`);
          }
        } else if (delta < -10) {
          log.info(`AI 自评 ${selfScore} 分 vs 客观 ${objectiveScore} 分 — AI 过于保守`);
        } else {
          log.ok(`AI 自评 ${selfScore} 分 vs 客观 ${objectiveScore} 分 — 校准正常`);
        }
      }

      // 写入哨兵供后续阶段引用
      try {
        const scorePath = path.join(changeDir, `.gate-${phase}-score.json`);
        fs.writeFileSync(scorePath, JSON.stringify({
          phase, objectiveScore, selfScore, timestamp: Date.now(),
          breakdown: scoreItems.map(s => ({
            name: s.name, weight: s.weight,
            passed: !failReasons.some(r => s.failPatterns.some(p => p.test(r))),
          })),
        }, null, 2) + '\n');
      } catch { /* 写入失败不影响 */ }
    } catch (e) {
      // 评分异常不影响 gate 结果
    }
  }

  console.log('');
  if (pass) {
    // 成功通过 smoke/review gate → 写哨兵
    if (phase === 'smoke' || phase === 'review') {
      try {
        const sentinelName = phase === 'smoke' ? '.gate-smoke-passed' : '.gate-review-passed';
        const sentinelPath = path.join(changeDir, sentinelName);
        fs.writeFileSync(sentinelPath, JSON.stringify({
          timestamp: Date.now(),
          version: readVersion(),
        }, null, 2) + '\n');
      } catch (e) {
        log.warn(`写入 ${phase} 哨兵失败：${e.message}`);
      }
    }
    // guard 集成：gate 通过后自动锁定 spec.md
    try {
      const guard = require('./guard');
      guard.onGatePassed(projectRoot, changeName, phase);
    } catch { /* guard 未安装时静默跳过 */ }

    log.ok(`Gate 通过 ✓ — 可以进入 ${phase} 阶段`);
    process.exit(0);
  } else {
    // gate 失败 → 清除可能存在的旧哨兵
    if (phase === 'smoke' || phase === 'review') {
      const sentinelName = phase === 'smoke' ? '.gate-smoke-passed' : '.gate-review-passed';
      const sentinelPath = path.join(changeDir, sentinelName);
      if (fs.existsSync(sentinelPath)) {
        try { fs.unlinkSync(sentinelPath); } catch {}
      }
    }
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

// ─── Agents ─────────────────────────────────────────────────

/**
 * 列出当前项目可用的 agent profile，并提示宿主是否支持 sub-agent
 *
 * 用法：
 *   npx @alenfitz/spec-copilot agents [list]
 *   npx @alenfitz/spec-copilot agents show <name>
 */
function cmdAgents(args) {
  const sub = args[0] || 'list';
  const projectRoot = findProjectRoot();
  const agentsDir = path.join(projectRoot, 'spec_copilot', 'agents');

  // install 子命令：单独安装/刷新宿主的 sub-agent 文件
  if (sub === 'install') {
    const adapter = resolveAdapter(args.slice(1), projectRoot);
    if (!adapter) {
      log.err('无法确定宿主工具，请用 --tool 指定');
      process.exit(1);
    }
    if (!adapter.agentsDir || typeof adapter.formatAgent !== 'function') {
      log.warn(`宿主 ${adapter.name} 不支持 sub-agent —— 跳过安装`);
      log.info('  其它宿主使用降级模式：主 agent Read spec_copilot/agents/*.md 扮演角色');
      return;
    }
    log.title(`刷新 ${adapter.displayName} sub-agent`);
    installAgentsForAdapter(adapter, pkgRoot(), projectRoot);
    log.ok('完成');
    return;
  }

  if (!fs.existsSync(agentsDir)) {
    log.warn('spec_copilot/agents/ 目录不存在 — 请运行 update 拉取 v2.0.0 内置 agent');
    log.info('运行：npx @alenfitz/spec-copilot update --force');
    process.exit(1);
  }

  if (sub === 'list') {
    log.title('内置 Agent Profiles');
    const files = fs.readdirSync(agentsDir).filter(f => f.endsWith('.md') && f !== 'README.md');
    for (const f of files) {
      const content = fs.readFileSync(path.join(agentsDir, f), 'utf-8');
      const nameMatch = content.match(/^name:\s*(.+)$/m);
      const roleMatch = content.match(/^role:\s*(.+)$/m);
      const whenMatch = content.match(/^when_to_use:\s*(.+)$/m);
      const needsSub = /needs_subagent:\s*true/.test(content);
      console.log(`  ${needsSub ? '🔒' : '  '} ${nameMatch ? nameMatch[1] : f}`);
      if (roleMatch) console.log(`     角色: ${roleMatch[1]}`);
      if (whenMatch) console.log(`     触发: ${whenMatch[1]}`);
      console.log('');
    }
    console.log('🔒 标记表示推荐使用 sub-agent 独立执行');
    console.log('使用 `npx @alenfitz/spec-copilot agents show <name>` 查看完整 profile');
  } else if (sub === 'help' || sub === '--help') {
    console.log(`
agents 子命令：
  list                查看内置 Agent Profile
  show <name>         查看完整 profile 内容
  install [--tool X]  单独刷新宿主的 sub-agent 文件（不动其它文件）
`);
  } else if (sub === 'show') {
    const name = args[1];
    if (!name) {
      log.err('用法: npx @alenfitz/spec-copilot agents show <name>');
      process.exit(2);
    }
    const file = path.join(agentsDir, `${name}.md`);
    if (!fs.existsSync(file)) {
      log.err(`未找到 agent profile: ${name}`);
      log.info(`已安装的 profile: ${fs.readdirSync(agentsDir).filter(f => f.endsWith('.md') && f !== 'README.md').map(f => f.replace('.md', '')).join(', ')}`);
      process.exit(1);
    }
    process.stdout.write(fs.readFileSync(file, 'utf-8'));
  } else {
    log.err(`未知子命令: ${sub}（可用: list / show）`);
    process.exit(2);
  }
}

/** 检测当前宿主是否支持 sub-agent 调度（基于 adapter 声明的 supportsSubagent） */
function detectSubagentSupport(projectRoot) {
  const stateFile = path.join(projectRoot, 'spec_copilot', TOOL_STATE_FILE);
  let tool = 'unknown';
  if (fs.existsSync(stateFile)) {
    tool = fs.readFileSync(stateFile, 'utf-8').trim();
  }
  const adapter = adapters[tool];
  return {
    tool,
    supportsSubagent: !!(adapter && adapter.supportsSubagent),
    agentsDir: adapter && adapter.agentsDir,
  };
}

/** 列出 framework/agents/ 内本框架自带的 profile 文件名（不含扩展名，不含 README） */
function listFrameworkAgentNames() {
  const srcAgentsDir = path.join(pkgRoot(), 'framework', 'agents');
  if (!fs.existsSync(srcAgentsDir)) return [];
  return fs.readdirSync(srcAgentsDir)
    .filter(f => f.endsWith('.md') && f !== 'README.md')
    .map(f => f.replace(/\.md$/, ''));
}

/**
 * 把 framework/agents/*.md 转成宿主专属 sub-agent 文件
 * 只对声明 agentsDir + formatAgent 的 adapter 生效（claude-code / opencode）
 */
function installAgentsForAdapter(adapter, srcRoot, projectRoot) {
  if (!adapter.agentsDir || typeof adapter.formatAgent !== 'function') return;

  const srcAgentsDir = path.join(srcRoot, 'framework', 'agents');
  if (!fs.existsSync(srcAgentsDir)) return;

  const destDir = path.join(projectRoot, adapter.agentsDir);
  fs.mkdirSync(destDir, { recursive: true });

  const profiles = fs.readdirSync(srcAgentsDir).filter(f => f.endsWith('.md') && f !== 'README.md');
  let installed = 0;
  for (const f of profiles) {
    const content = fs.readFileSync(path.join(srcAgentsDir, f), 'utf-8');
    const meta = parseAgentMeta(content);
    if (!meta.name) meta.name = f.replace('.md', '');
    const formatted = adapter.formatAgent(content, meta);
    fs.writeFileSync(path.join(destDir, f), formatted, 'utf-8');
    installed++;
  }
  if (installed > 0) {
    log.ok(`${adapter.agentsDir}/ 已安装（${installed} 个 sub-agent profile，宿主可直接调用）`);
  }
}

// ─── Guard ──────────────────────────────────────────────────

function cmdGuard(args) {
  const guard = require('./guard');
  const projectRoot = findProjectRoot();
  const sub = args[0];

  switch (sub) {
    case 'install':
      guard.cmdGuardInstall(projectRoot);
      break;
    case 'status':
      guard.cmdGuardStatus(projectRoot);
      break;
    case 'lock':
      guard.cmdGuardLock(projectRoot, args.slice(1));
      break;
    case 'unlock':
      guard.cmdGuardUnlock(projectRoot, args.slice(1));
      break;
    case 'check': {
      const isHook = args.includes('--hook');
      const pass = guard.cmdGuardCheck(projectRoot, isHook);
      process.exit(pass ? 0 : 1);
      break;
    }
    default:
      console.log(`
spec-copilot guard — 代码级护栏（AI 工具绕不过的硬拦截）

用法:
  spec-copilot guard install          初始化保护（记录 hash + 可选 git hook）
  spec-copilot guard status           查看保护状态与完整性
  spec-copilot guard lock [<file>]    锁定文件（记录 hash，无参数 = 自动按阶段锁定）
  spec-copilot guard unlock <file>    解锁文件（清除 hash 记录）
  spec-copilot guard check [--hook]   运行完整性检查

原理:
  主防线（不依赖 Git / chmod / 特殊权限）：
    锁定文件时记录 sha256 hash
    gate 运行时校验 hash — 不一致 → gate 拒绝通过
    AI 可以改文件，但改了过不了 gate — 等于白改

  附加层（有 Git 时自动启用）：
    pre-commit hook — 骨架组件检测

  人类解锁：spec-copilot guard unlock <文件>
`);
      break;
  }
}

// ─── Doctor ─────────────────────────────────────────────────

function cmdDoctor() {
  const projectRoot = findProjectRoot();
  const frameworkRepo = isFrameworkRepo(projectRoot);
  log.title('@alenfitz/spec-copilot doctor');
  log.info(`项目根目录: ${projectRoot}`);
  log.info(`框架版本:   ${readVersion()}`);

  let issues = 0;
  const scDir = path.join(projectRoot, 'spec_copilot');

  if (frameworkRepo) {
    log.info('检测模式:   框架源码仓库');
    log.ok('当前目录是 spec-copilot 框架源码仓库，跳过项目安装态检查');

    const keyFiles = [
      ['framework/VERSION', '框架版本文件'],
      ['framework/CHANGELOG.md', '框架变更记录'],
      ['framework/AGENTS.md.template', 'Prompt 模板'],
      ['bin/cli.js', 'CLI 入口'],
      ['README.md', '英文文档'],
      ['README.zh-CN.md', '中文文档'],
      ['scripts/build.js', '构建脚本'],
    ];
    for (const [rel, label] of keyFiles) {
      if (fs.existsSync(path.join(projectRoot, rel))) {
        log.ok(`${label}（${rel}）`);
      } else {
        log.err(`缺少 ${label}（${rel}）`);
        issues++;
      }
    }

    if (issues === 0) {
      log.ok('框架源码仓库自检通过');
    } else {
      log.err(`发现 ${issues} 个问题，请先修复源码仓库后再发布`);
    }
    return;
  }

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

  // 检查 agents/ 目录（v2.0.0 引入）
  const agentsDir = path.join(scDir, 'agents');
  if (fs.existsSync(agentsDir)) {
    const profiles = fs.readdirSync(agentsDir)
      .filter(f => f.endsWith('.md') && f !== 'README.md');
    log.ok(`内置 Agent Profiles：${profiles.length} 个（${profiles.map(f => f.replace('.md', '')).join(', ')}）`);

    // 检测宿主是否支持 sub-agent
    const { tool, supportsSubagent } = detectSubagentSupport(projectRoot);
    if (supportsSubagent) {
      log.ok(`宿主 ${tool} 支持 sub-agent，agent 可独立运行`);
    } else {
      log.warn(`宿主 ${tool} 未知/不支持 sub-agent，agent 将以"扮演"模式运行（结论可靠性降级）`);
      log.info('  建议在 claude-code 中执行 /spec:review 以获得独立 agent 判定');
    }
  } else {
    log.warn('spec_copilot/agents/ 不存在 — 运行 update --force 拉取 v2.0.0 内置 agent');
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

  // 检查 E2E 浏览器冒烟就绪状态
  try {
    const { resolvePlaywright } = require('./e2e-smoke');
    const pw = resolvePlaywright(projectRoot);
    if (pw && pw.launchOptions) {
      log.ok(`E2E 浏览器冒烟就绪（playwright-core + 系统 Chrome${pw.browserPath ? ': ' + pw.browserPath : ''}）`);
    } else if (pw && pw.launchOptions === null) {
      log.warn('E2E 浏览器冒烟不可用：未找到系统 Chrome/Chromium');
      log.info('  安装 Chrome: https://www.google.com/chrome/');
    } else {
      log.warn('E2E 浏览器冒烟不可用：playwright-core 未加载');
    }
  } catch {
    log.info('E2E 检查跳过');
  }

  // 检查 guard 护栏状态
  try {
    const guard = require('./guard');
    const configPath = path.join(projectRoot, '.spec-copilot', 'guard.json');
    if (fs.existsSync(configPath)) {
      const locks = guard.readLocks(projectRoot);
      const lockedCount = Object.keys(locks.files).length;
      const integrity = guard.verifyIntegrity(projectRoot);
      if (integrity.pass) {
        log.ok(`Guard 护栏已启用（${lockedCount} 个文件锁定，hash 完整）`);
      } else {
        log.warn(`Guard 护栏已启用（${lockedCount} 个文件锁定，${integrity.violations.length} 个完整性异常）`);
      }
    } else {
      log.info('Guard 护栏未安装（运行 spec-copilot guard install 启用代码级保护）');
    }
  } catch {
    log.info('Guard 检查跳过');
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
    // 精准清理本框架安装的 sub-agent 文件（保留用户自建的同目录其它 agent）
    if (adapter.agentsDir) {
      const hostAgentsDir = path.join(projectRoot, adapter.agentsDir);
      if (fs.existsSync(hostAgentsDir)) {
        const ourAgents = listFrameworkAgentNames();
        let removed = 0;
        for (const name of ourAgents) {
          const f = path.join(hostAgentsDir, `${name}.md`);
          if (fs.existsSync(f)) {
            fs.unlinkSync(f);
            removed++;
          }
        }
        if (removed > 0) log.ok(`已删除 ${adapter.agentsDir}/ 下 ${removed} 个 spec-copilot agent（保留用户自建文件）`);
        // 如目录为空，连目录一起删
        try {
          if (fs.readdirSync(hostAgentsDir).length === 0) {
            fs.rmdirSync(hostAgentsDir);
            log.info(`  ${adapter.agentsDir}/ 目录已空，一并移除`);
          } else {
            log.info(`  ${adapter.agentsDir}/ 保留（仍有其它文件）`);
          }
        } catch {}
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

/**
 * 校验 commit message 是否含必填自评分卡
 *
 * 用法：
 *   npx @alenfitz/spec-copilot scorecard <commit-msg-file>
 *   或：spec-copilot scorecard --stdin（从标准输入读 message）
 *
 * 仅对 feature/* 分支的 task commit 强制（chore/merge/初始 commit 跳过）。
 *
 * 退出码：0 = 通过；1 = 缺字段/分数过低；2 = 用法错误
 */
function cmdScorecard(args) {
  let msg = '';
  try {
    if (args[0] === '--stdin') {
      msg = fs.readFileSync(0, 'utf-8');
    } else if (args[0]) {
      msg = fs.readFileSync(args[0], 'utf-8');
    } else {
      log.err('用法: scorecard <commit-msg-file> | --stdin');
      process.exit(2);
    }
  } catch (e) {
    log.err(`读取 commit message 失败：${e.message}`);
    process.exit(2);
  }

  // 跳过非 task commit（chore/merge/revert/初始化）
  const firstLine = msg.split('\n')[0] || '';
  const isTaskCommit = /^\[[^\]]+\]\s*T\d+:/.test(firstLine);
  if (!isTaskCommit) {
    // 非 task commit 也鼓励有分卡，但不强制
    return process.exit(0);
  }

  // 必需字段（用 [^\S\n] 不包含换行的空白，避免跨行串行匹配）
  const required = [
    { key: '业需匹配度', regex: /业需匹配度[：:][^\S\n]*(\d+)\s*\/\s*10/ },
    { key: '代码可投产度', regex: /代码可投产度[：:][^\S\n]*(\d+)\s*\/\s*10/ },
    { key: '我未做但应该做的事', regex: /我未做但应该做的事[：:]([^\n]*)/ },
    { key: '总分', regex: /给[^\S\n]*[：:]?[^\S\n]*(\d+)\s*\/\s*100/ },
  ];

  const missing = [];
  const scores = {};
  for (const f of required) {
    const m = msg.match(f.regex);
    if (!m) {
      missing.push(f.key);
      continue;
    }
    const raw = (m[1] || '').trim();
    if (f.key === '我未做但应该做的事') {
      // 文本字段：必须有 >= 1 个有效字符
      if (raw.length < 1 || /^[_\-\s]+$/.test(raw)) {
        missing.push(f.key + '（留空 / 占位符）');
      } else {
        scores[f.key] = raw;
      }
    } else if (/^\d+$/.test(raw)) {
      scores[f.key] = parseInt(raw, 10);
    } else {
      missing.push(f.key + '（值非数字）');
    }
  }

  if (missing.length > 0) {
    console.error('');
    log.err(`commit message 缺少自评分卡字段：${missing.join('、')}`);
    console.error('');
    console.error('  task commit 必须在 message 末尾附自评分卡，格式：');
    console.error('');
    console.error('    ## 自评分卡');
    console.error('    - 业需匹配度：8/10（每扣 1 分必须列出具体扣分点）');
    console.error('    - 代码可投产度：7/10');
    console.error('    - 我未做但应该做的事：xxx（无则写"无"）');
    console.error('    - 如果用户现在评分，给：75/100（含理由）');
    console.error('');
    console.error('  跳过校验（不推荐）：git commit --no-verify');
    process.exit(1);
  }

  // 分数门槛
  const totalScore = scores['总分'];
  if (typeof totalScore === 'number') {
    if (totalScore < 60) {
      log.err(`自评总分 ${totalScore}/100 低于 60 — 当前 task 不应被 commit`);
      console.error('  请要么改进实现，要么显式声明"接受降级"并先告知用户');
      console.error('  跳过校验（不推荐）：git commit --no-verify');
      process.exit(1);
    } else if (totalScore < 70) {
      log.warn(`自评总分 ${totalScore}/100（< 70），建议改进；commit 已放行`);
    } else {
      log.ok(`自评分卡：${totalScore}/100（业需 ${scores['业需匹配度']}/10 · 投产 ${scores['代码可投产度']}/10）`);
    }
  }

  // "未做事" 留空检测（必填）
  const todo = scores['我未做但应该做的事'];
  if (typeof todo === 'string' && (todo.length < 1 || /^[_\-\s]+$/.test(todo))) {
    log.err('"我未做但应该做的事" 字段不能留空（无则显式写"无"）');
    process.exit(1);
  }
  process.exit(0);
}

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

// ─── Sync（适配器同步） ────────────────────────────────────

function cmdSync(args) {
  const projectRoot = findProjectRoot();
  const srcRoot = pkgRoot();
  const scDir = path.join(projectRoot, 'spec_copilot');
  const force = args.includes('--force');

  if (!fs.existsSync(scDir)) {
    log.err('spec_copilot/ 不存在，请先执行 install');
    process.exit(1);
  }

  // 读取已安装的工具列表
  const stateFile = path.join(scDir, TOOL_STATE_FILE);
  let toolNames = [];
  if (fs.existsSync(stateFile)) {
    toolNames = fs.readFileSync(stateFile, 'utf-8').trim().split(',').map(s => s.trim()).filter(Boolean);
  }

  // 如指定了 --tool，用指定的
  const multi = resolveAdapters(args, projectRoot);
  if (multi) {
    toolNames = multi.map(a => a.name);
  }

  // 如果还是空，自动检测
  if (toolNames.length === 0) {
    const detected = detectTools(projectRoot);
    toolNames = detected.map(a => a.name);
  }

  if (toolNames.length === 0) {
    log.err('未检测到任何 AI 编码工具，请用 --tool 指定');
    process.exit(1);
  }

  const targetAdapters = toolNames.map(n => adapters[n]).filter(Boolean);
  log.title(`spec-copilot sync → ${targetAdapters.map(a => a.displayName).join(', ')}`);

  // 检测技术栈
  const stack = detectStack(projectRoot);
  const stackCtx = buildStackContext(stack);

  // 生成提示词
  const rawPrompt = renderPromptTemplate();
  const promptWithStack = stackCtx ? rawPrompt + '\n' + stackCtx : rawPrompt;

  const commandsSrc = path.join(srcRoot, 'commands');
  let synced = 0;

  for (const adapter of targetAdapters) {
    log.info('');
    log.info(`─── 同步 ${adapter.displayName} ───`);

    // 同步命令
    if (adapter.hasNativeCommands && adapter.commandsDir) {
      const cmdDest = path.join(projectRoot, adapter.commandsDir);
      fs.mkdirSync(cmdDest, { recursive: true });
      copyDir(commandsSrc, cmdDest);
      log.ok(`${adapter.commandsDir}/ 已同步`);
    }

    // 同步 sub-agent
    installAgentsForAdapter(adapter, srcRoot, projectRoot);

    // 同步提示词
    const promptPath = path.join(projectRoot, adapter.promptPath);
    const promptDir = path.dirname(promptPath);
    if (force || !fs.existsSync(promptPath)) {
      fs.mkdirSync(promptDir, { recursive: true });
      const formattedPrompt = adapter.formatPrompt(promptWithStack);
      fs.writeFileSync(promptPath, formattedPrompt, 'utf-8');
      log.ok(`${adapter.promptPath} 已${force ? '覆盖' : '创建'}`);
      synced++;
    } else {
      log.warn(`${adapter.promptPath} 已存在，跳过（--force 覆盖）`);
    }

    // 同步 legacy 文件
    if (adapter.legacyPath && adapter.formatLegacy) {
      const legacyFile = path.join(projectRoot, adapter.legacyPath);
      if (force || !fs.existsSync(legacyFile)) {
        const legacyContent = adapter.formatLegacy(promptWithStack);
        fs.writeFileSync(legacyFile, legacyContent, 'utf-8');
        log.ok(`${adapter.legacyPath} 已${force ? '覆盖' : '创建'}`);
        synced++;
      } else {
        log.warn(`${adapter.legacyPath} 已存在，跳过`);
      }
    }
  }

  // 更新工具状态
  const newState = targetAdapters.map(a => a.name).join(',');
  fs.writeFileSync(stateFile, newState, 'utf-8');

  log.title(`同步完成（${synced} 个文件${force ? '已覆盖' : '已更新'}）`);
  if (!force && synced === 0) {
    log.info('所有文件已是最新，如需强制覆盖请用 --force');
  }
}

// ─── CI ────────────────────────────────────────────────────

function cmdCI(args) {
  const projectRoot = findProjectRoot();
  const sub = args[0];

  if (sub === 'setup' || sub === 'init') {
    const { cmdCISetup } = require('./ci-gen');
    const withE2E = args.includes('--e2e');
    console.log('\n生成 CI 配置...\n');
    cmdCISetup(projectRoot, { withE2E });
  } else {
    console.log(`
spec-copilot ci — CI/CD 自动化

用法:
  spec-copilot ci setup              生成 GitHub Actions workflow
  spec-copilot ci setup --e2e        同时生成 E2E 完整测试 workflow

生成的 workflow 会在 PR 提交时自动运行:
  - gate smoke（构建 + 骨架 + 代码质量）
  - gate review（覆盖率 + API 契约 + 错误处理）
  - 评分结果上传为 artifacts
`);
  }
}

function showHelp() {
  console.log(`
@alenfitz/spec-copilot — 渐进式 Spec 编码框架（多工具统一版）

支持工具: ${supportedTools().join(', ')}

用法:
  npx @alenfitz/spec-copilot install [--tool <name>]    初始化项目
  npx @alenfitz/spec-copilot update [--force]            升级框架
  npx @alenfitz/spec-copilot sync [--tool <name>] [--force]  同步适配器文件
  npx @alenfitz/spec-copilot gate <name> <phase>         阶段门禁检查
  npx @alenfitz/spec-copilot lint [name]                 Spec 完整性检查
  npx @alenfitz/spec-copilot agents <list|show|install>  内置 Agent Profile 管理
  npx @alenfitz/spec-copilot scorecard <msg-file>        校验 task commit 自评分卡
  npx @alenfitz/spec-copilot guard <install|status|lock|unlock|check>  代码级护栏
  npx @alenfitz/spec-copilot ci <setup>                  生成 CI/CD 配置
  npx @alenfitz/spec-copilot doctor                      检查安装状态
  npx @alenfitz/spec-copilot uninstall [--confirm]       移除框架文件

--tool 支持:
  --tool cursor             单个工具
  --tool cursor,copilot     多工具同时安装
  --tool all                全部工具

示例:
  npx @alenfitz/spec-copilot install --tool cursor
  npx @alenfitz/spec-copilot install --tool all
  npx @alenfitz/spec-copilot sync --force
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
    cmdGate(args.slice(1)).catch(e => { log.err(e.message); process.exit(1); });
    break;
  case 'lint':
    cmdLint(args.slice(1));
    break;
  case 'agents':
    cmdAgents(args.slice(1));
    break;
  case 'scorecard':
    cmdScorecard(args.slice(1));
    break;
  case 'guard':
    cmdGuard(args.slice(1));
    break;
  case 'ci':
    cmdCI(args.slice(1));
    break;
  case 'sync':
    cmdSync(args.slice(1));
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

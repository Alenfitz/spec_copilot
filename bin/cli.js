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
const { adapters, detectTools, supportedTools, parseAgentMeta } = require('../adapters');

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

  // 5.5 安装 sub-agent profile 到宿主专属目录（如宿主支持）
  installAgentsForAdapter(adapter, srcRoot, projectRoot);

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

  console.log('');
  if (pass) {
    // 成功通过 review gate → 写哨兵（其它 phase 不写）
    if (phase === 'review') {
      try {
        const sentinelPath = path.join(changeDir, '.gate-review-passed');
        fs.writeFileSync(sentinelPath, JSON.stringify({
          timestamp: Date.now(),
          version: readVersion(),
        }, null, 2) + '\n');
      } catch (e) {
        log.warn(`写入 review 哨兵失败：${e.message}`);
      }
    }
    log.ok(`Gate 通过 ✓ — 可以进入 ${phase} 阶段`);
    process.exit(0);
  } else {
    // review gate 失败 → 清除可能存在的旧哨兵，防止下次 archive 误信
    if (phase === 'review') {
      const sentinelPath = path.join(changeDir, '.gate-review-passed');
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
  npx @alenfitz/spec-copilot agents <list|show|install>  内置 Agent Profile 管理
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
  case 'agents':
    cmdAgents(args.slice(1));
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

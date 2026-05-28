/**
 * frontend-checks.js — 前端硬检测模块（v2.2.0）
 *
 * 导出可被 cli.js gate 系统调用的前端检查函数。
 * 零外部依赖，仅使用 Node.js 内置模块。
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ─── 工具函数 ───────────────────────────────────────────────

function walkFiles(dir, filter, result = []) {
  if (!fs.existsSync(dir)) return result;
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, f.name);
    if (f.isDirectory()) {
      if (!/node_modules|dist|\.git|\.nuxt|\.next/.test(f.name)) {
        walkFiles(full, filter, result);
      }
    } else if (filter(f.name)) {
      result.push(full);
    }
  }
  return result;
}

function findFeRoots(projectRoot) {
  // v4.0.5+: 委托给共享检测模块（自动识别 hf-web / my-app / web-client 等自定义命名）
  const { detectFrontendRoots } = require('./project-roots');
  return detectFrontendRoots(projectRoot);
}

function extractVueTemplate(content) {
  const match = content.match(/<template[^>]*>([\s\S]*?)<\/template>/);
  return match ? match[1] : '';
}

function extractVueScript(content) {
  const match = content.match(/<script[^>]*>([\s\S]*?)<\/script>/);
  return match ? match[1] : '';
}

// ─── 检查 1：骨架组件检测 ────────────────────────────────────

const EMPTY_COMPONENTS = [
  'el-empty', 'a-empty', 'n-empty', 'van-empty',
  'ElEmpty', 'AEmpty', 'NEmpty',
];
const PLACEHOLDER_WORDS = [
  'TODO', '待实现', '待完善', '占位', '待后端', '待开发',
  '待补充', 'placeholder', '暂未实现', '敬请期待',
];

function detectSkeletonComponents(projectRoot) {
  const feRoots = findFeRoots(projectRoot);
  const skeletons = [];
  let total = 0;

  for (const root of feRoots) {
    const vueFiles = walkFiles(root, f => /\.vue$/.test(f));

    for (const file of vueFiles) {
      const baseName = path.basename(file);
      if (/^(App|main|index)\./i.test(baseName)) continue;

      total++;
      const content = fs.readFileSync(file, 'utf-8');
      const template = extractVueTemplate(content);
      if (!template.trim()) {
        skeletons.push({ file: path.relative(projectRoot, file), reason: '<template> 为空' });
        continue;
      }

      const stripped = template
        .replace(/<!--[\s\S]*?-->/g, '')   // 去注释
        .replace(/<[^>]+>/g, ' ')          // 去标签，留文本
        .replace(/\s+/g, ' ')
        .trim();

      // 检测 1a：模板内只有 empty 组件
      const hasOnlyEmpty = EMPTY_COMPONENTS.some(ec =>
        template.includes(`<${ec}`) || template.includes(`<${ec.replace(/([A-Z])/g, '-$1').toLowerCase().replace(/^-/, '')}`)
      );
      const contentNodes = template
        .replace(/<!--[\s\S]*?-->/g, '')
        .match(/<[a-zA-Z][\w-]*[^>]*(?:\/>|>)/g) || [];
      const nonEmptyNodes = contentNodes.filter(n =>
        !EMPTY_COMPONENTS.some(ec => n.includes(ec) || n.includes(ec.replace(/([A-Z])/g, '-$1').toLowerCase().replace(/^-/, '')))
      );
      // 如果只有 empty 组件 + 最多一层包裹 div
      const wrapperOnly = nonEmptyNodes.every(n => /^<(div|section|template|el-card|a-card|n-card)\b/.test(n));
      if (hasOnlyEmpty && (nonEmptyNodes.length <= 2 || wrapperOnly)) {
        skeletons.push({ file: path.relative(projectRoot, file), reason: '仅含 empty 占位组件' });
        continue;
      }

      // 检测 1b：模板文本只有占位词
      if (stripped.length > 0 && stripped.length < 100) {
        const hasOnlyPlaceholder = PLACEHOLDER_WORDS.some(pw =>
          stripped.includes(pw)
        );
        const hasRealContent = contentNodes.filter(n =>
          !/<(div|section|template|span|p)\b/.test(n) &&
          !EMPTY_COMPONENTS.some(ec => n.includes(ec))
        ).length;
        if (hasOnlyPlaceholder && hasRealContent <= 1) {
          skeletons.push({ file: path.relative(projectRoot, file), reason: `模板仅含占位文字: "${stripped.slice(0, 60)}"` });
          continue;
        }
      }

      // 检测 1c：有效内容节点 ≤ 2（一个 div + 一个文本/empty）
      if (contentNodes.length <= 2 && stripped.length < 30) {
        const script = extractVueScript(content);
        const hasProps = /defineProps|props\s*:/.test(script);
        const hasEmits = /defineEmits|emits\s*:/.test(script);
        if ((hasProps || hasEmits) && contentNodes.length <= 1) {
          skeletons.push({ file: path.relative(projectRoot, file), reason: '定义了 props/emits 但模板几乎为空' });
          continue;
        }
      }
    }
  }

  return { skeletons, total };
}

// ─── 检查 2：构建验证 ────────────────────────────────────────

function checkBuildable(projectRoot) {
  const results = { frontend: null, backend: null };

  // 前端构建检查
  const fePkgCandidates = ['frontend/package.json', 'package.json'].map(p => path.join(projectRoot, p));
  for (const pkgPath of fePkgCandidates) {
    if (!fs.existsSync(pkgPath)) continue;
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    if (!pkg.scripts || (!pkg.scripts.build && !pkg.scripts['type-check'])) continue;

    const pkgDir = path.dirname(pkgPath);
    // 优先 type-check，其次 build
    const cmd = pkg.scripts['type-check'] ? 'npm run type-check' : 'npm run build';
    try {
      execSync(cmd, { cwd: pkgDir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 120000 });
      results.frontend = { pass: true, cmd, dir: path.relative(projectRoot, pkgDir) };
    } catch (e) {
      const stderr = (e.stderr || '').trim().split('\n').slice(-10).join('\n');
      results.frontend = { pass: false, cmd, dir: path.relative(projectRoot, pkgDir), error: stderr };
    }
    break;
  }

  // 后端构建检查
  const bePomPath = path.join(projectRoot, 'backend/pom.xml');
  const beGradlePath = path.join(projectRoot, 'backend/build.gradle');
  if (fs.existsSync(bePomPath)) {
    try {
      execSync('mvn compile -q -DskipTests', { cwd: path.join(projectRoot, 'backend'), encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 180000 });
      results.backend = { pass: true, cmd: 'mvn compile', dir: 'backend' };
    } catch (e) {
      const stderr = (e.stderr || '').trim().split('\n').slice(-10).join('\n');
      results.backend = { pass: false, cmd: 'mvn compile', dir: 'backend', error: stderr };
    }
  } else if (fs.existsSync(beGradlePath)) {
    try {
      execSync('./gradlew compileJava -q', { cwd: path.join(projectRoot, 'backend'), encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 180000 });
      results.backend = { pass: true, cmd: 'gradlew compileJava', dir: 'backend' };
    } catch (e) {
      const stderr = (e.stderr || '').trim().split('\n').slice(-10).join('\n');
      results.backend = { pass: false, cmd: 'gradlew compileJava', dir: 'backend', error: stderr };
    }
  }

  return results;
}

// ─── 检查 3：TypeScript any 泛滥检测 ─────────────────────────

function detectAnyAbuse(projectRoot, threshold = 5) {
  const feRoots = findFeRoots(projectRoot);
  const abusers = [];
  let totalLines = 0;
  let totalAnys = 0;

  for (const root of feRoots) {
    const tsFiles = walkFiles(root, f => /\.(ts|tsx|vue)$/.test(f));

    for (const file of tsFiles) {
      const content = fs.readFileSync(file, 'utf-8');
      const lines = content.split('\n');
      const lineCount = lines.length;
      // 匹配 `: any`、`as any`、`<any>`、`any[]`，排除注释行和字符串
      const anyMatches = lines.filter(line => {
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*')) return false;
        return /:\s*any\b|as\s+any\b|<any>|any\[\]/.test(line);
      });
      const anyCount = anyMatches.length;

      totalLines += lineCount;
      totalAnys += anyCount;

      if (lineCount > 0 && anyCount > 0) {
        const ratio = (anyCount / lineCount) * 100;
        if (ratio > threshold) {
          abusers.push({
            file: path.relative(projectRoot, file),
            anyCount,
            lineCount,
            ratio: ratio.toFixed(1),
          });
        }
      }
    }
  }

  return {
    totalAnys,
    totalLines,
    globalRatio: totalLines > 0 ? ((totalAnys / totalLines) * 100).toFixed(2) : '0',
    abusers: abusers.sort((a, b) => b.anyCount - a.anyCount),
  };
}

// ─── Task 解析工具函数 ──────────────────────────────────────

function splitTaskBlocks(tasksContent) {
  return tasksContent.split(/(?=^## Task \d+)/m).filter(b => /^## Task \d+/.test(b));
}

function extractTaskMeta(block) {
  const titleMatch = block.match(/^## (Task \d+)[：:]\s*(.*)$/m);
  const taskName = titleMatch ? titleMatch[1] : 'Task ?';
  const title = titleMatch ? titleMatch[2] : '';
  return { taskName, title };
}

function extractFieldValue(block, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = block.match(new RegExp(`- \\*\\*${escaped}\\*\\*[：:]\\s*([^\\n]*)`, 'i'));
  return match ? (match[1] || '').trim() : '';
}

function isNoneLike(text) {
  return /^(无|none|n\/a|na|不适用)$/i.test(String(text || '').trim());
}

function countFeatureRefs(text) {
  const refs = String(text || '').match(/\bF\d+\b/g) || [];
  return [...new Set(refs)].length;
}

// ─── 检查 4：tasks.md 前后端交织检测 ─────────────────────────

function checkTaskInterleaving(tasksContent) {
  const taskBlocks = splitTaskBlocks(tasksContent);
  if (taskBlocks.length < 4) return { pass: true, message: 'task 数量 < 4，跳过交织检查' };

  const taskTypes = taskBlocks.map(block => {
    const { title } = extractTaskMeta(block);
    const isFe = /前端|页面|组件|vue|react|UI|界面|列表页|编辑页|弹框|弹窗|面板/.test(title);
    const isBe = /后端|接口|API|service|controller|mapper|数据库|表结构/.test(title);
    if (isFe && !isBe) return 'fe';
    if (isBe && !isFe) return 'be';
    return 'mixed';
  });

  // 检查是否有连续 > 3 个后端 task 不穿插前端
  let maxConsecutiveBe = 0;
  let currentConsecutive = 0;
  for (const t of taskTypes) {
    if (t === 'be') {
      currentConsecutive++;
      maxConsecutiveBe = Math.max(maxConsecutiveBe, currentConsecutive);
    } else {
      currentConsecutive = 0;
    }
  }

  const feCount = taskTypes.filter(t => t === 'fe').length;
  const beCount = taskTypes.filter(t => t === 'be').length;

  const failures = [];
  if (maxConsecutiveBe > 3) {
    failures.push(`连续 ${maxConsecutiveBe} 个后端 task 未穿插前端 task（上限 3 个）— 前端会被挤到最后导致骨架`);
  }

  // 检查前端 task 是否全部集中在末尾
  const feIndices = taskTypes.map((t, i) => t === 'fe' ? i : -1).filter(i => i >= 0);
  if (feIndices.length > 0 && beCount > 0) {
    const minFeIndex = Math.min(...feIndices);
    if (minFeIndex > taskTypes.length * 0.7) {
      failures.push(`前端 task 全部集中在 70% 之后（第一个前端 task 是 T${minFeIndex + 1}/${taskTypes.length}）— 应交织排列`);
    }
  }

  return {
    pass: failures.length === 0,
    feCount,
    beCount,
    maxConsecutiveBe,
    taskTypes,
    failures,
  };
}

// ─── 检查 5：前端 task 粒度检测 ──────────────────────────────

function checkTaskGranularity(tasksContent, maxVuePerTask = 4) {
  const taskBlocks = splitTaskBlocks(tasksContent);
  const oversized = [];

  for (const block of taskBlocks) {
    const { taskName, title } = extractTaskMeta(block);

    // 仅检查前端 task
    const isFe = /前端|页面|组件|vue|react|UI|界面|列表页|编辑页/.test(title);
    if (!isFe) continue;

    // 统计 task 描述中提到的 .vue 文件数量
    const vueRefs = block.match(/[\w-]+\.vue/g) || [];
    const uniqueVues = [...new Set(vueRefs)];

    if (uniqueVues.length > maxVuePerTask) {
      oversized.push({
        task: taskName,
        title: title.slice(0, 40),
        vueCount: uniqueVues.length,
        files: uniqueVues.slice(0, 8),
      });
    }
  }

  return { oversized, maxAllowed: maxVuePerTask };
}

// ─── 检查 6：前端 task 功能性自证检测 ─────────────────────────

function checkFrontendEvidence(tasksContent) {
  const taskBlocks = splitTaskBlocks(tasksContent);
  const failures = [];

  for (const block of taskBlocks) {
    const { taskName, title } = extractTaskMeta(block);

    const isFe = /前端|页面|组件|vue|react|UI|界面|列表页|编辑页|弹框/.test(title);
    if (!isFe) continue;

    const isDone = /状态[：:]\s*(✅|已完成|完成|已交付|done)/i.test(block) || /实际验证结果/.test(block);
    if (!isDone) continue;

    // 检查是否包含构建验证输出
    const hasBuildEvidence = /vue-tsc|tsc\s|npm run build|vite build|webpack|构建成功|build.*success|零错误|0 error/i.test(block);

    // 检查是否包含用户操作路径
    const hasUserPath = /用户操作路径|操作路径|用户路径|交互路径/.test(block);
    const hasPathDescription = /→|->|点击|进入|打开|跳转|弹出|显示|输入|选择|提交/.test(block);
    const pathDescCount = (block.match(/→|->/) || []).length;

    if (!hasBuildEvidence) {
      failures.push(`${taskName}: 前端 task 验证结果缺少构建输出（需包含 vue-tsc / npm run build 结果）`);
    }
    if (!hasUserPath && pathDescCount < 2) {
      failures.push(`${taskName}: 前端 task 缺少用户操作路径描述（如"列表页 → 点击新增 → 弹出弹框 → 填写 → 提交"）`);
    }
  }

  return { failures };
}

// ─── 检查 7：Task Vertical Slice 闭环检测 ─────────────────────

function checkTaskVerticalSlices(tasksContent) {
  const taskBlocks = splitTaskBlocks(tasksContent);
  const failures = [];
  const warnings = [];
  const checked = [];

  for (const block of taskBlocks) {
    const { taskName, title } = extractTaskMeta(block);
    checked.push(taskName);

    const coverage = extractFieldValue(block, '覆盖功能点');
    const nonDegradable = extractFieldValue(block, '不可降级项');
    const userAction = extractFieldValue(block, '用户动作');
    const apiContract = extractFieldValue(block, '接口契约');
    const stateData = extractFieldValue(block, '状态/数据变化');
    const uiOutput = extractFieldValue(block, '界面/输出结果');
    const verifyPath = extractFieldValue(block, '验证路径');

    const missing = [];
    if (!userAction) missing.push('用户动作');
    if (!apiContract) missing.push('接口契约');
    if (!stateData) missing.push('状态/数据变化');
    if (!uiOutput) missing.push('界面/输出结果');
    if (!verifyPath) missing.push('验证路径');
    if (!nonDegradable) missing.push('不可降级项');

    if (missing.length > 0) {
      failures.push(`${taskName}: 缺少 V-Slice / 闭环字段：${missing.join('、')}`);
    }

    const featureCount = countFeatureRefs(coverage);
    if (featureCount > 3) {
      failures.push(`${taskName}: 覆盖 ${featureCount} 个功能点（上限 3 个）— task 过大，建议继续拆分`);
    }

    if (isNoneLike(nonDegradable)) {
      warnings.push(`${taskName}: “不可降级项”为”无” — 建议至少写出 1 条硬验收点`);
    }
  }

  return { checked, failures, warnings };
}

// ─── 导出 ────────────────────────────────────────────────────

module.exports = {
  detectSkeletonComponents,
  checkBuildable,
  detectAnyAbuse,
  checkTaskInterleaving,
  checkTaskGranularity,
  checkFrontendEvidence,
  checkTaskVerticalSlices,
};

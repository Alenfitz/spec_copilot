/**
 * project-roots.js — 自动识别项目的前端/后端根目录
 *
 * 解决：之前硬编码 ['frontend/src', 'app/src', 'src'] 等路径，
 * 用户使用自定义命名（如 hf-web/, hf-server/, my-app/, web-client/）时全部匹配失败。
 *
 * 策略：
 *   1. 优先尝试标准位置
 *   2. 扫描项目根目录的一级子目录，按内容特征判断
 *      - 含 package.json 且有 vue/react/angular/svelte 等前端依赖 → 前端
 *      - 含 pom.xml / build.gradle → Java 后端
 *      - 含 go.mod → Go 后端
 *      - 含 requirements.txt / pyproject.toml / manage.py → Python 后端
 *
 * 缓存：同一 projectRoot 多次调用复用结果（避免重复 readdir）。
 */

const fs = require('fs');
const path = require('path');

const _frontendCache = new Map();
const _backendCache = new Map();

/** 项目级跳过的目录 */
const SKIP_DIRS = new Set([
  'node_modules', 'dist', 'build', 'target', 'out', 'coverage',
  '.git', '.idea', '.vscode', '.next', '.nuxt', '.cache',
  'spec_copilot', '__pycache__', 'venv', '.venv', 'env',
]);

function safeReadJson(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')); } catch { return null; }
}

function hasFrontendDeps(pkg) {
  if (!pkg) return false;
  const allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  return !!(
    allDeps.vue || allDeps['@vue/cli-service'] || allDeps.nuxt ||
    allDeps.react || allDeps['react-dom'] || allDeps.next ||
    allDeps['@angular/core'] ||
    allDeps.svelte || allDeps['@sveltejs/kit']
  );
}

/**
 * 自动检测项目的前端代码根（含 src/ 的绝对路径）
 * 返回数组（一个项目可能有多个前端模块，如 admin + portal）
 */
function detectFrontendRoots(projectRoot) {
  if (_frontendCache.has(projectRoot)) return _frontendCache.get(projectRoot);

  const found = new Set();

  // 1. 标准位置
  for (const std of ['frontend/src', 'app/src', 'src', 'web/src', 'client/src']) {
    const full = path.join(projectRoot, std);
    if (fs.existsSync(full)) found.add(full);
  }

  // 2. 扫描一级子目录
  try {
    for (const entry of fs.readdirSync(projectRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;

      const dir = path.join(projectRoot, entry.name);
      const pkgJson = path.join(dir, 'package.json');
      if (!fs.existsSync(pkgJson)) continue;

      const pkg = safeReadJson(pkgJson);
      if (!hasFrontendDeps(pkg)) continue;

      // 优先 src/，否则用根目录（Next.js / Nuxt 项目）
      const src = path.join(dir, 'src');
      if (fs.existsSync(src)) {
        found.add(src);
      } else {
        found.add(dir);
      }
    }
  } catch { /* permission denied */ }

  const result = [...found];
  _frontendCache.set(projectRoot, result);
  return result;
}

/**
 * 自动检测项目的后端代码根
 */
function detectBackendRoots(projectRoot) {
  if (_backendCache.has(projectRoot)) return _backendCache.get(projectRoot);

  const found = new Set();

  // 1. 标准位置（Java/Spring）
  for (const std of ['backend/src/main', 'src/main', 'server/src/main', 'api/src/main']) {
    const full = path.join(projectRoot, std);
    if (fs.existsSync(full)) found.add(full);
  }

  // 2. 扫描一级子目录
  try {
    for (const entry of fs.readdirSync(projectRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;

      const dir = path.join(projectRoot, entry.name);

      // Java / Spring（Maven / Gradle）
      if (
        fs.existsSync(path.join(dir, 'pom.xml')) ||
        fs.existsSync(path.join(dir, 'build.gradle')) ||
        fs.existsSync(path.join(dir, 'build.gradle.kts'))
      ) {
        const srcMain = path.join(dir, 'src', 'main');
        if (fs.existsSync(srcMain)) found.add(srcMain);
        else found.add(dir);
        continue;
      }

      // Go 后端
      if (fs.existsSync(path.join(dir, 'go.mod'))) {
        found.add(dir);
        continue;
      }

      // Python 后端（Django / FastAPI 等）
      if (
        fs.existsSync(path.join(dir, 'requirements.txt')) ||
        fs.existsSync(path.join(dir, 'pyproject.toml')) ||
        fs.existsSync(path.join(dir, 'manage.py'))
      ) {
        found.add(dir);
        continue;
      }

      // Node.js 后端（Express / NestJS）— 有 package.json 但不含前端框架依赖
      const pkgJson = path.join(dir, 'package.json');
      if (fs.existsSync(pkgJson)) {
        const pkg = safeReadJson(pkgJson);
        if (pkg && !hasFrontendDeps(pkg)) {
          const allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
          if (allDeps.express || allDeps['@nestjs/core'] || allDeps.koa || allDeps.fastify) {
            const src = path.join(dir, 'src');
            if (fs.existsSync(src)) found.add(src);
            else found.add(dir);
          }
        }
      }
    }
  } catch { /* permission denied */ }

  const result = [...found];
  _backendCache.set(projectRoot, result);
  return result;
}

/**
 * 清空缓存（测试用）
 */
function _clearCache() {
  _frontendCache.clear();
  _backendCache.clear();
}

module.exports = {
  detectFrontendRoots,
  detectBackendRoots,
  _clearCache,
};

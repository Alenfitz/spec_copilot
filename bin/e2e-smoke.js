/**
 * e2e-smoke.js — E2E 浏览器冒烟模块（v2.7.0）
 *
 * Spec-driven 端到端浏览器验证：
 *   1. 从 spec.md 提取页面路由和 API 端点
 *   2. 自动检测/启动前后端开发服务器
 *   3. 用 headless Chrome 逐页面检查：
 *      - 白屏、JS 异常、框架错误遮罩
 *      - API 4xx/5xx 响应（前后端对不上）
 *      - API 返回非 JSON（后端报错返回 HTML）
 *      - 空数据渲染（列表页无数据、空状态组件）
 *      - 控制台 API 相关错误
 *   4. 返回结构化结果供 cli.js smoke gate 消费
 *
 * v2.7.0: 从"页面能打开"升级到"前后端联调真正跑通"
 * 内置 playwright-core + 系统 Chrome，用户零额外安装。
 */

const fs = require('fs');
const path = require('path');
const net = require('net');
const http = require('http');
const { spawn } = require('child_process');

// ─── 常量 ────────────────────────────────────────────────────

const DEFAULT_PAGE_TIMEOUT = 30000;
const SERVER_START_TIMEOUT_BE = 90000;
const SERVER_START_TIMEOUT_FE = 45000;
const PORT_PROBE_TIMEOUT = 2000;
const API_CHECK_TIMEOUT = 5000;

/** 控制台错误中的无害模式（开发环境常见噪音） */
const BENIGN_CONSOLE_PATTERNS = [
  /favicon\.ico/,
  /\[HMR\]/,
  /\[vite\]/i,
  /hot-update/,
  /hot update/i,
  /DevTools/i,
  /Autofill/i,
  /Download the Vue Devtools/i,
  /Download the React DevTools/i,
  /\/sockjs-node\//,
  /ws:\/\//,
  /WebSocket connection/i,
  /ERR_CONNECTION_REFUSED.*sockjs/,
  /net::ERR_FAILED.*chrome-extension/,
  /ResizeObserver loop/,
  /Third-party cookie/i,
  /Failed to load resource.*favicon/,
];

/** 技术栈自动检测配置 */
const STACK_PROFILES = [
  {
    name: 'spring-boot + vue3 (分目录)',
    detect: (root) =>
      fs.existsSync(path.join(root, 'backend', 'pom.xml')) &&
      fs.existsSync(path.join(root, 'frontend', 'package.json')),
    backend: { dir: 'backend', cmd: 'mvn spring-boot:run -q', port: 8080, readyPattern: /Started \w+ in|Tomcat started/i },
    frontend: { dir: 'frontend', cmd: 'npm run dev', port: 5173, readyPattern: /Local:.*http|VITE.*ready|localhost:\d+/i },
  },
  {
    name: 'spring-boot + vue3 (根目录 + frontend)',
    detect: (root) =>
      fs.existsSync(path.join(root, 'pom.xml')) &&
      fs.existsSync(path.join(root, 'frontend', 'package.json')),
    backend: { dir: '.', cmd: 'mvn spring-boot:run -q', port: 8080, readyPattern: /Started \w+ in|Tomcat started/i },
    frontend: { dir: 'frontend', cmd: 'npm run dev', port: 5173, readyPattern: /Local:.*http|VITE.*ready|localhost:\d+/i },
  },
  {
    name: 'spring-boot + vue3 (根目录合体)',
    detect: (root) =>
      fs.existsSync(path.join(root, 'pom.xml')) &&
      fs.existsSync(path.join(root, 'package.json')) &&
      (() => { try { const p = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8')); return p.dependencies && (p.dependencies.vue || p.devDependencies && p.devDependencies.vue); } catch { return false; } })(),
    backend: { dir: '.', cmd: 'mvn spring-boot:run -q', port: 8080, readyPattern: /Started \w+ in|Tomcat started/i },
    frontend: { dir: '.', cmd: 'npm run dev', port: 5173, readyPattern: /Local:.*http|VITE.*ready|localhost:\d+/i },
  },
  {
    name: 'vite-only (纯前端)',
    detect: (root) => {
      try {
        const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'));
        return (pkg.devDependencies && pkg.devDependencies.vite) || (pkg.dependencies && pkg.dependencies.vite);
      } catch { return false; }
    },
    backend: null,
    frontend: { dir: '.', cmd: 'npm run dev', port: 5173, readyPattern: /Local:.*http|VITE.*ready|localhost:\d+/i },
  },
];

// ─── Playwright 发现 ─────────────────────────────────────────

/**
 * 查找可用的 Chrome/Chromium 浏览器路径
 * @returns {string|null}
 */
function findSystemChrome() {
  const platform = process.platform;
  const candidates = [];

  if (platform === 'darwin') {
    candidates.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      `${process.env.HOME}/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`,
    );
  } else if (platform === 'linux') {
    candidates.push(
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/snap/bin/chromium',
    );
  } else if (platform === 'win32') {
    const programFiles = process.env['PROGRAMFILES'] || 'C:\\Program Files';
    const programFilesX86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';
    const localAppData = process.env.LOCALAPPDATA || '';
    candidates.push(
      `${programFiles}\\Google\\Chrome\\Application\\chrome.exe`,
      `${programFilesX86}\\Google\\Chrome\\Application\\chrome.exe`,
      `${localAppData}\\Google\\Chrome\\Application\\chrome.exe`,
    );
  }

  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

/**
 * 加载 playwright-core（spec-copilot 自带）并定位系统 Chrome
 * @returns {{ chromium: object, module: object, launchOptions: object }|null}
 */
function resolvePlaywright(projectRoot) {
  // 1. 尝试加载 playwright-core（spec-copilot 自带依赖）
  let pw = null;
  try {
    pw = require('playwright-core');
  } catch {
    // 回退：从目标项目查找完整 playwright
    const searchPaths = [
      projectRoot,
      path.join(projectRoot, 'frontend'),
      path.join(projectRoot, 'app'),
    ].filter(p => fs.existsSync(p));

    for (const base of searchPaths) {
      try {
        const resolved = require.resolve('playwright', { paths: [base] });
        pw = require(resolved);
        if (pw && pw.chromium) return { chromium: pw.chromium, module: pw, launchOptions: {} };
      } catch { /* continue */ }
    }
    return null;
  }

  if (!pw || !pw.chromium) return null;

  // 2. 确定浏览器来源
  //    优先 channel: 'chrome'（系统已安装的 Chrome）
  //    回退：显式 executablePath
  const systemChrome = findSystemChrome();
  if (systemChrome) {
    return {
      chromium: pw.chromium,
      module: pw,
      launchOptions: { channel: 'chrome' },
      browserPath: systemChrome,
    };
  }

  // 3. 没找到系统 Chrome
  return {
    chromium: pw.chromium,
    module: pw,
    launchOptions: null, // 标记为找不到浏览器
    browserPath: null,
  };
}

// ─── 端口探测 ────────────────────────────────────────────────

function isPortListening(port, host = '127.0.0.1', timeoutMs = PORT_PROBE_TIMEOUT) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host });
    const timer = setTimeout(() => { socket.destroy(); resolve(false); }, timeoutMs);
    socket.on('connect', () => { clearTimeout(timer); socket.destroy(); resolve(true); });
    socket.on('error', () => { clearTimeout(timer); resolve(false); });
  });
}

/**
 * HTTP GET 探测，返回状态码
 */
function httpProbe(url, timeoutMs = API_CHECK_TIMEOUT) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      res.resume(); // drain
      resolve(res.statusCode);
    });
    req.on('error', () => resolve(0));
    req.on('timeout', () => { req.destroy(); resolve(0); });
  });
}

// ─── 服务器管理 ──────────────────────────────────────────────

/**
 * 检测已运行的服务器
 * @returns {Promise<{backend: {port: number}|null, frontend: {port: number}|null}>}
 */
async function detectRunningServers(profile) {
  const result = { backend: null, frontend: null };

  if (profile && profile.backend) {
    if (await isPortListening(profile.backend.port)) {
      result.backend = { port: profile.backend.port };
    }
  }
  if (profile && profile.frontend) {
    if (await isPortListening(profile.frontend.port)) {
      result.frontend = { port: profile.frontend.port };
    }
  }
  return result;
}

/**
 * 启动服务器进程并等待就绪
 * @returns {Promise<{proc: ChildProcess, port: number}>}
 */
function startServer(projectRoot, config, timeoutMs) {
  return new Promise((resolve, reject) => {
    const cwd = path.resolve(projectRoot, config.dir);
    if (!fs.existsSync(cwd)) {
      reject(new Error(`目录不存在: ${config.dir}`));
      return;
    }

    // 检查 node_modules（前端项目）
    if (config.cmd.startsWith('npm') && !fs.existsSync(path.join(cwd, 'node_modules'))) {
      reject(new Error(`${config.dir}/node_modules 不存在 — 请先运行 npm install`));
      return;
    }

    const [cmd, ...args] = config.cmd.split(/\s+/);
    const proc = spawn(cmd, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
      env: { ...process.env, FORCE_COLOR: '0', CI: '1' },
    });

    const stdoutBuf = [];
    const stderrBuf = [];
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      const lastOutput = [...stderrBuf, ...stdoutBuf].slice(-8).join('\n');
      reject(new Error(`服务器启动超时（${Math.round(timeoutMs / 1000)}s）: ${config.cmd}\n最后输出:\n${lastOutput}`));
    }, timeoutMs);

    const onData = (data) => {
      const line = data.toString();
      stdoutBuf.push(line);
      if (stdoutBuf.length > 50) stdoutBuf.shift();
      if (!settled && config.readyPattern.test(line)) {
        settled = true;
        clearTimeout(timer);
        resolve({ proc, port: config.port });
      }
    };

    proc.stdout.on('data', onData);
    proc.stderr.on('data', (data) => {
      const line = data.toString();
      stderrBuf.push(line);
      if (stderrBuf.length > 50) stderrBuf.shift();
      // 有些工具把 ready 信息输出到 stderr（如 vite）
      if (!settled && config.readyPattern.test(line)) {
        settled = true;
        clearTimeout(timer);
        resolve({ proc, port: config.port });
      }
    });

    proc.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`服务器启动失败: ${err.message}`));
    });

    proc.on('exit', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const lastOutput = [...stderrBuf, ...stdoutBuf].slice(-8).join('\n');
      reject(new Error(`服务器进程退出（code ${code}）: ${config.cmd}\n${lastOutput}`));
    });
  });
}

/**
 * 安全杀掉进程
 */
function killProcess(proc) {
  if (!proc || proc.killed) return;
  try {
    // 尝试杀进程组
    if (proc.pid) {
      try { process.kill(-proc.pid, 'SIGTERM'); } catch { /* ignore */ }
    }
    proc.kill('SIGTERM');
    // 2秒后强杀
    setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch { /* ignore */ }
    }, 2000);
  } catch { /* already dead */ }
}

// ─── v3.0.0 API Schema 提取 ────────────────────────────────

/**
 * 从 spec.md §6 API 契约中提取响应字段结构
 * 用于在 smoke 时校验 API 实际返回的字段名是否匹配
 */
function extractApiSchemas(specContent) {
  const schemas = {};

  // 匹配 API 声明后的响应字段表格
  const apiBlockRegex = /(GET|POST|PUT|DELETE|PATCH)\s+(\/api\/[^\s|,)）\]]+)[\s\S]*?(?=(?:GET|POST|PUT|DELETE|PATCH)\s+\/api\/|##\s|\n---|\Z)/g;
  let m;
  while ((m = apiBlockRegex.exec(specContent)) !== null) {
    const method = m[1];
    const apiPath = m[2];
    const block = m[0];

    // 从表格中提取响应字段
    const fieldRegex = /\|\s*(\w+)\s*\|\s*(\w+)\s*\|/g;
    const fields = [];
    let fm;
    while ((fm = fieldRegex.exec(block)) !== null) {
      const name = fm[1];
      if (name !== '字段' && name !== 'field' && name !== 'Field' && name !== '参数' && name !== 'name') {
        fields.push({ name, type: fm[2] });
      }
    }

    if (fields.length > 0) {
      const key = `${method} ${apiPath}`;
      schemas[key] = { method, path: apiPath, fields };
    }
  }

  return schemas;
}

/**
 * 校验 API 实际响应的字段是否包含 spec 中声明的字段
 */
function validateApiSchema(specSchema, actualJson) {
  if (!actualJson || typeof actualJson !== 'object') return { pass: true, missing: [] };

  // 尝试找到数据层（常见的包装格式：{ data: ... }, { code: 0, data: ... }）
  let dataObj = actualJson;
  if (actualJson.data && typeof actualJson.data === 'object') {
    dataObj = actualJson.data;
  }
  // 如果数据是数组，取第一个元素
  if (Array.isArray(dataObj) && dataObj.length > 0) {
    dataObj = dataObj[0];
  }
  if (dataObj && dataObj.records && Array.isArray(dataObj.records) && dataObj.records.length > 0) {
    dataObj = dataObj.records[0]; // 分页格式
  }
  if (dataObj && dataObj.list && Array.isArray(dataObj.list) && dataObj.list.length > 0) {
    dataObj = dataObj.list[0];
  }
  if (dataObj && dataObj.items && Array.isArray(dataObj.items) && dataObj.items.length > 0) {
    dataObj = dataObj.items[0];
  }

  if (!dataObj || typeof dataObj !== 'object' || Array.isArray(dataObj)) {
    return { pass: true, missing: [] };
  }

  const actualKeys = Object.keys(dataObj);
  const missing = [];
  for (const field of specSchema.fields) {
    // 模糊匹配：camelCase 和 snake_case 互转
    const nameVariants = [
      field.name,
      field.name.replace(/([A-Z])/g, '_$1').toLowerCase(), // camelCase → snake_case
      field.name.replace(/_([a-z])/g, (_, c) => c.toUpperCase()), // snake_case → camelCase
    ];
    const found = actualKeys.some(k => nameVariants.some(v => k.toLowerCase() === v.toLowerCase()));
    if (!found) {
      missing.push(field.name);
    }
  }

  return { pass: missing.length === 0, missing };
}

// ─── v3.0.0 截图对比 ────────────────────────────────────────

/**
 * 截图并保存到 .spec-copilot/screenshots/
 * @returns {Promise<string|null>} 截图文件路径
 */
async function takeAndSaveScreenshot(page, projectRoot, routeKey) {
  try {
    const ssDir = path.join(projectRoot, '.spec-copilot', 'screenshots');
    if (!fs.existsSync(ssDir)) fs.mkdirSync(ssDir, { recursive: true });

    const safeName = routeKey.replace(/[\/\\:*?"<>|]/g, '_').replace(/^_/, '');
    const ssPath = path.join(ssDir, `${safeName}.png`);
    const prevPath = path.join(ssDir, `${safeName}.prev.png`);

    // 如果已有截图，重命名为 .prev.png
    if (fs.existsSync(ssPath)) {
      fs.copyFileSync(ssPath, prevPath);
    }

    await page.screenshot({ path: ssPath, fullPage: false });
    return ssPath;
  } catch {
    return null;
  }
}

/**
 * 比较两张截图的像素差异（简单版：比较文件大小差异作为启发式）
 * 真正的像素对比需要 pixelmatch 库，这里用文件大小差异 + 尺寸比较作为轻量替代
 *
 * @returns {{ changed: boolean, delta: number, detail: string }|null}
 */
function compareScreenshots(currentPath, projectRoot) {
  try {
    const safeName = path.basename(currentPath, '.png');
    const prevPath = path.join(path.dirname(currentPath), `${safeName}.prev.png`);

    if (!fs.existsSync(prevPath)) return null; // 首次截图，无对比

    const currentSize = fs.statSync(currentPath).size;
    const prevSize = fs.statSync(prevPath).size;
    const sizeDelta = Math.abs(currentSize - prevSize);
    const sizeRatio = sizeDelta / Math.max(currentSize, prevSize);

    // 文件大小变化超过 30% 视为 UI 有变化
    if (sizeRatio > 0.3) {
      return {
        changed: true,
        delta: Math.round(sizeRatio * 100),
        detail: `截图文件大小变化 ${Math.round(sizeRatio * 100)}%（${prevSize} → ${currentSize} bytes）`,
      };
    }

    return { changed: false, delta: Math.round(sizeRatio * 100), detail: '' };
  } catch {
    return null;
  }
}

// ─── Spec 解析 ───────────────────────────────────────────────

/**
 * 从 spec.md 提取可测试的页面路由和 API 端点
 */
function extractSpecRoutes(specContent) {
  const pages = [];
  const apis = [];
  const seen = new Set();

  // 1. 提取 API 路径（§6 接口契约）
  const apiRegex = /(?:GET|POST|PUT|DELETE|PATCH)\s+(\/api\/[^\s|,)）]+)/g;
  let m;
  while ((m = apiRegex.exec(specContent)) !== null) {
    const apiPath = m[1].replace(/\{[^}]+\}/g, '1'); // 替换路径参数
    if (!seen.has(apiPath)) {
      seen.add(apiPath);
      apis.push({ method: m[0].split(/\s/)[0], path: apiPath });
    }
  }

  // 2. 提取显式页面路由
  const routeRegex = /(?:路由|route|path|页面路径)[：:]\s*([\/\w\-:]+)/gi;
  while ((m = routeRegex.exec(specContent)) !== null) {
    const route = m[1];
    if (!seen.has('page:' + route)) {
      seen.add('page:' + route);
      pages.push({ route, specRef: `路由声明` });
    }
  }

  // 3. 从路由表格提取
  const tableRouteRegex = /\|\s*(\/[a-zA-Z][\w\-\/:]*)\s*\|/g;
  while ((m = tableRouteRegex.exec(specContent)) !== null) {
    const route = m[1].replace(/:[a-zA-Z]+/g, '1'); // :id → 1
    if (!seen.has('page:' + route)) {
      seen.add('page:' + route);
      pages.push({ route, specRef: '路由表' });
    }
  }

  // 4. 从功能点提取隐含页面
  const featureRegex = /(F\d{2,})[^|]*?\|[^|]*?(列表页?|编辑页?|详情页?|新增页?|表单页?|管理页?|首页|仪表盘|Dashboard)/gi;
  while ((m = featureRegex.exec(specContent)) !== null) {
    const fpId = m[1];
    const pageType = m[2];
    // 不加具体路由（我们不知道），标记为需要从 router 反查
    if (!seen.has('fp:' + fpId)) {
      seen.add('fp:' + fpId);
      pages.push({ route: null, specRef: `${fpId} ${pageType}`, needsRouterLookup: true });
    }
  }

  // 5. 确保根路由存在
  if (!pages.some(p => p.route === '/')) {
    pages.unshift({ route: '/', specRef: '根路由' });
  }

  return { pages, apis };
}

/**
 * 从前端 router 文件中提取实际路由，补全 spec 中未显式声明路由的功能点
 */
function resolveRoutesFromProject(projectRoot, specRoutes) {
  const feRoots = ['frontend/src', 'app/src', 'src'].filter(r =>
    fs.existsSync(path.join(projectRoot, r))
  );

  // 查找 router 文件
  let routerContent = '';
  for (const root of feRoots) {
    for (const name of ['router/index.ts', 'router/index.js', 'router.ts', 'router.js']) {
      const p = path.join(projectRoot, root, name);
      if (fs.existsSync(p)) {
        routerContent += fs.readFileSync(p, 'utf-8') + '\n';
      }
    }
  }

  if (!routerContent) return specRoutes;

  // 提取所有 path: '/xxx' 声明
  const routePaths = [];
  const pathRegex = /path:\s*['"]([^'"]+)['"]/g;
  let m;
  while ((m = pathRegex.exec(routerContent)) !== null) {
    const route = m[1];
    if (route !== '*' && route !== '/:pathMatch(.*)' && route !== '/:catchAll(.*)') {
      routePaths.push(route);
    }
  }

  // 把 router 里的路由全加入测试列表（去重）
  const existingRoutes = new Set(specRoutes.pages.filter(p => p.route).map(p => p.route));
  for (const route of routePaths) {
    // 替换动态参数
    const staticRoute = route.replace(/:[\w]+/g, '1');
    if (!existingRoutes.has(staticRoute) && !existingRoutes.has(route)) {
      existingRoutes.add(staticRoute);
      specRoutes.pages.push({ route: staticRoute, specRef: 'router 声明' });
    }
  }

  // 移除 needsRouterLookup 标记的占位条目（已从 router 补全）
  specRoutes.pages = specRoutes.pages.filter(p => !p.needsRouterLookup);

  return specRoutes;
}

/**
 * 从 spec.md 的验收场景矩阵提取 ACxx 场景
 */
function extractAcceptanceScenarios(specContent) {
  const scenarios = [];
  const seen = new Set();
  const rowRegex = /^\|\s*(AC\d+)\s*\|\s*([^|\n]+?)\s*\|\s*([^|\n]+?)\s*\|\s*([^|\n]+?)\s*\|\s*([^|\n]+?)\s*\|?\s*$/gm;
  let m;
  while ((m = rowRegex.exec(specContent)) !== null) {
    const id = m[1].trim();
    if (seen.has(id)) continue;
    seen.add(id);
    scenarios.push({
      id,
      type: m[2].trim().toLowerCase(),
      steps: m[3].trim(),
      expected: m[4].trim(),
      refs: m[5].split(',').map(s => s.trim()).filter(Boolean),
    });
  }
  return scenarios;
}

function splitScenarioSteps(stepsText) {
  return stepsText
    .split(/\s*(?:→|->|=>|\/)\s*/g)
    .map(s => s.trim())
    .filter(Boolean);
}

function inferStepRequirement(stepText) {
  const text = stepText.trim();
  return {
    text,
    kind:
      /(打开|进入|访问|进入列表|进入详情|跳转|进入页面)/i.test(text) ? 'open' :
      /(查询|搜索|筛选|检索|search|filter)/i.test(text) ? 'search' :
      /(分页|下一页|上一页|翻页|page)/i.test(text) ? 'pagination' :
      /(查看详情|详情|查看|detail)/i.test(text) ? 'detail' :
      /(新增|新建|创建|录入|填写|编辑|提交|保存)/i.test(text) ? 'form' :
      /(删除|作废|撤销|停用)/i.test(text) ? 'mutation' :
      /(提示|校验|报错|失败|拦截|异常|文案)/i.test(text) ? 'feedback' :
      'generic',
  };
}

function inferScenarioSignals(scenario) {
  const text = `${scenario.steps} ${scenario.expected}`;
  const parsedSteps = splitScenarioSteps(scenario.steps).map(inferStepRequirement);
  return {
    parsedSteps,
    needsSearch: /(查询|搜索|筛选|search|filter)/i.test(text),
    needsPagination: /(分页|下一页|上一页|page\s*\d|第\s*\d+\s*页)/i.test(text),
    needsFormSubmit: /(新增|新建|创建|录入|提交|保存|编辑)/i.test(text),
    needsDetail: /(查看详情|详情页|查看|详情|detail)/i.test(text),
    needsListRefresh: /(列表|刷新|结果|table|grid)/i.test(text),
    needsErrorFeedback: scenario.type === 'rule' || scenario.type === 'error' || /(报错|错误|提示|校验|拦截|失败|文案)/i.test(text),
  };
}

function summarizeAcceptanceCoverage(scenarios, pageResults, apiResults, interactionResults, apiInteractionSummary) {
  if (!scenarios.length) {
    return {
      total: 0,
      covered: 0,
      partial: 0,
      missing: 0,
      scenarios: [],
      byType: {},
      failures: [],
      warnings: [],
    };
  }

  const allInteractions = interactionResults.flatMap(r => r.interactions || []);
  const lowerRoutes = pageResults.map(p => (p.route || '').toLowerCase());
  const pagePassCount = pageResults.filter(p => p.pass).length;
  const apiHealthy = (apiInteractionSummary && apiInteractionSummary.ok > 0) || apiResults.some(a => a.pass);
  const negativeEvidence =
    pageResults.some(p => (p.failures || []).some(f => /4xx|校验|提示|失败|错误/.test(f))) ||
    interactionResults.some(r => (r.failures || []).some(f => /4xx|5xx|校验|失败|错误/.test(f)) || (r.warnings || []).some(w => /400|校验|提示/.test(w))) ||
    (apiInteractionSummary && (apiInteractionSummary.client4xx > 0 || apiInteractionSummary.server5xx > 0));

  const hasSearchEvidence = allInteractions.some(i => i.type === '搜索' && i.apiTriggered && (!i.apiErrors || i.apiErrors.length === 0));
  const hasPaginationEvidence = allInteractions.some(i => i.type === '分页' && i.apiTriggered);
  const hasFormSubmitEvidence = allInteractions.some(i => i.type === '表单提交' && i.apiTriggered);
  const hasCreateEvidence = allInteractions.some(i => i.type === '新增按钮' && i.exists);
  const hasDetailEvidence =
    allInteractions.some(i => i.type === '表格操作' && i.actionCount > 0) ||
    lowerRoutes.some(route => /detail|info|view|edit|form|\/1$|\/details?/.test(route));
  const hasListEvidence =
    allInteractions.some(i => i.type === '搜索' || i.type === '分页') ||
    lowerRoutes.some(route => /list|index|manage|table|query|search/.test(route)) ||
    pagePassCount > 0;
  const hasMutationEvidence = allInteractions.some(i => i.type === '表单提交' && i.apiTriggered);

  const details = scenarios.map((scenario) => {
    const signals = inferScenarioSignals(scenario);
    const evidence = [];
    const missing = [];
    const stepMatches = [];

    if (pagePassCount > 0) evidence.push('页面可访问');
    else missing.push('页面访问证据');

    if (apiHealthy) evidence.push('API 联通');
    else missing.push('API 联通证据');

    if (signals.needsSearch) {
      if (hasSearchEvidence) evidence.push('搜索交互');
      else missing.push('搜索交互');
    }
    if (signals.needsPagination) {
      if (hasPaginationEvidence) evidence.push('分页交互');
      else missing.push('分页交互');
    }
    if (signals.needsFormSubmit) {
      if (hasFormSubmitEvidence) evidence.push('表单提交');
      else if (hasCreateEvidence) evidence.push('新增入口存在');
      else missing.push('表单提交');
    }
    if (signals.needsDetail) {
      if (hasDetailEvidence) evidence.push('详情/行操作');
      else missing.push('详情/查看交互');
    }
    if (signals.needsListRefresh) {
      if (hasListEvidence) evidence.push('列表交互');
      else missing.push('列表刷新');
    }
    if (signals.needsErrorFeedback) {
      if (negativeEvidence) evidence.push('异常/校验反馈');
      else missing.push('异常/校验反馈');
    }

    for (const step of signals.parsedSteps) {
      let matched = false;
      let matchedBy = '';
      switch (step.kind) {
        case 'open':
          matched = pagePassCount > 0;
          matchedBy = matched ? '页面可访问' : '';
          break;
        case 'search':
          matched = hasSearchEvidence;
          matchedBy = matched ? '搜索交互' : '';
          break;
        case 'pagination':
          matched = hasPaginationEvidence;
          matchedBy = matched ? '分页交互' : '';
          break;
        case 'detail':
          matched = hasDetailEvidence;
          matchedBy = matched ? '详情/行操作' : '';
          break;
        case 'form':
          matched = hasFormSubmitEvidence || hasCreateEvidence;
          matchedBy = hasFormSubmitEvidence ? '表单提交' : (hasCreateEvidence ? '新增入口存在' : '');
          break;
        case 'mutation':
          matched = hasMutationEvidence;
          matchedBy = matched ? '表单提交' : '';
          break;
        case 'feedback':
          matched = negativeEvidence;
          matchedBy = matched ? '异常/校验反馈' : '';
          break;
        default:
          matched = apiHealthy || pagePassCount > 0;
          matchedBy = matched ? '页面/API 基础证据' : '';
          break;
      }
      stepMatches.push({
        step: step.text,
        kind: step.kind,
        matched,
        matchedBy,
      });
    }

    const matchedStepCount = stepMatches.filter(s => s.matched).length;
    const totalStepCount = stepMatches.length;
    const stepCoverage = totalStepCount > 0 ? matchedStepCount / totalStepCount : (evidence.length > 0 ? 1 : 0);
    if (totalStepCount > 0 && matchedStepCount === 0) {
      missing.push('步骤级执行证据');
    } else if (totalStepCount > 0 && matchedStepCount < totalStepCount) {
      missing.push(`步骤覆盖不足(${matchedStepCount}/${totalStepCount})`);
    }

    let status = 'covered';
    if (missing.length === 0 && evidence.length === 0) status = 'missing';
    else if (missing.length > 0 && evidence.length > 0) status = 'partial';
    else if (missing.length > 0) status = 'missing';
    if (status === 'covered' && totalStepCount > 0 && stepCoverage < 1) {
      status = 'partial';
    }
    if (scenario.type === 'happy' && totalStepCount >= 2 && stepCoverage < 0.6) {
      status = 'missing';
    }

    return {
      ...scenario,
      status,
      evidence,
      missing,
      stepMatches,
      matchedStepCount,
      totalStepCount,
      stepCoverage,
    };
  });

  const byType = {};
  for (const item of details) {
    const type = item.type || 'unknown';
    if (!byType[type]) byType[type] = { total: 0, covered: 0, partial: 0, missing: 0 };
    byType[type].total += 1;
    byType[type][item.status] += 1;
  }

  const covered = details.filter(s => s.status === 'covered').length;
  const partial = details.filter(s => s.status === 'partial').length;
  const missing = details.filter(s => s.status === 'missing').length;
  const failures = [];
  const warnings = [];

  const happyStats = byType.happy || { total: 0, covered: 0 };
  if (covered === 0) {
    failures.push(`验收场景闭环为 0/${details.length}，spec 中的 ACxx 尚未形成 smoke/e2e 可验证证据`);
  }
  if (happyStats.total > 0 && happyStats.covered === 0) {
    failures.push(`happy 场景 0/${happyStats.total} 完整覆盖，核心主流程仍缺少可验证闭环`);
  }
  const weakHappy = details.filter(s => s.type === 'happy' && s.totalStepCount >= 2 && s.stepCoverage < 0.6);
  if (weakHappy.length > 0) {
    failures.push(`happy 场景步骤覆盖不足: ${weakHappy.slice(0, 5).map(s => `${s.id}(${s.matchedStepCount}/${s.totalStepCount})`).join(', ')}`);
  }
  if (missing > 0 && failures.length === 0) {
    warnings.push(`${missing} 个 AC 场景仍未覆盖：${details.filter(s => s.status === 'missing').slice(0, 5).map(s => s.id).join(', ')}`);
  }

  return {
    total: details.length,
    covered,
    partial,
    missing,
    scenarios: details,
    byType,
    failures,
    warnings,
  };
}

// ─── 浏览器检查 ──────────────────────────────────────────────

/**
 * 判断控制台消息是否为无害噪音
 */
function isBenignConsoleMsg(text) {
  return BENIGN_CONSOLE_PATTERNS.some(p => p.test(text));
}

/** API 相关的控制台错误关键词 — 从 warning 提升为 failure */
const API_ERROR_KEYWORDS = [
  /failed to fetch/i,
  /network\s*error/i,
  /ERR_CONNECTION_REFUSED/i,
  /ECONNREFUSED/i,
  /404\s*not\s*found/i,
  /axios.*error/i,
  /request.*failed/i,
  /api.*error/i,
  /Cannot read propert.*of (null|undefined)/i, // 常见的 API 返回格式不对导致的前端崩溃
  /TypeError.*undefined is not/i,
];

/**
 * 对单个页面执行浏览器检查（v2.7.0 增强版）
 *
 * 检查维度：
 *   L1 基础：白屏、HTTP 状态码、框架错误遮罩、未捕获异常
 *   L2 联调：API 4xx/5xx、API 返回非 JSON、空数据渲染、控制台 API 错误
 *
 * @returns {Promise<PageResult>}
 */
async function checkPage(page, baseUrl, routeInfo, timeoutMs) {
  const result = {
    route: routeInfo.route,
    specRef: routeInfo.specRef,
    pass: true,
    failures: [],
    warnings: [],
    loadTimeMs: 0,
    apiInteractions: [],  // v2.7.0: 记录所有 API 交互
  };

  const consoleErrors = [];
  const consoleApiErrors = [];   // v2.7.0: API 相关的控制台错误单独跟踪
  const networkFailures = [];
  const pageErrors = [];
  const apiResponses = [];       // v2.7.0: 收集所有 API 响应详情

  // 监听控制台
  const onConsole = (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      if (isBenignConsoleMsg(text)) return;

      // v2.7.0: API 相关错误单独归类（将升级为 failure）
      if (API_ERROR_KEYWORDS.some(p => p.test(text))) {
        consoleApiErrors.push(text.slice(0, 200));
      } else {
        consoleErrors.push(text.slice(0, 200));
      }
    }
  };
  page.on('console', onConsole);

  // 监听未捕获异常
  const onPageError = (err) => {
    pageErrors.push(err.message.slice(0, 200));
  };
  page.on('pageerror', onPageError);

  // 监听网络请求失败
  const onRequestFailed = (req) => {
    const url = req.url();
    if (url.includes('/api/') && !isBenignConsoleMsg(url)) {
      const failure = req.failure();
      networkFailures.push(`${req.method()} ${url}: ${failure ? failure.errorText : 'unknown'}`);
    }
  };
  page.on('requestfailed', onRequestFailed);

  // v2.7.0: 监听所有 API 响应（4xx + 5xx + 非 JSON 检测）
  const onResponse = async (res) => {
    const url = res.url();
    if (!url.includes('/api/')) return;

    const status = res.status();
    const info = {
      method: res.request().method(),
      url: url.slice(0, 150),
      status,
      contentType: '',
      isJson: true,
      error: null,
    };

    try {
      const contentType = res.headers()['content-type'] || '';
      info.contentType = contentType.slice(0, 80);

      // v2.7.0: 检测后端返回 HTML 而不是 JSON（常见联调问题：接口不存在时后端返回 404 HTML 页面）
      if (status >= 200 && status < 300 && contentType && !contentType.includes('json')) {
        info.isJson = false;
        info.error = `API 返回非 JSON（Content-Type: ${contentType.slice(0, 50)}）`;
      }
    } catch { /* headers 读取失败时静默 */ }

    if (status >= 400) {
      info.error = `HTTP ${status}`;
    }

    apiResponses.push(info);
  };
  page.on('response', onResponse);

  try {
    const fullUrl = `${baseUrl}${routeInfo.route}`;
    const startTime = Date.now();

    // 导航
    const response = await page.goto(fullUrl, {
      waitUntil: 'networkidle',
      timeout: timeoutMs,
    });
    result.loadTimeMs = Date.now() - startTime;

    // 等一小段时间让异步渲染完成
    await page.waitForTimeout(1500);

    // ── Check 1：HTTP 状态码 ──
    if (response && response.status() >= 400) {
      const finalUrl = page.url();
      if (!finalUrl.includes('/login') && !finalUrl.includes('/auth')) {
        result.failures.push(`HTTP ${response.status()} 响应`);
      }
    }

    // ── Check 2：白屏检测 ──
    const bodyInfo = await page.evaluate(() => {
      const body = document.body;
      return {
        text: (body.innerText || '').trim().slice(0, 500),
        childCount: body.children.length,
        hasApp: !!document.querySelector('#app') || !!document.querySelector('#root'),
        appChildCount: (() => {
          const app = document.querySelector('#app') || document.querySelector('#root');
          return app ? app.children.length : 0;
        })(),
        title: document.title || '',
      };
    });

    if (bodyInfo.appChildCount === 0 && bodyInfo.text.length < 10) {
      result.failures.push('白屏：#app/#root 无子元素且页面无文本内容');
    } else if (bodyInfo.text.length < 5 && bodyInfo.childCount < 2) {
      result.failures.push(`疑似白屏：body 仅 ${bodyInfo.childCount} 个子元素、${bodyInfo.text.length} 字符文本`);
    }

    // ── Check 3：框架错误遮罩 ──
    const hasErrorOverlay = await page.evaluate(() => {
      const viteOverlay = document.querySelector('vite-error-overlay');
      const reactOverlay = document.querySelector('#webpack-dev-server-client-overlay') ||
                           document.querySelector('[data-reactroot] + div[style*="position: fixed"]');
      const vueError = document.querySelector('.vue-server-renderer-error');
      const whitelabel = document.body.innerText.includes('Whitelabel Error Page');
      const cannotGet = document.body.innerText.includes('Cannot GET');
      return !!(viteOverlay || reactOverlay || vueError || whitelabel || cannotGet);
    });
    if (hasErrorOverlay) {
      result.failures.push('检测到框架错误遮罩（Vite/React error overlay 或 Spring Boot Whitelabel Error）');
    }

    // ── Check 4：登录重定向检测（不算失败） ──
    const finalUrl = page.url();
    if (finalUrl.includes('/login') || finalUrl.includes('/auth')) {
      if (routeInfo.route !== '/login' && routeInfo.route !== '/auth') {
        result.warnings.push(`重定向到登录页（${finalUrl}）— 页面可达但需认证`);
        result.authGated = true;
      }
    }

    // ── Check 5：未捕获异常 ──
    if (pageErrors.length > 0) {
      result.failures.push(`${pageErrors.length} 个未捕获 JS 异常: ${pageErrors.slice(0, 3).join('; ')}`);
    }

    // ── Check 6：API 网络失败（连接被拒 = 后端没启动或接口不存在） ──
    if (networkFailures.length > 0) {
      result.failures.push(`${networkFailures.length} 个 API 请求失败: ${networkFailures.slice(0, 3).join('; ')}`);
    }

    // ── Check 7：API 4xx/5xx 响应（v2.7.0 增强：4xx 也是失败） ──
    const api4xx = apiResponses.filter(a => a.status >= 400 && a.status < 500);
    const api5xx = apiResponses.filter(a => a.status >= 500);

    if (api5xx.length > 0) {
      result.failures.push(`${api5xx.length} 个 API 返回 5xx（后端异常）: ${api5xx.slice(0, 3).map(a => `${a.status} ${a.method} ${a.url.split('?')[0]}`).join('; ')}`);
    }
    if (api4xx.length > 0) {
      // 401/403 在非 authGated 页面是失败，在 authGated 页面是预期
      const realErrors = result.authGated
        ? api4xx.filter(a => a.status !== 401 && a.status !== 403)
        : api4xx;
      if (realErrors.length > 0) {
        result.failures.push(`${realErrors.length} 个 API 返回 4xx（前后端不匹配）: ${realErrors.slice(0, 3).map(a => `${a.status} ${a.method} ${a.url.split('?')[0]}`).join('; ')}`);
      }
    }

    // ── Check 8：API 返回非 JSON（v2.7.0 新增） ──
    const nonJsonApis = apiResponses.filter(a => !a.isJson && a.status >= 200 && a.status < 300);
    if (nonJsonApis.length > 0) {
      result.failures.push(`${nonJsonApis.length} 个 API 返回非 JSON（后端可能返回了 HTML 错误页）: ${nonJsonApis.slice(0, 3).map(a => `${a.method} ${a.url.split('?')[0]} → ${a.contentType}`).join('; ')}`);
    }

    // ── Check 9：空数据渲染检测（v2.7.0 新增） ──
    // 页面有 API 调用且成功，但渲染出空状态 → 数据格式对不上
    if (!result.authGated) {
      const emptyStateInfo = await page.evaluate(() => {
        // Element Plus / Ant Design 空状态组件
        const emptyComponents = document.querySelectorAll(
          '.el-empty, .ant-empty, .a-empty, [class*="empty-state"], [class*="no-data"], [class*="noData"]'
        );
        // 常见空状态文案
        const bodyText = document.body.innerText || '';
        const emptyTextPatterns = [
          '暂无数据', '暂无内容', '没有数据', '无数据', 'No data', 'No results',
          '暂无记录', '没有记录', '数据为空', '列表为空',
        ];
        const hasEmptyText = emptyTextPatterns.some(p => bodyText.includes(p));

        // 空表格检测：有表头但无数据行
        const tables = document.querySelectorAll('.el-table, .ant-table, table');
        let emptyTableCount = 0;
        tables.forEach(t => {
          const headerCells = t.querySelectorAll('th, .el-table__header-wrapper th');
          const bodyRows = t.querySelectorAll('tbody tr, .el-table__body-wrapper tbody tr');
          // 有表头但 body 为空或只有一行"暂无数据"
          if (headerCells.length > 0 && bodyRows.length <= 1) {
            const rowText = bodyRows.length === 1 ? (bodyRows[0].innerText || '').trim() : '';
            if (bodyRows.length === 0 || emptyTextPatterns.some(p => rowText.includes(p))) {
              emptyTableCount++;
            }
          }
        });

        return {
          emptyComponentCount: emptyComponents.length,
          hasEmptyText,
          emptyTableCount,
        };
      });

      // 有成功的 API 调用 + 页面显示空状态 → 数据格式可能对不上
      const successApiCount = apiResponses.filter(a => a.status >= 200 && a.status < 300 && a.isJson).length;
      if (successApiCount > 0) {
        if (emptyStateInfo.emptyTableCount > 0) {
          result.failures.push(`${emptyStateInfo.emptyTableCount} 个表格有表头但无数据（API 有响应但数据未渲染 — 检查字段映射）`);
        }
        if (emptyStateInfo.emptyComponentCount > 0 && !emptyStateInfo.emptyTableCount) {
          result.warnings.push(`检测到 ${emptyStateInfo.emptyComponentCount} 个空状态组件（API 有响应但页面显示为空 — 可能是字段映射问题）`);
        }
      } else if (apiResponses.length === 0 && !result.authGated) {
        // 页面没有发任何 API 请求 — 可能用了 mock 数据
        if (emptyStateInfo.hasEmptyText || emptyStateInfo.emptyComponentCount > 0) {
          result.warnings.push('页面未发起任何 API 请求且显示空状态 — 可能使用了 mock 数据或未对接接口');
        }
      }
    }

    // ── Check 10：控制台 API 相关错误（v2.7.0：升级为 failure） ──
    if (consoleApiErrors.length > 0) {
      result.failures.push(`${consoleApiErrors.length} 个控制台 API 错误: ${consoleApiErrors.slice(0, 3).join('; ')}`);
    }

    // ── Check 11：控制台其他错误（warning 级） ──
    if (consoleErrors.length > 0) {
      result.warnings.push(`${consoleErrors.length} 个控制台错误: ${consoleErrors.slice(0, 3).join('; ')}`);
    }

    // ── Check 12：慢加载（warning 级） ──
    if (result.loadTimeMs > 10000) {
      result.warnings.push(`页面加载耗时 ${Math.round(result.loadTimeMs / 1000)}s（> 10s）`);
    }

    // v2.7.0: 记录 API 交互摘要
    result.apiInteractions = apiResponses.map(a => ({
      method: a.method,
      url: a.url.split('?')[0],
      status: a.status,
      isJson: a.isJson,
      error: a.error,
    }));

  } catch (err) {
    if (err.name === 'TimeoutError') {
      result.failures.push(`导航超时（${Math.round(timeoutMs / 1000)}s）`);
    } else {
      result.failures.push(`浏览器检查异常: ${err.message.slice(0, 150)}`);
    }
  } finally {
    page.removeListener('console', onConsole);
    page.removeListener('pageerror', onPageError);
    page.removeListener('requestfailed', onRequestFailed);
    page.removeListener('response', onResponse);
  }

  result.pass = result.failures.length === 0;
  return result;
}

// ─── v2.8.0 主动交互测试 ────────────────────────────────────

/**
 * 对页面执行主动交互测试
 * 不需要知道"正确结果"，只验证：交互元素存在 → 操作触发 API → API 无报错
 *
 * @returns {Promise<InteractionResult>}
 */
async function checkPageInteractions(page, baseUrl, routeInfo, timeoutMs) {
  const result = {
    route: routeInfo.route,
    interactions: [],
    failures: [],
    warnings: [],
  };

  // 如果页面被重定向到登录页，跳过交互测试
  const currentUrl = page.url();
  if (currentUrl.includes('/login') || currentUrl.includes('/auth')) {
    if (routeInfo.route !== '/login' && routeInfo.route !== '/auth') {
      result.warnings.push('页面需认证，跳过交互测试');
      return result;
    }
  }

  // ── 1. 搜索/筛选交互 ──
  try {
    const searchInfo = await page.evaluate(() => {
      // 查找搜索输入框
      const searchSelectors = [
        'input[type="search"]',
        'input[placeholder*="搜索"]', 'input[placeholder*="查询"]', 'input[placeholder*="search"]',
        'input[placeholder*="Search"]', 'input[placeholder*="请输入"]',
        '.el-input input[placeholder*="搜"]', '.el-input input[placeholder*="查"]',
        '.ant-input[placeholder*="搜"]', '.ant-input[placeholder*="查"]',
        '.el-input__inner[placeholder*="搜"]',
      ];
      for (const sel of searchSelectors) {
        const el = document.querySelector(sel);
        if (el && el.offsetParent !== null) { // visible
          return { found: true, selector: sel, placeholder: el.placeholder || '' };
        }
      }
      return { found: false };
    });

    if (searchInfo.found) {
      // 收集 API 请求
      const apiCalls = [];
      const onSearchResponse = (res) => {
        if (res.url().includes('/api/')) {
          apiCalls.push({ method: res.request().method(), url: res.url(), status: res.status() });
        }
      };
      page.on('response', onSearchResponse);

      try {
        const searchInput = await page.$(searchInfo.selector);
        if (searchInput) {
          await searchInput.click();
          await searchInput.fill('test');
          // 触发搜索：Enter 或等 debounce
          await page.keyboard.press('Enter');
          await page.waitForTimeout(2000);

          const interaction = {
            type: '搜索',
            element: searchInfo.placeholder || searchInfo.selector,
            apiTriggered: apiCalls.length > 0,
            apiCount: apiCalls.length,
            apiErrors: apiCalls.filter(a => a.status >= 400).map(a => `${a.status} ${a.method} ${a.url.split('?')[0].slice(0, 80)}`),
          };
          result.interactions.push(interaction);

          if (!interaction.apiTriggered) {
            result.warnings.push(`搜索交互未触发 API 请求（输入 "test" + Enter 后无 /api/ 请求）`);
          } else if (interaction.apiErrors.length > 0) {
            result.failures.push(`搜索触发的 API 报错: ${interaction.apiErrors.slice(0, 2).join('; ')}`);
          }

          // 清空搜索恢复原状
          await searchInput.fill('');
          await page.keyboard.press('Enter');
          await page.waitForTimeout(1000);
        }
      } finally {
        page.removeListener('response', onSearchResponse);
      }
    }
  } catch (e) {
    result.warnings.push(`搜索交互测试异常: ${e.message.slice(0, 100)}`);
  }

  // ── 2. 分页交互 ──
  try {
    const paginationInfo = await page.evaluate(() => {
      const paginationSelectors = [
        '.el-pagination', '.ant-pagination', '.pagination',
        'nav[aria-label*="pagination"]', '[class*="pager"]',
      ];
      for (const sel of paginationSelectors) {
        const el = document.querySelector(sel);
        if (el && el.offsetParent !== null) {
          // 查找"下一页"或页码 2 按钮
          const nextBtn = el.querySelector(
            '.el-icon-arrow-right, .anticon-right, .btn-next, ' +
            'button[aria-label="Next"], li.number:nth-child(2), ' +
            '.el-pager li:nth-child(2), .ant-pagination-item:nth-child(2)'
          );
          // 也查找带数字 2 的分页按钮
          const page2Btns = el.querySelectorAll('li, button, a');
          let page2Ref = null;
          page2Btns.forEach(btn => {
            if ((btn.textContent || '').trim() === '2' && btn.offsetParent !== null) {
              page2Ref = true;
            }
          });
          return {
            found: true,
            selector: sel,
            hasNextOrPage2: !!(nextBtn || page2Ref),
          };
        }
      }
      return { found: false };
    });

    if (paginationInfo.found && paginationInfo.hasNextOrPage2) {
      const apiCalls = [];
      const onPageResponse = (res) => {
        if (res.url().includes('/api/')) {
          apiCalls.push({ method: res.request().method(), url: res.url(), status: res.status() });
        }
      };
      page.on('response', onPageResponse);

      try {
        // 点击页码 2
        const clicked = await page.evaluate((sel) => {
          const pagination = document.querySelector(sel);
          if (!pagination) return false;
          const btns = pagination.querySelectorAll('li, button, a');
          for (const btn of btns) {
            if ((btn.textContent || '').trim() === '2' && btn.offsetParent !== null) {
              btn.click();
              return true;
            }
          }
          // 回退：点下一页
          const next = pagination.querySelector('.btn-next, button[aria-label="Next"]');
          if (next) { next.click(); return true; }
          return false;
        }, paginationInfo.selector);

        if (clicked) {
          await page.waitForTimeout(2000);

          const interaction = {
            type: '分页',
            element: paginationInfo.selector,
            apiTriggered: apiCalls.length > 0,
            apiCount: apiCalls.length,
            apiErrors: apiCalls.filter(a => a.status >= 400).map(a => `${a.status} ${a.method} ${a.url.split('?')[0].slice(0, 80)}`),
            hasPageParam: apiCalls.some(a => /[?&](page|pageNum|current|offset)=/i.test(a.url)),
          };
          result.interactions.push(interaction);

          if (!interaction.apiTriggered) {
            result.warnings.push('分页点击未触发 API 请求（可能是前端假分页）');
          } else if (!interaction.hasPageParam) {
            result.warnings.push('分页 API 请求无分页参数（page/pageNum/current）— 可能未正确传参');
          } else if (interaction.apiErrors.length > 0) {
            result.failures.push(`分页触发的 API 报错: ${interaction.apiErrors.slice(0, 2).join('; ')}`);
          }
        }
      } finally {
        page.removeListener('response', onPageResponse);
      }
    }
  } catch (e) {
    result.warnings.push(`分页交互测试异常: ${e.message.slice(0, 100)}`);
  }

  // ── 3. 新增/创建按钮交互（只检测存在性和可点击性，不实际提交） ──
  try {
    const createBtnInfo = await page.evaluate(() => {
      const btnTexts = ['新增', '新建', '添加', '创建', 'Add', 'Create', 'New', '+ 新增', '＋新增'];
      const allBtns = document.querySelectorAll('button, .el-button, .ant-btn, a.btn');
      for (const btn of allBtns) {
        const text = (btn.textContent || '').trim();
        if (btnTexts.some(t => text.includes(t)) && btn.offsetParent !== null) {
          return {
            found: true,
            text: text.slice(0, 30),
            disabled: btn.disabled || btn.classList.contains('is-disabled'),
          };
        }
      }
      return { found: false };
    });

    if (createBtnInfo.found) {
      const interaction = {
        type: '新增按钮',
        element: createBtnInfo.text,
        exists: true,
        disabled: createBtnInfo.disabled,
      };
      result.interactions.push(interaction);

      if (createBtnInfo.disabled) {
        result.warnings.push(`新增按钮 "${createBtnInfo.text}" 存在但被禁用`);
      }
    }
  } catch (e) {
    // 静默
  }

  // ── 4. 表格行操作按钮检测 ──
  try {
    const tableActionInfo = await page.evaluate(() => {
      const tables = document.querySelectorAll('.el-table, .ant-table, table');
      if (tables.length === 0) return { found: false };

      const actionTexts = ['编辑', '删除', '查看', '详情', 'Edit', 'Delete', 'View', 'Detail'];
      let actionCount = 0;
      let disabledCount = 0;

      tables.forEach(table => {
        const rows = table.querySelectorAll('tbody tr');
        if (rows.length === 0) return;
        // 只检查第一行
        const firstRow = rows[0];
        const btns = firstRow.querySelectorAll('button, .el-button, .ant-btn, a');
        btns.forEach(btn => {
          const text = (btn.textContent || '').trim();
          if (actionTexts.some(t => text.includes(t))) {
            actionCount++;
            if (btn.disabled || btn.classList.contains('is-disabled')) disabledCount++;
          }
        });
      });

      return { found: actionCount > 0, actionCount, disabledCount };
    });

    if (tableActionInfo.found) {
      result.interactions.push({
        type: '表格操作',
        actionCount: tableActionInfo.actionCount,
        disabledCount: tableActionInfo.disabledCount,
      });
    }
  } catch (e) {
    // 静默
  }

  // ── 5. 表单提交测试（v2.9.0）──
  // 找到新增/创建按钮 → 点击打开表单 → 填写测试数据 → 提交 → 检查 POST/PUT 请求
  try {
    // 5a. 检测是否有可点击的新增按钮（复用 check 3 的结果）
    const formTestInfo = await page.evaluate(() => {
      const btnTexts = ['新增', '新建', '添加', '创建', 'Add', 'Create', 'New', '+ 新增', '＋新增'];
      const allBtns = document.querySelectorAll('button, .el-button, .ant-btn, a.btn');
      for (const btn of allBtns) {
        const text = (btn.textContent || '').trim();
        if (btnTexts.some(t => text.includes(t)) && btn.offsetParent !== null && !btn.disabled && !btn.classList.contains('is-disabled')) {
          return { found: true, text: text.slice(0, 30) };
        }
      }
      return { found: false };
    });

    if (formTestInfo.found) {
      const formApiCalls = [];
      const onFormResponse = (res) => {
        if (res.url().includes('/api/')) {
          formApiCalls.push({
            method: res.request().method(),
            url: res.url(),
            status: res.status(),
          });
        }
      };
      page.on('response', onFormResponse);

      try {
        // 点击新增按钮
        const clicked = await page.evaluate((btnTexts) => {
          const allBtns = document.querySelectorAll('button, .el-button, .ant-btn, a.btn');
          for (const btn of allBtns) {
            const text = (btn.textContent || '').trim();
            if (btnTexts.some(t => text.includes(t)) && btn.offsetParent !== null && !btn.disabled) {
              btn.click();
              return true;
            }
          }
          return false;
        }, ['新增', '新建', '添加', '创建', 'Add', 'Create', 'New', '+ 新增', '＋新增']);

        if (clicked) {
          await page.waitForTimeout(1500);

          // 5b. 检测是否弹出了表单（dialog/drawer/新页面）
          const formInfo = await page.evaluate(() => {
            // 检测弹窗/抽屉
            const dialogSelectors = [
              '.el-dialog:not([style*="display: none"])',
              '.el-drawer:not([style*="display: none"])',
              '.ant-modal:not([style*="display: none"])',
              '.ant-drawer:not([style*="display: none"])',
              '.modal.show', '.modal.fade.show',
              '[role="dialog"]:not([style*="display: none"])',
            ];
            let formContainer = null;
            for (const sel of dialogSelectors) {
              const el = document.querySelector(sel);
              if (el && el.offsetParent !== null) {
                formContainer = el;
                break;
              }
            }

            // 如果没有弹窗，检查页面上是否新出现了表单
            if (!formContainer) {
              const forms = document.querySelectorAll('form, .el-form, .ant-form');
              for (const f of forms) {
                if (f.offsetParent !== null) { formContainer = f; break; }
              }
            }

            if (!formContainer) return { found: false };

            // 收集可填写的输入框
            const inputs = formContainer.querySelectorAll(
              'input[type="text"], input[type="number"], input[type="email"], input[type="tel"], ' +
              'input:not([type]), textarea, ' +
              '.el-input__inner, .ant-input'
            );
            const visibleInputs = [];
            inputs.forEach(input => {
              if (input.offsetParent !== null && !input.disabled && !input.readOnly) {
                visibleInputs.push({
                  tag: input.tagName.toLowerCase(),
                  type: input.type || 'text',
                  placeholder: (input.placeholder || '').slice(0, 50),
                  name: input.name || '',
                  id: input.id || '',
                });
              }
            });

            // 查找提交按钮
            const submitTexts = ['确定', '保存', '提交', '确认', 'OK', 'Save', 'Submit', 'Confirm'];
            const allBtns = formContainer.querySelectorAll('button, .el-button, .ant-btn');
            let submitBtn = null;
            allBtns.forEach(btn => {
              const text = (btn.textContent || '').trim();
              if (submitTexts.some(t => text.includes(t)) && btn.offsetParent !== null) {
                submitBtn = { text: text.slice(0, 20) };
              }
            });

            return {
              found: true,
              inputCount: visibleInputs.length,
              inputs: visibleInputs.slice(0, 10),
              hasSubmitBtn: !!submitBtn,
              submitBtnText: submitBtn ? submitBtn.text : null,
            };
          });

          if (formInfo.found && formInfo.inputCount > 0) {
            // 5c. 填写测试数据
            const testData = {
              text: '测试数据',
              number: '100',
              email: 'test@example.com',
              tel: '13800138000',
            };

            await page.evaluate((inputs, testData) => {
              const container = document.querySelector(
                '.el-dialog:not([style*="display: none"]), .el-drawer:not([style*="display: none"]), ' +
                '.ant-modal:not([style*="display: none"]), .ant-drawer:not([style*="display: none"]), ' +
                '[role="dialog"]:not([style*="display: none"]), form, .el-form, .ant-form'
              );
              if (!container) return;

              const allInputs = container.querySelectorAll(
                'input[type="text"], input[type="number"], input[type="email"], input[type="tel"], ' +
                'input:not([type]), textarea, .el-input__inner, .ant-input'
              );

              allInputs.forEach(input => {
                if (input.offsetParent === null || input.disabled || input.readOnly) return;
                const type = input.type || 'text';
                const value = testData[type] || testData.text;

                // 用 native input setter 触发 Vue/React 响应
                const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
                  window.HTMLInputElement.prototype, 'value'
                ).set;
                nativeInputValueSetter.call(input, value);
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));
              });
            }, formInfo.inputs, testData);

            await page.waitForTimeout(500);

            // 5d. 点击提交按钮
            if (formInfo.hasSubmitBtn) {
              formApiCalls.length = 0; // 清除之前打开表单时的 API 调用

              const submitted = await page.evaluate((submitTexts) => {
                const containers = document.querySelectorAll(
                  '.el-dialog:not([style*="display: none"]), .el-drawer:not([style*="display: none"]), ' +
                  '.ant-modal:not([style*="display: none"]), .ant-drawer:not([style*="display: none"]), ' +
                  '[role="dialog"]:not([style*="display: none"]), form, .el-form, .ant-form'
                );
                for (const container of containers) {
                  if (!container || container.offsetParent === null) continue;
                  const btns = container.querySelectorAll('button, .el-button, .ant-btn');
                  for (const btn of btns) {
                    const text = (btn.textContent || '').trim();
                    if (submitTexts.some(t => text.includes(t)) && !btn.disabled) {
                      btn.click();
                      return true;
                    }
                  }
                }
                return false;
              }, ['确定', '保存', '提交', '确认', 'OK', 'Save', 'Submit', 'Confirm']);

              if (submitted) {
                await page.waitForTimeout(2500);

                const postPutCalls = formApiCalls.filter(a => a.method === 'POST' || a.method === 'PUT');
                const errorCalls = formApiCalls.filter(a => a.status >= 400);

                const interaction = {
                  type: '表单提交',
                  element: formTestInfo.text,
                  inputsFilled: formInfo.inputCount,
                  submitBtn: formInfo.submitBtnText,
                  apiTriggered: postPutCalls.length > 0,
                  apiCount: postPutCalls.length,
                  apiErrors: errorCalls.map(a => `${a.status} ${a.method} ${a.url.split('?')[0].slice(0, 80)}`),
                };
                result.interactions.push(interaction);

                if (!interaction.apiTriggered) {
                  result.failures.push(`表单提交未触发 POST/PUT 请求（填写 ${formInfo.inputCount} 个字段 → 点击 "${formInfo.submitBtnText}" → 无 API 请求）`);
                } else if (interaction.apiErrors.length > 0) {
                  // 400 可能是验证失败（测试数据不符合业务规则），降为 warning
                  const server5xx = errorCalls.filter(a => a.status >= 500);
                  if (server5xx.length > 0) {
                    result.failures.push(`表单提交 API 返回 5xx: ${server5xx.map(a => `${a.status} ${a.method} ${a.url.split('?')[0].slice(0, 80)}`).join('; ')}`);
                  } else {
                    result.warnings.push(`表单提交 API 返回 ${errorCalls[0].status}（可能是测试数据不符合业务校验规则）`);
                  }
                }
              }
            } else {
              result.warnings.push(`表单弹出但未找到提交按钮（${formInfo.inputCount} 个输入框）`);
            }
          } else if (formInfo.found && formInfo.inputCount === 0) {
            result.warnings.push('新增按钮打开了弹窗但未检测到可填写输入框');
          }

          // 5e. 关闭弹窗恢复状态
          try {
            await page.evaluate(() => {
              // 按 ESC 关闭
              document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
              // 或点取消按钮
              const cancelTexts = ['取消', '关闭', 'Cancel', 'Close'];
              const btns = document.querySelectorAll('button, .el-button, .ant-btn');
              for (const btn of btns) {
                const text = (btn.textContent || '').trim();
                if (cancelTexts.some(t => text === t) && btn.offsetParent !== null) {
                  btn.click();
                  break;
                }
              }
            });
            await page.waitForTimeout(500);
          } catch { /* 关闭失败不影响 */ }
        }
      } finally {
        page.removeListener('response', onFormResponse);
      }
    }
  } catch (e) {
    result.warnings.push(`表单提交测试异常: ${e.message.slice(0, 100)}`);
  }

  return result;
}

// ─── API 健康检查 ────────────────────────────────────────────

/**
 * 用 Node.js http 模块检查 API 端点可达性（不走 Playwright）
 */
async function checkApiEndpoints(backendUrl, apis) {
  const results = [];

  for (const api of apis) {
    const url = `${backendUrl}${api.path}`;
    try {
      const status = await httpProbe(url);
      results.push({
        method: api.method,
        path: api.path,
        status,
        pass: status > 0 && status < 500,
        error: status === 0 ? 'connection refused' : null,
      });
    } catch (e) {
      results.push({
        method: api.method,
        path: api.path,
        status: 0,
        pass: false,
        error: e.message,
      });
    }
  }

  return results;
}

// ─── 主入口 ──────────────────────────────────────────────────

/**
 * 执行 E2E 浏览器冒烟测试
 *
 * @param {string} projectRoot - 项目根目录绝对路径
 * @param {string} specContent - spec.md 完整内容
 * @param {object} [options]
 * @param {number} [options.timeout=30000] - 单页面导航超时 ms
 * @param {boolean} [options.headed=false] - 是否显示浏览器窗口
 * @param {string} [options.baseUrl] - 覆盖自动检测的前端 URL
 * @param {string} [options.backendUrl] - 覆盖自动检测的后端 URL
 * @param {boolean} [options.skipApis=false] - 跳过 API 健康检查
 * @returns {Promise<E2ESmokeResult>}
 */
async function runE2ESmoke(projectRoot, specContent, options = {}) {
  const {
    timeout = DEFAULT_PAGE_TIMEOUT,
    headed = false,
    baseUrl: overrideBaseUrl,
    backendUrl: overrideBackendUrl,
    skipApis = false,
  } = options;

  // ── Step 1：发现 Playwright + 浏览器 ──
  const pw = resolvePlaywright(projectRoot);
  if (!pw) {
    return {
      available: false,
      pass: undefined,
      skipReason: 'playwright-core 加载失败（spec-copilot 安装可能不完整）',
      pages: [],
      apiResults: [],
      consoleErrors: [],
      servers: {},
    };
  }
  if (pw.launchOptions === null) {
    return {
      available: false,
      pass: undefined,
      skipReason: '未找到系统 Chrome/Chromium 浏览器',
      installHint: process.platform === 'darwin'
        ? '安装 Chrome: https://www.google.com/chrome/ 或 brew install --cask google-chrome'
        : process.platform === 'linux'
        ? '安装 Chrome: sudo apt install google-chrome-stable 或 sudo snap install chromium'
        : '安装 Chrome: https://www.google.com/chrome/',
      pages: [],
      apiResults: [],
      consoleErrors: [],
      servers: {},
    };
  }

  // ── Step 2：检测技术栈 ──
  let profile = null;
  for (const sp of STACK_PROFILES) {
    if (sp.detect(projectRoot)) {
      profile = sp;
      break;
    }
  }

  // ── Step 3：服务器管理 ──
  const startedProcs = [];
  let frontendUrl = overrideBaseUrl || null;
  let backendUrl = overrideBackendUrl || null;
  let serverInfo = { backend: null, frontend: null, alreadyRunning: false };

  try {
    if (!frontendUrl || !backendUrl) {
      if (!profile) {
        return {
          available: true,
          pass: undefined,
          skipReason: '无法自动检测技术栈（不匹配任何已知 profile）。使用 --base-url 手动指定',
          pages: [],
          apiResults: [],
          consoleErrors: [],
          servers: {},
        };
      }

      // 探测已运行的服务器
      const running = await detectRunningServers(profile);

      // 后端
      if (profile.backend) {
        if (running.backend) {
          backendUrl = backendUrl || `http://127.0.0.1:${profile.backend.port}`;
          serverInfo.backend = { port: profile.backend.port, alreadyRunning: true };
          serverInfo.alreadyRunning = true;
        } else if (!backendUrl) {
          try {
            const be = await startServer(projectRoot, profile.backend, SERVER_START_TIMEOUT_BE);
            startedProcs.push(be.proc);
            backendUrl = `http://127.0.0.1:${be.port}`;
            serverInfo.backend = { port: be.port, cmd: profile.backend.cmd, pid: be.proc.pid };
          } catch (err) {
            return {
              available: true,
              pass: false,
              skipReason: null,
              pages: [],
              apiResults: [],
              consoleErrors: [],
              servers: serverInfo,
              startupError: `后端启动失败: ${err.message}`,
            };
          }
        }
      }

      // 前端
      if (profile.frontend) {
        if (running.frontend) {
          frontendUrl = frontendUrl || `http://127.0.0.1:${profile.frontend.port}`;
          serverInfo.frontend = { port: profile.frontend.port, alreadyRunning: true };
          serverInfo.alreadyRunning = true;
        } else if (!frontendUrl) {
          try {
            const fe = await startServer(projectRoot, profile.frontend, SERVER_START_TIMEOUT_FE);
            startedProcs.push(fe.proc);
            frontendUrl = `http://127.0.0.1:${fe.port}`;
            serverInfo.frontend = { port: fe.port, cmd: profile.frontend.cmd, pid: fe.proc.pid };
          } catch (err) {
            return {
              available: true,
              pass: false,
              skipReason: null,
              pages: [],
              apiResults: [],
              consoleErrors: [],
              servers: serverInfo,
              startupError: `前端启动失败: ${err.message}`,
            };
          }
        }
      }

      // 无前端 URL 则无法继续
      if (!frontendUrl) {
        frontendUrl = backendUrl; // 单体应用：后端同时提供前端
      }
      if (!frontendUrl) {
        return {
          available: true,
          pass: undefined,
          skipReason: '无法确定前端 URL',
          pages: [],
          apiResults: [],
          consoleErrors: [],
          servers: serverInfo,
        };
      }
    }

    // ── Step 4：从 spec 提取路由与验收场景 ──
    let specRoutes = extractSpecRoutes(specContent);
    specRoutes = resolveRoutesFromProject(projectRoot, specRoutes);
    const acceptanceScenarios = extractAcceptanceScenarios(specContent);

    // 过滤掉没有路由的条目
    const testablePages = specRoutes.pages.filter(p => p.route);

    // ── Step 5：API 健康检查 ──
    // 优先通过前端 URL 检查（Vite proxy 场景：前端 dev server 代理 /api 到后端）
    // 如果前端 URL 的 API 不通，再尝试直连后端 URL
    let apiResults = [];
    if (!skipApis && specRoutes.apis.length > 0) {
      const apiBaseUrl = frontendUrl || backendUrl;
      if (apiBaseUrl) {
        apiResults = await checkApiEndpoints(apiBaseUrl, specRoutes.apis);
        // 如果前端代理不通且有独立后端 URL，回退到直连后端
        const allFailed = apiResults.every(a => !a.pass);
        if (allFailed && backendUrl && apiBaseUrl !== backendUrl) {
          apiResults = await checkApiEndpoints(backendUrl, specRoutes.apis);
        }
      }
    }

    // ── Step 6：浏览器测试 ──
    let browser;
    try {
      browser = await pw.chromium.launch({
        ...pw.launchOptions,
        headless: !headed,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
      });

      const context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        ignoreHTTPSErrors: true,
      });

      const page = await context.newPage();
      const pageResults = [];
      const interactionResults = [];  // v2.8.0
      const allConsoleErrors = [];
      const screenshotChanges = [];   // v3.0.0

      // v3.0.0: 提取 API schema 用于响应字段校验
      const apiSchemas = extractApiSchemas(specContent);

      // v3.0.0: 监听 API 响应做 schema 校验
      const schemaViolations = [];
      const onSchemaResponse = async (res) => {
        const url = res.url();
        if (!url.includes('/api/') || res.status() < 200 || res.status() >= 300) return;

        try {
          const contentType = res.headers()['content-type'] || '';
          if (!contentType.includes('json')) return;

          const body = await res.json().catch(() => null);
          if (!body) return;

          // 找匹配的 schema
          const method = res.request().method();
          const urlPath = new URL(url).pathname;

          for (const [key, schema] of Object.entries(apiSchemas)) {
            // 模糊匹配路径（去掉数字参数）
            const schemaPath = schema.path.replace(/\{[^}]+\}/g, '\\d+');
            if (schema.method === method && new RegExp(schemaPath).test(urlPath)) {
              const validation = validateApiSchema(schema, body);
              if (!validation.pass) {
                schemaViolations.push({
                  api: `${method} ${urlPath}`,
                  specFields: schema.fields.map(f => f.name),
                  missing: validation.missing,
                });
              }
              break;
            }
          }
        } catch { /* 校验异常静默 */ }
      };
      page.on('response', onSchemaResponse);

      for (const routeInfo of testablePages) {
        const result = await checkPage(page, frontendUrl, routeInfo, timeout);
        pageResults.push(result);
        if (result.warnings) {
          allConsoleErrors.push(...result.warnings.filter(w => w.includes('控制台错误')));
        }

        // v3.0.0: 截图 + 对比
        try {
          const ssPath = await takeAndSaveScreenshot(page, projectRoot, routeInfo.route);
          if (ssPath) {
            const comparison = compareScreenshots(ssPath, projectRoot);
            if (comparison && comparison.changed) {
              screenshotChanges.push({
                route: routeInfo.route,
                ...comparison,
              });
              result.warnings.push(`UI 变化：${comparison.detail}`);
            }
          }
        } catch { /* 截图失败不影响 */ }

        // v2.8.0: 被动检查通过 + 非 authGated → 执行主动交互测试
        if (result.pass && !result.authGated) {
          try {
            const interResult = await checkPageInteractions(page, frontendUrl, routeInfo, timeout);
            if (interResult.interactions.length > 0 || interResult.failures.length > 0) {
              interactionResults.push(interResult);
            }
            if (interResult.failures.length > 0) {
              result.failures.push(...interResult.failures);
              result.pass = false;
            }
            if (interResult.warnings.length > 0) {
              result.warnings.push(...interResult.warnings);
            }
          } catch (e) {
            // 交互测试异常不影响被动检查结果
          }
          // 交互测试后重新导航回当前页面，恢复状态
          try {
            await page.goto(`${frontendUrl}${routeInfo.route}`, { waitUntil: 'networkidle', timeout });
            await page.waitForTimeout(500);
          } catch { /* 恢复失败不影响后续页面 */ }
        }
      }

      page.removeListener('response', onSchemaResponse);

      // v3.0.0: schema 校验结果合并到页面结果
      if (schemaViolations.length > 0) {
        for (const v of schemaViolations) {
          // 找对应页面或加到第一个页面
          const targetPage = pageResults.find(p => !p.authGated) || pageResults[0];
          if (targetPage) {
            targetPage.warnings.push(`API Schema 不匹配 ${v.api}: spec 声明字段 [${v.missing.join(', ')}] 在实际响应中未找到`);
          }
        }
      }

      await context.close();

      // ── 汇总结果 ──
      const failedPages = pageResults.filter(p => !p.pass);
      const failedApis = apiResults.filter(a => !a.pass);

      // v2.7.0: 汇总所有页面的 API 交互
      const allApiInteractions = pageResults.flatMap(p => p.apiInteractions || []);
      const apiInteractionSummary = {
        total: allApiInteractions.length,
        ok: allApiInteractions.filter(a => a.status >= 200 && a.status < 400 && a.isJson).length,
        client4xx: allApiInteractions.filter(a => a.status >= 400 && a.status < 500).length,
        server5xx: allApiInteractions.filter(a => a.status >= 500).length,
        nonJson: allApiInteractions.filter(a => !a.isJson && a.status >= 200 && a.status < 300).length,
        failed: allApiInteractions.filter(a => a.status === 0).length,
      };

      // v2.8.0: 汇总交互测试结果
      const interactionSummary = {
        totalPages: interactionResults.length,
        totalInteractions: interactionResults.reduce((s, r) => s + r.interactions.length, 0),
        searchTested: interactionResults.some(r => r.interactions.some(i => i.type === '搜索')),
        paginationTested: interactionResults.some(r => r.interactions.some(i => i.type === '分页')),
        failures: interactionResults.reduce((s, r) => s + r.failures.length, 0),
      };
      const acceptanceSummary = summarizeAcceptanceCoverage(
        acceptanceScenarios,
        pageResults,
        apiResults,
        interactionResults,
        apiInteractionSummary
      );

      return {
        available: true,
        pass:
          failedPages.length === 0 &&
          failedApis.filter(a => a.status === 0 || a.status >= 500).length === 0 &&
          acceptanceSummary.failures.length === 0,
        skipReason: null,
        pages: pageResults,
        apiResults,
        apiInteractionSummary,
        interactionResults,      // v2.8.0
        interactionSummary,      // v2.8.0
        acceptanceSummary,       // v3.3.0
        schemaViolations,        // v3.0.0
        screenshotChanges,       // v3.0.0
        consoleErrors: allConsoleErrors,
        servers: serverInfo,
        summary: {
          totalPages: testablePages.length,
          passedPages: testablePages.length - failedPages.length,
          failedPages: failedPages.length,
          totalApis: apiResults.length,
          passedApis: apiResults.length - failedApis.length,
          failedApis: failedApis.length,
        },
      };

    } finally {
      if (browser) {
        try { await browser.close(); } catch { /* ignore */ }
      }
    }

  } finally {
    // ── 清理：杀掉本次启动的所有服务器进程 ──
    for (const proc of startedProcs) {
      killProcess(proc);
    }
  }
}

// ─── 导出 ────────────────────────────────────────────────────

module.exports = {
  runE2ESmoke,
  resolvePlaywright,
  extractSpecRoutes,
  resolveRoutesFromProject,
  extractAcceptanceScenarios,
};

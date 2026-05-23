/**
 * e2e-smoke.js — 双引擎 E2E 浏览器冒烟模块（v2.4.0）
 *
 * Spec-driven 端到端浏览器验证：
 *   1. 从 spec.md 提取页面路由和 API 端点
 *   2. 自动检测/启动前后端开发服务器
 *   3. 双引擎浏览器检查：
 *      - opencli/CDP 引擎：连接已登录的 Chrome，可测试认证页面
 *      - playwright-core 引擎：headless Chrome，CI 友好
 *   4. 返回结构化结果供 cli.js smoke gate 消费
 *
 * 引擎优先级（auto 模式）：
 *   opencli daemon → Chrome CDP (9222) → playwright-core launch → skip
 */

const fs = require('fs');
const path = require('path');
const net = require('net');
const http = require('http');
const { spawn, execSync } = require('child_process');

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

/** opencli / CDP 连接常量 */
const OPENCLI_DAEMON_PORT = 19825;
const CHROME_CDP_PORTS = [9222, 9229];
const CDP_CONNECT_TIMEOUT = 5000;

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

// ─── opencli / CDP 引擎发现 ─────────────────────────────────

/**
 * 检测 opencli 是否可用
 * @returns {{ type: 'cli'|'module', version?: string }|null}
 */
function resolveOpencli() {
  // 方式 1：全局 CLI
  try {
    const version = execSync('opencli --version', {
      timeout: 3000, encoding: 'utf-8', stdio: 'pipe',
    }).trim();
    return { type: 'cli', version };
  } catch { /* not installed globally */ }

  // 方式 2：require 模块（项目本地安装）
  try {
    require.resolve('@jackwener/opencli');
    return { type: 'module' };
  } catch { /* not installed */ }

  return null;
}

/**
 * 尝试连接到已运行的 Chrome（通过 CDP 或 opencli daemon）
 *
 * 连接成功后返回一个 Playwright Browser 实例，但底层是用户已登录的真实 Chrome。
 * 这允许我们测试需要认证的页面。
 *
 * @param {object} pw - resolvePlaywright() 返回的对象
 * @returns {Promise<{ browser: object, engine: string, port: number }|null>}
 */
async function connectToLiveChrome(pw) {
  if (!pw || !pw.chromium) return null;

  // 1. 尝试 opencli daemon（它的 HTTP 端口可能暴露 CDP）
  if (await isPortListening(OPENCLI_DAEMON_PORT, '127.0.0.1', 2000)) {
    // opencli daemon 运行中 — 尝试从 daemon 获取 CDP endpoint
    try {
      const infoUrl = `http://127.0.0.1:${OPENCLI_DAEMON_PORT}/json/version`;
      const statusCode = await httpProbe(infoUrl, 2000);
      if (statusCode === 200) {
        // daemon 直接暴露 CDP — 连接
        const browser = await pw.chromium.connectOverCDP(
          `http://127.0.0.1:${OPENCLI_DAEMON_PORT}`,
          { timeout: CDP_CONNECT_TIMEOUT }
        );
        return { browser, engine: 'opencli', port: OPENCLI_DAEMON_PORT };
      }
    } catch { /* daemon 不支持直连 CDP，继续尝试其他方式 */ }
  }

  // 2. 尝试直连 Chrome CDP 端口
  //    用户需用 --remote-debugging-port=9222 启动 Chrome
  //    或 opencli daemon 已启用 CDP 端口转发
  for (const port of CHROME_CDP_PORTS) {
    if (await isPortListening(port, '127.0.0.1', 2000)) {
      try {
        const browser = await pw.chromium.connectOverCDP(
          `http://127.0.0.1:${port}`,
          { timeout: CDP_CONNECT_TIMEOUT }
        );
        return { browser, engine: 'chrome-cdp', port };
      } catch { /* 该端口不是有效 CDP 端点 */ }
    }
  }

  return null;
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

// ─── 浏览器检查 ──────────────────────────────────────────────

/**
 * 判断控制台消息是否为无害噪音
 */
function isBenignConsoleMsg(text) {
  return BENIGN_CONSOLE_PATTERNS.some(p => p.test(text));
}

/**
 * 对单个页面执行浏览器检查
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
  };

  const consoleErrors = [];
  const networkFailures = [];
  const pageErrors = [];

  // 监听控制台
  const onConsole = (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      if (!isBenignConsoleMsg(text)) {
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
    // 只关心后端 API 请求失败
    if (url.includes('/api/') && !isBenignConsoleMsg(url)) {
      const failure = req.failure();
      networkFailures.push(`${req.method()} ${url}: ${failure ? failure.errorText : 'unknown'}`);
    }
  };
  page.on('requestfailed', onRequestFailed);

  // 监听 API 响应状态码
  const apiErrors = [];
  const onResponse = (res) => {
    const url = res.url();
    if (url.includes('/api/') && res.status() >= 500) {
      apiErrors.push(`${res.status()} ${res.url().slice(0, 120)}`);
    }
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
      // 检查是否是 SPA 的 history fallback（返回 index.html 的 200）
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
      // Vite error overlay
      const viteOverlay = document.querySelector('vite-error-overlay');
      // React error overlay
      const reactOverlay = document.querySelector('#webpack-dev-server-client-overlay') ||
                           document.querySelector('[data-reactroot] + div[style*="position: fixed"]');
      // Vue error
      const vueError = document.querySelector('.vue-server-renderer-error');
      // Spring Boot Whitelabel
      const whitelabel = document.body.innerText.includes('Whitelabel Error Page');
      // "Cannot GET"
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
        // 登录重定向不算失败
        result.authGated = true;
      }
    }

    // ── Check 5：未捕获异常 ──
    if (pageErrors.length > 0) {
      result.failures.push(`${pageErrors.length} 个未捕获 JS 异常: ${pageErrors.slice(0, 3).join('; ')}`);
    }

    // ── Check 6：API 网络失败 ──
    if (networkFailures.length > 0) {
      result.failures.push(`${networkFailures.length} 个 API 请求失败: ${networkFailures.slice(0, 3).join('; ')}`);
    }

    // ── Check 7：API 5xx ──
    if (apiErrors.length > 0) {
      result.failures.push(`${apiErrors.length} 个 API 返回 5xx: ${apiErrors.slice(0, 3).join('; ')}`);
    }

    // ── Check 8：控制台错误（warning 级） ──
    if (consoleErrors.length > 0) {
      result.warnings.push(`${consoleErrors.length} 个控制台错误: ${consoleErrors.slice(0, 3).join('; ')}`);
    }

    // ── Check 9：慢加载（warning 级） ──
    if (result.loadTimeMs > 10000) {
      result.warnings.push(`页面加载耗时 ${Math.round(result.loadTimeMs / 1000)}s（> 10s）`);
    }

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
 * @param {string} [options.engine='auto'] - 引擎选择: auto | playwright | opencli
 *   auto: 尝试 opencli/CDP → 回退 playwright-core
 *   playwright: 仅用 playwright-core（headless，干净会话）
 *   opencli: 仅尝试 opencli/CDP（已登录的 Chrome），不回退
 * @returns {Promise<E2ESmokeResult>}
 */
async function runE2ESmoke(projectRoot, specContent, options = {}) {
  const {
    timeout = DEFAULT_PAGE_TIMEOUT,
    headed = false,
    baseUrl: overrideBaseUrl,
    backendUrl: overrideBackendUrl,
    skipApis = false,
    engine = 'auto',
  } = options;

  // ── Step 1：发现浏览器引擎 ──
  const pw = resolvePlaywright(projectRoot);
  const opencli = resolveOpencli();
  const useEngine = engine || 'auto';
  const playwrightReady = !!(pw && pw.launchOptions !== null);

  // 最低要求：playwright-core 必须可用（所有引擎都通过它操作浏览器）
  if (!pw) {
    return {
      available: false, pass: undefined,
      skipReason: 'playwright-core 加载失败（spec-copilot 安装可能不完整）',
      pages: [], apiResults: [], consoleErrors: [], servers: {},
    };
  }

  // 仅 playwright 模式 / auto 模式：需要系统 Chrome
  if (useEngine !== 'opencli' && !playwrightReady) {
    return {
      available: false, pass: undefined,
      skipReason: '未找到系统 Chrome/Chromium 浏览器',
      installHint: process.platform === 'darwin'
        ? '安装 Chrome: https://www.google.com/chrome/ 或 brew install --cask google-chrome'
        : process.platform === 'linux'
        ? '安装 Chrome: sudo apt install google-chrome-stable 或 sudo snap install chromium'
        : '安装 Chrome: https://www.google.com/chrome/',
      pages: [], apiResults: [], consoleErrors: [], servers: {},
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

    // ── Step 4：从 spec 提取路由 ──
    let specRoutes = extractSpecRoutes(specContent);
    specRoutes = resolveRoutesFromProject(projectRoot, specRoutes);

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

    // ── Step 6：浏览器测试（双引擎） ──
    let browser;
    let activeEngine = 'playwright';
    let persistent = false; // 是否连接到用户已运行的浏览器（不能关闭）
    let authGatedPages = []; // 需要认证的页面（可通过 opencli/CDP 重试）

    try {
      // ── 引擎选择 ──
      //   auto:    尝试 CDP 连接（opencli/已运行Chrome）→ 回退 playwright launch
      //   opencli: 仅 CDP 连接
      //   playwright: 仅 playwright launch
      if (useEngine === 'auto' || useEngine === 'opencli') {
        const live = await connectToLiveChrome(pw);
        if (live) {
          browser = live.browser;
          activeEngine = live.engine;
          persistent = true;
        } else if (useEngine === 'opencli') {
          return {
            available: true, pass: undefined,
            skipReason: '无法连接到已运行的 Chrome（需启动 Chrome 并开启 --remote-debugging-port=9222，或启动 opencli daemon）',
            pages: [], apiResults: [], consoleErrors: [], servers: serverInfo,
            engineInfo: { requested: 'opencli', opencliInstalled: !!opencli },
          };
        }
        // auto 模式下 CDP 不可用 → 走 playwright launch
      }

      if (!browser && playwrightReady) {
        browser = await pw.chromium.launch({
          ...pw.launchOptions,
          headless: !headed,
          args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
        });
        activeEngine = 'playwright';
        persistent = false;
      }

      if (!browser) {
        return {
          available: true, pass: undefined,
          skipReason: '无法启动浏览器',
          pages: [], apiResults: [], consoleErrors: [], servers: serverInfo,
        };
      }

      // ── 创建上下文 + 逐页面检查 ──
      const context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        ignoreHTTPSErrors: true,
      });

      const page = await context.newPage();
      const pageResults = [];
      const allConsoleErrors = [];

      for (const routeInfo of testablePages) {
        const result = await checkPage(page, frontendUrl, routeInfo, timeout);
        result.engine = activeEngine;
        pageResults.push(result);
        if (result.warnings) {
          allConsoleErrors.push(...result.warnings.filter(w => w.includes('控制台错误')));
        }
        if (result.authGated) {
          authGatedPages.push(routeInfo);
        }
      }

      await context.close();

      // ── 认证页面重试（auto 模式：playwright 跑完后用 CDP 重测 authGated 页面） ──
      if (authGatedPages.length > 0 && activeEngine === 'playwright' && useEngine === 'auto') {
        const live = await connectToLiveChrome(pw);
        if (live) {
          const liveCtx = await live.browser.newContext({
            viewport: { width: 1280, height: 800 },
            ignoreHTTPSErrors: true,
          });
          const livePage = await liveCtx.newPage();

          for (const routeInfo of authGatedPages) {
            const result = await checkPage(livePage, frontendUrl, routeInfo, timeout);
            result.engine = live.engine;
            result.authRetry = true;
            // 用 CDP 结果替换原来的 authGated 结果
            const idx = pageResults.findIndex(p => p.route === routeInfo.route);
            if (idx !== -1) {
              pageResults[idx] = result;
            }
          }

          await liveCtx.close();
          // 注意：不关闭用户的浏览器
        }
      }

      // ── 汇总结果 ──
      const failedPages = pageResults.filter(p => !p.pass);
      const failedApis = apiResults.filter(a => !a.pass);

      return {
        available: true,
        pass: failedPages.length === 0 && failedApis.filter(a => a.status === 0 || a.status >= 500).length === 0,
        skipReason: null,
        pages: pageResults,
        apiResults,
        consoleErrors: allConsoleErrors,
        servers: serverInfo,
        engineInfo: {
          primary: activeEngine,
          opencliInstalled: !!opencli,
          authRetried: authGatedPages.length > 0,
        },
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
      if (browser && !persistent) {
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
  resolveOpencli,
  connectToLiveChrome,
  extractSpecRoutes,
  resolveRoutesFromProject,
};

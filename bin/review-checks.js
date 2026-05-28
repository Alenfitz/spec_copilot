/**
 * review-checks.js — 独立 Reviewer（v2.8.0）
 *
 * 代码级 spec-to-code 验证，替代"AI 审 AI"。
 * 在 gate review 时自动执行，不依赖 AI 判断。
 *
 * 检查维度：
 *   1. API 契约校验：spec 定义的 API → 前端代码是否调用 → 后端代码是否实现
 *   2. 前后端契约一致性：前端请求字段 / 后端必填字段 / snake_case 约束
 *   3. 错误处理审计：所有 API 调用点是否有 catch/error 处理
 *   4. 硬编码数据检测：前端组件中是否有该从 API 取的数据被写死
 *   5. 硬编码业务身份检测：当前用户/业务身份是否被写死在前端
 *   6. 路由完整性：spec 中的页面路由 → router 文件中是否存在
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { detectFrontendRoots, detectBackendRoots } = require('./project-roots');

// ─── 工具函数 ────────────────────────────────────────────────

function isGitRepo(projectRoot) {
  try {
    execSync('git rev-parse --is-inside-work-tree', { cwd: projectRoot, stdio: 'ignore' });
    return true;
  } catch { return false; }
}

function gitGrep(projectRoot, pattern) {
  try {
    const result = execSync(`git grep -l -- "${pattern}"`, {
      cwd: projectRoot, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'],
    }).trim();
    return result ? result.split('\n').filter(Boolean) : [];
  } catch { return []; }
}

function findFiles(dir, ext, maxDepth = 5) {
  const results = [];
  function walk(d, depth) {
    if (depth > maxDepth || !fs.existsSync(d)) return;
    try {
      const entries = fs.readdirSync(d, { withFileTypes: true });
      for (const e of entries) {
        if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === 'dist' || e.name === 'build' || e.name === 'target') continue;
        const full = path.join(d, e.name);
        if (e.isDirectory()) walk(full, depth + 1);
        else if (ext.some(x => e.name.endsWith(x))) results.push(full);
      }
    } catch { /* permission denied */ }
  }
  walk(dir, 0);
  return results;
}

function readSafe(filePath) {
  try { return fs.readFileSync(filePath, 'utf-8'); } catch { return ''; }
}

function uniq(arr) {
  return [...new Set(arr.filter(Boolean))];
}

function extractBalancedBody(content, openBraceIndex) {
  if (openBraceIndex < 0 || openBraceIndex >= content.length) return '';
  let depth = 0;
  for (let i = openBraceIndex; i < content.length; i++) {
    const ch = content[i];
    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      if (depth === 0) return content.slice(openBraceIndex + 1, i);
    }
  }
  return '';
}

// ─── Spec 解析 ──────────────────────────────────────────────

function extractSpecApis(specContent) {
  const apis = [];
  const seen = new Set();
  // 字符类排除：空白、|、,、)、）、]、`（修复："`POST /api/foo`" 写法时 backtick 被吃进路径）
  const apiRegex = /(GET|POST|PUT|DELETE|PATCH)\s+(\/api\/[^\s|,)）\]`]+)/g;
  let m;
  while ((m = apiRegex.exec(specContent)) !== null) {
    const key = `${m[1]} ${m[2]}`;
    if (!seen.has(key)) {
      seen.add(key);
      apis.push({ method: m[1], path: m[2] });
    }
  }
  return apis;
}

/**
 * 从 spec 提取页面路由（不是 API 路径！）
 * v4.0.10: 修复"把 /api/foo 误判为页面路由"的 false positive
 * 排除：/api/ 开头（接口）、含 {param} 的（API 路径占位符）、单段过短（如 /id）
 */
function extractSpecRoutes(specContent) {
  const routes = [];
  const seen = new Set();
  const isPageRoute = (p) => {
    if (!p) return false;
    if (p.startsWith('/api/') || p.startsWith('/v1/') || p.startsWith('/v2/')) return false;
    if (/\{[^}]+\}/.test(p)) return false;  // API path 占位符
    if (p.length < 2) return false;          // 排除 "/"
    return true;
  };

  // 显式路由声明
  const routeRegex = /(?:路由|route|path|页面路径)[：:]\s*([\/\w\-:]+)/gi;
  let m;
  while ((m = routeRegex.exec(specContent)) !== null) {
    const p = m[1];
    if (isPageRoute(p) && !seen.has(p)) { seen.add(p); routes.push(p); }
  }
  // 表格中的路由
  const tableRouteRegex = /\|\s*(\/[a-zA-Z][\w\-\/:]*)\s*\|/g;
  while ((m = tableRouteRegex.exec(specContent)) !== null) {
    const p = m[1];
    if (isPageRoute(p) && !seen.has(p)) { seen.add(p); routes.push(p); }
  }
  return routes;
}

/**
 * 把 markdown 表格行解析为 cell 数组
 * 处理 `|` 分隔、首尾分隔符、转义、以及 cell 内的反引号
 */
function parseTableRow(line) {
  if (!/^\s*\|.*\|\s*$/.test(line)) return null;
  // 跳过分隔行（| --- | --- |）
  if (/^\s*\|\s*[-:|\s]+\|?\s*$/.test(line)) return null;
  return line.split('|').slice(1, -1).map(c => c.trim());
}

/**
 * 业务规则矩阵 — 位置式解析
 * v3: 6 列（id/desc/layer/trigger/outcome/verification）
 * v4: 已删除矩阵（只在 §4 用 bullet 列出）
 */
function extractRuleMatrix(specContent) {
  const rows = [];
  for (const line of specContent.split('\n')) {
    const cells = parseTableRow(line);
    if (!cells || cells.length < 5) continue;
    if (!/^V\d+$/.test(cells[0])) continue;
    rows.push({
      id: cells[0],
      description: cells[1] || '',
      layer: cells[2] || '',
      trigger: cells[3] || '',
      outcome: cells[4] || '',
      verification: cells[5] || '',  // v3 6 列时存在；v4 没有矩阵，此函数返回空
    });
  }
  return rows;
}

/**
 * 接口覆盖矩阵 — 位置式解析，兼容 v3 / v4 schema
 * v3: 7 列（id/method/path/frontendCaller/backendEntry/requestStyle/responseStyle）
 * v4: 6 列（id/method/path/frontendCaller/backendEntry/featurePoint）
 * 最低要求：前 5 列（id/method/path/frontendCaller/backendEntry）
 */
function extractApiCoverageMatrix(specContent) {
  const rows = [];
  for (const line of specContent.split('\n')) {
    const cells = parseTableRow(line);
    if (!cells || cells.length < 5) continue;
    if (!/^API\d+$/.test(cells[0])) continue;
    if (!/^(GET|POST|PUT|DELETE|PATCH)$/i.test(cells[1])) continue;
    const row = {
      id: cells[0],
      method: cells[1].toUpperCase(),
      path: cells[2],
      frontendCaller: (cells[3] || '').replace(/[`]/g, ''),
      backendEntry: (cells[4] || '').replace(/[`]/g, ''),
      requestStyle: '',
      responseStyle: '',
      featurePoint: '',
    };
    if (cells.length >= 7) {
      // v3 schema: 6 = requestStyle, 7 = responseStyle
      row.requestStyle = cells[5] || '';
      row.responseStyle = cells[6] || '';
    } else if (cells.length === 6) {
      // v4 schema: 6 = featurePoint (F01, F02...)
      row.featurePoint = cells[5] || '';
    }
    rows.push(row);
  }
  return rows;
}

function extractRuleCheckBlocks(specContent) {
  const blocks = [];
  const regex = /```ya?ml\s+RULE-CHECK:\s*([\s\S]*?)```/g;
  let m;
  while ((m = regex.exec(specContent)) !== null) {
    const body = m[1];
    const get = (name) => {
      const mm = body.match(new RegExp(`\\b${name}:\\s*["']?([^\\n"']+)["']?`));
      return mm ? mm[1].trim() : '';
    };
    blocks.push({
      raw: body,
      id: get('id'),
      kind: get('kind'),
      apiId: get('api'),
      when: get('when'),
      field: get('field') || get('left'),
      from: get('from'),
      to: get('to'),
      key: get('key'),
      repeat: get('repeat'),
      finalState: get('final_state') || get('to'),
      secondRequest: get('second_request'),
      duplicateStatus: get('duplicate_status'),
      duplicateMessage: get('duplicate_message'),
      left: get('left'),
      op: get('op'),
      right: get('right'),
      success: get('success'),
      errorMessage: get('error_message'),
    });
  }
  return blocks;
}

/**
 * 接口字段清单（§6.2，可选）— 位置式解析
 * 5 列：id / requiredFields / optionalFields / responseFields / errorFields
 * 注意：第 2 列必须不是 HTTP method（避免与接口覆盖矩阵冲突）
 */
function extractApiFieldChecklist(specContent) {
  const rows = [];
  for (const line of specContent.split('\n')) {
    const cells = parseTableRow(line);
    if (!cells || cells.length < 5) continue;
    if (!/^API\d+$/.test(cells[0])) continue;
    // 跳过接口覆盖矩阵：cells[1] 是 HTTP method
    if (/^(GET|POST|PUT|DELETE|PATCH)$/i.test(cells[1])) continue;
    rows.push({
      id: cells[0],
      requiredFields: cells[1].split(',').map(s => s.replace(/[`]/g, '').trim()).filter(Boolean),
      optionalFields: cells[2].split(',').map(s => s.replace(/[`]/g, '').trim()).filter(Boolean),
      responseFields: cells[3].split(',').map(s => s.replace(/[`]/g, '').trim()).filter(Boolean),
      errorFields: cells[4].split(',').map(s => s.replace(/[`]/g, '').trim()).filter(Boolean),
    });
  }
  return rows;
}

function extractFrontApiCalls(projectRoot) {
  const feRoots = detectFrontendRoots(projectRoot);
  const results = [];

  for (const root of feRoots) {
    const files = findFiles(root, ['.ts', '.js']);
    for (const file of files) {
      const relPath = path.relative(projectRoot, file);
      if (!/\/api\//.test(relPath.replace(/\\/g, '/'))) continue;
      const content = readSafe(file);
      if (!content) continue;

      const fnRegex = /export function\s+([A-Za-z0-9_$]+)\s*\(([^)]*)\)\s*\{([\s\S]*?)\n\}/g;
      let m;
      while ((m = fnRegex.exec(content)) !== null) {
        const fnName = m[1];
        const paramsText = m[2] || '';
        const body = m[3] || '';
        const endpointMatch = body.match(/\.(get|post|put|delete|patch)\s*<[^>]*>?\s*\(\s*['"`]([^'"`]+)['"`]/i)
          || body.match(/\.(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]/i);
        if (!endpointMatch) continue;

        const objectBodyMatch = paramsText.match(/\{([\s\S]*)\}/);
        let fieldCandidates = [];
        if (objectBodyMatch) {
          fieldCandidates = objectBodyMatch[1]
            .split(',')
            .map(s => s.trim().replace(/\?.*$/, '').replace(/:.*/, '').trim())
            .filter(Boolean);
        } else {
          fieldCandidates = paramsText.split(',')
            .map(s => s.trim().replace(/\?.*$/, '').replace(/:.*/, '').trim())
            .filter(Boolean);
        }

        results.push({
          file: relPath,
          fnName,
          method: endpointMatch[1].toUpperCase(),
          path: endpointMatch[2],
          requestFields: uniq(fieldCandidates),
          body,
        });
      }
    }
  }

  return results;
}

function extractBackendApiContracts(projectRoot) {
  const beRoots = detectBackendRoots(projectRoot);
  const results = [];

  for (const root of beRoots) {
    const controllerFiles = findFiles(root, ['.java']).filter(f => /Controller\.java$/.test(f));
    for (const file of controllerFiles) {
      const relPath = path.relative(projectRoot, file);
      const content = readSafe(file);
      if (!content) continue;

      const basePathMatch = content.match(/@RequestMapping\(\s*["']([^"']+)["']\s*\)/);
      const basePath = basePathMatch ? basePathMatch[1] : '';
      const mappingRegex = /@(GetMapping|PostMapping|PutMapping|DeleteMapping|PatchMapping)\(\s*["']([^"']+)["']\s*\)[\s\S]*?public\s+[^{]+\s+([A-Za-z0-9_$]+)\s*\(\s*([\s\S]*?)\s*\)\s*\{/g;
      let m;
      while ((m = mappingRegex.exec(content)) !== null) {
        const method = m[1].replace('Mapping', '').toUpperCase();
        const subPath = m[2];
        const fnName = m[3];
        const paramsText = m[4] || '';
        const params = uniq(
          [...paramsText.matchAll(/(?:@PathVariable|@RequestParam(?:\(\s*["']([^"']+)["'])?|@RequestBody)\s*(?:@Valid\s*)?(?:Map<String,\s*Object>|[A-Za-z0-9_<>, ?]+)\s+([A-Za-z0-9_$]+)/g)]
            .map(mm => mm[1] || mm[2])
        );

        const requireCalls = uniq(
          [...content.slice(m.index, Math.min(content.length, m.index + 1500)).matchAll(/require\(body,\s*["']([^"']+)["']\)/g)]
            .map(mm => mm[1])
        );

        results.push({
          file: relPath,
          fnName,
          method,
          path: `${basePath}${subPath}`.replace(/\/+/g, '/'),
          requiredFields: requireCalls.length > 0 ? requireCalls : params,
          rawParams: params,
          body: extractBalancedBody(content, mappingRegex.lastIndex - 1),
        });
      }
    }
  }

  return results;
}

function isSnakeCase(name) {
  return /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/.test(name);
}

function normalizeApiPath(pathname) {
  return pathname.replace(/\{[^}]+\}/g, '').replace(/:[a-zA-Z_][\w-]*/g, '').replace(/\/+$/, '');
}

function resolveFrontendCoverageCall(projectRoot, apiRow, frontApiCalls) {
  if (apiRow.frontendCaller) {
    const [frontFile, frontFn] = apiRow.frontendCaller.split('#');
    const normalizedFile = (frontFile || '').replace(/\\/g, '/');
    const exact = frontApiCalls.find(item =>
      item.file.replace(/\\/g, '/') === normalizedFile && item.fnName === frontFn
    );
    if (exact) return exact;
  }
  return frontApiCalls.find(item =>
    item.method === apiRow.method &&
    normalizeApiPath(item.path) === normalizeApiPath(apiRow.path)
  );
}

function resolveBackendCoverageCall(projectRoot, apiRow, backendApis) {
  if (apiRow.backendEntry) {
    const [backClass, backFn] = apiRow.backendEntry.split('#');
    const exact = backendApis.find(item =>
      item.fnName === backFn && item.file.includes(backClass || '')
    );
    if (exact) return exact;
  }
  return backendApis.find(item =>
    item.method === apiRow.method &&
    normalizeApiPath(item.path) === normalizeApiPath(apiRow.path)
  );
}

function fieldExistsInChecklistRows(rows, field, includeResponse = false) {
  if (!field) return false;
  return rows.some(row => {
    const pools = [
      ...(row.requiredFields || []),
      ...(row.optionalFields || []),
      ...(includeResponse ? (row.responseFields || []) : []),
    ];
    return pools.includes(field);
  });
}

function hasFieldEvidenceInFrontend(frontCall, field) {
  if (!frontCall || !field) return false;
  return frontCall.requestFields.includes(field) || frontCall.body.includes(field);
}

function hasFieldEvidenceInBackend(projectRoot, backendCall, field) {
  if (!backendCall || !field) return false;
  if (backendCall.requiredFields.includes(field) || backendCall.rawParams.includes(field)) return true;
  const content = readSafe(path.join(projectRoot, backendCall.file));
  return content.includes(field);
}

function hasErrorMessageEvidence(projectRoot, filePath, errorMessage) {
  if (!filePath || !errorMessage) return false;
  return readSafe(path.join(projectRoot, filePath)).includes(errorMessage);
}

// ─── Check 1: API 契约校验 ──────────────────────────────────

/**
 * 检查 spec 中定义的 API 端点是否在前后端代码中都有实现/调用
 */
function checkApiContract(projectRoot, specContent) {
  const apis = extractSpecApis(specContent);
  const coverageRows = extractApiCoverageMatrix(specContent);
  if (apis.length === 0) return { pass: true, results: [], message: 'spec 中无 API 端点声明' };

  const useGit = isGitRepo(projectRoot);
  const feRoots = detectFrontendRoots(projectRoot);
  const beRoots = detectBackendRoots(projectRoot);

  const results = [];

  for (const api of apis) {
    const mapped = coverageRows.find(row =>
      row.method === api.method && normalizeApiPath(row.path) === normalizeApiPath(api.path)
    );
    // 简化路径用于搜索（去掉路径参数和结尾斜杠）
    const searchPath = api.path.replace(/\{[^}]+\}/g, '').replace(/\/+$/, '');
    const shortPath = searchPath.split('/').slice(0, 4).join('/'); // /api/users/xxx → /api/users

    let feFound = false;
    let beFound = false;
    let feExact = false;
    let beExact = false;

    if (mapped) {
      if (mapped.frontendCaller) {
        const [frontFile, frontFn] = mapped.frontendCaller.split('#');
        if (frontFile && frontFn) {
          // 尝试在项目根 + 所有 fe roots 下查找
          const candidates = [
            path.join(projectRoot, frontFile),
            ...feRoots.map(r => path.join(path.dirname(r), frontFile)), // fe-root 的父目录（hf-web/）+ frontFile
            ...feRoots.map(r => path.join(r, frontFile)),                // fe-root 本身 + frontFile
          ];
          for (const cand of candidates) {
            const content = readSafe(cand);
            if (content && new RegExp(`export\\s+function\\s+${frontFn}\\s*\\(`).test(content)) {
              feExact = true;
              break;
            }
          }
        }
      }
      if (mapped.backendEntry) {
        const [backClass, backFn] = mapped.backendEntry.split('#');
        for (const root of beRoots) {
          const files = findFiles(root, ['.java', '.kt', '.py', '.go']);
          const hit = files.find(file => {
            const content = readSafe(file);
            return content.includes(backClass || '') && content.includes(backFn || '');
          });
          if (hit) {
            beExact = true;
            break;
          }
        }
      }
    }

    if (useGit) {
      const matches = gitGrep(projectRoot, shortPath);
      const codeMatches = matches.filter(f => !f.startsWith('spec_copilot/') && !f.endsWith('.md'));
      feFound = codeMatches.some(f =>
        /\.(vue|tsx|jsx|ts|js)$/.test(f) && /(src|app|pages|views|components|api|services|store)\//.test(f)
      );
      beFound = codeMatches.some(f =>
        /\.(java|kt|py|go|rb|cs|php)$/.test(f)
      );
    } else {
      // 无 git，全文搜索（性能差但兼容）
      for (const root of feRoots) {
        const files = findFiles(root, ['.vue', '.tsx', '.jsx', '.ts', '.js']);
        feFound = files.some(f => readSafe(f).includes(shortPath));
        if (feFound) break;
      }
      for (const root of beRoots) {
        const files = findFiles(root, ['.java', '.kt', '.py', '.go']);
        beFound = files.some(f => readSafe(f).includes(shortPath));
        if (beFound) break;
      }
    }

    results.push({
      method: api.method,
      path: api.path,
      feFound: feExact || feFound,
      beFound: beExact || beFound,
      feExact,
      beExact,
      status: (feExact || feFound) && (beExact || beFound) ? 'ok' : (feExact || feFound) ? 'be-missing' : (beExact || beFound) ? 'fe-missing' : 'both-missing',
    });
  }

  const mismatches = results.filter(r => r.status !== 'ok');
  return {
    pass: mismatches.length === 0,
    results,
    total: apis.length,
    matched: results.filter(r => r.status === 'ok').length,
    feMissing: results.filter(r => r.status === 'fe-missing'),
    beMissing: results.filter(r => r.status === 'be-missing'),
    bothMissing: results.filter(r => r.status === 'both-missing'),
  };
}

function checkContractConsistency(projectRoot) {
  const feApis = extractFrontApiCalls(projectRoot);
  const beApis = extractBackendApiContracts(projectRoot);
  const mismatches = [];
  let checked = 0;

  for (const fe of feApis) {
    const fePath = normalizeApiPath(fe.path);
    const be = beApis.find(item =>
      item.method === fe.method &&
      normalizeApiPath(item.path) === fePath
    );
    if (!be) continue;
    checked++;

    const feFields = fe.requestFields;
    const beRequired = be.requiredFields;
    const missingOnFe = beRequired.filter(field => field && !feFields.includes(field));
    const nonSnakeFe = feFields.filter(field => field && !isSnakeCase(field));
    const nonSnakeBe = beRequired.filter(field => field && !isSnakeCase(field));

    if (missingOnFe.length > 0 || nonSnakeFe.length > 0 || nonSnakeBe.length > 0) {
      mismatches.push({
        method: fe.method,
        path: fe.path,
        frontFile: fe.file,
        frontFn: fe.fnName,
        backFile: be.file,
        backFn: be.fnName,
        missingOnFe,
        nonSnakeFe,
        nonSnakeBe,
      });
    }
  }

  return {
    pass: mismatches.length === 0,
    checked,
    mismatches,
  };
}

// ─── Check 2: 写接口持久化闭环 ────────────────────────────────

function isWriteMethod(method) {
  return /^(POST|PUT|PATCH|DELETE)$/i.test(method || '');
}

const BUSINESS_TOKEN_STOP_WORDS = new Set([
  'api', 'controller', 'service', 'repository', 'mapper', 'repo', 'dao',
  'save', 'create', 'add', 'new', 'update', 'edit', 'delete', 'remove',
  'patch', 'post', 'put', 'get', 'list', 'detail', 'query', 'search',
  'by', 'id', 'ids', 'dto', 'vo', 'bo', 'request', 'response',
]);

const GENERIC_PERSISTENCE_RECEIVERS = new Set([
  'basemapper', 'mapper', 'repository', 'repo', 'dao',
  'jdbctemplate', 'entitymanager', 'mongotemplate', 'redistemplate',
]);

function normalizeBusinessToken(token) {
  const lower = (token || '').toLowerCase();
  if (!lower || lower.length < 3) return '';
  if (lower.endsWith('ies') && lower.length > 4) return `${lower.slice(0, -3)}y`;
  if (/(?:[sxz]|ch|sh)es$/.test(lower) && lower.length > 4) return lower.slice(0, -2);
  if (lower.endsWith('s') && !lower.endsWith('ss') && lower.length > 3) return lower.slice(0, -1);
  return lower;
}

function splitBusinessTokens(value) {
  return String(value || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9_$]+/)
    .map(normalizeBusinessToken)
    .filter(token => token && !BUSINESS_TOKEN_STOP_WORDS.has(token));
}

function buildPersistenceContext(row, backendCall) {
  const [backendClass = '', backendMethod = ''] = String(row.backendEntry || '').replace(/[`]/g, '').split('#');
  const fileClass = backendCall && backendCall.file ? path.basename(backendCall.file, path.extname(backendCall.file)) : '';
  return {
    tokens: uniq([
      ...splitBusinessTokens(row.path),
      ...splitBusinessTokens(row.featurePoint),
      ...splitBusinessTokens(backendClass),
      ...splitBusinessTokens(backendMethod),
      ...splitBusinessTokens(fileClass),
      ...splitBusinessTokens(backendCall && backendCall.fnName),
    ]),
  };
}

function hasTokenOverlap(value, context) {
  const expected = new Set((context && context.tokens) || []);
  if (expected.size === 0) return true;
  return splitBusinessTokens(value).some(token => expected.has(token));
}

function isGenericPersistenceReceiver(receiver) {
  return GENERIC_PERSISTENCE_RECEIVERS.has(String(receiver || '').toLowerCase());
}

function isExactGenericPersistenceMethod(methodName) {
  return /^(save|saveAndFlush|insert|insertSelective|update|updateById|updateByPrimaryKey|delete|deleteById|remove|removeById|persist|merge)$/i.test(methodName || '');
}

function hasWriteAction(methodName) {
  return /(save|insert|update|delete|persist|merge|remove)/i.test(methodName || '');
}

function hasSqlPersistenceEvidence(text, context) {
  const sqlRegex = /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+([A-Za-z0-9_.$]+)/gi;
  let m;
  while ((m = sqlRegex.exec(text || '')) !== null) {
    if (hasTokenOverlap(m[1], context)) return true;
  }
  return false;
}

function hasPersistenceEvidence(text, context = {}) {
  if (!text) return false;
  if (hasSqlPersistenceEvidence(text, context)) return true;

  const callRegex = /\b([A-Za-z0-9_$]*(?:baseMapper|mapper|repository|repo|dao|jdbcTemplate|entityManager|mongoTemplate|redisTemplate))\s*\.\s*([A-Za-z0-9_$]+)\s*\(/gi;
  let m;
  while ((m = callRegex.exec(text)) !== null) {
    const receiver = m[1];
    const methodName = m[2];
    if (!hasWriteAction(methodName)) continue;

    const matchesCurrentApi = hasTokenOverlap(`${receiver} ${methodName}`, context);
    if (matchesCurrentApi) return true;

    // Generic receiver names such as repository.save(...) are accepted,
    // but concrete receivers like userRepository.updateById(...) must match the current API tokens.
    if (isGenericPersistenceReceiver(receiver) && isExactGenericPersistenceMethod(methodName)) return true;
  }

  return false;
}

function extractInjectedServices(controllerContent) {
  const services = [];
  const fieldRegex = /(?:@Autowired\s*)?(?:private|protected|public)?\s*(?:final\s+)?([A-Z][A-Za-z0-9_$]*(?:Service|Repository|Mapper|Dao|DAO))\s+([a-zA-Z_$][A-Za-z0-9_$]*)\s*[;=]/g;
  let m;
  while ((m = fieldRegex.exec(controllerContent)) !== null) {
    services.push({ type: m[1], name: m[2] });
  }

  const ctorRegex = /public\s+[A-Z][A-Za-z0-9_$]*\s*\(([^)]*)\)/g;
  while ((m = ctorRegex.exec(controllerContent)) !== null) {
    for (const part of m[1].split(',')) {
      const mm = part.trim().match(/([A-Z][A-Za-z0-9_$]*(?:Service|Repository|Mapper|Dao|DAO))\s+([a-zA-Z_$][A-Za-z0-9_$]*)/);
      if (mm) services.push({ type: mm[1], name: mm[2] });
    }
  }

  return uniq(services.map(item => `${item.type}#${item.name}`)).map(key => {
    const [type, name] = key.split('#');
    return { type, name };
  });
}

function findJavaClassFile(projectRoot, className) {
  const beRoots = detectBackendRoots(projectRoot);
  for (const root of beRoots) {
    const candidates = findFiles(root, ['.java']).filter(file => path.basename(file) === `${className}.java`);
    if (candidates[0]) return candidates[0];
  }
  return null;
}

function extractJavaMethodBody(content, methodName) {
  if (!content || !methodName) return '';
  const methodRegex = new RegExp(`(?:public|protected|private)\\s+[^{;=]+\\s+${methodName}\\s*\\([^)]*\\)\\s*\\{`, 'g');
  const match = methodRegex.exec(content);
  if (!match) return '';
  return extractBalancedBody(content, methodRegex.lastIndex - 1);
}

function hasCalledServicePersistence(projectRoot, backendCall, context) {
  const controllerPath = path.join(projectRoot, backendCall.file);
  const controllerContent = readSafe(controllerPath);
  const services = extractInjectedServices(controllerContent);

  for (const service of services) {
    const callRegex = new RegExp(`\\b${service.name}\\s*\\.\\s*([A-Za-z0-9_$]+)\\s*\\(`, 'g');
    let m;
    while ((m = callRegex.exec(backendCall.body || '')) !== null) {
      const calledMethod = m[1];
      const serviceFile = findJavaClassFile(projectRoot, service.type);
      if (!serviceFile) continue;
      const serviceContent = readSafe(serviceFile);
      const serviceBody = extractJavaMethodBody(serviceContent, calledMethod);
      if (hasPersistenceEvidence(serviceBody, {
        tokens: uniq([...(context && context.tokens ? context.tokens : []), ...splitBusinessTokens(service.type)]),
      })) return true;
    }
  }

  return false;
}

function checkWritePersistenceClosure(projectRoot, specContent) {
  const coverageRows = extractApiCoverageMatrix(specContent);
  const writeRows = coverageRows.filter(row => isWriteMethod(row.method));
  if (writeRows.length === 0) {
    return { pass: true, checked: 0, message: 'spec 中无 POST/PUT/PATCH/DELETE 写接口矩阵行' };
  }

  const backendApis = extractBackendApiContracts(projectRoot);
  const risks = [];
  const checked = [];

  for (const row of writeRows) {
    const backendCall = resolveBackendCoverageCall(projectRoot, row, backendApis);
    if (!backendCall) continue;
    checked.push({ id: row.id, method: row.method, path: row.path, backendEntry: row.backendEntry });

    const persistenceContext = buildPersistenceContext(row, backendCall);
    const directEvidence = hasPersistenceEvidence(backendCall.body, persistenceContext);
    const delegatedEvidence = directEvidence ? false : hasCalledServicePersistence(projectRoot, backendCall, persistenceContext);
    if (!directEvidence && !delegatedEvidence) {
      risks.push({
        id: row.id,
        method: row.method,
        path: row.path,
        backendEntry: row.backendEntry,
        file: backendCall.file,
        fnName: backendCall.fnName,
        reason: '未在后端入口或其直接调用的 Service/Repository 中发现 save/insert/update/delete 等持久化证据',
      });
    }
  }

  return {
    pass: risks.length === 0,
    checked: checked.length,
    total: writeRows.length,
    matched: checked.length - risks.length,
    risks,
    skipped: writeRows.length - checked.length,
  };
}

// ─── Check 3: 错误处理审计 ──────────────────────────────────

/**
 * 检查前端 API 调用点是否有错误处理
 */
function checkErrorHandling(projectRoot) {
  const feRoots = detectFrontendRoots(projectRoot);

  const violations = [];
  let totalApiCalls = 0;

  for (const root of feRoots) {
    const files = findFiles(root, ['.vue', '.tsx', '.jsx', '.ts', '.js']);

    for (const file of files) {
      const content = readSafe(file);
      if (!content) continue;
      const relPath = path.relative(projectRoot, file);

      // 跳过类型声明文件和测试文件
      if (relPath.includes('.d.ts') || relPath.includes('__test') || relPath.includes('.spec.') || relPath.includes('.test.')) continue;

      const lines = content.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // 检测 API 调用模式
        const isApiCall =
          /\.(get|post|put|delete|patch)\s*\(\s*['"`]\/api\//.test(line) ||
          /fetch\s*\(\s*['"`].*\/api\//.test(line) ||
          /request\s*\(\s*\{[\s\S]*url.*\/api\//.test(line) ||
          /\bapi\.\w+\s*\(/.test(line);

        if (!isApiCall) continue;
        totalApiCalls++;

        // 向前后各看 10 行，查找错误处理
        const contextStart = Math.max(0, i - 5);
        const contextEnd = Math.min(lines.length, i + 10);
        const context = lines.slice(contextStart, contextEnd).join('\n');

        const hasErrorHandling =
          /\.catch\s*\(/.test(context) ||
          /catch\s*\(/.test(context) ||                    // try-catch
          /\.then\s*\([^)]*,[^)]*\)/.test(context) ||     // .then(ok, err)
          /onError|errorHandler|handleError/i.test(context) ||
          /\.finally\s*\(/.test(context);

        // 检测空 catch
        const hasEmptyCatch = /catch\s*\([^)]*\)\s*\{\s*\}/.test(context) ||
                              /\.catch\s*\(\s*\(\s*\)\s*=>\s*\{\s*\}\s*\)/.test(context);

        if (!hasErrorHandling) {
          violations.push({
            file: relPath,
            line: i + 1,
            type: 'no-catch',
            detail: 'API 调用无错误处理（无 catch/onError）',
          });
        } else if (hasEmptyCatch) {
          violations.push({
            file: relPath,
            line: i + 1,
            type: 'empty-catch',
            detail: 'API 调用有 catch 但为空（吞掉了错误）',
          });
        }
      }
    }
  }

  return {
    pass: violations.length === 0,
    violations,
    totalApiCalls,
    noHandling: violations.filter(v => v.type === 'no-catch').length,
    emptyCatch: violations.filter(v => v.type === 'empty-catch').length,
  };
}

// ─── Check 3: 硬编码数据检测 ────────────────────────────────

/**
 * 检测前端组件中可能是硬编码 mock 数据的模式
 */
function checkHardcodedData(projectRoot) {
  const feRoots = detectFrontendRoots(projectRoot);

  const suspects = [];

  for (const root of feRoots) {
    const files = findFiles(root, ['.vue', '.tsx', '.jsx', '.ts', '.js']);

    for (const file of files) {
      const content = readSafe(file);
      if (!content) continue;
      const relPath = path.relative(projectRoot, file);

      // 跳过工具/配置/常量文件
      if (/\/(constants?|config|utils?|helpers?|types?|enums?|mock)\//i.test(relPath)) continue;
      if (relPath.includes('.d.ts') || relPath.includes('__test')) continue;

      // 检测模式 1：大数组字面量（3+ 个对象元素，含 id/name 等字段）
      // 匹配 const xxx = [{ id: 1, name: '...' }, { id: 2, ... }]
      const arrayLiteralRegex = /(?:const|let|var|ref\(|reactive\()\s*\w+\s*[=:]\s*\[[\s\S]{100,}?\]/g;
      let m;
      while ((m = arrayLiteralRegex.exec(content)) !== null) {
        const match = m[0];
        const objectCount = (match.match(/\{/g) || []).length;
        // 包含看起来像业务数据的字段
        const hasDataFields = /\bid\s*[:=]|name\s*[:=]\s*['"`]|title\s*[:=]\s*['"`]|label\s*[:=]\s*['"`]/.test(match);
        if (objectCount >= 3 && hasDataFields) {
          const lineNum = content.slice(0, m.index).split('\n').length;
          suspects.push({
            file: relPath,
            line: lineNum,
            type: 'hardcoded-array',
            objectCount,
            detail: `疑似硬编码数据（${objectCount} 个对象，含 id/name 字段 — 应从 API 获取）`,
          });
        }
      }

      // 检测模式 2：tableData / dataSource 等直接赋值为数组
      const dataVarRegex = /(?:tableData|dataSource|listData|dataList|options|menuList|items)\s*[=:]\s*(?:ref\(|reactive\()?\s*\[[\s\S]{50,}?\]/g;
      while ((m = dataVarRegex.exec(content)) !== null) {
        const match = m[0];
        const objectCount = (match.match(/\{/g) || []).length;
        if (objectCount >= 2) {
          const lineNum = content.slice(0, m.index).split('\n').length;
          // 去重（可能跟模式 1 重叠）
          if (!suspects.some(s => s.file === relPath && Math.abs(s.line - lineNum) < 3)) {
            suspects.push({
              file: relPath,
              line: lineNum,
              type: 'hardcoded-datasource',
              detail: `tableData/dataSource 直接赋值为硬编码数组（${objectCount} 个对象）`,
            });
          }
        }
      }
    }
  }

  return {
    pass: suspects.length === 0,
    suspects,
  };
}

function checkHardcodedIdentities(projectRoot) {
  const feRoots = detectFrontendRoots(projectRoot);
  const violations = [];
  const identityPatterns = [
    { regex: /\buser-\d{3,}\b/g, reason: '硬编码用户 ID' },
    { regex: /['"`](张三|李四|王五|赵六|管理员|许可人|签发人|接票人)['"`]/g, reason: '硬编码业务身份/人员名称' },
    { regex: /\b(currentUser|operatorId|operatorName)\s*[:=]\s*['"`][^'"`]+['"`]/g, reason: '当前登录人被前端写死' },
  ];

  for (const root of feRoots) {
    const files = findFiles(root, ['.vue', '.tsx', '.jsx', '.ts', '.js']);
    for (const file of files) {
      const relPath = path.relative(projectRoot, file);
      if (/\/(mock|__tests__|fixtures)\//.test(relPath.replace(/\\/g, '/'))) continue;
      const content = readSafe(file);
      if (!content) continue;
      const lines = content.split('\n');

      lines.forEach((line, idx) => {
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
        for (const pattern of identityPatterns) {
          if (pattern.regex.test(line)) {
            violations.push({
              file: relPath,
              line: idx + 1,
              detail: pattern.reason,
              snippet: trimmed.slice(0, 120),
            });
            break;
          }
          pattern.regex.lastIndex = 0;
        }
      });
    }
  }

  return {
    pass: violations.length === 0,
    violations,
  };
}

// ─── Check 4: 路由完整性 ────────────────────────────────────

/**
 * 检查 spec 中声明的路由是否在前端 router 文件中存在
 */
function checkRouteCompleteness(projectRoot, specContent) {
  const specRoutes = extractSpecRoutes(specContent);
  // v4.0.10: 用更明确的措辞 — 让评分系统识别这是"无输入"而非"路由全通过"
  if (specRoutes.length === 0) return { pass: true, message: 'spec 中无页面路由（仅 API 路径不计为页面路由）' };

  // 读取 router 文件
  const feRoots = detectFrontendRoots(projectRoot);

  let routerContent = '';
  for (const root of feRoots) {
    for (const name of ['router/index.ts', 'router/index.js', 'router.ts', 'router.js', 'routes/index.ts', 'routes.ts']) {
      const p = path.join(root, name);
      if (fs.existsSync(p)) routerContent += readSafe(p) + '\n';
    }
  }

  if (!routerContent) return { pass: true, message: '未找到 router 文件' };

  const missing = [];
  for (const route of specRoutes) {
    // 将 :id 等参数替换为正则
    const routePattern = route.replace(/:[a-zA-Z]+/g, ':[a-zA-Z]+');
    if (!routerContent.includes(route) && !new RegExp(routePattern.replace(/\//g, '\\/')).test(routerContent)) {
      missing.push(route);
    }
  }

  return {
    pass: missing.length === 0,
    total: specRoutes.length,
    matched: specRoutes.length - missing.length,
    missing,
  };
}

function checkRuleCoverage(projectRoot, specContent) {
  const rules = extractRuleMatrix(specContent);
  if (rules.length === 0) return { pass: true, message: 'spec 中无 Vxx 业务规则矩阵' };

  const useGit = isGitRepo(projectRoot);
  const apiCoverage = extractApiCoverageMatrix(specContent);
  const apiFieldChecklist = extractApiFieldChecklist(specContent);
  const frontApiCalls = extractFrontApiCalls(projectRoot);
  const backendApis = extractBackendApiContracts(projectRoot);
  const feRoots = detectFrontendRoots(projectRoot);
  const beRoots = detectBackendRoots(projectRoot);
  const allRoots = [...feRoots, ...beRoots];

  const findMatches = (pattern) => {
    if (useGit) {
      return gitGrep(projectRoot, pattern).filter(f => !f.startsWith('spec_copilot/') && !f.endsWith('.md'));
    }
    const matches = [];
    for (const root of allRoots) {
      const files = findFiles(root, ['.vue', '.tsx', '.jsx', '.ts', '.js', '.java', '.kt', '.py', '.go']);
      for (const file of files) {
        const content = readSafe(file);
        if (content.includes(pattern)) {
          matches.push(path.relative(projectRoot, file));
        }
      }
    }
    return matches;
  };

  const ruleBlocks = extractRuleCheckBlocks(specContent);
  const knownKinds = new Set(['required', 'enum', 'compare_datetime', 'state_transition', 'idempotent']);
  const fieldAwareKinds = new Set(['required', 'enum', 'compare_datetime']);
  const transitionKinds = new Set(['state_transition']);
  const idempotentKinds = new Set(['idempotent']);

  const results = rules.map((rule) => {
    const dsl = ruleBlocks.find(block => block.id === rule.id);
    const ruleIdHits = findMatches(rule.id);
    const triggerHits = rule.trigger && rule.trigger !== '-' ? findMatches(rule.trigger) : [];
    const outcomeHits = rule.outcome && rule.outcome !== '-' ? findMatches(rule.outcome.replace(/[`'"]/g, '')) : [];
    const verificationDeclared = rule.verification && !/^代码里处理|无|待补|todo$/i.test(rule.verification);

    const frontendHits = uniq(ruleIdHits.filter(f => /\.(vue|tsx|jsx|ts|js)$/.test(f) && /(src|app|pages|views|components|api|store)\//.test(f)));
    const backendHits = uniq(ruleIdHits.filter(f => /\.(java|kt|py|go)$/.test(f)));
    const outcomeEvidence = uniq([...triggerHits, ...outcomeHits]);
    const missing = [];

    if (frontendHits.length === 0 && /前端|双端/i.test(rule.layer)) {
      missing.push('前端规则落点');
    }
    if (backendHits.length === 0 && /后端|双端/i.test(rule.layer)) {
      missing.push('后端规则落点');
    }
    if (outcomeEvidence.length === 0) {
      missing.push('触发/结果证据');
    }
    if (!verificationDeclared) {
      missing.push('验证方式声明');
    }
    if (dsl) {
      const boundApiRows = dsl.apiId ? apiCoverage.filter(api => api.id === dsl.apiId) : [];
      const boundChecklistRows = dsl.apiId ? apiFieldChecklist.filter(api => api.id === dsl.apiId) : [];
      const boundFrontCall = boundApiRows[0] ? resolveFrontendCoverageCall(projectRoot, boundApiRows[0], frontApiCalls) : null;
      const boundBackendCall = boundApiRows[0] ? resolveBackendCoverageCall(projectRoot, boundApiRows[0], backendApis) : null;
      const fieldChecklistScope = boundChecklistRows.length > 0 ? boundChecklistRows : apiFieldChecklist;
      const fieldRefs = uniq([dsl.left, dsl.right]);

      if (!knownKinds.has(dsl.kind)) missing.push('RULE-CHECK.kind 非法');
      if (!dsl.when) missing.push('RULE-CHECK.when');
      if (!dsl.errorMessage && /异常|错误|文案|拦截/i.test(rule.outcome)) missing.push('RULE-CHECK.error_message');
      if ((fieldAwareKinds.has(dsl.kind) || transitionKinds.has(dsl.kind) || idempotentKinds.has(dsl.kind)) && !dsl.apiId) {
        missing.push('RULE-CHECK.api 缺少 API 绑定');
      }
      if (dsl.apiId && boundApiRows.length === 0) {
        missing.push('RULE-CHECK.api 未在 API 覆盖矩阵中声明');
      }
      if (dsl.apiId && boundChecklistRows.length === 0) {
        missing.push('RULE-CHECK.api 缺少契约字段清单');
      }
      if (dsl.kind === 'compare_datetime' && (!dsl.left || !dsl.op || !dsl.right)) {
        missing.push('RULE-CHECK.compare_datetime 参数不完整');
      }
      if (dsl.kind === 'required' && !dsl.left) {
        missing.push('RULE-CHECK.required 字段缺失');
      }
      if (dsl.kind === 'state_transition' && (!dsl.field || !dsl.to)) {
        missing.push('RULE-CHECK.state_transition 参数不完整');
      }
      if (dsl.kind === 'idempotent' && !dsl.key) {
        missing.push('RULE-CHECK.idempotent 缺少幂等键');
      }
      if (dsl.kind === 'idempotent' && dsl.repeat && !/^\d+$/.test(dsl.repeat)) {
        missing.push('RULE-CHECK.idempotent repeat 非法');
      }
      if (dsl.kind === 'idempotent' && dsl.secondRequest && !/^(blocked|accepted|either)$/i.test(dsl.secondRequest)) {
        missing.push('RULE-CHECK.idempotent second_request 非法');
      }
      if (dsl.kind === 'idempotent' && dsl.duplicateStatus && !/^\d+$/.test(dsl.duplicateStatus)) {
        missing.push('RULE-CHECK.idempotent duplicate_status 非法');
      }
      if (dsl.kind === 'required') {
        const fieldFoundInChecklist = fieldExistsInChecklistRows(fieldChecklistScope, dsl.left);
        if (!fieldFoundInChecklist) {
          missing.push('RULE-CHECK.required 字段未出现在 API 字段清单');
        }
      }
      if (dsl.kind === 'enum') {
        const fieldFoundInChecklist = fieldExistsInChecklistRows(fieldChecklistScope, dsl.left, true);
        if (!fieldFoundInChecklist) {
          missing.push('RULE-CHECK.enum 字段未出现在 API 字段清单');
        }
      }
      if (dsl.kind === 'compare_datetime') {
        const fieldsFound = [dsl.left, dsl.right].every(field => fieldExistsInChecklistRows(fieldChecklistScope, field, true));
        if (!fieldsFound) {
          missing.push('RULE-CHECK.compare_datetime 字段未在 API 字段清单中闭环');
        }
      }
      if (dsl.kind === 'state_transition') {
        const fieldFoundInChecklist = fieldExistsInChecklistRows(fieldChecklistScope, dsl.field, true);
        if (!fieldFoundInChecklist) {
          missing.push('RULE-CHECK.state_transition 字段未出现在 API 字段清单');
        }
        if (dsl.finalState && !fieldFoundInChecklist) {
          missing.push('RULE-CHECK.state_transition final_state 缺少状态字段支撑');
        }
      }
      if (dsl.kind === 'idempotent') {
        const keyFoundInChecklist = fieldExistsInChecklistRows(fieldChecklistScope, dsl.key, true);
        if (!keyFoundInChecklist) {
          missing.push('RULE-CHECK.idempotent 幂等键未出现在 API 字段清单');
        }
      }
      if (dsl.errorMessage) {
        const errorRows = boundChecklistRows.length > 0 ? boundChecklistRows : apiFieldChecklist;
        const errorFieldDeclared = errorRows.some(api => api.errorFields.length > 0);
        if (!errorFieldDeclared) {
          missing.push('RULE-CHECK.error_message 缺少 API 错误字段支撑');
        }
      }
      if (dsl.apiId && /前端|双端/i.test(rule.layer) && !boundFrontCall) {
        missing.push('RULE-CHECK.api 前端调用方未解析');
      }
      if (dsl.apiId && /后端|双端/i.test(rule.layer) && !boundBackendCall) {
        missing.push('RULE-CHECK.api 后端实现入口未解析');
      }
      if (dsl.apiId && fieldAwareKinds.has(dsl.kind) && /前端|双端/i.test(rule.layer) && boundFrontCall) {
        const allFieldsCovered = fieldRefs.every(field => hasFieldEvidenceInFrontend(boundFrontCall, field));
        if (!allFieldsCovered) {
          missing.push('RULE-CHECK.api 前端调用方缺少规则字段证据');
        }
      }
      if (dsl.apiId && fieldAwareKinds.has(dsl.kind) && /后端|双端/i.test(rule.layer) && boundBackendCall) {
        const allFieldsCovered = fieldRefs.every(field => hasFieldEvidenceInBackend(projectRoot, boundBackendCall, field));
        if (!allFieldsCovered) {
          missing.push('RULE-CHECK.api 后端实现入口缺少规则字段证据');
        }
      }
      if (dsl.apiId && dsl.kind === 'state_transition' && /前端|双端/i.test(rule.layer) && boundFrontCall) {
        if (!hasFieldEvidenceInFrontend(boundFrontCall, dsl.field) || !boundFrontCall.body.includes(dsl.to)) {
          missing.push('RULE-CHECK.api 前端调用方缺少状态迁移证据');
        }
      }
      if (dsl.apiId && dsl.kind === 'state_transition' && /后端|双端/i.test(rule.layer) && boundBackendCall) {
        const backendContent = readSafe(path.join(projectRoot, boundBackendCall.file));
        if (!hasFieldEvidenceInBackend(projectRoot, boundBackendCall, dsl.field) || !backendContent.includes(dsl.to)) {
          missing.push('RULE-CHECK.api 后端实现入口缺少状态迁移证据');
        }
      }
      if (dsl.apiId && dsl.kind === 'idempotent' && /前端|双端/i.test(rule.layer) && boundFrontCall) {
        if (!hasFieldEvidenceInFrontend(boundFrontCall, dsl.key)) {
          missing.push('RULE-CHECK.api 前端调用方缺少幂等键证据');
        }
      }
      if (dsl.apiId && dsl.kind === 'idempotent' && /后端|双端/i.test(rule.layer) && boundBackendCall) {
        if (!hasFieldEvidenceInBackend(projectRoot, boundBackendCall, dsl.key)) {
          missing.push('RULE-CHECK.api 后端实现入口缺少幂等键证据');
        }
      }
      if (dsl.apiId && dsl.errorMessage && /后端|双端/i.test(rule.layer) && boundBackendCall) {
        if (!hasErrorMessageEvidence(projectRoot, boundBackendCall.file, dsl.errorMessage)) {
          missing.push('RULE-CHECK.error_message 未落到绑定 API 实现');
        }
      }
      if (dsl.apiId && dsl.errorMessage && /前端|双端/i.test(rule.layer) && boundFrontCall) {
        const frontMessageCovered = hasErrorMessageEvidence(projectRoot, boundFrontCall.file, dsl.errorMessage);
        const backMessageCovered = boundBackendCall ? hasErrorMessageEvidence(projectRoot, boundBackendCall.file, dsl.errorMessage) : false;
        if (!frontMessageCovered && !backMessageCovered) {
          missing.push('RULE-CHECK.error_message 未落到绑定 API 链路');
        }
      }
      if (apiCoverage.length === 0) {
        missing.push('RULE-CHECK 缺少 API 覆盖矩阵支撑');
      }
    }

    return {
      ...rule,
      dsl,
      frontendHits,
      backendHits,
      outcomeEvidence,
      verificationDeclared,
      missing,
      pass: missing.length === 0,
    };
  });

  return {
    pass: results.every(r => r.pass),
    total: results.length,
    matched: results.filter(r => r.pass).length,
    results,
    missingRules: results.filter(r => !r.pass),
    dslCount: ruleBlocks.length,
  };
}

// ─── 主入口 ──────────────────────────────────────────────────

/**
 * 执行独立 review 检查
 * @param {string} projectRoot
 * @param {string} specContent
 * @returns {{ pass: boolean, checks: object[] }}
 */
function runReviewChecks(projectRoot, specContent) {
  const checks = [];
  let overallPass = true;

  // 1. API 契约校验
  try {
    const apiContract = checkApiContract(projectRoot, specContent);
    checks.push({
      name: 'API 契约校验',
      ...apiContract,
    });
    if (!apiContract.pass) overallPass = false;
  } catch (e) {
    checks.push({ name: 'API 契约校验', pass: true, error: e.message });
  }

  // 2. 前后端契约一致性
  try {
    const contractConsistency = checkContractConsistency(projectRoot);
    checks.push({
      name: '前后端契约一致性',
      ...contractConsistency,
    });
    if (!contractConsistency.pass) overallPass = false;
  } catch (e) {
    checks.push({ name: '前后端契约一致性', pass: true, error: e.message });
  }

  // 3. 写接口持久化闭环
  try {
    const persistenceClosure = checkWritePersistenceClosure(projectRoot, specContent);
    checks.push({
      name: '写接口持久化闭环',
      ...persistenceClosure,
    });
    if (!persistenceClosure.pass) overallPass = false;
  } catch (e) {
    checks.push({ name: '写接口持久化闭环', pass: true, error: e.message });
  }

  // 4. 错误处理审计
  try {
    const errorHandling = checkErrorHandling(projectRoot);
    checks.push({
      name: '错误处理审计',
      ...errorHandling,
    });
    // 错误处理是 warning 级别（太严格会挡住所有项目）
    // 但超过 50% 的 API 调用无 catch 则降级为 failure
    if (errorHandling.totalApiCalls > 0) {
      const ratio = errorHandling.noHandling / errorHandling.totalApiCalls;
      if (ratio > 0.5) overallPass = false;
    }
  } catch (e) {
    checks.push({ name: '错误处理审计', pass: true, error: e.message });
  }

  // 5. 硬编码数据检测
  try {
    const hardcoded = checkHardcodedData(projectRoot);
    checks.push({
      name: '硬编码数据检测',
      ...hardcoded,
    });
    // 硬编码数据是 warning 级别
  } catch (e) {
    checks.push({ name: '硬编码数据检测', pass: true, error: e.message });
  }

  // 6. 硬编码业务身份检测
  try {
    const identities = checkHardcodedIdentities(projectRoot);
    checks.push({
      name: '硬编码业务身份检测',
      ...identities,
    });
    if (!identities.pass) overallPass = false;
  } catch (e) {
    checks.push({ name: '硬编码业务身份检测', pass: true, error: e.message });
  }

  // 7. 路由完整性
  try {
    const routes = checkRouteCompleteness(projectRoot, specContent);
    checks.push({
      name: '路由完整性',
      ...routes,
    });
    if (!routes.pass) overallPass = false;
  } catch (e) {
    checks.push({ name: '路由完整性', pass: true, error: e.message });
  }

  // 8. 业务规则覆盖
  try {
    const rules = checkRuleCoverage(projectRoot, specContent);
    checks.push({
      name: '业务规则覆盖',
      ...rules,
    });
    if (!rules.pass) overallPass = false;
  } catch (e) {
    checks.push({ name: '业务规则覆盖', pass: true, error: e.message });
  }

  return { pass: overallPass, checks };
}

module.exports = {
  runReviewChecks,
  checkApiContract,
  checkContractConsistency,
  checkWritePersistenceClosure,
  checkErrorHandling,
  checkHardcodedData,
  checkHardcodedIdentities,
  checkRouteCompleteness,
  checkRuleCoverage,
};

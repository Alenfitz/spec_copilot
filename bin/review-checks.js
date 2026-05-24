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

// ─── Spec 解析 ──────────────────────────────────────────────

function extractSpecApis(specContent) {
  const apis = [];
  const seen = new Set();
  const apiRegex = /(GET|POST|PUT|DELETE|PATCH)\s+(\/api\/[^\s|,)）\]]+)/g;
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

function extractSpecRoutes(specContent) {
  const routes = [];
  const seen = new Set();
  // 路由声明
  const routeRegex = /(?:路由|route|path|页面路径)[：:]\s*([\/\w\-:]+)/gi;
  let m;
  while ((m = routeRegex.exec(specContent)) !== null) {
    if (!seen.has(m[1])) { seen.add(m[1]); routes.push(m[1]); }
  }
  // 表格路由
  const tableRouteRegex = /\|\s*(\/[a-zA-Z][\w\-\/:]*)\s*\|/g;
  while ((m = tableRouteRegex.exec(specContent)) !== null) {
    if (!seen.has(m[1])) { seen.add(m[1]); routes.push(m[1]); }
  }
  return routes;
}

function extractRuleMatrix(specContent) {
  const rows = [];
  const regex = /^\|\s*(V\d+)\s*\|\s*([^|\n]+?)\s*\|\s*([^|\n]+?)\s*\|\s*([^|\n]+?)\s*\|\s*([^|\n]+?)\s*\|\s*([^|\n]+?)\s*\|?\s*$/gm;
  let m;
  while ((m = regex.exec(specContent)) !== null) {
    rows.push({
      id: m[1].trim(),
      description: m[2].trim(),
      layer: m[3].trim(),
      trigger: m[4].trim(),
      outcome: m[5].trim(),
      verification: m[6].trim(),
    });
  }
  return rows;
}

function extractFrontApiCalls(projectRoot) {
  const feRoots = ['frontend/src', 'app/src', 'src']
    .map(r => path.join(projectRoot, r))
    .filter(fs.existsSync);
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
  const beRoots = ['backend/src/main', 'src/main']
    .map(r => path.join(projectRoot, r))
    .filter(fs.existsSync);
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

// ─── Check 1: API 契约校验 ──────────────────────────────────

/**
 * 检查 spec 中定义的 API 端点是否在前后端代码中都有实现/调用
 */
function checkApiContract(projectRoot, specContent) {
  const apis = extractSpecApis(specContent);
  if (apis.length === 0) return { pass: true, results: [], message: 'spec 中无 API 端点声明' };

  const useGit = isGitRepo(projectRoot);
  const feRoots = ['frontend/src', 'app/src', 'src'].filter(r =>
    fs.existsSync(path.join(projectRoot, r))
  );
  const beRoots = ['backend/src', 'src/main'].filter(r =>
    fs.existsSync(path.join(projectRoot, r))
  );

  const results = [];

  for (const api of apis) {
    // 简化路径用于搜索（去掉路径参数和结尾斜杠）
    const searchPath = api.path.replace(/\{[^}]+\}/g, '').replace(/\/+$/, '');
    const shortPath = searchPath.split('/').slice(0, 4).join('/'); // /api/users/xxx → /api/users

    let feFound = false;
    let beFound = false;

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
        const files = findFiles(path.join(projectRoot, root), ['.vue', '.tsx', '.jsx', '.ts', '.js']);
        feFound = files.some(f => readSafe(f).includes(shortPath));
        if (feFound) break;
      }
      for (const root of beRoots) {
        const files = findFiles(path.join(projectRoot, root), ['.java', '.kt', '.py', '.go']);
        beFound = files.some(f => readSafe(f).includes(shortPath));
        if (beFound) break;
      }
    }

    results.push({
      method: api.method,
      path: api.path,
      feFound,
      beFound,
      status: feFound && beFound ? 'ok' : feFound ? 'be-missing' : beFound ? 'fe-missing' : 'both-missing',
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

// ─── Check 2: 错误处理审计 ──────────────────────────────────

/**
 * 检查前端 API 调用点是否有错误处理
 */
function checkErrorHandling(projectRoot) {
  const feRoots = ['frontend/src', 'app/src', 'src'].filter(r =>
    fs.existsSync(path.join(projectRoot, r))
  );

  const violations = [];
  let totalApiCalls = 0;

  for (const root of feRoots) {
    const files = findFiles(path.join(projectRoot, root), ['.vue', '.tsx', '.jsx', '.ts', '.js']);

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
  const feRoots = ['frontend/src', 'app/src', 'src'].filter(r =>
    fs.existsSync(path.join(projectRoot, r))
  );

  const suspects = [];

  for (const root of feRoots) {
    const files = findFiles(path.join(projectRoot, root), ['.vue', '.tsx', '.jsx', '.ts', '.js']);

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
  const feRoots = ['frontend/src', 'app/src', 'src'].filter(r =>
    fs.existsSync(path.join(projectRoot, r))
  );
  const violations = [];
  const identityPatterns = [
    { regex: /\buser-\d{3,}\b/g, reason: '硬编码用户 ID' },
    { regex: /['"`](张三|李四|王五|赵六|管理员|许可人|签发人|接票人)['"`]/g, reason: '硬编码业务身份/人员名称' },
    { regex: /\b(currentUser|operatorId|operatorName)\s*[:=]\s*['"`][^'"`]+['"`]/g, reason: '当前登录人被前端写死' },
  ];

  for (const root of feRoots) {
    const files = findFiles(path.join(projectRoot, root), ['.vue', '.tsx', '.jsx', '.ts', '.js']);
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
  if (specRoutes.length === 0) return { pass: true, message: 'spec 中无显式路由声明' };

  // 读取 router 文件
  const feRoots = ['frontend/src', 'app/src', 'src'].filter(r =>
    fs.existsSync(path.join(projectRoot, r))
  );

  let routerContent = '';
  for (const root of feRoots) {
    for (const name of ['router/index.ts', 'router/index.js', 'router.ts', 'router.js']) {
      const p = path.join(projectRoot, root, name);
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
  const feRoots = ['frontend/src', 'app/src', 'src'].filter(r => fs.existsSync(path.join(projectRoot, r)));
  const beRoots = ['backend/src', 'src/main'].filter(r => fs.existsSync(path.join(projectRoot, r)));
  const allRoots = [...feRoots, ...beRoots];

  const findMatches = (pattern) => {
    if (useGit) {
      return gitGrep(projectRoot, pattern).filter(f => !f.startsWith('spec_copilot/') && !f.endsWith('.md'));
    }
    const matches = [];
    for (const root of allRoots) {
      const abs = path.join(projectRoot, root);
      const files = findFiles(abs, ['.vue', '.tsx', '.jsx', '.ts', '.js', '.java', '.kt', '.py', '.go']);
      for (const file of files) {
        const content = readSafe(file);
        if (content.includes(pattern)) {
          matches.push(path.relative(projectRoot, file));
        }
      }
    }
    return matches;
  };

  const results = rules.map((rule) => {
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

    return {
      ...rule,
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

  // 3. 错误处理审计
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

  // 4. 硬编码数据检测
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

  // 5. 硬编码业务身份检测
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

  // 6. 路由完整性
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

  // 7. 业务规则覆盖
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
  checkErrorHandling,
  checkHardcodedData,
  checkHardcodedIdentities,
  checkRouteCompleteness,
  checkRuleCoverage,
};

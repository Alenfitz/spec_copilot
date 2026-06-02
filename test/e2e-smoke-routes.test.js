/**
 * e2e-smoke 路由提取测试
 *
 * 回归:§6.1 接口覆盖矩阵里的 API 路径(尤其 POST/PUT/DELETE)绝不能被当成
 * 浏览器页面路由去 goto —— 否则会对这些 API 产生假 405/4xx 失败,污染 smoke 结论。
 */

const { test } = require('node:test');
const assert = require('node:assert');
const { extractSpecRoutes } = require('../bin/e2e-smoke');

const SPEC = `
# 切片

## 6. 接口契约

### 6.1 接口覆盖矩阵
| API ID | Method | Path | 前端调用方 | 后端实现入口 | 关联功能点 |
|--------|--------|------|-----------|-------------|----------|
| API01 | POST | /api/work-ticket/list | \`src/api/wt.ts#list\` | \`WorkTicketController#list\` | F01 |
| API02 | GET | /api/work-ticket/detail/{id} | \`src/api/wt.ts#detail\` | \`WorkTicketController#detail\` | F24 |
| API03 | DELETE | /api/work-ticket/{id} | \`src/api/wt.ts#remove\` | \`WorkTicketController#remove\` | F25 |
`;

test('extractSpecRoutes: §6.1 矩阵的 API 路径不进页面路由', () => {
  const { pages, apis } = extractSpecRoutes(SPEC);
  const apiPagesLeaked = pages.filter(p => p.route && p.route.startsWith('/api/'));
  assert.strictEqual(apiPagesLeaked.length, 0,
    `API 路径不应出现在 pages 中,但发现:${JSON.stringify(apiPagesLeaked)}`);
});

test('extractSpecRoutes: §6.1 矩阵的 API 端点按正确 method 进 apis', () => {
  const { apis } = extractSpecRoutes(SPEC);
  const find = (method, pathPart) => apis.some(a => a.method === method && a.path.includes(pathPart));
  assert.ok(find('POST', '/api/work-ticket/list'), 'list 应以 POST 进 apis');
  assert.ok(find('GET', '/api/work-ticket/detail'), 'detail 应以 GET 进 apis');
  assert.ok(find('DELETE', '/api/work-ticket/'), 'remove 应以 DELETE 进 apis');
  // 不应把 POST 接口当成 GET 探测
  assert.ok(!apis.some(a => a.method === 'GET' && a.path === '/api/work-ticket/list'),
    'POST /list 不应被当成 GET 探测');
});

test('extractSpecRoutes: 路径参数 {id}/:id 归一化为 1', () => {
  const { apis } = extractSpecRoutes(SPEC);
  assert.ok(apis.some(a => a.path === '/api/work-ticket/detail/1'), 'detail/{id} 应归一化为 /detail/1');
});

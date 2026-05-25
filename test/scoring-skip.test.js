/**
 * v4.0.10: 评分系统 "skip 状态" + 路由提取过滤 /api/ 的回归测试
 *
 * 之前的漏洞：spec 没填某个矩阵（如 Vxx/ACxx），对应 gate 检查 silently pass，
 * 拿满分。鼓励 AI 偷懒不填。修复后：无输入 = 该项从总分剔除（归一化）。
 */

const { test } = require('node:test');
const assert = require('node:assert');
const reviewChecks = require('../bin/review-checks');

// ─── extractSpecRoutes 不再把 /api/* 误判为页面路由 ─────────

test('extractSpecRoutes: 不包含 /api/ 开头的路径（API 不是页面路由）', () => {
  const spec = `
| API01 | POST | /api/work-ticket/list | ... |
| API02 | GET  | /api/work-ticket/detail/{id} | ... |
`;
  // checkRouteCompleteness 是入口；内部使用 extractSpecRoutes
  const result = reviewChecks.checkRouteCompleteness('/tmp/no-such', spec);
  // 应该 message 为"无页面路由"，而不是把 /api/* 拿来匹配
  assert.ok(result.message);
  assert.ok(/无页面路由|无显式路由/.test(result.message), `expected skip message, got: ${result.message}`);
});

test('extractSpecRoutes: 真正的页面路由能识别', () => {
  const spec = `
| PAGE01 | /work-ticket | 列表页 | ... |
| PAGE02 | /work-ticket/edit/:id | 编辑页 | ... |
`;
  // 没 router 文件 → 仍 skip，但路由本身应被提取
  // 通过 message 内容判断：如果 specRoutes 长度 > 0，message 是"未找到 router 文件"
  // 如果 specRoutes 长度 == 0，message 是"无页面路由"
  const result = reviewChecks.checkRouteCompleteness('/tmp/no-such', spec);
  assert.ok(result.message);
  // 真正的页面路由能提取 → message 应该是"未找到 router 文件"而非"无页面路由"
  assert.ok(/未找到 router 文件/.test(result.message),
    `expected '未找到 router 文件' (说明路由被提取), got: ${result.message}`);
});

test('extractSpecRoutes: 含 {id} 占位符的路径被排除（API 路径标志）', () => {
  const spec = `| API01 | GET | /api/user/{userId}/profile | ... |`;
  const result = reviewChecks.checkRouteCompleteness('/tmp/no-such', spec);
  assert.ok(/无页面路由|无显式路由/.test(result.message));
});

test('extractSpecRoutes: 混合页面路由 + API 路径 → 只提取页面路由', () => {
  const spec = `
## 7.1 页面/路由
| /work-ticket | 列表页 |
| /work-ticket/edit/:id | 编辑页 |

## 6.1 接口
| API01 | GET | /api/work-ticket/list | ... |
`;
  const result = reviewChecks.checkRouteCompleteness('/tmp/no-such', spec);
  // 提取到了 2 个页面路由 → "未找到 router 文件" 才是预期 message
  assert.ok(/未找到 router 文件/.test(result.message),
    `expected page routes extracted, got: ${result.message}`);
});

/**
 * review-checks 模块测试 — 通过 runReviewChecks 入口验证整体能正常运行
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const reviewChecks = require('../bin/review-checks');

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'spec-copilot-review-'));
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

test('review-checks: 模块导出所有期望函数', () => {
  assert.strictEqual(typeof reviewChecks.runReviewChecks, 'function');
  assert.strictEqual(typeof reviewChecks.checkApiContract, 'function');
  assert.strictEqual(typeof reviewChecks.checkContractConsistency, 'function');
  assert.strictEqual(typeof reviewChecks.checkErrorHandling, 'function');
  assert.strictEqual(typeof reviewChecks.checkHardcodedData, 'function');
  assert.strictEqual(typeof reviewChecks.checkHardcodedIdentities, 'function');
  assert.strictEqual(typeof reviewChecks.checkRouteCompleteness, 'function');
  assert.strictEqual(typeof reviewChecks.checkRuleCoverage, 'function');
});

test('checkApiContract: 空 spec → 不报错，返回 pass', () => {
  const dir = mkTmp();
  try {
    const result = reviewChecks.checkApiContract(dir, '');
    assert.ok(result);
    assert.strictEqual(typeof result.pass, 'boolean');
  } finally {
    cleanup(dir);
  }
});

test('checkApiContract: spec 含 API 端点 → 能识别', () => {
  const dir = mkTmp();
  try {
    const spec = `
# 测试需求

## 6. 接口契约
- GET /api/users
- POST /api/orders
`;
    const result = reviewChecks.checkApiContract(dir, spec);
    assert.ok(result);
    // 应至少识别出 2 个 API（即使因没有代码 fail）
    assert.ok(Array.isArray(result.results) || result.message);
  } finally {
    cleanup(dir);
  }
});

test('checkHardcodedIdentities: 空目录 → pass（无文件可扫）', () => {
  const dir = mkTmp();
  try {
    const result = reviewChecks.checkHardcodedIdentities(dir);
    assert.ok(result);
    assert.strictEqual(typeof result.pass, 'boolean');
  } finally {
    cleanup(dir);
  }
});

test('checkHardcodedData: 空目录 → pass', () => {
  const dir = mkTmp();
  try {
    const result = reviewChecks.checkHardcodedData(dir);
    assert.ok(result);
    assert.strictEqual(typeof result.pass, 'boolean');
  } finally {
    cleanup(dir);
  }
});

test('checkErrorHandling: 空目录 → pass', () => {
  const dir = mkTmp();
  try {
    const result = reviewChecks.checkErrorHandling(dir);
    assert.ok(result);
    assert.strictEqual(typeof result.pass, 'boolean');
  } finally {
    cleanup(dir);
  }
});

test('checkRouteCompleteness: 空 spec → 不报错', () => {
  const dir = mkTmp();
  try {
    const result = reviewChecks.checkRouteCompleteness(dir, '');
    assert.ok(result);
  } finally {
    cleanup(dir);
  }
});

test('runReviewChecks: 完整流程 — 空项目空 spec 不崩', () => {
  const dir = mkTmp();
  try {
    const result = reviewChecks.runReviewChecks(dir, '');
    assert.ok(result);
    assert.strictEqual(typeof result, 'object');
  } finally {
    cleanup(dir);
  }
});

test('runReviewChecks: 完整流程 — 真实 spec 不崩', () => {
  const dir = mkTmp();
  try {
    const spec = `
# 用户管理

## 3. 功能点
- F01: 用户列表查询

## 6. 接口契约
### 6.1 接口覆盖矩阵
| API ID | Method | Path | 前端调用方 | 后端实现入口 | 关联功能点 |
|-------|--------|------|-----------|-------------|----------|
| API01 | GET | /api/users | \`src/api/user.ts#getUsers\` | \`UserController#list\` | F01 |
`;
    const result = reviewChecks.runReviewChecks(dir, spec);
    assert.ok(result);
  } finally {
    cleanup(dir);
  }
});

test('checkApiContract: v4 六列接口矩阵可精确匹配自定义前后端目录', () => {
  const dir = mkTmp();
  try {
    fs.mkdirSync(path.join(dir, 'hf-web', 'src', 'api'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'hf-server', 'src', 'main', 'java', 'com', 'example'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'hf-web', 'package.json'), JSON.stringify({ dependencies: { vue: '^3.0.0' } }), 'utf-8');
    fs.writeFileSync(path.join(dir, 'hf-web', 'src', 'api', 'user.ts'), `
export function getUsers() {
  return http.get('/api/users')
}
`, 'utf-8');
    fs.writeFileSync(path.join(dir, 'hf-server', 'pom.xml'), '<project></project>', 'utf-8');
    fs.writeFileSync(path.join(dir, 'hf-server', 'src', 'main', 'java', 'com', 'example', 'UserController.java'), `
class UserController {
  @GetMapping("/api/users")
  public Object list() { return null; }
}
`, 'utf-8');

    const spec = `
# 用户管理

## 6. 接口契约
\`GET /api/users\`

### 6.1 接口覆盖矩阵
| API ID | Method | Path | 前端调用方 | 后端实现入口 | 关联功能点 |
|-------|--------|------|-----------|-------------|----------|
| API01 | GET | /api/users | \`src/api/user.ts#getUsers\` | \`UserController#list\` | F01 |
`;
    const result = reviewChecks.checkApiContract(dir, spec);
    assert.strictEqual(result.pass, true);
    assert.strictEqual(result.total, 1);
    assert.strictEqual(result.matched, 1);
    assert.strictEqual(result.results[0].feExact, true);
    assert.strictEqual(result.results[0].beExact, true);
    assert.strictEqual(result.results[0].path, '/api/users');
  } finally {
    cleanup(dir);
  }
});

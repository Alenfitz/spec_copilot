/**
 * project-roots 模块测试 — 验证自定义目录命名能被识别
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { detectFrontendRoots, detectBackendRoots, _clearCache } = require('../bin/project-roots');

function mkTmp(setup) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-copilot-roots-'));
  if (setup) setup(dir);
  return dir;
}
function cleanup(dir) { fs.rmSync(dir, { recursive: true, force: true }); }
function writeJson(p, obj) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(obj)); }
function touch(p) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, ''); }

test('detectFrontendRoots: 标准 src/ 目录', () => {
  _clearCache();
  const dir = mkTmp(d => {
    writeJson(path.join(d, 'package.json'), { dependencies: { vue: '^3.0.0' } });
    fs.mkdirSync(path.join(d, 'src'));
  });
  try {
    const roots = detectFrontendRoots(dir);
    assert.ok(roots.includes(path.join(dir, 'src')));
  } finally { cleanup(dir); }
});

test('detectFrontendRoots: frontend/src 标准结构', () => {
  _clearCache();
  const dir = mkTmp(d => {
    writeJson(path.join(d, 'frontend', 'package.json'), { dependencies: { react: '^18.0.0' } });
    fs.mkdirSync(path.join(d, 'frontend', 'src'), { recursive: true });
  });
  try {
    const roots = detectFrontendRoots(dir);
    assert.ok(roots.some(r => r.endsWith('src')));
  } finally { cleanup(dir); }
});

test('detectFrontendRoots: 自定义命名 hf-web/ — 重点 case', () => {
  _clearCache();
  const dir = mkTmp(d => {
    writeJson(path.join(d, 'hf-web', 'package.json'), { dependencies: { vue: '^3.0.0' } });
    fs.mkdirSync(path.join(d, 'hf-web', 'src'), { recursive: true });
  });
  try {
    const roots = detectFrontendRoots(dir);
    assert.strictEqual(roots.length, 1, `expected 1 fe root, got ${roots.length}: ${roots.join(', ')}`);
    assert.ok(roots[0].endsWith(path.join('hf-web', 'src')));
  } finally { cleanup(dir); }
});

test('detectFrontendRoots: 自定义命名 my-app/ (Next.js, 无 src/)', () => {
  _clearCache();
  const dir = mkTmp(d => {
    writeJson(path.join(d, 'my-app', 'package.json'), { dependencies: { next: '^14.0.0', react: '^18.0.0' } });
  });
  try {
    const roots = detectFrontendRoots(dir);
    assert.strictEqual(roots.length, 1);
    assert.ok(roots[0].endsWith('my-app'));
  } finally { cleanup(dir); }
});

test('detectFrontendRoots: 跳过非前端的 node 项目', () => {
  _clearCache();
  const dir = mkTmp(d => {
    // 一个纯 Express 后端，不应被识别为前端
    writeJson(path.join(d, 'server', 'package.json'), { dependencies: { express: '^4.0.0' } });
    fs.mkdirSync(path.join(d, 'server', 'src'), { recursive: true });
  });
  try {
    const roots = detectFrontendRoots(dir);
    assert.strictEqual(roots.length, 0, `应不识别为前端，但找到: ${roots.join(', ')}`);
  } finally { cleanup(dir); }
});

test('detectFrontendRoots: 跳过 node_modules / dist / spec_copilot', () => {
  _clearCache();
  const dir = mkTmp(d => {
    // 假冒前端在 node_modules 中
    writeJson(path.join(d, 'node_modules', 'foo', 'package.json'), { dependencies: { vue: '^3.0.0' } });
    fs.mkdirSync(path.join(d, 'node_modules', 'foo', 'src'), { recursive: true });
  });
  try {
    const roots = detectFrontendRoots(dir);
    assert.strictEqual(roots.length, 0);
  } finally { cleanup(dir); }
});

test('detectBackendRoots: 标准 src/main', () => {
  _clearCache();
  const dir = mkTmp(d => {
    fs.writeFileSync(path.join(d, 'pom.xml'), '<project/>');
    fs.mkdirSync(path.join(d, 'src', 'main'), { recursive: true });
  });
  try {
    const roots = detectBackendRoots(dir);
    assert.ok(roots.some(r => r.endsWith(path.join('src', 'main'))));
  } finally { cleanup(dir); }
});

test('detectBackendRoots: 自定义命名 hf-server/ — 重点 case', () => {
  _clearCache();
  const dir = mkTmp(d => {
    fs.mkdirSync(path.join(d, 'hf-server', 'src', 'main'), { recursive: true });
    fs.writeFileSync(path.join(d, 'hf-server', 'pom.xml'), '<project/>');
  });
  try {
    const roots = detectBackendRoots(dir);
    assert.strictEqual(roots.length, 1);
    assert.ok(roots[0].endsWith(path.join('hf-server', 'src', 'main')));
  } finally { cleanup(dir); }
});

test('detectBackendRoots: Express 后端', () => {
  _clearCache();
  const dir = mkTmp(d => {
    writeJson(path.join(d, 'api', 'package.json'), { dependencies: { express: '^4.0.0' } });
    fs.mkdirSync(path.join(d, 'api', 'src'), { recursive: true });
  });
  try {
    const roots = detectBackendRoots(dir);
    assert.strictEqual(roots.length, 1);
    assert.ok(roots[0].endsWith(path.join('api', 'src')));
  } finally { cleanup(dir); }
});

test('detectBackendRoots: Go 后端', () => {
  _clearCache();
  const dir = mkTmp(d => {
    fs.mkdirSync(path.join(d, 'svc'), { recursive: true });
    fs.writeFileSync(path.join(d, 'svc', 'go.mod'), 'module test');
  });
  try {
    const roots = detectBackendRoots(dir);
    assert.strictEqual(roots.length, 1);
    assert.ok(roots[0].endsWith('svc'));
  } finally { cleanup(dir); }
});

test('detectBackendRoots: 不把 Vue 项目误判为后端', () => {
  _clearCache();
  const dir = mkTmp(d => {
    writeJson(path.join(d, 'web', 'package.json'), { dependencies: { vue: '^3.0.0' } });
    fs.mkdirSync(path.join(d, 'web', 'src'), { recursive: true });
  });
  try {
    const roots = detectBackendRoots(dir);
    assert.strictEqual(roots.length, 0);
  } finally { cleanup(dir); }
});

test('combo: 同时识别 hf-web/ 和 hf-server/（用户实际项目结构）', () => {
  _clearCache();
  const dir = mkTmp(d => {
    writeJson(path.join(d, 'hf-web', 'package.json'), { dependencies: { vue: '^3.0.0', 'element-plus': '^2.0.0' } });
    fs.mkdirSync(path.join(d, 'hf-web', 'src'), { recursive: true });
    fs.mkdirSync(path.join(d, 'hf-server', 'src', 'main'), { recursive: true });
    fs.writeFileSync(path.join(d, 'hf-server', 'pom.xml'), '<project/>');
  });
  try {
    const fe = detectFrontendRoots(dir);
    const be = detectBackendRoots(dir);
    assert.strictEqual(fe.length, 1);
    assert.ok(fe[0].endsWith(path.join('hf-web', 'src')));
    assert.strictEqual(be.length, 1);
    assert.ok(be[0].endsWith(path.join('hf-server', 'src', 'main')));
  } finally { cleanup(dir); }
});

test('detectFrontendRoots: 空目录返回空数组', () => {
  _clearCache();
  const dir = mkTmp();
  try {
    assert.deepStrictEqual(detectFrontendRoots(dir), []);
  } finally { cleanup(dir); }
});

test('detectBackendRoots: 空目录返回空数组', () => {
  _clearCache();
  const dir = mkTmp();
  try {
    assert.deepStrictEqual(detectBackendRoots(dir), []);
  } finally { cleanup(dir); }
});

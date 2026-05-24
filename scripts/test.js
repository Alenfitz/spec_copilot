#!/usr/bin/env node
/**
 * Cross-platform test runner.
 *
 * 为什么不用 "node --test test/*.test.js"：
 * Windows shell (cmd / PowerShell) 不支持 glob 展开，会原样把
 * 'test/*.test.js' 传给 node，导致 "no such file" 错误。
 *
 * 这个脚本枚举 test/ 下所有 .test.js 文件并显式传给 node --test。
 */

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const testDir = path.resolve(__dirname, '..', 'test');

if (!fs.existsSync(testDir)) {
  console.error(`Test directory not found: ${testDir}`);
  process.exit(1);
}

const files = fs.readdirSync(testDir)
  .filter(f => f.endsWith('.test.js'))
  .map(f => path.join(testDir, f));

if (files.length === 0) {
  console.error('No test files found in test/');
  process.exit(1);
}

console.log(`Running ${files.length} test file(s)...`);

const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exit(result.status ?? 1);

/**
 * Build: obfuscate JS + copy assets → dist/
 */
const fs = require('fs');
const path = require('path');
const JavaScriptObfuscator = require('javascript-obfuscator');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');

// Clean dist
if (fs.existsSync(dist)) {
  fs.rmSync(dist, { recursive: true });
}

// Obfuscator config — balanced: readability protection without breaking Node.js runtime
const obfuscatorOpts = {
  compact: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.5,
  deadCodeInjection: true,
  deadCodeInjectionThreshold: 0.3,
  identifierNamesGenerator: 'hexadecimal',
  numbersToExpressions: true,
  renameGlobals: false,
  selfDefending: true,
  simplify: true,
  splitStrings: true,
  splitStringsChunkLength: 10,
  stringArray: true,
  stringArrayCallsTransform: true,
  stringArrayEncoding: ['base64'],
  stringArrayIndexShift: true,
  stringArrayWrappersCount: 2,
  stringArrayWrappersType: 'variable',
  target: 'node',
  transformObjectKeys: true,
};

// License header — 写在所有混淆产物顶部，保护性声明（reverse engineering / 重发布的法律红线）
const pkgVersion = require(path.join(root, 'package.json')).version;
const LICENSE_HEADER = `/*!
 * @alenfitz/spec-copilot v${pkgVersion}
 * Copyright (c) ${new Date().getFullYear()} alenfitz. All rights reserved.
 *
 * This file is proprietary and obfuscated. Reverse engineering, decompilation,
 * disassembly, or unauthorized redistribution of any kind is strictly prohibited.
 * Source code is NOT licensed under MIT/Apache and is NOT available for derivative work.
 *
 * Bugs / feature requests: https://github.com/Alenfitz/spec_copilit/issues
 */
`;

function obfuscateFile(srcPath, destPath) {
  const code = fs.readFileSync(srcPath, 'utf-8');
  const result = JavaScriptObfuscator.obfuscate(code, obfuscatorOpts);
  // obfuscator 可能保留 shebang 在输出顶部 — 先剥掉，shebang restore 步骤统一处理
  const obfuscated = result.getObfuscatedCode().replace(/^#!.*\n/, '');
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.writeFileSync(destPath, LICENSE_HEADER + obfuscated, 'utf-8');
}

function copyDir(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(s, d);
    } else {
      fs.copyFileSync(s, d);
    }
  }
}

// Obfuscate JS files
console.log('Obfuscating JS...');
obfuscateFile(path.join(root, 'bin', 'cli.js'), path.join(dist, 'bin', 'cli.js'));
obfuscateFile(path.join(root, 'adapters', 'index.js'), path.join(dist, 'adapters', 'index.js'));

// Restore shebang at top（必须是文件第一行，license header 移到 shebang 之后）
{
  const cliPath = path.join(dist, 'bin', 'cli.js');
  let content = fs.readFileSync(cliPath, 'utf-8');
  if (!content.startsWith('#!/usr/bin/env node')) {
    content = '#!/usr/bin/env node\n' + content;
  }
  fs.writeFileSync(cliPath, content, 'utf-8');
}

// Copy non-JS assets
console.log('Copying assets...');
copyDir(path.join(root, 'framework'), path.join(dist, 'framework'));
copyDir(path.join(root, 'commands'), path.join(dist, 'commands'));

// Copy READMEs to dist root
for (const f of ['README.md', 'README.zh-CN.md']) {
  const src = path.join(root, f);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(dist, f));
}

// Copy package.json to dist (for publishing)
const pkg = require(path.join(root, 'package.json'));
// Remove dev-only fields from dist package.json
delete pkg.scripts;
delete pkg.devDependencies;
pkg.scripts = { test: 'node bin/cli.js --help' };
// Adjust bin path for dist
if (pkg.bin && pkg.bin['spec-copilot']) {
  pkg.bin['spec-copilot'] = 'bin/cli.js';
}
fs.writeFileSync(path.join(dist, 'package.json'), JSON.stringify(pkg, null, 2), 'utf-8');

console.log('Build complete → dist/');

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execSync } = require('node:child_process');

const CLI = path.resolve(__dirname, '..', 'bin', 'cli.js');

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'spec-copilot-watch-'));
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function runWatchOnce(projectRoot, since) {
  try {
    return execSync(`node "${CLI}" watch --once --since ${since}`, {
      cwd: projectRoot,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (e) {
    return (e.stdout || '') + (e.stderr || '');
  }
}

function touchFile(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

test('watch --once: alerts when business source changes without active change', () => {
  const dir = mkTmp();
  try {
    const since = Date.now();
    touchFile(path.join(dir, 'src', 'main', 'App.java'), 'class App {}\n');
    const out = runWatchOnce(dir, since);
    assert.match(out, /SPEC-COPILOT WATCH ALERT/);
    assert.match(out, /SRC_WITHOUT_ACTIVE_CHANGE/);
    assert.match(out, /src\/main\/App\.java/);
  } finally {
    cleanup(dir);
  }
});

test('watch --once: alerts when source changes before apply gate', () => {
  const dir = mkTmp();
  try {
    const changeDir = path.join(dir, 'spec_copilot', 'changes', 'demo');
    fs.mkdirSync(changeDir, { recursive: true });
    touchFile(path.join(changeDir, 'spec.md'), '# Demo\n');
    touchFile(path.join(changeDir, 'tasks.md'), '# Tasks\n');
    const since = Date.now();
    touchFile(path.join(dir, 'backend', 'src', 'main', 'Demo.java'), 'class Demo {}\n');
    const out = runWatchOnce(dir, since);
    assert.match(out, /SRC_BEFORE_APPLY/);
    assert.match(out, /尚无 \.gate-apply-passed/);
  } finally {
    cleanup(dir);
  }
});

test('watch --once: alerts when archive appears without review/test sentinels', () => {
  const dir = mkTmp();
  try {
    const archiveDir = path.join(dir, 'spec_copilot', 'archives', '2026-05', 'demo');
    const since = Date.now();
    touchFile(path.join(archiveDir, 'spec.md'), '# Demo\n> complexity: 🔴 重\n');
    const out = runWatchOnce(dir, since);
    assert.match(out, /ARCHIVE_WITHOUT_SENTINEL/);
    assert.match(out, /\.gate-review-passed/);
    assert.match(out, /\.gate-test-passed/);
  } finally {
    cleanup(dir);
  }
});

test('watch --once: scaffold warning only fires when scaffold mode is required', () => {
  const dir = mkTmp();
  try {
    const changeDir = path.join(dir, 'spec_copilot', 'changes', 'demo');
    const since = Date.now();
    touchFile(path.join(changeDir, 'spec.md'), '# Demo\n');
    let out = runWatchOnce(dir, since);
    assert.match(out, /watch scan clean/);

    touchFile(path.join(dir, 'spec_copilot', '.scaffold-required'), '{}\n');
    out = runWatchOnce(dir, since);
    assert.match(out, /SPEC_WITHOUT_SCAFFOLD/);
  } finally {
    cleanup(dir);
  }
});

test('watch --once: clean when source change has active apply gate', () => {
  const dir = mkTmp();
  try {
    const changeDir = path.join(dir, 'spec_copilot', 'changes', 'demo');
    fs.mkdirSync(changeDir, { recursive: true });
    touchFile(path.join(changeDir, 'spec.md'), '# Demo\n');
    touchFile(path.join(changeDir, 'tasks.md'), '# Tasks\n');
    touchFile(path.join(changeDir, '.gate-scaffold'), '{}\n');
    touchFile(path.join(changeDir, '.gate-apply-passed'), '{}\n');
    const since = Date.now();
    touchFile(path.join(dir, 'src', 'main', 'Demo.java'), 'class Demo {}\n');
    const out = runWatchOnce(dir, since);
    assert.match(out, /watch scan clean/);
  } finally {
    cleanup(dir);
  }
});

const fs = require('fs');
const path = require('path');

function copyDir(src, dest, options = {}) {
  const { overwrite = true, exclude = [] } = options;
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (exclude.includes(entry.name)) continue;
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath, options);
    } else if (overwrite || !fs.existsSync(destPath)) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function cleanupLegacyColonCommands(commandsDir) {
  if (!fs.existsSync(commandsDir)) return 0;
  let removed = 0;
  for (const entry of fs.readdirSync(commandsDir, { withFileTypes: true })) {
    if (entry.isFile() && /^spec:.+\.md$/.test(entry.name)) {
      fs.unlinkSync(path.join(commandsDir, entry.name));
      removed++;
    }
  }
  return removed;
}

function rmDirRecursive(dirPath) {
  if (!fs.existsSync(dirPath)) return;
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const p = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      rmDirRecursive(p);
    } else {
      fs.unlinkSync(p);
    }
  }
  fs.rmdirSync(dirPath);
}

function countMdFiles(dir) {
  if (!fs.existsSync(dir)) return 0;
  let count = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      count += countMdFiles(path.join(dir, entry.name));
    } else if (entry.name.endsWith('.md')) {
      count++;
    }
  }
  return count;
}

module.exports = {
  copyDir,
  cleanupLegacyColonCommands,
  rmDirRecursive,
  countMdFiles,
};

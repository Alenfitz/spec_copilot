const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execSync } = require('node:child_process');

const { checkTaskVerticalSlices } = require('../bin/frontend-checks');

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'spec-copilot-entropy-'));
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function setupProject(dir, tasksContent, specContent = '> status: propose\n> complexity: 🔴\n\n## 1. 背景与目标\n\n## 2. 代码现状\n\n## 3. 功能点\n\n## 4. 业务规则\n\n## 9. 待澄清\n\n## 13. 确认记录\n') {
  const scDir = path.join(dir, 'spec_copilot');
  const changeDir = path.join(scDir, 'changes', 'demo');
  const scriptsDir = path.join(scDir, 'scripts');
  fs.mkdirSync(changeDir, { recursive: true });
  fs.mkdirSync(scriptsDir, { recursive: true });

  fs.writeFileSync(path.join(changeDir, 'spec.md'), specContent, 'utf-8');
  fs.writeFileSync(path.join(changeDir, 'tasks.md'), tasksContent, 'utf-8');
  fs.writeFileSync(path.join(changeDir, 'log.md'), '## 时间线\n\n## 知识发现\n\n## Spec-Code 偏差记录\n', 'utf-8');

  const srcLint = path.join(__dirname, '..', 'framework', 'scripts', 'spec-lint.sh');
  const dstLint = path.join(scriptsDir, 'spec-lint.sh');
  fs.copyFileSync(srcLint, dstLint);
  fs.chmodSync(dstLint, 0o755);
}

function runLint(projectRoot) {
  const cli = path.join(__dirname, '..', 'bin', 'cli.js');
  try {
    const stdout = execSync(`node "${cli}" lint demo`, {
      cwd: projectRoot,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { pass: true, stdout };
  } catch (e) {
    return {
      pass: false,
      stdout: e.stdout?.toString() || '',
      stderr: e.stderr?.toString() || '',
      status: e.status,
    };
  }
}

function runGateApply(projectRoot) {
  const cli = path.join(__dirname, '..', 'bin', 'cli.js');
  try {
    const stdout = execSync(`node "${cli}" gate demo apply`, {
      cwd: projectRoot,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { pass: true, stdout };
  } catch (e) {
    return {
      pass: false,
      stdout: e.stdout?.toString() || '',
      stderr: e.stderr?.toString() || '',
      status: e.status,
    };
  }
}

test('checkTaskVerticalSlices: 缺少 V-Slice 字段时失败', () => {
  const tasks = `# Tasks

## 前置条件
- [ ] spec 已确认

## Task 1: 新建工单
- **目标**：完成工单创建
- **覆盖功能点**：F01
- **不可降级项**：创建后必须真实落库
- **涉及文件**：
  - \`src/a.ts\`
- **关键签名**：
  \`\`\`ts
  export function createTicket() {}
  \`\`\`
- **验证命令**：
  \`\`\`bash
  curl http://localhost:8080/api/tickets
  \`\`\`
- **Git commit**：\`[demo] T1: create\`
- 状态：待完成
`;
  const result = checkTaskVerticalSlices(tasks);
  assert.ok(result.failures.some(f => f.includes('用户动作')));
  assert.ok(result.failures.some(f => f.includes('验证路径')));
});

test('checkTaskVerticalSlices: 覆盖功能点超过 3 个时失败', () => {
  const tasks = `# Tasks

## 前置条件
- [ ] spec 已确认

## Task 1: 工单大闭环
- **目标**：一次做完全部
- **覆盖功能点**：F01/F02/F03/F04
- **不可降级项**：保存必须真实落库
- **涉及文件**：
  - \`src/a.ts\`

### V-Slice（必填）
- **用户动作**：列表页点击新增后提交
- **接口契约**：POST /api/tickets -> TicketController#create
- **状态/数据变化**：创建工单并写入数据库
- **界面/输出结果**：新建成功后跳转详情页
- **验证路径**：列表页 -> 新建 -> 提交 -> 详情回显

- **验证命令**：
  \`\`\`bash
  curl http://localhost:8080/api/tickets
  \`\`\`
- **Git commit**：\`[demo] T1: big\`
- 状态：待完成
`;
  const result = checkTaskVerticalSlices(tasks);
  assert.ok(result.failures.some(f => f.includes('覆盖 4 个功能点')));
});

test('lint: 缺少 V-Slice / 不可降级项时失败', () => {
  const dir = mkTmp();
  try {
    setupProject(dir, `# Tasks

## 前置条件
- [ ] spec 已确认

## Task 1: 新建工单
- **目标**：完成工单创建
- **覆盖功能点**：F01
- **涉及文件**：
  - \`src/a.ts\`
- **关键签名**：
  \`\`\`ts
  export function createTicket() {}
  \`\`\`
- **验证命令**：
  \`\`\`bash
  curl http://localhost:8080/api/tickets
  \`\`\`
- **Git commit**：\`[demo] T1: create\`
- 状态：待完成
`);
    const result = runLint(dir);
    const output = `${result.stdout}\n${result.stderr}`;
    assert.strictEqual(result.pass, false);
    assert.match(output, /缺少 V-Slice 区块|缺少“不可降级项”字段|缺少 V-Slice 字段/);
  } finally {
    cleanup(dir);
  }
});

test('lint: 合法 V-Slice task 可以通过', () => {
  const dir = mkTmp();
  try {
    setupProject(dir, `# Tasks

## 前置条件
- [ ] spec 已确认

## Task 1: 新建工单闭环
- **目标**：完成工单创建并回显
- **覆盖功能点**：F01/F02
- **不可降级项**：保存必须真实落库
- **涉及文件**：
  - \`src/a.ts\`
- **关键签名**：
  \`\`\`ts
  export function createTicket() {}
  \`\`\`

### V-Slice（必填）
- **用户动作**：列表页点击新增，填写表单并提交
- **接口契约**：POST /api/tickets -> TicketController#create
- **状态/数据变化**：创建工单并写入数据库
- **界面/输出结果**：提交成功后返回列表并显示新工单
- **验证路径**：列表页 -> 点击新增 -> 填写 -> 提交 -> 返回列表查看新增记录

- **验证命令**：
  \`\`\`bash
  curl http://localhost:8080/api/tickets
  \`\`\`
- **Git commit**：\`[demo] T1: create\`
- 状态：待完成
`);
    const result = runLint(dir);
    assert.strictEqual(result.pass, true, `${result.stdout}\n${result.stderr}`);
  } finally {
    cleanup(dir);
  }
});

test('gate apply: 缺少 V-Slice 时失败', () => {
  const dir = mkTmp();
  try {
    setupProject(
      dir,
      `# Tasks

## 前置条件
- [ ] spec 已确认

## Task 1: 工单接口
- **目标**：完成接口
- **覆盖功能点**：F01
- **不可降级项**：保存必须真实落库
- **涉及文件**：
  - \`src/a.ts\`
- **关键签名**：
  \`\`\`ts
  export function createTicket() {}
  \`\`\`
- **验证命令**：
  \`\`\`bash
  curl http://localhost:8080/api/tickets
  \`\`\`
- **Git commit**：\`[demo] T1: api\`
- 状态：待完成
`,
      `> status: propose
> complexity: 🔴

## 1. 背景与目标

## 2. 代码现状

## 3. 功能点

## 4. 业务规则

## 9. 待澄清

## 10. 技术决策

## 13. 确认记录
`
    );
    const result = runGateApply(dir);
    const output = `${result.stdout}\n${result.stderr}`;
    assert.strictEqual(result.pass, false);
    assert.match(output, /Task Vertical Slice 检测失败/);
  } finally {
    cleanup(dir);
  }
});

test('gate apply: 合法 V-Slice task 可以通过', () => {
  const dir = mkTmp();
  try {
    setupProject(
      dir,
      `# Tasks

## 前置条件
- [ ] spec 已确认

## Task 1: 新建工单闭环
- **目标**：完成工单创建并回显
- **覆盖功能点**：F01/F02
- **不可降级项**：保存必须真实落库
- **涉及文件**：
  - \`src/a.ts\`
- **关键签名**：
  \`\`\`ts
  export function createTicket() {}
  \`\`\`

### V-Slice（必填）
- **用户动作**：列表页点击新增，填写表单并提交
- **接口契约**：POST /api/tickets -> TicketController#create
- **状态/数据变化**：创建工单并写入数据库
- **界面/输出结果**：提交成功后返回列表并显示新工单
- **验证路径**：列表页 -> 点击新增 -> 填写 -> 提交 -> 返回列表查看新增记录

- **验证命令**：
  \`\`\`bash
  curl http://localhost:8080/api/tickets
  \`\`\`
- **Git commit**：\`[demo] T1: create\`
- 状态：待完成
`,
      `> status: propose
> complexity: 🔴

## 1. 背景与目标

## 2. 代码现状

## 3. 功能点

## 4. 业务规则

## 9. 待澄清

## 10. 技术决策

## 13. 确认记录
`
    );
    const result = runGateApply(dir);
    assert.strictEqual(result.pass, true, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /Task Vertical Slice：1 个 task 具备基本闭环字段/);
  } finally {
    cleanup(dir);
  }
});

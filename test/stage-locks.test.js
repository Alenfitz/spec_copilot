/**
 * v4.0.16: 阶段锁合约测试
 *
 * 目标：防止模型在读懂规范后，仍因用户催促而跳过
 * /spec:init -> /spec:bootstrap -> /spec:propose|lite -> /spec:apply
 * 的阶段门禁。
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const REPO = path.resolve(__dirname, '..');

const agentsTpl = fs.readFileSync(path.join(REPO, 'framework', 'AGENTS.md.template'), 'utf-8');
const initMd = fs.readFileSync(path.join(REPO, 'commands', 'spec', 'init.md'), 'utf-8');
const bootstrapMd = fs.readFileSync(path.join(REPO, 'commands', 'spec', 'bootstrap.md'), 'utf-8');
const proposeMd = fs.readFileSync(path.join(REPO, 'commands', 'spec', 'propose.md'), 'utf-8');
const liteMd = fs.readFileSync(path.join(REPO, 'commands', 'spec', 'lite.md'), 'utf-8');
const applyMd = fs.readFileSync(path.join(REPO, 'commands', 'spec', 'apply.md'), 'utf-8');

test('AGENTS.md.template: 必须声明阶段锁且优先级高于用户催促', () => {
  assert.match(agentsTpl, /## 阶段锁（高优先级）/);
  assert.match(agentsTpl, /高于.*尽快完成.*直接开发.*一次做完.*先出代码再补文档/);
  assert.match(agentsTpl, /未执行 `\/spec:init` 前，禁止进入业务开发/);
  assert.match(agentsTpl, /用户消息里即使同时出现命令词和.*做完整件事.*也必须按当前阶段门禁逐步推进/);
});

test('AGENTS.md.template: 空壳项目必须锁定在 /spec:bootstrap', () => {
  assert.match(agentsTpl, /空壳项目在 `\/spec:bootstrap` 完成前，不能进入任何需求开发阶段/);
});

test('init.md: 必须把自己声明为唯一合法起点', () => {
  assert.match(initMd, /`\/spec:init` 是每次会话的\*\*唯一合法起点\*\*/);
  assert.match(initMd, /如果用户在同一条消息里同时说了.*先写代码.*直接实现.*也\*\*不能\*\*跳过本命令/);
});

test('init.md: 空壳项目后必须禁止继续 propose/lite/apply/直接编码', () => {
  assert.match(initMd, /自动触发 `\/spec:bootstrap`/);
  assert.match(initMd, /禁止.*继续 propose\/lite\/apply\/直接编码/);
  assert.match(initMd, /→ 下一步：\/spec:bootstrap/);
});

test('bootstrap.md: 完成前禁止进入任何需求开发阶段', () => {
  assert.match(bootstrapMd, /`\/spec:bootstrap` 完成前，禁止进入 `\/spec:propose`、`\/spec:lite`、`\/spec:apply` 或直接写业务代码/);
  assert.match(bootstrapMd, /初始化完直接开发.*也不能越过 propose\/lite 阶段/);
  assert.match(bootstrapMd, /不加任何业务代码/);
});

test('propose.md: 只能产出 spec，不得因用户催促直接编码', () => {
  assert.match(proposeMd, /`\/spec:propose` 的职责是产出 spec\/tasks\/log，不是直接编码/);
  assert.match(proposeMd, /即使用户在同一条消息里要求.*把开发也一起做完.*也必须先完成本命令/);
  assert.match(proposeMd, /输出到这里必须停止/);
});

test('lite.md: 必须要求迷你 spec 之后的二次明确确认', () => {
  assert.match(liteMd, /不要在用户确认前编码/);
  assert.match(liteMd, /同一条消息里已经说了.*直接做完.*也不能视为这里的确认/);
  assert.match(liteMd, /再拿到一次明确的"开始\/继续\/做吧"/);
});

test('lite.md: 发现复杂化后必须停下，不得继续偷跑', () => {
  assert.match(liteMd, /建议改用 `\/spec:propose`(?: 走完整流程)?/);
  assert.match(liteMd, /如果用户拒绝切换，也不能继续按 lite 偷跑复杂需求开发/);
});

test('apply.md: 必须禁止绕过 propose 直接编码', () => {
  assert.match(applyMd, /如果用户没有先走 `\/spec:propose`，不得自行脑补 spec 后直接编码/);
  assert.match(applyMd, /用户即使说"全部执行"、"不要停顿"，也必须遵守本命令的逐 task 停顿/);
  assert.match(applyMd, /唯一例外只有用户\*\*显式\*\*使用 `\/spec:flow`/);
});

---
description: 三阶段审查（Spec 合规独立 agent + 代码质量 + 破坏性测试）
---

请按 AGENTS.md 中定义的 /review 流程执行：

**变更名**：$ARGUMENTS

## 前置检查

运行 `npx @alenfitz/spec-copilot gate <变更名> review`（跨平台门禁检查）

## 阶段一：Spec Compliance（强制独立 agent）

> v2.0.0 引入：必须使用 `spec-compliance-reviewer` agent profile。该 profile 在 `spec_copilot/agents/spec-compliance-reviewer.md`。

**宿主为 claude-code（支持 Agent 工具）时**：
1. Read `spec_copilot/agents/spec-compliance-reviewer.md`
2. 通过 Agent 工具 spawn 独立子 agent：
   - `subagent_type`: `general-purpose`
   - `prompt`: profile 完整内容 + 本次变更 spec.md/tasks.md 路径 + 项目根路径
3. 等子 agent 返回完整报告，**主 agent 不得 override 或软化结论**
4. 把子 agent 报告嵌入到 spec.md §12 审查结论

**其它宿主**：
1. 主 agent 自己 Read profile 并扮演该角色执行
2. 报告顶部加 `⚠️ 未使用独立 agent，结论可靠性降级`
3. 在结论里加：`独立性：降级`

阶段一不通过（覆盖率 < 80% 或有 Critical 不一致）→ 直接返回 `/spec:fix`，不进入阶段二。

## 阶段二：Code Quality（附录 B）

按 Critical / Important / Minor 三级审查。
加载 `spec_copilot/stack-adapters/<栈>.md` §10 栈相关检查项。

## 阶段三：Adversarial Test（🔴 强制 / 🟡 可选）

> v2.0.0 引入：🔴 复杂需求必须跑破坏性测试，🟡 可由用户选择是否跑。

**何时跑**：阶段一和阶段二都通过后。

**宿主为 claude-code 时**：
1. Read `spec_copilot/agents/adversarial-tester.md`
2. 通过 Agent 工具 spawn 独立子 agent：
   - `subagent_type`: `general-purpose`
   - `prompt`: profile + spec.md/tasks.md 路径 + 阶段一报告 + 项目根路径
3. 等返回报告

**其它宿主**：扮演模式，标注降级。

阶段三发现 Critical 缺陷 → 返回 `/spec:fix`，修复后重跑阶段三。

## 完成后

把三个阶段的报告**合并**写入 spec.md §12 审查结论（必须含：覆盖率数字、Critical 数、Adversarial Critical 数）。

## 结束后

读取 spec.md §2 复杂度等级后输出：

**通过（Critical=0）：**

🟡 中等需求：
```
审查通过 ✓
→ 下一步：/spec:archive <变更名>
```

🔴 复杂需求：
```
审查通过 ✓
→ 下一步：/spec:test <变更名>
（测试通过后 /spec:archive）
```

**需修复（Critical>0，所有等级）：**
```
审查未通过 ✗（<N> 个 Critical 问题）
→ 下一步：/spec:fix <变更名> <问题描述>
（修复后自动重新 /spec:review）
```

如参数含 --full，执行全量 review（扫描整个代码库）；否则仅扫描本次变更文件。

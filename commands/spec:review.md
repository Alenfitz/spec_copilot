---
description: 三阶段审查（Spec 合规独立 agent + 代码质量 + 破坏性测试）
---

请按 AGENTS.md 中定义的 /review 流程执行：

**变更名**：$ARGUMENTS

## 前置检查

运行 `npx @alenfitz/spec-copilot gate <变更名> review`（跨平台门禁检查）

## 阶段一：Spec Compliance（强制独立 agent）

> v2.0.0+ 引入：必须使用 `spec-compliance-reviewer` agent profile。

**Claude Code**（profile 已安装到 `.claude/agents/spec-compliance-reviewer.md`）：
- 使用 Agent 工具调度：`subagent_type: spec-compliance-reviewer`
- `prompt`: 提供本次变更名 + spec.md/tasks.md 路径 + 项目根路径 + 任务说明

**opencode**（profile 已安装到 `.opencode/agent/spec-compliance-reviewer.md`）：
- 使用 Task 工具调度：`subagent_type: spec-compliance-reviewer`
- 提供同上参数

**其它宿主**（cursor / windsurf / copilot / cline）：
1. 主 agent 自己 Read `spec_copilot/agents/spec-compliance-reviewer.md`，扮演该角色执行
2. 报告顶部加 `⚠️ 未使用独立 agent，结论可靠性降级`
3. 在结论里加：`独立性：降级`

**调用方法用 `npx @alenfitz/spec-copilot doctor` 检测**：如果显示"宿主支持 sub-agent"，使用前两种方式；否则用降级方式。

子 agent 返回报告后，**主 agent 不得 override 或软化结论**，必须把报告原样嵌入 spec.md §12。

阶段一不通过（覆盖率 < 80% 或有 Critical 不一致）→ 直接返回 `/spec:fix`，不进入阶段二。

## 阶段二：Code Quality（附录 B）

按 Critical / Important / Minor 三级审查。
加载 `spec_copilot/stack-adapters/<栈>.md` §10 栈相关检查项。

## 阶段三：Adversarial Test（🔴 强制 / 🟡 可选）

> v2.0.0 引入：🔴 复杂需求必须跑破坏性测试，🟡 可由用户选择是否跑。

**何时跑**：阶段一和阶段二都通过后。

**Claude Code / opencode**（profile 已安装到宿主 agent 目录）：
- 调用 `subagent_type: adversarial-tester`
- 提供变更名 + spec.md/tasks.md 路径 + 阶段一报告 + 项目根路径

**其它宿主**：主 agent Read `spec_copilot/agents/adversarial-tester.md` 扮演该角色，标注降级。

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

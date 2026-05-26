---
description: 三阶段审查（Spec 合规独立 agent + 代码质量 + 破坏性测试）
---

请按 /review 流程执行：

**变更名**：$ARGUMENTS

## 前置检查

```bash
npx @alenfitz/spec-copilot gate <变更名> review
```

gate review 自动执行：
- **smoke 证据校验**：`.gate-smoke-passed` 必须由 CLI 签发，且仍匹配当前 `spec.md/tasks.md/log.md/source`
- **API 契约校验**：spec §6.1 接口矩阵 → 前端调用 + 后端实现匹配
- **契约一致性**：前端请求字段 vs 后端必填字段
- **错误处理审计**：所有 API 调用点是否有 catch
- **硬编码身份检测**：前端是否写死当前用户/操作人

## 阶段一：Spec Compliance（强制独立 agent）

**Claude Code**：
```
Agent({
  subagent_type: "spec-compliance-reviewer",
  description: "Spec 合规独立审查",
  prompt: `请按你的角色 profile 完成对 <变更名> 的合规审查。
输入：
- spec.md: spec_copilot/changes/<变更名>/spec.md
- tasks.md: spec_copilot/changes/<变更名>/tasks.md
- 项目根目录: <当前 cwd>

按 profile 执行，严格按输出格式返回报告。`
})
```

**opencode**：用 task 工具，subagent_type=spec-compliance-reviewer。

**其它宿主**：主 agent 自己 Read profile 扮演执行，报告顶部标"独立性降级"。

**子 agent 返回后，主 agent 不得 override 或软化结论。**

阶段一不通过（功能点覆盖率太低或有 Critical 不一致）→ 返回 `/spec:fix`。

## 阶段二：Code Quality

按 Critical / Important / Minor 三级审查。
加载 `spec_copilot/stack-adapters/<栈>.md` §10 栈相关检查。

## 阶段三：Adversarial Test（🔴 复杂需求强制）

阶段一二都通过后跑。
调用 `subagent_type: adversarial-tester`，提供 spec + 项目根 + 阶段一报告。

阶段三发现 Critical → `/spec:fix` 修复后重跑阶段三。

## 完成后

三阶段报告合并写入 spec.md §12，必须含：覆盖率数字、Critical 数、契约一致性结果。

## 输出

**通过（Critical=0）**：

🔴 复杂需求：
```
审查通过 ✓
→ 下一步：/spec:test <变更名>（测试后 /spec:archive）
```

其余情况：
```
审查通过 ✓
→ 下一步：/spec:archive <变更名>
```

**需修复**：
```
审查未通过 ✗（<N> 个 Critical）
→ /spec:fix <变更名> <问题>
```

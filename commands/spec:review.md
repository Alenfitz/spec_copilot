---
description: 两阶段审查（Spec 合规 + 代码质量）
---

请按 AGENTS.md 中定义的 /review 流程执行：

**变更名**：$ARGUMENTS

## 前置检查

运行 `npx @alenfitz/spec-copilot gate <变更名> review`（跨平台门禁检查）

**阶段一 Spec Compliance**（附录 A）：
逐条验证 spec 功能点是否落地。PASS 后才进入阶段二。

**阶段二 Code Quality**（附录 B）：
按 Critical / Important / Minor 三级审查。
加载 `spec_copilot/stack-adapters/<栈>.md` §10 栈相关检查项。

完成后更新 spec.md §12 审查结论。

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

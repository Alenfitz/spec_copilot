---
description: 两阶段审查（Spec 合规 + 代码质量）
---

请按 AGENTS.md 中定义的 /review 流程执行：

**变更名**：$ARGUMENTS

## 前置检查

运行 `npx @alenfitz/spec-copilot gate <变更名> review`（跨平台门禁检查）

**阶段一 Spec Compliance**（附录 A）：

> 🔒 **独立验证铁律**：禁止凭 apply 阶段的记忆得出结论。每个功能点/业务规则必须当场执行 `grep -rn` 或 `Read`，输出 `文件:行号` 作为证据。无证据的 ✅ 视为无效。

执行步骤：
1. 读取 spec.md §3 功能点列表，逐条执行 `grep -rn` 定位后端和前端实现
2. 读取 spec.md §4 业务规则列表，逐条执行 `grep -rn` 定位校验逻辑
3. 对有实现的功能点，`Read` 代码段确认非空实现（非 TODO/占位/空方法体）
4. 统计覆盖率：`已实现/总功能点`。**低于 80% 直接判定不合规**
5. 检查 log.md `Spec-Code 偏差记录` 是否为空 — 如果 apply 阶段声称无偏差但 review 发现缺失实现，标记为 Critical 不一致

PASS 后才进入阶段二。

**阶段二 Code Quality**（附录 B）：
按 Critical / Important / Minor 三级审查。
加载 `spec_copilot/stack-adapters/<栈>.md` §10 栈相关检查项。

完成后更新 spec.md §12 审查结论（必须包含覆盖率数字）。

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

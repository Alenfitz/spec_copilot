---
description: 全自动完整版流水线 — propose → apply → smoke → review → test → archive
---

# /flow — 全自动完整版流水线

请自动完成以下需求的端到端开发：

**需求描述**：$ARGUMENTS

## 模式说明

此为**自动模式**，AI 自主推进每个阶段，不停下等待用户确认。

这是标准“逐 Task 停顿”规则的**显式例外**：仅当用户明确使用 `/spec:flow` 时生效。

适用场景：
- 用户明确授权 AI 自动推进
- 需求边界清晰，允许跳过逐 task 停顿
- 需要完整留痕（spec/tasks/log + smoke + review + test + archive）

复杂度约束：
- 🟢 轻量需求：建议改用 `/spec:lite`
- 🔴 复杂需求：可继续执行本流程

## 执行序列

按以下顺序逐阶段执行，**任一步骤失败即停，不继续**。

---

### Phase 1: Propose

1. 复杂度评估（按 AGENTS.md §复杂度分级 判定）
   - 🟢 → 🛑 **立即终止**，输出：*"🟢 轻量需求不建议走全自动完整版流程，请改用 /spec:lite"*
   - 🔴 → 继续执行
2. Research：Grep/Read 现有代码 + knowledge/
3. 写文件：
   - `spec_copilot/changes/<变更名>/spec.md`（按模板填充）
   - `spec_copilot/changes/<变更名>/log.md`（模板原样写入，替换标题）
4. §9 待澄清检查：
   - 有 `- [ ]` 未解决项 → 🛑 **停下来**，列出问题，提示：*"以上问题需要确认后才能自动推进"*
   - 已清空 → 继续
5. 运行 lint

---

### Phase 2: Apply

1. 运行 `npx @alenfitz/spec-copilot gate <变更名> apply`
2. Gate 通过后逐 task 编码（**不停顿**，不等用户说"继续"）：
   - 完成一个 task → 验证证据 → 立即 commit → 自动进入下一 task
   - Spec-Code 偏差记录到 log.md
3. 全部 task 完成后：
   - 填写 tasks.md "变更摘要"（如有 tasks.md）
   - 执行 Phase 3

---

### Phase 3: Smoke

1. 编译/构建后端（命令见 `project-context.md` §8）
2. 对 spec §6 每个接口执行 curl 验证
3. **记录到 log.md**：在 `## 时间线` 追加 `| 当前时间 | smoke | 冒烟测试通过 ✓ |`
4. 评估结果：
   - 通过 → 执行 Phase 4
   - 失败 → 🛑 **停下来**，输出失败详情，提示：*"冒烟失败，请检查后说'继续'或 /spec:fix"*

---

### Phase 4: Review

1. 运行 `npx @alenfitz/spec-copilot gate <变更名> review`
2. 阶段一 Spec Compliance（附录 A）：逐条验证功能点
3. 阶段二 Code Quality（附录 B）：按 Critical/Important/Minor 审查
4. 更新 spec.md §12 审查结论
5. 评估结果：
   - Critical = 0 → 执行 Phase 5
   - Critical > 0 → 🛑 **停下来**，列出所有 Critical 问题，提示：*"审查未通过，修复后请说'继续'或 /spec:fix"*

---

### Phase 5: Test

1. 运行 `npx @alenfitz/spec-copilot gate <变更名> test`
2. 按 spec §8 测试策略补充自动化测试：
   - 正向路径
   - 边界条件
   - 异常路径
3. 运行全部测试，并把测试报告记录到 `log.md`
4. 测试全部通过后，运行 `npx @alenfitz/spec-copilot gate <变更名> test --record-pass`
5. 评估结果：
   - 通过 → 执行 Phase 6
   - 失败 → 🛑 **停下来**，输出失败详情，提示：*"测试失败，请检查后说'继续'或 /spec:fix"*

---

### Phase 6: Archive

1. 运行 `npx @alenfitz/spec-copilot gate <变更名> archive`
2. 逐条展示 log.md "知识发现"，自动将可沉淀的写入 `spec_copilot/knowledge/index.md`
3. 更新 spec.md status → done
4. 移动 `spec_copilot/changes/<变更名>/` → `spec_copilot/archives/<YYYY-MM>/<变更名>/`
5. 输出最终报告：

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
需求 [变更名] 已完成 ✓

复杂度：🔴 重
耗时阶段：propose → apply → smoke → review → test → archive
改动文件：<N> 个
知识沉淀：<N> 条

→ 下一步：git merge feature/<变更名> --no-ff
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## 铁律

- 逐阶段输出进度标题（`## Phase N: ...`），不跳步
- 任一步骤失败立即停，不继续后续阶段
- 🔴 复杂需求必须经过 Phase 5 Test，禁止 review 后直接 archive
- 🟢 轻量需求直接引导到 `/spec:lite`
- 仅在用户明确使用 `/spec:flow` 时跳过逐 task 停顿
- §9 有未解决项直接拒绝
- Spec-Code 偏差必须记录

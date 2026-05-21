---
description: 执行编码（逐 task 推进，每个 task 停顿等确认）
---

请按 AGENTS.md 中定义的 /apply 流程执行：

**变更名**：$ARGUMENTS

## 前置检查（缺一不过）

1. 运行 `npx @alenfitz/spec-copilot gate <变更名> apply`（跨平台门禁检查）
2. Gate 通过后：`git checkout -b feature/<变更名>`（如已在分支则跳过）
3. 告知用户当前分支名

## 逐 task 执行规则（铁律：一个 task 一停）

> **🛑 这是最重要的规则：完成一个 task 后必须完全停止，等用户说"继续"才执行下一个 task。**
> **禁止连续执行多个 task。禁止在一次回复中完成两个或更多 task。**
> **即使用户说"全部执行"或"一口气做完"，仍必须逐 task 停顿。**

每个 task 的执行流程：
1. 编码实现
2. 验证（编译/构建/运行）
3. 展示验证证据（截取关键输出）
4. 立即 `git commit`
5. 更新 tasks.md 该 task 状态为 ✅
6. **🛑 停止。输出以下提示后结束回复：**
   ```
   ✅ T<n> 完成（<简述>）
   验证：<编译/测试结果>
   Commit: <hash> <message>
   
   → 下一步：T<n+1>: <描述>
   → 说"继续"执行下一个 task
   ```
7. **等用户回复后才开始下一个 task**

- 用户反馈后修改完 → 再次停下确认，不得自动进入下一 task
- Spec-Code 偏差当场记录到 log.md（log.md 已在 /spec:propose 时从 `spec_copilot/changes/templates/log.md` 模板创建，直接编辑已有文件，不得重建）

## 全部 task 完成后

1. 填写 tasks.md "变更摘要"
2. 输出完成报告：
   ```
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━
   /spec:apply 全部完成 ✓
   总 Task：<N> 个
   总 Commit：<N> 个
   
   → 下一步：/spec:smoke <变更名>
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━
   ```
3. **停止。等用户触发 /spec:smoke。**

核心原则：**AI 负责执行，用户负责推进节奏。** 任何阶段跳转都需要用户显式触发。

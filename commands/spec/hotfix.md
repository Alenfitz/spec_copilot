---
description: 紧急线上故障修复
---

请按 AGENTS.md 中定义的 /hotfix 流程执行：

**问题描述**：$ARGUMENTS

规则：
1. 允许跳过 spec 三段生成，但必须产出精简 spec（≤100 字）
2. 基于 hotfix 分支执行最小修复
3. 单个原子 commit
4. 必须跑 /smoke 验证

铁律：禁止在 hotfix 分支做任何非修复动作。先止血，后治本。

## 结束后

```
故障修复已完成 ✓

⚠️  24 小时内必须补齐：
  /spec:archive <变更名>（补完整 spec + review + 沉淀 #incident）

治本方案：/spec:propose <根治方案描述>
```

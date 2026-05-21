---
description: 发起变更提案（评估复杂度、分段生成 spec）
---

请按 AGENTS.md 中定义的 /propose 流程处理以下需求：

**需求描述**：$ARGUMENTS

## Step 0 — 复杂度分级

按**影响面**判定：

| 级别 | 判定标准 | 制品 | 后续流程 |
|------|---------|------|---------|
| 🟢 简单 | 不改 API 契约 且 不改表结构 且 不改核心流程 且 不引入新依赖 | 无 | 直接编码 |
| 🟡 中等 | 新增 1-3 接口 / 改 1-2 表非核心字段 / 引入新依赖 / 改核心流程的非关键分支 | spec.md | apply → smoke → review → archive |
| 🔴 复杂 | 新子系统 / 改核心流程主路径 / 改核心表结构 / 并发或事务 / 数据迁移 / 外部服务集成 | spec.md + tasks.md | apply → smoke → review → test → archive |

给出级别和理由（必须说明触及了哪条影响面），然后直接进入 Step 1，**不等待用户确认**。

🟢 简单 → 直接编码，不创建文件。到此结束。

## Step 1 — Research

Grep/Read 现有代码和 knowledge/。

## Step 2 — 写入文件（第一个动作）

**在输出任何 spec 内容到对话之前，先用 Write 工具创建文件：**

```
mkdir -p spec_copilot/changes/<变更名>/
Write: spec_copilot/changes/<变更名>/spec.md
Write: spec_copilot/changes/<变更名>/log.md
```

- `spec.md` — 以 `spec_copilot/changes/templates/spec.md` 为模板，填充所有能填的章节。不确定的内容填入 §9 待澄清，标记为 `- [ ]`。
- `log.md` — 以 `spec_copilot/changes/templates/log.md` 为模板，**原样写入**，仅替换标题中的"需求名称"为实际变更名。所有章节（时间线/知识发现/Spec-Code 偏差记录）必须保留。

🔴 复杂需求还需额外创建 `tasks.md`（以 `spec_copilot/changes/templates/tasks.md` 为模板）。

写完文件后，用 Read 确认内容，然后展示摘要。

## Step 3 — §9 检查（自动模式关键决策点）

检查 spec.md §9 待澄清：

- **§9 有 `- [ ]` 未解决项** → 🛑 停下来，列出所有待澄清问题，提示：*"请回答以上问题后说'继续'"*
- **§9 已清空** → 输出：
  ```
  spec 已就绪 ✓（§9 已清空，可自动推进）
  文件：spec_copilot/changes/<变更名>/spec.md
  → 下一步：/spec:apply <变更名>
  → 全自动：/spec:flow <变更名>
  ```

## Step 4 — Lint

`npx @alenfitz/spec-copilot lint <变更名>`

## 铁律

- **先说"我写入了 spec.md"，再展示内容。** 文件不存在 = propose 失败。
- 禁止只在对话中总结。禁止跳过 Write 工具调用。

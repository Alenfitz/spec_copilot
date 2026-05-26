---
description: 发起变更提案（评估复杂度、生成 spec）
---

请按 AGENTS.md 中定义的 /propose 流程处理以下需求：

**需求描述**：$ARGUMENTS

## Step 0 — 复杂度分级（两档）

按**影响面**判定：

| 级别 | 判定 | 制品 |
|------|------|------|
| 🟢 轻 | 不改 API 契约 + 不改表结构 + 不改核心流程 + 不新增依赖 | 改用 `/spec:lite` |
| 🔴 重 | 触及任一：新 API / 改表结构 / 改核心流程 / 新依赖 / 数据迁移 / 并发或事务 | spec.md（+ tasks.md） |

🟢 轻量需求 → 输出"建议使用 /spec:lite"后结束。
🔴 重量需求 → 进入 Step 1，**不等用户确认**。

## 阶段锁

- `/spec:propose` 的职责是产出 spec/tasks/log，不是直接编码。
- 即使用户在同一条消息里要求"把开发也一起做完"，也必须先完成本命令，停在 `/spec:apply`。
- 只要 `spec.md + tasks.md + log.md` 还没落盘，就禁止写业务代码。

## Step 1 — Research

Grep/Read 现有代码和 knowledge/。

## Step 2 — 写入文件（第一个动作）

**在输出任何 spec 内容到对话之前，先用 Write 工具创建文件：**

```
mkdir -p spec_copilot/changes/<变更名>/
Write: spec_copilot/changes/<变更名>/spec.md
Write: spec_copilot/changes/<变更名>/log.md
Write: spec_copilot/changes/<变更名>/tasks.md
```

- `spec.md` — 以 `spec_copilot/changes/templates/spec.md` 为模板
- `log.md` — 以 `spec_copilot/changes/templates/log.md` 为模板，**原样写入**
- `tasks.md` — 以 `spec_copilot/changes/templates/tasks.md` 为模板

### 矩阵必填（gate 会自动消费）

spec.md 中必须填写：
1. **§3 功能点** — 每个 Fxx 有 ID + 描述 + 一句话验收标准
2. **§6.1 接口覆盖矩阵** — 每个 APIxx 写到函数级（前端 `src/api/x.ts#fnName`，后端 `XxxController#fnName`）

接口矩阵填准 = review 用精确映射，**避免模糊 grep 误报**。

## Step 3 — §9 检查

- §9 有 `- [ ]` 未解决项 → 🛑 停下来列问题，提示用户回答
- §9 已清空 → 输出：
  ```
  spec 已就绪 ✓
  → 下一步：/spec:apply <变更名>
  ```

> 输出到这里必须停止。不得因为用户催促而直接进入 apply 或 flow。

## Step 4 — Lint

`npx @alenfitz/spec-copilot lint <变更名>`

## 铁律

- **先 Write 文件，再展示内容。** 文件不存在 = propose 失败。
- 禁止只在对话中总结，禁止跳过 Write。

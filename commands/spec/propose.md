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

### Task 拆分规则（Entropy Control）

- `tasks.md` 里的每个 task 必须是一个**可独立验证的最小业务闭环**，不能只按“后端一批 / 前端一批 / 测试一批”拆分。
- 每个 task 默认只覆盖 `1-3` 个功能点；如果超过 3 个功能点，必须解释为什么不能继续拆分。
- 每个 task 必须填写一组 `V-Slice`：
  - 用户动作
  - 接口契约
  - 状态/数据变化
  - 界面/输出结果
  - 验证路径
- 每个 task 必须明确至少一条“不可降级项”。
- 目标不是让 task 看起来完整，而是让 AI 在 `/spec:apply` 阶段更容易把单个 task 真正做完。

不推荐：

- T1 后端接口
- T2 前端页面
- T3 测试补齐

推荐：

- T1 列表查询闭环：列表接口 + 前端读取 + 一个筛选项 + 分页验证
- T2 新建闭环：新建弹框 + 创建接口 + 创建成功回显
- T3 保存闭环：编辑字段 + 保存接口 + 落库 + 重新打开回显

### 生命周期账本初始化

- propose 阶段负责初始化 `log.md` 生命周期账本。
- 如果存在材料缺失、默认假设、待用户补充的信息，必须写入 `log.md` 的 `假设记录`。
- 如果用户在 propose 阶段已经明确做出范围取舍或补充材料，必须写入 `用户决策记录`，不能只留在对话里。

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

## Step 4 — Lint

`npx @alenfitz/spec-copilot lint <变更名>`

## 铁律

- **先 Write 文件，再展示内容。** 文件不存在 = propose 失败。
- 禁止只在对话中总结，禁止跳过 Write。

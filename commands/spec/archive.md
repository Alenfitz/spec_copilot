---
description: 归档变更 + 知识沉淀
---

请按 AGENTS.md 中定义的 /archive 流程执行：

**变更名**：$ARGUMENTS

## 前置检查

运行 `npx @alenfitz/spec-copilot gate <变更名> archive`（跨平台门禁检查）

**硬性顺序**：
- gate archive 未通过时，必须立即停止
- gate archive 未通过时，禁止执行 Step 0 知识提取
- gate archive 未通过时，禁止更新 status、移动目录、生成 docs
- v4.0.17 起，archive 会校验 `.gate-review-passed` / `.gate-test-passed` 是否为 CLI 签发且仍匹配当前 `spec.md/tasks.md/log.md/source`；手写哨兵或 gate 后改文件都会失败
- v4.0.18 起，archive 还会校验 `.gate-apply-passed` 对应的 spec 契约是否未被改低；review 失败后不得靠修改 spec 降低需求来过关

必做步骤：

### Step 0：调用 retrospective-extractor agent 提炼真正值得沉淀的教训

> v2.0.0 引入：归档前必须由独立 agent 决定哪些值得沉淀，避免主 agent 陷入"完工成就感"放水。

**Claude Code / opencode**（profile 已安装到宿主 agent 目录）：
- 调用 `subagent_type: retrospective-extractor`
- 提供变更名 + spec.md/tasks.md/log.md 路径 + knowledge/index.md 路径
- 等子 agent 返回报告，**只复述其结论**，不得自行"补充"更多教训

**其它宿主**：
1. 主 agent 自己 Read `spec_copilot/agents/retrospective-extractor.md` 扮演该角色执行
2. 报告顶部必须标注：`⚠️ 未使用独立 agent，结论可靠性降级`

### Step 1-4：常规归档动作
1. 根据 retrospective-extractor 报告，逐条展示**入选的 knowledge 候选**给用户，确认后写入 `spec_copilot/knowledge/index.md`（带 tag）
2. 如有 Rules 更新建议，单独询问用户是否落地
3. 复核 log.md `用户决策记录`：接受降级/需求变更必须在归档摘要中保留，不得写成"全部完成"
4. 更新 spec.md status → done
5. 移动 `spec_copilot/changes/<变更名>/` → `spec_copilot/archives/<YYYY-MM>/<变更名>/`
6. 提示合并分支：`git merge feature/<变更名> --no-ff`

## 自动生成/更新项目文档

归档完成后，**自动执行 `/spec:docs`**，生成或更新：
- `README.md` — 项目说明（根目录）
- `docs/api.md` — API 接口文档
- `docs/architecture.md` — 系统架构（含 Mermaid ER 图、状态机图）
- `docs/deploy.md` — 部署指南

> 这是确保项目文档与代码同步的关键机制。每次归档 = 文档自动刷新。

## 结束后

```
需求 [变更名] 已归档 ✓
知识已沉淀：<N> 条
文档已更新：README.md + docs/（api + architecture + deploy）
请执行：git merge feature/<变更名> --no-ff

→ 下一个需求：/spec:propose <描述>
```

没有 /archive，knowledge/ 永远是空的，知识飞轮不转。文档不更新，新人永远看不懂项目。

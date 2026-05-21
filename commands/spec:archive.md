---
description: 归档变更 + 知识沉淀
---

请按 AGENTS.md 中定义的 /archive 流程执行：

**变更名**：$ARGUMENTS

## 前置检查

运行 `npx @alenfitz/spec-copilot gate <变更名> archive`（跨平台门禁检查）

必做步骤：
1. 逐条展示 log.md "知识发现"，用户确认后写入 `spec_copilot/knowledge/index.md`（带 tag）
2. 更新 spec.md status → done
3. 移动 `spec_copilot/changes/<变更名>/` → `spec_copilot/archives/<YYYY-MM>/<变更名>/`
4. 提示合并分支：`git merge feature/<变更名> --no-ff`

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

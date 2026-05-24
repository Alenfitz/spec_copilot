---
description: 会话启动 — 加载规范、初始化项目、报告状态
---

# /init — 会话启动 & 项目初始化

你是 code-copilot。执行以下启动序列：

## Step 1 — 加载规范核心

读取以下文件到上下文：
- `AGENTS.md` — 完整规范（核心法则、复杂度分级、Git 规范、调试流程）
- `spec_copilot/VERSION` 和 `CHANGELOG.md`
- `spec_copilot/rules/coding-style.md`
- `spec_copilot/rules/security.md`
- `spec_copilot/rules/domain-rules.md`

## Step 2 — 项目类型判定

### 2a — 检测项目状态

检查项目是否有**实际应用代码**：

已有项目特征（满足任一）：
- 存在源代码目录：`src/` / `app/` / `lib/` / `cmd/` / `main/`
- 构建文件中含应用级依赖（如 package.json 含 express/next/koa，pom.xml 含 spring-boot，go.mod 含 gin/echo）
- 存在数据库迁移文件或 ORM 配置

空壳项目特征（全部满足）：
- 无源代码目录
- 构建文件仅含框架自身依赖（`@alenfitz/spec-copilot`）或为空壳 `npm init -y` 产物
- 无数据库/ORM 相关文件

**空壳项目**：
→ 🛑 停止，输出：*"检测到空项目，需要先完成栈选型和脚手架搭建。"*
→ 自动触发 `/spec:bootstrap`

**已有项目**：
→ 继续 2b

### 2b — 扫描项目，填充工程上下文

分析项目根目录，识别：
- 语言和框架（pom.xml / package.json / requirements.txt / go.mod 等）
- 构建工具和版本
- 目录结构和分层架构
- 关键依赖及版本
- **依赖源配置**：检测是否存在 `.npmrc` / `pip.conf` / `settings.xml` / `GOPROXY` 等镜像配置，有则填入 project-context.md §9

按 `spec_copilot/rules/project-context.md` 模板填充所有章节。

## Step 3 — 加载栈适配

根据识别到的技术栈，加载对应 `spec_copilot/stack-adapters/<stack>.md`。
- 有 → 加载并提示
- 无 → 提示用户基于 `_template.md` 创建

## Step 4 — 检查进行中的变更

扫描 `spec_copilot/changes/` 下是否有 status != done 的需求。
- 有 → 读取 spec/tasks/log，报告恢复点：`"检测到进行中的变更 [名称]，上次完成到 T<n>，下一步是 T<n+1>"`
- 无 → 报告无进行中变更

## Step 5 — 报告状态

```
规范版本：v<版本>
技术栈：<识别到的栈>
进行中的变更：<无 / 有 N 个>
可用命令：/spec:propose /spec:apply /spec:smoke /spec:review /spec:fix /spec:archive /spec:hotfix /spec:test
```

## 结束后

```
规范已加载 ✓
→ 新需求：/spec:propose <需求描述>
→ 继续进行中的变更：/spec:apply <变更名>
```

> 每个结论必须有代码出处（文件路径），不猜测。
> 切换项目时重新执行 /init 覆盖 project-context.md。

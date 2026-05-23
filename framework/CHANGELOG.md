# 变更日志

本文件记录 spec_copilot 规范框架自身的版本变更。遵循 [Semantic Versioning](https://semver.org/)：MAJOR.MINOR.PATCH。

---

## [2.4.0] - 2026-05-23

### 新增

**双引擎 E2E 浏览器冒烟 + opencli 集成：**

- **双引擎架构**：opencli/CDP 引擎（已登录 Chrome）+ playwright-core 引擎（headless），自动切换
- **认证页面测试**：auto 模式下 playwright 检测到登录重定向的页面，自动通过 CDP 引擎重试
- **`--engine auto|playwright|opencli` 选项**：手动选择浏览器引擎
- **`connectToLiveChrome()` 函数**：通过 CDP 协议连接已运行的 Chrome 实例
- **`resolveOpencli()` 函数**：自动检测 opencli CLI 或 Node 模块安装状态
- **`doctor` 命令增强**：显示 opencli 引擎安装状态和使用指引
- **引擎信息回报**：E2E 结果包含 `engineInfo` 字段，显示使用的引擎和认证重试信息

### 变更

- 每个页面检查结果增加 `engine` 字段标记使用的引擎
- 连接到用户已运行的 Chrome 时不关闭浏览器（`persistent` 标记）
- smoke 命令文档更新双引擎说明

---

## [2.3.1] - 2026-05-23

### 变更

- **E2E 浏览器依赖简化**：改用 `playwright-core`（12MB）+ 系统 Chrome，用户无需在目标项目安装任何依赖
- 自动检测 macOS / Linux / Windows 上的 Chrome/Chromium 安装路径
- `doctor` 命令显示 Chrome 检测路径和 E2E 就绪状态
- API 健康检查支持 Vite proxy 回退：优先通过前端端口检查 → 失败回退直连后端端口
- 更新 README / CHANGELOG / AGENTS.md.template / spec:smoke.md 文档

---

## [2.3.0] - 2026-05-23

### 新增

**Playwright E2E 浏览器冒烟（解决"静态检查通过但浏览器不能用"的核心问题）：**

- **新增 `bin/e2e-smoke.js` 模块**：Spec-driven 端到端浏览器自动化验证
- **自动技术栈检测**：支持 Spring Boot + Vue3（分目录/合体）、Vite 纯前端等常见栈
- **开发服务器自动管理**：检测已运行的服务器或自动启动，测试完成后自动清理
- **Spec-driven 路由提取**：从 spec.md §3/§6 提取页面路由 + 从项目 router 文件补全
- **6 项浏览器硬检查**：
  - 白屏检测（#app/#root 无子元素）
  - 未捕获 JS 异常（pageerror 事件）
  - API 网络连接失败（ECONNREFUSED）
  - API 5xx 响应
  - 框架错误遮罩（Vite/React error overlay、Spring Boot Whitelabel）
  - HTTP 错误页面（404、Cannot GET）
- **API 健康检查**：用 Node.js http 模块逐个探测 spec 中声明的 API 端点
- **登录重定向识别**：重定向到 /login 标记为"需认证"（warning 级别，不阻断）
- **控制台噪音过滤**：内置 15+ 条开发环境常见无害模式（HMR、DevTools、favicon 等）

### CLI 变更

- `gate <name> smoke` 新增 E2E 浏览器检查（Playwright 未安装时自动跳过，不阻断）
- 新增 CLI flags：`--headed`（显示浏览器）、`--base-url`（手动指定前端 URL）、`--backend-url`（手动指定后端 URL）、`--no-e2e`（跳过 E2E）
- `cmdGate` 升级为 async 函数以支持异步 Playwright 操作

### 设计理念

> v2.2.0 解决了"代码结构层面"的骨架问题（静态检测），但用户实际浏览器体验仍然只有 50% 可用。
> 根因：curl 200 ≠ 前后端对齐。camelCase/snake_case 不匹配、响应结构错位、子表不持久化 —— 这些"接缝"问题在组件级测试中完全不可见。
> v2.3.0 核心突破：**用真实浏览器跑真实页面，让 smoke gate 验证"用户能不能用"而不仅仅是"代码能不能编译"**。

### 浏览器依赖

spec-copilot 内置 `playwright-core`（~12MB），运行时连接系统已安装的 Chrome/Chromium。
用户无需在目标项目安装任何额外依赖，只要电脑有 Chrome 即可。
未找到 Chrome 时 E2E 检查自动跳过（warning 级别），不影响其他 smoke 检查。

---

## [2.2.0] - 2026-05-23

### 新增

**前端硬检测体系（解决"骨架组件反复出现"的根因问题）：**

治本层（apply gate — 防止骨架产生）：
- **前后端 task 交织检查**：tasks.md 中连续 > 3 个后端 task 未穿插前端 → gate fail。防止前端 task 被挤到最后导致 context 耗尽
- **前端 task 粒度上限**：单个前端 task 涉及 > 4 个 .vue 文件 → gate fail。防止单 task 塞过多组件导致后半段降级为骨架
- **前端 task 集中度检测**：前端 task 全部集中在 70% 之后 → gate fail

治标层（smoke gate — 客观验证，不依赖 AI 自述）：
- **新增 `gate <name> smoke` phase**：smoke 从纯 prompt 阶段升级为 CLI 可验证阶段
- **构建验证**：自动检测并执行 `npm run build` / `mvn compile`，构建失败 = gate fail
- **骨架组件检测**：扫描 .vue 文件 `<template>` 区块，检测 el-empty / TODO-only / 空壳组件
- **TypeScript any 泛滥检测**：统计 `: any` / `as any` 出现密度，超标 = warning
- **smoke 哨兵文件**：通过后写入 `.gate-smoke-passed`，review 阶段可校验

兜底层（review gate — 最后防线）：
- **反"太嗨"机制 8：骨架组件检测**：拦截"文件存在、被引用、但内容是空壳"的组件 — 现有 stub/死代码检测的盲区
- **前端 task 功能性自证检测**：前端 task 的验证结果必须包含构建输出 + 用户操作路径描述

### 变更

- `gate` 命令支持 5 个 phase：apply / **smoke** / review / test / archive（新增 smoke）
- `spec:smoke.md` 增加 Step 0：运行 `gate <name> smoke` 获取客观检测结果
- `spec:apply.md` 前置检查说明新增 task 交织度和粒度检查
- 新增独立模块 `bin/frontend-checks.js`，导出 6 个检查函数供 cli.js 调用

### 设计理念

> 之前三版迭代反复加 prompt 级约束（"前端骨架=未完成"铁律、4条完成判定、前后端1:3比例）但问题反复出现。
> 根因：prompt 解决"知道该做什么"，解决不了"验证做没做到"。
> v2.2.0 核心转变：**治本（改变 task 结构防止骨架产生）+ 治标（CLI 自动化验证代替 AI 自述）**。

---

## [1.6.0] - 2026-05-21

### 新增

**`/spec:docs` — 项目文档自动生成：**
- 新增第 12 个命令 `/spec:docs`，从 project-context、archives、源代码自动生成四类文档
- `README.md`：项目说明（技术栈、快速开始、功能模块、API 概览）
- `docs/api.md`：API 接口文档（扫描 Controller 注解自动提取）
- `docs/architecture.md`：系统架构（分层架构、Mermaid ER 图、状态机图、模块关系图）
- `docs/deploy.md`：部署指南（环境要求、配置说明、构建命令、数据库初始化）
- 增量更新机制：通过 `<!-- auto-generated -->` 标记区分自动生成和手动编写内容

**`/spec:archive` 自动触发文档更新：**
- 归档完成后自动执行 `/spec:docs`，确保每次归档 = 文档同步刷新
- 解决"所有文档锁在 spec_copilot/ 里、新人看不到"的问题

---

## [1.5.0] - 2026-05-21

### 变更（基于真实项目端到端测试反馈）

**逐 Task 停顿强化（P0）：**
- `spec:apply` 命令新增「铁律」区块，三重强调：完成一个 task 必须停下等用户确认
- 禁止连续执行多个 task，即使用户说"全部执行"
- 每个 task 完成后输出标准化停顿提示（含 commit hash、下一步 task 描述）
- AGENTS.md 新增「节奏控制」章节，全局声明逐 task 停顿规则

**Fix → Re-verify 闭环（P0）：**
- `spec:fix` 命令重写，修复完成后必须自动重新验证（smoke/review），不等用户触发
- 明确 fix → re-verify 是原子闭环，增加无限循环保护

**阶段跳转等确认（P1）：**
- `spec:apply` 结束时不再自动触发 smoke，改为输出完成报告后等待用户显式触发
- 核心原则调整为"AI 负责执行，用户负责推进节奏"

**测试报告详细化（P1）：**
- `spec:test` 命令要求输出详细报告表格（测试类/用例数/通过数/覆盖范围）
- 不再接受"全部通过"的笼统报告

---

## [1.4.0] - 2026-05-21

### 新增

- **内网镜像支持**：bootstrap 流程新增依赖源检测与配置
  - `/spec:bootstrap` — Step 1 追问"公网/内网"，内网则收集 registry URL + 认证方式
  - `/spec:bootstrap` — Step 3 新增 Step 0：根据包管理器创建对应配置（.npmrc/settings.xml/pip.conf/GOPROXY），认证凭据通过环境变量注入，不写配置文件
  - `/spec:init` — Step 2b 检测已有项目的镜像配置并记录到 project-context.md §9
  - `project-context.md` 模板 — 新增 §9 镜像与依赖源（表格含 registry/认证方式/配置文件路径）

## [1.3.0] - 2026-05-21

### 新增

- **`/spec:bootstrap`** — 新项目引导命令。检测到空壳项目时触发栈选型对话：
  - Step 1 需求澄清（项目类型/规模/技术偏好）
  - Step 2 AI 推荐栈组合并解释理由，等用户确认
  - Step 3 搭建最小可运行脚手架
  - Step 4 填充工程上下文 + 加载栈适配器
  - 铁律：不替用户做选型决策，只推荐和建议

### 变更

- **`/spec:init`** — Step 2 增加空项目检测逻辑（无构建文件 + 无 src/ → 自动重定向到 /spec:bootstrap）
- **AGENTS.md** — 意图映射新增 /spec:bootstrap，启动检查说明区分已有/空壳两种路径

## [1.2.0] - 2026-05-21

### 新增

- **`/spec:flow`** — 全自动流水线命令，一键从 propose 跑到 archive（🟢 + 🟡 需求适用，🔴 拒绝执行）
  - propose → apply → smoke → review → archive 自动串行
  - 任一步骤失败即停，不继续
  - §9 有未解决项时阻断（业务歧义必须人工消解）

### 变更

- **`/spec:propose`** — 复杂度评估后不再等待用户确认，直接进入 Research。阻塞点仅保留 §9 待澄清
- **AGENTS.md** — 意图映射表新增 /spec:flow，复杂度分级说明更新为"给出级别后直接进入 Research"

## [1.1.7] - 2026-05-21

### 修复

- **spec:propose**：Step 2 增加 log.md 强制创建（从模板原样写入），解决 AI 自由生成导致章节不完整、review gate 无法识别冒烟记录的问题
- **spec:smoke**：增加"记录到 log.md 时间线"步骤，确保冒烟结果可被 review gate 检测

## [1.1.6] - 2026-05-21

### 修复

- **gate apply**：§9 待澄清检查正则限定范围，不再误匹配 §3 功能点的 `- [ ]` 复选框

## [1.1.5] - 2026-05-21

### 修复

- README.md/README.zh-CN.md 相互引用从相对路径改为 jsDelivr CDN 绝对 URL，npm 页面不再 404

---

## [1.1.4] - 2026-05-21

### 变更

**跨平台门禁：**
- 门禁逻辑从 bash 脚本移植到 Node.js（`cli.js` 新增 `gate` 子命令）
- `npx @alenfitz/spec-copilot gate <变更名> <phase>` 可在 Windows/Mac/Linux 运行
- 原 `scripts/spec-gate.sh` 保留供直接调用，但命令文件统一引用 npx 路径
- lint 命令引用也改为 `npx @alenfitz/spec-copilot lint`（而非直接调 bash）

---

## [1.1.3] - 2026-05-21

### 变更

**阶段门禁（Gating）：**
- 新增 `scripts/spec-gate.sh` — 阶段入口条件检查脚本
- 四个门禁：apply（spec 存在 + §9 清空 + tasks 就绪）、review（冒烟通过）、test（🔴 强制）、archive（审查通过）
- 门禁不通过 → 阻断当前阶段，提示缺失前置条件
- cli.js 安装时自动设置可执行权限，doctor 检查项包含门禁脚本

**复杂度感知路由：**
- 所有命令的 "结束后" 提示根据 spec.md §2 复杂度等级分支
- 🟢 简单：propose 后直接编码，不进入 spec 流程
- 🟡 中等：propose → apply → smoke → review → archive（标准五步）
- 🔴 复杂：propose → apply → smoke → review → test → archive（增加强制测试）
- 🚑 热修复：hotfix → smoke → archive（独立路径，24h 补全）
- AGENTS.md 新增"阶段门禁"章节，复杂度表增加"流程"列

**propose 命令修复：**
- 🟢 简单需求的 "结束后" 不再错误指向 `/spec:apply`，改为"直接编码，自行验证"

---

## [1.1.2] - 2026-05-21

### 变更

**引导式工作流：**
- 所有命令新增 "结束后" 章节，明确展示下一步命令
- 流程：init → propose → apply → smoke → review → archive 形成连贯链路
- smoke/review 命令按通过/失败分支提示不同下一步

---

## [1.1.1] - 2026-05-21

### 变更

**复杂度判定重做：**
- 移除文件数作为复杂度判定依据（≤3/4-8/>8），改为按影响面评估
- 影响面维度：API 契约、表结构、核心流程、新依赖、数据迁移、外部集成
- 区分"核心流程非关键分支"与"核心流程主路径"

**Spec 质量自检：**
- spec 模板新增"附录：Spec 质量自检"，按章节列出常见不合格写法
- 覆盖功能点、业务规则、数据变更、接口契约、待澄清、代码现状 6 个维度

**domain-rules 示例：**
- rules/domain-rules.md 不再是空壳，三个章节各填了带注释的示例条目
- 示例涵盖订单状态机、退款计算口径、用户注册流程等

**npm 包工程化改进：**
- cli.js 内嵌模板改为从 framework/ 文件读取，消除双重维护
- AGENTS.md 描述从"opencode 自动加载"修正为"规范参考文档"

---

## [1.0.0] - 2026-05-21

基于 code_copilot v2.0.0 迁移适配 opencode。

### 核心变更（相对于 code_copilot v2.0）

**加载机制重构：**
- `agents/copilot-prompt.md` + `CLAUDE.md` 引用 → 合并为单个 `AGENTS.md`
- Spec Reviewer / Code Quality Reviewer 从独立 agent 文件改为 AGENTS.md 附录 A/B
- `commands/` 目录：每个斜杠命令拆为独立 .md 文件，映射到 `.opencode/commands/`

**去除 Claude Code 特有机制：**
- 移除 `.claude/settings.local.json` 权限配置
- 移除 rules 文件的 `alwaysApply` / `alwaysApply: false` frontmatter（opencode 不识别）
- 移除 `agents/` 目录（内容合并到 AGENTS.md）

**保持不变：**
- 规范核心内容（Spec 先行、Task 节奏、知识飞轮）100% 保留
- `rules/` 目录结构和内容
- `stack-adapters/` 适配层机制
- `knowledge/` 知识索引
- `changes/templates/` 三件套模板
- `scripts/` 工程化脚本（路径从 `code_copilot` 改为 `spec_copilot`）

# 变更日志

本文件记录 spec_copilot 规范框架自身的版本变更。遵循 [Semantic Versioning](https://semver.org/)：MAJOR.MINOR.PATCH。

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

# @alenfitz/spec-copilot

**渐进式 Spec 编码框架** — 一个包，六种 AI 编码工具。让 AI 编码从"黑盒一把梭"变成"白盒分步推进"。

[English](https://github.com/Alenfitz/spec_copilit/blob/main/README.md)

---

## 支持工具

| 工具 | 提示词文件 | 命令方式 |
|------|-----------|---------|
| **opencode** | `AGENTS.md` | `.opencode/commands/`（原生） |
| **Claude Code** | `CLAUDE.md` | `.claude/commands/`（原生） |
| **Cursor** | `.cursor/rules/spec-copilot.mdc` | Prompt 路由 |
| **Windsurf** | `.windsurf/rules/spec-copilot.md` | Prompt 路由 |
| **GitHub Copilot** | `.github/copilot-instructions.md` | Prompt 路由 |
| **Cline** | `.clinerules/spec-copilot.md` | Prompt 路由 |

## 快速开始

```bash
# 安装 — 指定你的工具
npx @alenfitz/spec-copilot install --tool cursor
npx @alenfitz/spec-copilot install --tool claude-code
npx @alenfitz/spec-copilot install --tool windsurf
# 可选: opencode, claude-code, cursor, windsurf, copilot, cline

# 验证安装
npx @alenfitz/spec-copilot doctor
```

后续命令（`update`、`doctor` 等）自动识别已安装的工具。

## 核心理念

1. **Spec 先行（No Spec, No Code）** — AI 评估复杂度、逐条澄清、分段生成 spec，确认才写代码。
2. **Task 节奏可控** — AI 完成一个原子任务就停下来，展示验证证据，立即 commit，等你说"继续"才推进。
3. **知识飞轮** — 每个需求的踩坑记录归档到带 tag 分类的知识库，下个需求自动读取。

## 命令速查

| 命令 | 何时用 | 产出 |
|------|-------|------|
| `/spec:init` | 首次接入项目 | 填充 `rules/project-context.md` |
| `/spec:bootstrap` | 新空项目 | 栈选型 + 脚手架搭建 |
| `/spec:propose <需求>` | 有新需求 | `spec.md`（复杂需求 + `tasks.md`） |
| `/spec:flow <需求>` | 全自动模式（🟢/🟡） | 完整流水线：propose → archive |
| `/spec:apply <变更名>` | spec 确认后 | 逐 task 提交的代码 |
| `/spec:smoke <变更名>` | /spec:apply 完成后 | 编译 + 接口冒烟报告 |
| `/spec:review <变更名>` | /spec:smoke 通过后 | Spec 合规 + 代码质量审查报告 |
| `/spec:fix <变更名>` | review 有问题 | 修复 commit + 文档同步 |
| `/spec:archive <变更名>` | review 通过后 | 知识沉淀 + 文档更新 + 分支合并提示 |
| `/spec:docs [类型]` | 任何时候 | README + API + 架构 + 部署文档 |
| `/spec:hotfix <描述>` | 线上故障 | 最小修复 + hotfix 分支 |
| `/spec:test <变更名>` | 补自动化测试 | 测试代码 + 运行报告 |

## CLI 命令

```bash
npx @alenfitz/spec-copilot install --tool <name>    # 安装框架
npx @alenfitz/spec-copilot update [--force]          # 升级框架
npx @alenfitz/spec-copilot gate <变更名> <phase>      # 阶段门禁检查
npx @alenfitz/spec-copilot lint <变更名>              # Spec 完整性检查
npx @alenfitz/spec-copilot doctor                    # 检查安装状态
npx @alenfitz/spec-copilot uninstall --confirm       # 移除框架
```

## 安装后的目录结构

```
你的项目/
├── <工具专属提示词文件>               ← AI 读取
├── <工具专属命令目录/>               ← 原生命令（如支持）
│
├── README.md                          ← 自动生成的项目文档
├── docs/                              ← API、架构、部署文档
│
└── spec_copilot/
    ├── commands/                      ← 12 个命令定义
    ├── rules/
    │   ├── coding-style.md            ← 编码通用规范
    │   ├── security.md                ← 安全红线
    │   ├── project-context.md         ← 项目技术上下文（/spec:init 填充）
    │   └── domain-rules.md            ← 业务领域规则（你来填）
    ├── stack-adapters/
    │   ├── _template.md               ← 新栈适配模板
    │   └── spring-boot-vue3.md        ← 内置适配（示例）
    ├── knowledge/index.md             ← 带 tag 索引的知识库
    ├── changes/templates/             ← spec.md / tasks.md / log.md 模板
    ├── archives/                      ← 已归档的需求
    └── scripts/                       ← Lint、门禁、Hook 脚本
```

## 门禁系统（自动化质量检查）

CLI 门禁在阶段切换时执行客观检查，不通过则阻断：

```bash
npx @alenfitz/spec-copilot gate <变更名> smoke
```

| 门禁 | 检查项 |
|------|--------|
| `apply` | Spec 完整性 + 前后端 task 交织度 + 前端 task 粒度 |
| `smoke` | **构建验证** + **骨架检测** + TS any 泛滥 + **双引擎 E2E 浏览器冒烟** |
| `review` | smoke 哨兵 + 功能点覆盖 + 死代码 + stub handler + 嗨语言 |
| `archive` | review 哨兵 + spec 审查结论 |

### E2E 浏览器冒烟（v2.3.0 + 双引擎 v2.4.0）

双引擎端到端浏览器验证 — 抓住"能编译但不能用"的问题：

- **自动检测**技术栈（Spring Boot + Vue3、Vite 等）并启动开发服务器
- **Spec 驱动**路由提取：从 spec.md + 项目 router 文件自动生成测试页面
- **逐页面检查**：白屏、未捕获 JS 异常、API 连接失败、框架错误遮罩
- **双引擎**：playwright-core（headless, CI 友好）+ opencli/CDP（已登录 Chrome，可测认证页面）
- **auto 模式**：playwright 跑全量 → 登录重定向页面自动通过 CDP 引擎重试
- **零配置**适配常见栈，flags：`--headed`、`--base-url`、`--engine auto|playwright|opencli`、`--no-e2e`

使用系统已安装的 Chrome — 无需额外安装。可选：`npm i -g @jackwener/opencli` + `chrome --remote-debugging-port=9222` 测试认证页面。

## 复杂度分级

| 级别 | 判定标准（按影响面） | 需要什么 |
|------|-----------------|---------|
| 🟢 简单 | 不改 API / 不改表 / 不改核心流程 / 不引入新依赖 | 直接对话 |
| 🟡 中等 | 新增接口 / 改表非核心字段 / 新依赖 | spec（两段确认） |
| 🔴 复杂 | 新子系统 / 核心流程 / 核心表结构 / 并发事务 | spec + tasks + knowledge |

## 升级安全性

- **会覆盖**：coding-style.md、security.md、模板、脚本、命令、内置栈适配
- **默认跳过**：提示词文件（使用 `--force` 覆盖）
- **绝不覆盖**：project-context.md、domain-rules.md、knowledge/、changes/、archives/、自定义栈适配

## 相关包

- [`@alenfitz/opencode-copilot`](https://www.npmjs.com/package/@alenfitz/opencode-copilot) — opencode 专属版
- [`@alenfitz/spec-driven-dev`](https://www.npmjs.com/package/@alenfitz/spec-driven-dev) — Claude Code 专属版（旧版）

## License

MIT

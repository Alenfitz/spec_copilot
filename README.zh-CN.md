# @alenfitz/spec-copilot

**渐进式 Spec 编码框架** — 一个包，六种 AI 编码工具。让 AI 编码从"黑盒一把梭"变成"白盒分步推进"。

[English](https://github.com/Alenfitz/spec_copilot/blob/main/README.md)

> **v4.0（破坏性变更）** — 一次正式的减法：spec 模板瘦身 63%、必填字段从 9 个降到 4 个、新增 `/spec:lite` 轻量需求路径、三个内置技术栈适配器（Vue + Spring Boot / React + Express / Next.js）、框架自身有了 37 个测试 + 跨平台 CI（Ubuntu/macOS/Windows × Node 18/20/22）。迁移说明见 [CHANGELOG](framework/CHANGELOG.md#400---2026-05-24--breaking-change)。

---

## 支持工具

| 工具 | 提示词文件 | 命令方式 |
|------|-----------|---------|
| **opencode** | `AGENTS.md` | `.opencode/commands/`（原生） |
| **Claude Code** | `CLAUDE.md` | `.claude/commands/`（原生） |
| **Cursor** | `.cursor/rules/spec-copilot.mdc` + `.cursorrules`（legacy） | Prompt 路由 |
| **Windsurf** | `.windsurf/rules/spec-copilot.md` + `.windsurfrules`（legacy） | Prompt 路由 |
| **GitHub Copilot** | `.github/copilot-instructions.md` | Prompt 路由 |
| **Cline** | `.clinerules/spec-copilot.md` | Prompt 路由 |

## 内置技术栈适配器

| 栈 | 文件 |
|----|------|
| Spring Boot + Vue 3 | `framework/stack-adapters/spring-boot-vue3.md` |
| React + Express | `framework/stack-adapters/react-express.md` |
| Next.js 13+（App Router） | `framework/stack-adapters/nextjs.md` |

其他栈：复制 `_template.md` 自行补充。

## 快速开始

```bash
# 安装 — 指定你的工具
npx @alenfitz/spec-copilot install --tool cursor
npx @alenfitz/spec-copilot install --tool claude-code
npx @alenfitz/spec-copilot install --tool all   # 一次装全部 6 个工具

# 验证安装
npx @alenfitz/spec-copilot doctor
```

后续命令（`update`、`doctor`、`sync` 等）自动识别已安装的工具。

## 核心理念（三条）

1. **No Spec, No Code** — 没 spec 不写代码。Spec 和代码冲突时，错的是代码。
2. **逐 Task 停顿** — 完成一个 task 就停下来展示验证证据，等用户说"继续"。
3. **不编造，要找证据** — 代码现状必须有出处（文件路径 + 类名/方法名）。

## 命令速查

| 命令 | 何时用 | 产出 |
|------|-------|------|
| `/spec:init` | 首次接入项目 | 填充 `rules/project-context.md` |
| `/spec:bootstrap` | 新空项目 | 栈选型 + 脚手架搭建 |
| **`/spec:lite <需求>`** | **轻量需求**（bug 修复 / UI 调整 / 小功能） | 5 节迷你 spec → 直接编码 |
| `/spec:propose <需求>` | 重量需求 | `spec.md` + `tasks.md` |
| `/spec:flow <需求>` | 全自动模式 | 完整流水线：propose → archive |
| `/spec:apply <变更名>` | spec 确认后 | 逐 task 提交的代码 |
| `/spec:smoke <变更名>` | /spec:apply 完成后 | 构建 + E2E + 接口冒烟 |
| `/spec:review <变更名>` | /spec:smoke 通过后 | Spec 合规 + 代码质量审查 |
| `/spec:fix <变更名>` | review 有问题 | 修复 commit + 文档同步 |
| `/spec:archive <变更名>` | review 通过后 | 知识沉淀 + 文档更新 |
| `/spec:docs [类型]` | 任何时候 | README + API + 架构 + 部署文档 |
| `/spec:hotfix <描述>` | 线上故障 | 最小修复 + hotfix 分支 |
| `/spec:test <变更名>` | 补自动化测试 | 测试代码 + 运行报告 |

## CLI 命令

```bash
npx @alenfitz/spec-copilot install --tool <name>    # 安装框架
npx @alenfitz/spec-copilot update [--force]          # 升级框架
npx @alenfitz/spec-copilot sync [--tool <name>]      # 重新同步适配器文件
npx @alenfitz/spec-copilot gate <变更名> <phase>      # 阶段门禁检查
npx @alenfitz/spec-copilot lint <变更名>              # Spec 完整性检查
npx @alenfitz/spec-copilot agents list               # 查看内置 Agent Profile
npx @alenfitz/spec-copilot scorecard <msg-file>      # 校验 task commit 自评分卡
npx @alenfitz/spec-copilot guard status              # 查看护栏状态
npx @alenfitz/spec-copilot ci setup                  # 生成 CI/CD 配置
npx @alenfitz/spec-copilot doctor                    # 检查安装状态
npx @alenfitz/spec-copilot uninstall --confirm       # 移除框架
```

## 安装后的目录结构

```
你的项目/
├── <工具专属提示词文件>               ← AI 读取
├── <工具专属命令目录/>               ← 原生命令（如支持）
│
└── spec_copilot/
    ├── commands/                      ← 13 个命令定义
    ├── rules/
    │   ├── coding-style.md            ← 编码通用规范
    │   ├── security.md                ← 安全红线
    │   ├── project-context.md         ← 项目技术上下文
    │   └── domain-rules.md            ← 业务领域规则（你来填）
    ├── stack-adapters/
    │   ├── _template.md
    │   ├── spring-boot-vue3.md
    │   ├── react-express.md
    │   └── nextjs.md
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
| `apply` | Spec 完整性 + §9 已清空 |
| `smoke` | 构建验证 + 骨架组件检测 + **E2E 浏览器冒烟** |
| `review` | smoke 哨兵 + 功能点覆盖 + API 契约精确匹配 + 契约一致性 + 硬编码身份检测 |
| `archive` | review 哨兵 + spec 审查结论 |

### E2E 浏览器冒烟

基于 Playwright 的端到端浏览器验证 — 抓住"能编译但不能用"的问题：

- **自动检测**技术栈（Spring Boot + Vue3、Vite、Next.js 等）并启动开发服务器
- **Spec 驱动**路由提取：从 spec.md + 项目 router 文件自动生成测试页面
- **逐页面检查**：白屏、未捕获 JS 异常、API 4xx/5xx、非 JSON 响应、空数据渲染、错误遮罩
- **主动交互**：搜索输入、分页点击、表单提交（自动填表 + 提交）
- **零配置**适配常见栈，可选 flags：`--headed`、`--base-url`、`--no-e2e`

使用系统已安装的 Chrome — 无需额外安装。

### 精确 API 映射

`review` 使用 spec.md §6.1 接口覆盖矩阵做函数级精确匹配：

- 前端调用方（如 `src/api/user.ts#getUser`）和后端实现入口（如 `UserController#getUser`）精确对应
- 矩阵缺失时回退到模糊 grep
- 比纯关键字匹配的误报率低

### 契约一致性

`review` 会主动检查前后端契约漂移：

- 检查前端请求字段是否覆盖后端必填字段
- 检测前端是否把当前登录人、操作人写死
- 抓住"页面看起来做完了但接口调不通"

### Guard 代码级护栏

AI 工具会无视提示词中的"铁律"。Guard 用 **hash 校验 @ gate 时** 做硬拦截：

```bash
npx @alenfitz/spec-copilot guard install    # 初始化保护
npx @alenfitz/spec-copilot guard status     # 查看保护状态
npx @alenfitz/spec-copilot guard lock       # 锁定文件
npx @alenfitz/spec-copilot guard unlock     # 解锁
```

**Gate 拦截被保护文件篡改：**
- ❌ 审批后修改 `spec.md`（gate 通过后自动锁定）
- ❌ 修改 `domain-rules.md` / `project-context.md`（永久保护）

**零依赖**：不需要 git / chmod / 特殊权限。**所有 AI 工具通用**。

## 复杂度分级（v4.0 两档）

| 级别 | 判定 | 命令 |
|------|------|------|
| 🟢 轻 | 不改 API / 不改表 / 不改核心流程 / 不引入新依赖 | `/spec:lite` — 对话里 5 节迷你 spec，直接编码 |
| 🔴 重 | 触及任一：新增 API / 改表结构 / 改核心流程 / 新依赖 / 数据迁移 / 并发或事务 | `/spec:propose` — 完整 spec + tasks + gate |

## 升级安全性

- **会覆盖**：coding-style.md、security.md、模板、脚本、命令、内置栈适配
- **默认跳过**：提示词文件（使用 `--force` 覆盖）
- **绝不覆盖**：project-context.md、domain-rules.md、knowledge/、changes/、archives/、自定义栈适配

## 相关包

- [`@alenfitz/opencode-copilot`](https://www.npmjs.com/package/@alenfitz/opencode-copilot) — opencode 专属版
- [`@alenfitz/spec-driven-dev`](https://www.npmjs.com/package/@alenfitz/spec-driven-dev) — Claude Code 专属版（旧版）

## License

MIT

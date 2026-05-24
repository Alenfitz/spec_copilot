# 变更日志

本文件记录 spec_copilot 规范框架自身的版本变更。遵循 [Semantic Versioning](https://semver.org/)：MAJOR.MINOR.PATCH。

---

## [3.9.0] - 2026-05-24

### 新增
- **RULE-CHECK API 绑定校验**: 字段型规则可通过 `api: APIxx` 绑定到接口覆盖矩阵，review 开始校验规则字段是否真正落到了前端调用方和后端实现入口

### 变更
- **规则字段闭环增强**: `required` / `enum` / `compare_datetime` 除了检查 spec 自洽，还会检查绑定接口的前后端证据，进一步减少“规则写了但链路没落地”的高分误判
- **模板与 README 约束补齐**: 双语文档补充 `api: APIxx` 用法，推动团队把前后端交互规则写成更可执行的结构化 spec

## [3.10.0] - 2026-05-24

### 新增
- **RULE-CHECK 运行时证据汇总**: `smoke/e2e` 开始消费绑定 `api: APIxx` 的字段型规则，结合浏览器实际抓到的 API 请求、状态码和错误文案，输出运行时闭环结果

### 变更
- **动态规则 gate 增强**: 当 AC 场景真实命中绑定 API，但请求字段缺失、预期失败分支未出现、错误文案未命中时，`smoke` 会把它暴露成明确的 gate 结果
- **文档说明补齐**: spec 模板与双语 README 补充“让 AC 场景触发绑定 API，以便 RULE-CHECK 收集运行时证据”的写法约束

## [3.11.0] - 2026-05-24

### 新增
- **状态迁移/幂等规则动态证据**: `state_transition` 与 `idempotent` 开始进入 review/smoke 的结构化校验与运行时证据汇总，前端和接口规则的动态闭环继续增强

### 变更
- **RULE-CHECK DSL 补强**: 模板新增 `field/from/to` 与 `key/repeat` 写法示例，帮助团队把状态流转和重复提交约束写成更可执行的 spec
- **动态规则解释增强**: smoke 会区分“未命中绑定 API”“未观察到目标状态”“重复请求不足”等情况，降低排查前后端联调问题的成本

## [3.12.0] - 2026-05-24

### 新增
- **安全重复提交探测**: 表单提交测试在首次成功且界面仍可操作时，会谨慎尝试第二次提交，用于给 `idempotent` 规则补充更明确的运行时证据

### 变更
- **幂等规则判断增强**: smoke 现在能区分“前端防重导致第二次请求未发出”和“后端实际收到重复请求”，让前后端交互问题更容易定位
- **文档约束补齐**: 模板与 README 提示 AC 场景可显式描述重复提交，以便更稳定地观测幂等行为

## [3.13.0] - 2026-05-24

### 新增
- **真实业务验证断言字段**: `RULE-CHECK` 新增 `final_state`、`second_request`、`duplicate_status`、`duplicate_message` 等更贴近业务验收的断言字段，帮助团队用真实场景做更明确的动态验证

### 变更
- **动态规则输出增强**: smoke 对未完整闭环的规则会直接输出规则级缺口摘要，降低把 gate 结果翻译回业务问题的成本
- **模板与 README 真实验证说明补齐**: 文档补充“如何把 DSL 写成适合真实业务验证”的建议写法

## [3.8.0] - 2026-05-24

### 新增
- **RULE-CHECK 结构化一致性校验**: DSL 中的字段型规则开始与 API 字段清单、错误字段声明建立一致性检查，进一步逼近可执行规则

### 变更
- **字段型规则约束补齐**: `required` / `enum` / `compare_datetime` / `error_message` 等 DSL 规则现在要求与 `6.2 API 字段清单` 和错误字段声明保持一致
- **README 字段清单说明补齐**: 双语 README 与 spec 模板补充“字段型 RULE-CHECK 必须能追到 API 字段清单”的约束，降低团队误用成本

## [3.7.0] - 2026-05-24

### 新增
- **RULE-CHECK DSL 模板**: spec 新增轻量 YAML 规则执行模板，review 可校验 DSL 与 `Vxx` 的结构完整性，为后续规则自动执行打基础

### 变更
- **规则覆盖输出增强**: `review` 在规则覆盖通过时会展示 `RULE-CHECK` 数量，便于识别哪些规则已经进入结构化阶段
- **README 规则 DSL 说明补齐**: 双语 README 增加 `RULE-CHECK` 说明，帮助团队逐步把自然语言规则迁移到结构化描述

## [3.6.0] - 2026-05-24

### 新增
- **精确映射优先的接口检查**: review 在有 `API` 覆盖矩阵时优先使用 `前端调用方` / `后端实现入口` 做精确匹配，降低模糊 grep 误报

### 变更
- **README 精确映射说明补齐**: 双语 README 补充“显式矩阵优先于模糊搜索”的说明
- **前后端匹配稳定性增强**: gate 在存在明确 spec 证据时更依赖结构化映射，减少字符串级偶然命中

## [3.5.0] - 2026-05-24

### 新增
- **前端语义链路交互检查**: E2E 主动交互新增详情打开、回跳、弹层关闭等更接近真实验收路径的前端链路验证

### 变更
- **验收覆盖解释增强**: AC 场景在消费“查看详情/返回列表/关闭弹层”类步骤时拥有更明确的前端证据来源
- **README 前端交互说明补齐**: 双语 README 增加前端语义链路检查能力描述，方便理解 smoke 的前端失败原因

## [3.4.0] - 2026-05-24

### 新增
- **Vxx 业务规则覆盖检查**: `review gate` 新增规则落点、触发点、结果证据、验证方式的静态闭环检查，补强前端/后端交互中的业务语义约束

### 变更
- **模板规则约束补齐**: `spec.md` 模板明确要求 `Vxx` 的生效层、触发点、错误文案/结果都要可被 gate 搜索到
- **README 规则门禁说明补齐**: 双语 README 增加 `Vxx Rule Coverage Gate` 说明，便于理解 review 失败原因

## [3.3.2] - 2026-05-24

### 新增
- **ACxx 步骤级覆盖判定**: `smoke` 对多步骤验收场景新增步骤级匹配统计，并对 `happy` 场景步骤覆盖不足的情况执行更严格阻断

### 变更
- **CLI 失败解释增强**: E2E / smoke 输出会直接展示 `ACxx` 的步骤覆盖数与缺失项，方便回到 spec 和实现补闭环
- **README 验收门禁说明补齐**: 双语 README 补充“多步骤场景按步骤判定”的能力描述

## [3.3.1] - 2026-05-24

### 新增
- **Fxx ↔ ACxx 双向追踪检查**: `review gate` 新增功能点与验收场景的双向连通校验，拦截“功能点写了但验收挂不上”以及“验收写了但追不回功能点”的需求漂移

### 变更
- **模板追踪约束补齐**: `spec.md` 模板明确要求每个 `Fxx` 绑定真实 `ACxx`，每个 `ACxx` 回指 `Fxx` 或 `Vxx`
- **README 追踪门禁说明补齐**: 双语 README 增加 `Fxx to ACxx Trace Gate` 说明，方便用户理解 review 失败原因

## [3.3.0] - 2026-05-24

### 新增
- **验收场景覆盖门禁**: `smoke` / E2E 现在会解析 `spec.md` 中的 `ACxx` 验收场景矩阵，并输出 `covered / partial / missing` 覆盖统计
- **happy 场景闭环阻断**: 当 `happy` 主流程场景没有形成页面/API/交互闭环证据时，`smoke gate` 将直接失败，防止“功能看起来做了但没有验收闭环”继续流转
- **门禁可解释性增强**: CLI 在 E2E 结果中输出 AC 场景覆盖摘要，并列出缺失证据的场景，方便 AI 和人类直接回到 spec 补闭环

### 目的
- 让规范从“要求写验收场景”进一步升级到“gate 真正消费验收场景”
- 优先提升需求匹配度，把主流程闭环问题前置到 smoke 而不是留到 review

## [3.2.1] - 2026-05-24

### 修复
- **Doctor 仓库自检误报修复**: 在 spec-copilot 框架源码仓库内运行 `doctor` 时，改为执行源码仓库自检，不再误报“未安装 spec_copilot/”
- **npm 发布元数据修复**: `package.json.repository.url` 改为 npm 推荐的 `git+https://...git` 格式，消除发布规范化警告
- **README 命令清单对齐**: README / README.zh-CN 的 CLI 命令示例补齐 `sync`、`agents`、`scorecard`、`guard`、`ci`

### 变更
- **版本描述收敛**: 移除 README 中易过时的功能首发版本标注，改为与当前 `3.2.x` 能力描述保持一致

## [3.2.0] - 2026-05-24

### 新增
- **需求覆盖矩阵模板升级**: `spec.md` 新增功能点覆盖矩阵、业务规则覆盖矩阵、接口覆盖矩阵、页面/路由矩阵、验收场景矩阵，方便把自然语言需求转成可执行验收资产
- **任务模板升级**: `tasks.md` 新增 Fxx/Vxx/API/PAGE 覆盖声明、闭环证据要求、契约一致性自查、业务规则覆盖率字段
- **前后端契约一致性检查**: `gate smoke` 与 `gate review` 新增前端请求字段 vs 后端必填字段比对，并对 `snake_case` 做专项检查
- **硬编码业务身份检查**: `gate smoke` 与 `gate review` 可识别前端写死的当前用户、业务身份与示例人员名称

### 变更
- **Review 客观评分维度更新**: review 评分新增“契约一致性”和“身份来源”两个维度，降低“接口对不上但仍高分通过”的概率
- **发布说明同步**: README / README.zh-CN 的仓库链接与 gate 描述与当前能力保持一致

### 目的
- 将框架从“提示 AI 按规范做”进一步升级为“用 gate 主动拦截低分产物”
- 重点打击三类常见低分问题：前后端字段不一致、当前用户写死、功能有文件无闭环

---

## [3.1.0] - 2026-05-24

### 新增
- **适配器增强 — 多工具同时安装**: `--tool all` 或 `--tool cursor,copilot` 一次安装多个工具的适配文件
- **Legacy 格式兼容**: 安装时同时生成 `.cursorrules` / `.windsurfrules` 根目录文件，兼容旧版工具
- **项目技术栈自动检测**: 安装/同步时自动识别前端框架（Vue/React/Angular/Svelte）、后端（Spring Boot/Express/Django/Go）、构建工具、UI 库等，注入到提示词中
- **`sync` 命令**: `spec-copilot sync [--force]` 同步所有已安装工具的适配器文件，规范变化后一键更新
- **多工具状态记录**: 工具状态文件支持逗号分隔多工具名，Doctor 命令可检测全部已安装适配

---

## [3.0.0] - 2026-05-24

### 新增

**六大特性升级 — 从框架到平台**

**P0-1: CI 自动化（ci-gen.js）**
- `spec-copilot ci setup` 一键生成 GitHub Actions workflow
- PR 提交时自动运行 `gate smoke` + `gate review`
- `--e2e` 模式：生成含前后端启动 + 浏览器测试的完整 workflow
- 评分结果自动上传为 artifacts

**P0-2: 对抗性测试代码化（adversarial-test.js）**
- 从纯提示词升级为代码自动执行
- 从 spec.md 提取写操作 API → 自动构造边界/异常输入 → 直接调用检查
- 内置攻击向量：空输入、超长字符串、SQL 注入、XSS、路径穿越、类型错误
- 500 响应 = 后端未做输入校验，报告为漏洞
- review gate 中有运行中后端时自动触发

**P1-1: API Schema 校验**
- 从 spec.md §6 接口契约提取响应字段结构
- smoke 时拦截 API 实际响应，比对字段名是否匹配
- 支持 camelCase/snake_case 互转 + 分页格式自动解包
- 字段缺失报告为 warning

**P1-2: 截图对比**
- smoke 时自动截图保存到 `.spec-copilot/screenshots/`
- 下次 smoke 与上次截图对比，文件大小变化 >30% 报警
- UI 回归问题自动检测

**P2-1: spec:smoke 命令更新**
- 命令文件反映 v2.7-3.0 所有新增检查（L1/L2/L3）

**P2-2: 文档更新**
- help 文本增加 `ci` 命令

---

## [2.9.0] - 2026-05-24

### 新增

**客观评分 + 表单提交测试**

**客观评分系统 — 代码算的分，不是 AI 自评的分**
- Smoke/Review gate 结束后自动输出客观评分（满分 100）
- 按维度打分并显示明细（构建、骨架、E2E、API、交互、覆盖率等）
- 自动读取 spec.md 中的 AI 自评分数，与客观分对比
- 偏差 > 30 分 → gate 直接失败（"自评不可信"）
- 评分结果写入 `.gate-{phase}-score.json` 供后续阶段引用

**表单提交 E2E 测试 — 联调最常炸的场景**
- 自动检测"新增/创建"按钮 → 点击打开表单
- 检测弹窗/抽屉中的输入框 → 自动填写测试数据
- 用 native setter 触发 Vue/React 响应式更新
- 点击"确定/保存/提交" → 检查是否触发 POST/PUT 请求
- 5xx 响应 = failure，4xx = warning（可能是测试数据不符合校验）
- 测试后自动关闭弹窗恢复页面状态

---

## [2.8.0] - 2026-05-23

### 新增

**独立 Reviewer + 主动交互测试**

两个核心特性，进一步消除"AI 自评虚高"问题：

**独立 Reviewer（review-checks.js）— 代码级 spec-to-code 验证**
在 `gate review` 时自动执行，替代"AI 审 AI"的自评模式：
- **API 契约校验**：spec 中定义的 API 端点 → 检查前端是否调用 + 后端是否实现 → 不匹配即 fail
- **错误处理审计**：扫描前端所有 API 调用点 → 无 catch/空 catch → 超 50% 即 fail
- **硬编码数据检测**：检测前端组件中疑似 mock 数据（应从 API 获取的硬编码数组）
- **路由完整性**：spec 声明的路由 → router 文件中是否注册

**主动交互测试 — 从"被动观测"到"主动操作"**
E2E 浏览器冒烟中新增主动交互：
- **搜索测试**：自动定位搜索框 → 输入文字 + Enter → 检查是否触发 API 请求
- **分页测试**：自动定位分页组件 → 点击第 2 页 → 检查 API 请求是否带 page 参数
- **新增按钮检测**：检测"新增/创建"按钮是否存在、是否被禁用
- **表格操作检测**：检测表格行中"编辑/删除/查看"按钮是否存在

---

## [2.7.0] - 2026-05-23

### 新增

**Smoke 增强：前后端联调质量校验（从"页面能打开"到"联调跑通"）**

解决核心痛点：AI 自测评分 70+，实际联调 50 都不到。
原因是旧版 smoke 只检查"页面能打开"，完全不校验 API 交互质量。

v2.7.0 在 E2E 浏览器冒烟中新增 6 项联调检查：

- **API 4xx 检测**：前端调了后端不存在的接口（404）、参数格式错误（422）→ gate 失败
- **API 返回非 JSON 检测**：后端返回 HTML 错误页而不是 JSON 数据 → gate 失败
- **空数据渲染检测**：API 有响应但页面显示空表格/空状态组件 → 字段映射问题
- **控制台 API 错误升级**：`Failed to fetch`、`Network Error`、`Cannot read property of undefined` 等从 warning 升级为 failure
- **API 交互摘要**：gate 输出中显示完整的 API 请求统计（正常/4xx/5xx/非JSON/连接失败）
- **未对接接口检测**：页面无 API 请求且显示空状态 → 可能用了 mock 数据

---

## [2.6.0] - 2026-05-23

### 变更

**Guard 护栏重构：hash 校验 @ gate 时（硬拦截）**

v2.5.x 的 chmod / git hook 方案存在两个问题：
1. chmod 与 AI 同权限级，AI 可以撤销保护
2. git hook 依赖 VCS，非 git 项目无法使用

v2.6.0 改为 hash 校验 @ gate 时 — 真正的硬拦截：

- **机制**：锁定文件时记录 sha256 hash → gate 运行时校验 → hash 不一致 = gate 直接失败
- **效果**：AI 可以改文件（不阻止），但改了过不了 gate — 等于白改
- **gate 硬拦截**：`onGateCheck()` 在所有 gate 检查之前执行，被保护文件被篡改即刻终止
- **零依赖**：不需要 chmod、git、VCS、特殊权限，所有平台 / 所有 AI 工具通用
- **附加层**：有 git 时可选安装 pre-commit hook（骨架组件检测）
- **doctor 增强**：显示锁定文件数量和完整性状态

---

## [2.5.1] - 2026-05-23

### 变更

**Guard 护栏重构：chmod 主防线 + git hook 附加层**

v2.5.0 依赖 git hook 拦截，但不是所有项目都用 git。
v2.5.1 改为 chmod 444（操作系统级只读）为主防线，不依赖任何 VCS：

- **主防线：chmod 444** — 被保护文件设为只读，AI 工具调 write/edit 时 OS 直接拒绝
- **附加层：git hook** — 有 git 时自动安装，做骨架组件 + 相位门禁检查
- 支持 Windows（attrib +R）和 macOS/Linux（chmod 444）
- `guard check` 增加完整性校验：检查锁定文件的 chmod 状态和内容 hash
- `guard install` 在非 git 项目中也能工作（仅 chmod，跳过 hook）
- `guard lock/unlock` 直接操作文件权限，立即生效

---

## [2.5.0] - 2026-05-23

### 新增

**Guard 代码级护栏系统 — "提示词是建议，代码是法律"**

- `spec-copilot guard install/status/lock/unlock/check` 命令
- pre-commit hook 拦截：文件保护、相位门禁、骨架组件
- Gate 集成：通过后自动锁定 spec.md
- `.spec-copilot/guard.json` 声明式配置

---

## [2.4.1] - 2026-05-23

### 变更

- **仓库改名**：`spec_copilit` → `spec_copilot`（修正拼写）
- 移除 opencli 双引擎代码（实际价值有限，增加不必要复杂度）
- 保持 playwright-core + 系统 Chrome 单引擎架构，简洁可靠

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

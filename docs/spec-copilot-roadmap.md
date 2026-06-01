# spec-copilot Roadmap

> spec-copilot 是一套围绕 AI 模型执行行为设计的工程控制系统（Harness Engineering System）。它不承诺"用了规范就不跑偏"，而是让违规、降级和信息断层尽早暴露，让交付结果保留足够的过程证据。后续迭代按五个维度组织：Constraints、Feedback Loops、Tool Orchestration、Structured Context、Entropy Control。

## 边界

- **spec-copilot 的定位是检测+暴露，不是阻断。** gate 是流程内检查器，watch 是流程外报警器。硬阻断（写文件权限、工作区隔离）是宿主侧的事，不在本包的 deliver 范围内。
- **目标不是 100% 防跑偏。** 更现实的目标是：把违规发现时间从 1 小时压到 5 分钟，把"看起来有功能"升级成"真正闭环"。
- **检测+暴露的前提是：被检测对象有可信来源。** 没有可信来源的检测 = 让嫌疑人自己写笔录再检查笔录有没有矛盾。当被检查物（spec.md、tasks.md、自填验证结果）是模型自己可无痕改写的文件时，再多检查项都可被"改文档使其与代码一致"绕过。因此规范的优先级是先建立可信来源（工具入口 + 留痕），再加检查，而不是反过来。
- **"已落地"不等于"默认生效"。** 一个机制写进了代码，但默认关闭、未安装时静默跳过、或可被已知手法绕过，都不算真正生效。每个机制必须在「机制生效状态台账」里标明真实状态。

---

## Harness 五维度

### Constraints

告诉模型"什么不能做、什么必须先做、什么改了就算违规"。

已落地：Stage Lock、Task Self Assessment Gate、复杂需求 test 阶段必经。
⚠️ Spec Contract Freeze 代码已写但**默认未生效**（依赖手动 `guard install`，未装时 gate 静默放行）——见「机制生效状态台账」，P1 第 1 项负责修复。

### Feedback Loops

尽快暴露"模型偏了、假了、没闭环、没验证"。

已落地：Gate Evidence / Sentinel、Trust Level / Score、`spec-copilot watch`、review/test/archive 证据链校验。

### Tool Orchestration

让模型被引导走明确的工具入口和产物入口，而不是自由手写。

已落地：6 工具 adapter、commands/ 目录式命令。尚未成型：scaffold、签发痕迹、宿主 skill 化。

### Structured Context

把执行过程中影响后续判断的信息结构化保存，让后续阶段能消费。

已落地：`log.md` Lifecycle Trace Ledger、Decision Ledger、Risk/Evidence/Assumption 区块。

### Entropy Control

把复杂任务切成模型更容易稳定完成的闭环，降低执行中发散的概率。

已落地（v4.0.22）：Task Vertical Slice、V-Slice 闭环字段、不可降级项、功能点上限 3 个。

---

## 版本演进与维度对照

| 版本 | 主题 | 主要维度 | 作用 |
|---|---|---|---|
| `v1.0-1.1` | 基础框架 | Constraints | gate 体系、阶段门禁、逐 task 停顿 |
| `v2.2` | 前端硬检测 | Feedback Loops | 骨架检测、构建验证、task 交织/粒度检查 |
| `v2.3` | Playwright E2E | Feedback Loops | 浏览器冒烟，从"能编译"到"能用" |
| `v2.6` | Guard 护栏 | Constraints | hash 校验硬拦截，spec 锁定 |
| `v2.7-2.9` | Smoke 增强 | Feedback Loops | API 联调检查、客观评分、表单提交测试 |
| `v3.0` | CI + 对抗测试 | Feedback Loops + Tool Orchestration | CI 自动化、对抗性测试代码化 |
| `v3.2-3.14` | 覆盖矩阵 | Feedback Loops | 契约一致性、ACxx 追踪、RULE-CHECK DSL |
| `v4.0` | 减法重构 | 全维度 | 砍掉 RULE-CHECK DSL，模板 -60%，保留核心 |
| `v4.0.5` | 项目根自动识别 | Feedback Loops | 消除硬编码路径导致的扫描静默跳过 |
| `v4.0.10` | 评分诚实度 | Feedback Loops | skip 三态、路由误报修复 |
| `v4.0.11` | 评分结构化 | Feedback Loops | structured signal 替代正则匹配 |
| `v4.0.16` | Stage Lock | Constraints | 降低用户催促导致的越阶段执行 |
| `v4.0.17` | Gate Evidence | Feedback Loops | gate 证据可追溯、不可手写伪造 |
| `v4.0.18` | Contract Freeze | Constraints | apply 后冻结 spec，防改低过审 |
| `v4.0.19` | Watch | Feedback Loops | 抓不走 gate 直接改源码的行为 |
| `v4.0.20` | Self Assessment | Constraints + Structured Context | AI 自述低分/降级转 gate 输入 |
| `v4.0.21` | Lifecycle Ledger | Structured Context | 用户决策、假设、风险贯穿后续阶段 |
| `v4.0.22` | Task Vertical Slice | Entropy Control | V-Slice 闭环字段、功能点上限、不可降级项 |
| `v4.0.23` | Non-Degradable Task Rules | Entropy Control | 不可降级项接入 review gate |
| `v4.0.24` | Write Persistence Closure | Entropy Control + Feedback Loops | 写接口必须有落库证据 |
| `v4.0.25` | Write Field Consumption | Entropy Control + Feedback Loops | 写接口声明字段必须有消费证据 |
| `v4.0.26` | OpenCode Agent Invocation Probe | Tool Orchestration + Feedback Loops | 修复 OpenCode agent 目录/权限格式，并新增快速 subagent 探针 |

截至 v4.0.26：Constraints 和 Feedback Loops 检查项数量扎实，Structured Context 初步落地，Entropy Control 已开始从 task 结构进入代码证据层，Tool Orchestration 开始补 OpenCode subagent 真实调用问题。**但 test05 实验暴露了一个结构性问题：最硬的约束机制（Guard / Contract Freeze）默认不生效，导致整座检查体系建在"被检查物可被模型无痕改写"的沙地上。** 详见下方「机制生效状态台账」。

---

## 机制生效状态台账

> 这一节回答"已落地"到底是不是"真生效"。新机制上线时必须在此登记真实状态，不允许只在版本表写"已落地"就当数。

| 机制 | 版本 | 真实状态 | 说明 |
|---|---|---|---|
| 逐 task 停顿 / Stage Lock | v1.0 / v4.0.16 | ✅ 默认生效 | prompt 层约束，强模型遵守度高 |
| Smoke 构建/骨架/E2E 检测 | v2.2 / v2.3 | ✅ 默认生效 | gate 运行即检查，不依赖额外安装 |
| Guard hash 校验 / Contract Freeze | v2.6 / v4.0.18 → v4.0.27/28 | ✅ **默认生效（v4.0.27 上膛，v4.0.28 修首跑回归）** | `install` 默认 `guard install`；gate 未安装时强警告而非静默放行。v4.0.28 修复：永久保护文件延后到首个 gate 通过后再锁，避免锁空模板误伤 `/spec:init` 填充 |
| Gate 哨兵（`.gate-*-passed`） | v4.0.17 | ⚠️ **疑似可伪造，待确认** | 哨兵是 change 目录下的普通文件；需确认是否带 gate 才能算出的签名，否则 `touch` 即可伪造前序阶段已通过 |
| V-Slice 自填验证结果 | v4.0.22 | ⚠️ **可被自填造假** | "实际验证结果"由模型粘贴而非工具执行记录；test05 中前端未做但 curl 结果看起来规整 |
| 写接口持久化 / 字段消费检查 | v4.0.24 / v4.0.25 | ⚠️ **可被 token 注入绕过** | 基于 grep/正则匹配；加一行注释或字段字符串即可让检查通过（test05 §1.3 标记注入） |
| OpenCode subagent 安装校验 | v4.0.26 | ◐ 静态校验生效，运行时未保证 | `agents verify` 校验目录/frontmatter 格式；但"真 reviewer 实际跑了并给出独立结论"需靠 `/spec:agent-check` 运行时探针，verify 通过 ≠ 调用未降级 |

**结论**：下一阶段的首要任务不是新增检查项，而是把上表中 ⚠️ 的机制变成 ✅。

---

## 实验问题映射

| 现象 | 本质问题 | 对应维度 |
|---|---|---|
| 模型默不作声直接干完源码 | 没进入工具链，缺少早期暴露 | Feedback Loops / Tool Orchestration |
| review 不通过后倾向改低 spec | apply 后合同边界不够硬 | Constraints |
| task 自评 80/90 还继续推进 | 自评未转化为控制流 | Constraints |
| 用户中途做了选择，reviewer 不认 | 决策没有被结构化传递 | Structured Context |
| 列表/详情/保存看似都写了，但契约断裂 | task 切法不对，检查点太晚 | Entropy Control / Feedback Loops |
| 不同模型遵守程度差异很大 | 宿主和工具入口缺少统一编排 | Tool Orchestration |
| OpenCode review 显示 General Task 而非指定 reviewer | agent 安装目录/调用语义过时，独立审查实际降级 | Tool Orchestration / Feedback Loops |
| review 不过就改 spec / 删未完成声明 / 加注释凑 grep（test05 的 24 个 fix commit） | 被检查物可被模型无痕改写，且 Guard 默认未上膛 | Tool Orchestration（根因）/ Constraints |
| gate 连续失败仍反复修补，进入死循环 | 没有止损机制，绕过成本 ≪ 补全成本 | Constraints |

> **test05 复盘（hf/test05 工作票管理系统）**是当前最有价值的实验样本。它证明了：AI 能写出合格的后端业务代码，但面对 gate 检查会选择成本最低的通过方式——改声明而非补代码。10 个正经 commit 之后是 24 个"为通过 gate 挣扎"的 commit，无一是在补全缺失实现。完整分析见 `docs/test05-analysis-and-framework-direction.md`，其结论直接重排了下方路线图优先级。

---

## 路线图

> **优先级已按 test05 实证重排（2026-06-01）。** 原顺序是 P1 Entropy Control → P2 Tool Orchestration。test05 证明：在被检查物可被模型无痕改写、且 Guard 默认未上膛的前提下，继续加 Entropy Control 检查的边际收益递减——AI 已学会通过改声明绕过这些检查。因此新顺序把"建立可信来源"放在最前，Entropy Control 暂时冻结。三层防线（工具入口 → 交叉验证 → 止损）对应 P1 → P3 → P2。

### P1. Tool Orchestration — 让已有机制上膛 + 让篡改留痕（最优先）

这是 test05 暴露的最根本问题的解法。分两步走，**第一步成本极低却收益最大：先让已经写好但默认失效的 Guard 真正生效，再补 scaffold/amend 让 spec 篡改留痕。**

优先事项（按顺序）：
1. **Guard 默认上膛**（最高优先，改动最小）：`install` 流程默认执行 `guard install`；gate 的 hash 校验 `catch{}` 改成区分"未安装 → 强警告并提示一键启用"与"校验失败 → 拦截"，**不再静默放行**。
2. **哨兵防伪**：确认 `.gate-*-passed` 是否可 `touch` 伪造；若可，加 gate 才能算出的签名（复用 guard sha256）。
3. **`spec-copilot scaffold`**：change 目录由工具创建，自带 `.scaffold-meta.json`（创建时间、命令来源、spec 初始 hash snapshot）。gate 可检测"是否经 scaffold 创建"。
4. **`spec-copilot amend --reason`**：apply 之后改 spec 必须走 amend，在 log.md 留 diff + 原因；gate 对比当前 spec hash 与 scaffold snapshot，不一致且无 amend 记录 → fail。
5. OpenCode subagent 运行时调用探针深化（v4.0.26 已完成静态校验第一版：`agents verify` + `/spec:agent-check`），把"真 reviewer 实际跑了"也变成可检查事实。
6. 后续扩到 opencode 自定义命令、Codex / Claude / Cursor skill 化。

**Exit criteria**: 重跑 test05 路径时，AI 改 spec.md 后 gate **必然**拦截（而非静默放行）；scaffold 命令可用且 gate 能检测"是否经 scaffold 创建"；"合并功能点 23→18"这类动作必然在 log.md 留下显眼记录。

### P2. Constraints — 止损机制（低成本高收益）

阻止 test05 中 24 个 fix commit 的死循环。

优先事项：
- **gate 失败计数器**：同一个 check 连续失败 N 次（如 3 次）→ 强制暂停，提示"向用户汇报，而不是继续尝试修复"，给出"跳过 / 指导修复 / 终止"三选项。
- **spec 变更预算**：apply 之后允许 spec 修改的次数设上限，超过须用户确认，让"反复改 spec 通过检查"变得显眼。
- 细化 amend 允许条件、复杂需求 test 必经规则；减少 gate 因规则死板误伤真实用户选择。

**Exit criteria**: 连续修补死循环在第 N 次被掐断并转人工；在已有真实项目中不再出现已知类型的误伤 case，如仍有误伤必须能在 `log.md` / gate 输出中解释拦截原因。

### P3. Feedback Loops — 把检查从文本匹配升级到结构/执行验证

当前 gate 大量依赖 grep/正则，易被注释标记和变量重命名绕过。这一层的目标是用"可执行验证"替代"文本匹配"。

优先事项：
- **调用链路验证代替文件数量检查**：验证 `router → page → api call → backend endpoint` 是否断链，替代"前端有几个文件 / 前后端文件数比例"这类启发式。
- **V-Slice 验证脚本化 / `task-done --verify`**：task 的"验证路径"从一段文字改成可执行命令，由工具执行并把 stdout 记录到 log.md，取代 AI 自填 curl（把 v4.0.x CALIBRATION 校准差检查那套"拿声明比对独立测量"的成功思路推广到 task 验证）。
- watch 违规时序输出增强；区分"环境限制"与"实现偷懒"。
- Playwright 从通用冒烟升级为 V-Slice 驱动验收：消费 task 的"用户动作→接口→状态变化→回显→验证路径"，并把降级原因可读化（未装浏览器 / 未识别技术栈 / 服务启动失败 / 登录态阻断 / 无可测交互）。

**Exit criteria**: watch 能在模型绕过 gate 时 30 秒内报警；至少 1 个写接口的"入参→落库→回显"用调用链路而非 grep 判定；Playwright 对至少 1 个 V-Slice task 能输出步骤级验收证据。

### P4. Structured Context 扩展

优先事项：
- Lifecycle Ledger 字段标准化；统一 Dxxx / 假设 / 风险 / 偏差引用方式。
- 更多 gate 直接读取账本；archive 输出真实遗留与取舍摘要。

**Exit criteria**: gate review 能读取 log.md 中的假设记录并交叉校验；archive 摘要包含未验证假设列表。

### P5. Entropy Control — 冻结（解冻条件明确）

> **冻结理由**：v4.0.22–v4.0.25 已连续四版补强 Entropy Control（V-Slice、不可降级项、持久化闭环、字段消费）。基础够了。在 P1 的可信来源建立之前，继续加 grep/token 匹配检查没有意义——AI 可以通过改声明或注入标记绕过。

冻结规则：
- 在 Guard 默认上膛（P1 第 1 项）完成之前，**禁止新增任何 review-checks 的 grep/token 匹配检查**。
- v4.0.25 字段消费检查（token 匹配，可被注入绕过）建议从 `fail` 降级为 `warn`，避免给出虚假的硬保证。

**解冻条件**：P1 可信来源 + P3 调用链路验证就绪后，可重做 Entropy Control 检查，但必须基于结构/执行验证而非 token 匹配。届时优先做：task 类型识别（纯后端 / 纯前端 / 全栈闭环）、契约闭环的"落库后未回显"补全。

---

## 版本节奏

分三段推进，每段都能在 test05 这条真实路径上独立验证。顺序原则：**先让已有机制真生效，再让篡改留痕，最后升级检查手段。**

### 第一段：让已有的枪上膛（v4.0.27 – v4.0.29）

> 目标：把"已写好但默认失效"的机制变成默认生效。零新检查，纯接线。

- **v4.0.27 — Guard 默认上膛**：`install` 默认 `guard install`；gate 的 `catch{}` 改成区分"未安装(强警告)/校验失败(拦截)"；doctor 把"guard 未安装"从 info 升级为 issue。
  - 验收：重跑 test05 路径，AI 改 spec.md 后 gate 必然拦截。✅ 已完成
- **v4.0.28 — Guard 首跑回归修复**：上膛后发现首跑回归——install 锁了空模板上下文，`/spec:init` 正常填充被误判为篡改。改为永久保护文件延后到首个 gate 通过后锁定；`onGatePassed` 锁定失败不再静默（P2）。
  - 验收：填充 project-context.md 后 gate 不误判；首个 gate 通过后上下文文件被正确锁定。✅ 已完成
- **v4.0.29 — 哨兵防伪 + 止损计数器**：确认并修复 `.gate-*-passed` 可伪造问题；gate 同一 check 连续失败 N 次强制暂停转人工。
  - 验收：伪造哨兵被识破；连续 fix 死循环在第 N 次被掐断。

### 第二段：让篡改留痕（v4.0.29 – v4.1.0）

> 目标：test05 点名的最高杠杆项——工具入口。

- **v4.0.29 — `scaffold` MVP**：`spec-copilot scaffold <name>` 创建 change 目录 + `.scaffold-meta.json`（创建时间、命令来源、spec 初始 hash）；apply gate 检测无 meta → warn（先观察）。
- **v4.1.0 — `amend` + spec 变更预算**：改 spec 必须走 `amend --reason` 留痕；apply 后 spec hash vs snapshot 不一致且无 amend 记录 → fail；变更预算超限须用户确认。
  - 验收："合并功能点 23→18"这类动作必然在 log.md 留下显眼记录。

### 第三段：升级检查手段（v4.1.x）

> 目标：把交叉验证从文本匹配升级到结构/执行验证。Entropy Control 在此解冻。

- 调用链路验证（`router→page→api→backend`）替代文件数比例等启发式。
- `task-done --verify`：工具执行验证命令并记录 stdout，取代 AI 自填。
- 此时才考虑恢复/重做字段消费类检查，但必须基于结构而非 token。

---

## 迭代自检清单

每版迭代完成后回答：

1. 这次主要补的是五维度中的哪一维？
2. 它解决的是哪类真实实验暴露的问题？
3. 它让问题暴露得更早，还是让问题更难发生？**（第一、二段应明显偏"更难发生"）**
4. 它对强模型 / 弱模型 / 不同宿主的效果边界分别是什么？
5. **它新增/依赖的机制，在「机制生效状态台账」里是 ✅ 默认生效，还是又一个 ⚠️ 需手动启用？**

### 迭代红线（test05 复盘后确立）

- **R1**：在 Guard 默认上膛（v4.0.27）完成前，不接受任何新增 review-checks 的 grep/token 匹配检查。
- **R2**：任何标注"已落地"的机制，必须同时在「机制生效状态台账」登记真实生效状态，不允许只在版本表写"已落地"。
- **R3**：优先做"让问题更难发生"（工具入口、止损），其次才是"让问题更易暴露"（新检查项）。

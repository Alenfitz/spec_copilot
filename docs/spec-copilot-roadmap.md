# spec-copilot Roadmap

> spec-copilot 是一套围绕 AI 模型执行行为设计的工程控制系统（Harness Engineering System）。它不承诺"用了规范就不跑偏"，而是让违规、降级和信息断层尽早暴露，让交付结果保留足够的过程证据。后续迭代按五个维度组织：Constraints、Feedback Loops、Tool Orchestration、Structured Context、Entropy Control。

## 边界

- **spec-copilot 的定位是检测+暴露，不是阻断。** gate 是流程内检查器，watch 是流程外报警器。硬阻断（写文件权限、工作区隔离）是宿主侧的事，不在本包的 deliver 范围内。
- **目标不是 100% 防跑偏。** 更现实的目标是：把违规发现时间从 1 小时压到 5 分钟，把"看起来有功能"升级成"真正闭环"。

---

## Harness 五维度

### Constraints

告诉模型"什么不能做、什么必须先做、什么改了就算违规"。

已落地：Stage Lock、Spec Contract Freeze、Task Self Assessment Gate、复杂需求 test 阶段必经。

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

截至 v4.0.22：Constraints 和 Feedback Loops 基础扎实，Structured Context 初步落地，**Tool Orchestration 和 Entropy Control 明显偏弱**。

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

---

## 路线图

### P1. Entropy Control 补强

v4.0.22 已落地 V-Slice 基础结构，v4.0.23 开始把 `不可降级项` 接入 review gate。下一步继续深化。

优先事项：
- 契约闭环检查（API 入参→落库→回显 全链路）
- task 类型识别（纯后端 / 纯前端 / 全栈闭环）
- 不可降级项与 review/test 联动

**Exit criteria**: V-Slice gate 在 3 个真实项目中拦住至少 1 次 task 过大或闭环缺失；契约闭环检查能检测到"接口有了但没落库"的 case。

### P2. Tool Orchestration 补强

优先事项：
- `spec-copilot scaffold` — change 目录不再由模型自由手写
- 新 change 强制签发痕迹（谁创建的、用什么命令）
- opencode 自定义命令适配
- 后续扩到 Codex / Claude / Cursor skill 化

**Exit criteria**: scaffold 命令可用且 gate 能检测"是否经 scaffold 创建"；至少 2 个宿主有原生命令入口。

### P3. Feedback Loops 深化

优先事项：
- watch 违规时序输出增强
- 保存落库、字段路径错位、DTO/Map 滥用检查
- Playwright / E2E 降级原因可读化
- 区分"环境限制"与"实现偷懒"

**Exit criteria**: watch 能在模型绕过 gate 时 30 秒内报警；新增至少 2 项 smoke 检查覆盖"接口通了但数据没落库"场景。

### P4. Structured Context 扩展

优先事项：
- Lifecycle Ledger 字段标准化
- 统一 Dxxx / 假设 / 风险 / 偏差引用方式
- 更多 gate 直接读取账本
- archive 输出真实遗留与取舍摘要

**Exit criteria**: gate review 能读取 log.md 中的假设记录并交叉校验；archive 摘要包含未验证假设列表。

### P5. Constraints 微调

优先事项：
- 细化 amend 允许条件
- 细化复杂需求 test 必经规则
- 减少 gate 因规则死板误伤真实用户选择

**Exit criteria**: 在已有真实项目中不再出现已知类型的误伤 case；如果仍有误伤，必须能在 `log.md` / gate 输出中解释拦截原因。

---

## 版本节奏

分两段推进，每段效果独立可验证。

**第一段：补"模型为什么总发散"**（P1 为主）
- Task Vertical Slice 深化 + 契约闭环检查
- 目标：让模型更容易把单个 task 真正做完

**第二段：补"模型为什么总绕入口"**（P2 为主）
- scaffold + 宿主命令入口 + watch 配合
- 目标：让模型更难无痕绕开框架

---

## 迭代自检清单

每版迭代完成后回答：

1. 这次主要补的是五维度中的哪一维？
2. 它解决的是哪类真实实验暴露的问题？
3. 它让问题暴露得更早，还是让问题更难发生？
4. 它对强模型 / 弱模型 / 不同宿主的效果边界分别是什么？

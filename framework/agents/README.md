# Agents 目录

本目录存放 spec-copilot v2.0.0 引入的**内置专业化 Agent Profiles**。

## 设计原则

1. **独立上下文，消除自评偏差** —— 每个 agent 从零上下文出发，只看代码不看实现者会话历史
2. **职责单一** —— 每个 agent 只做一件事，做透
3. **跨工具通用** —— Profile 是纯 markdown，任何能注入 prompt 的工具都能用
4. **优雅降级** —— 不支持 sub-agent 的宿主里，主 agent "扮演" profile 角色，输出会标记"降级"

## Agent 列表

| Agent | 触发阶段 | 作用 | 是否必须用 sub-agent |
|-------|---------|------|--------------------|
| `spec-compliance-reviewer` | `/spec:review` 阶段一 | 独立验证 spec 功能点是否真的在代码里 | **强制**（降级会标警告） |
| `adversarial-tester` | `/spec:review` 通过后（🔴 必跑） | 设计破坏性场景，证伪"代码看起来工作" | 强制（🔴） |
| `retrospective-extractor` | `/spec:archive` 前 | 从 log/tasks/diff 提炼真正值得沉淀的 knowledge | 推荐（降级时质量明显下降） |

## 如何调用（按宿主能力）

### Claude Code（支持 Agent 工具）

主 agent 在对应 `/spec:` 命令里使用 Agent 工具：

```
subagent_type: general-purpose
prompt: <加载本目录对应 .md 文件的完整内容> + <具体任务上下文>
```

子 agent 独立运行，返回报告。主 agent 只复述结论，不得"修正"为更乐观。

### 其它工具（Cursor / opencode / Windsurf / Copilot / Cline）

主 agent 自己 Read 对应 .md 文件，按里面的"角色定位、信条、步骤"执行，输出**必须在报告顶部**标注：

> ⚠️ 未使用独立 agent，结论可靠性降级

并在最终结论里加一行：`独立性：降级（推荐用户在 claude-code 中重新跑一次以获得真正独立的判定）`

### CLI 检测

`npx @alenfitz/spec-copilot doctor` 会检测当前宿主是否支持 sub-agent，并提示降级状态。

## Profile 结构

每个 profile 文件遵循统一结构：

```
---
name: <agent name>
role: <一句话角色描述>
when_to_use: <什么阶段调用>
trigger_phase: <propose|apply|review|archive>
needs_subagent: true|false
fallback: <降级模式的具体说明>
---

# 角色定位
# 核心信条
# 输入
# 你必须做的（按顺序）
# 你绝对不能做的
# 输出格式
# 降级模式
```

## 为什么不把所有 agent 放到 AGENTS.md？

AGENTS.md 是主 agent 的提示词，给"那个干所有事的人"用。
Agents 目录里的 profile 是"专家咨询师"，主 agent 在需要专业判断时才调用一个。

混在一起会导致主 agent 在写代码时不必要地承担 reviewer mindset，降低实现效率。
拆开后，每个角色专注，质量更高。

## 与 AGENTS.md.template 附录 A/B 的关系

- 附录 A（Spec Compliance Reviewer）→ 等价于本目录 `spec-compliance-reviewer.md`
- 附录 B（Code Quality Reviewer）→ 保留在 AGENTS.md 主体（属于"主 agent 自检清单"性质，无需独立 agent）

附录 A 在 v2.0.0 起**优先**使用本目录的独立 profile。附录 A 保留作为降级模式的内联回退。

---
description: 快速验证宿主 subagent 是否真正可调用
---

请立即执行 subagent 快速探针，不要进入 review，不要读取业务代码。

## 目标

验证当前宿主是否能真正调用 `spec-compliance-reviewer` 独立 subagent，而不是降级成主 agent 或 General Task。

## Step 1：CLI 安装态检查

先运行：

```bash
npx @alenfitz/spec-copilot agents verify
```

如果该命令失败，停止并报告失败原因。

## Step 2：opencode 实际调用探针

如果当前宿主是 opencode：

1. 调用 `.opencode/agents/spec-compliance-reviewer.md` 对应的 subagent。
2. 让 subagent 只返回下面这一行，不做任何额外审查：

```text
SPEC_COPILOT_AGENT_PROBE_OK spec-compliance-reviewer
```

3. 如果界面显示 `General Task`，或返回内容不是上面的固定标记，判定失败。
4. 失败时必须输出：

```text
SPEC_COPILOT_AGENT_PROBE_FAILED
原因：未命中 spec-compliance-reviewer 独立 subagent
处理：检查 .opencode/agents/ 目录、opencode 版本、以及 Task/subagent 调用能力
```

## Step 3：Claude Code 实际调用探针

如果当前宿主是 Claude Code：

使用 Agent 工具：

```text
Agent({
  subagent_type: "spec-compliance-reviewer",
  description: "spec-copilot subagent probe",
  prompt: "只返回：SPEC_COPILOT_AGENT_PROBE_OK spec-compliance-reviewer"
})
```

如果无法调用，判定失败。

## 输出

成功：

```text
SPEC_COPILOT_AGENT_PROBE_OK spec-compliance-reviewer
```

失败：

```text
SPEC_COPILOT_AGENT_PROBE_FAILED
<具体原因>
```


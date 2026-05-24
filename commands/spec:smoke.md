---
description: 冒烟验证（构建 + 骨架检测 + E2E 联调校验 + 交互测试 + 客观评分）
---

请按 AGENTS.md 中定义的 /smoke 流程执行：

**变更名**：$ARGUMENTS

## 步骤

### Step 0：程序化 gate 检查（v3.0.0 自动化）

运行 CLI 门禁，获取客观构建结果、联调校验结果和交互测试结果：

```bash
npx @alenfitz/spec-copilot gate $ARGUMENTS smoke
```

此命令自动执行：
- 前后端构建验证（npm run build / mvn compile）
- 骨架组件检测（el-empty / TODO-only / 空壳组件）
- TypeScript any 泛滥检测（warning 级别）
- **E2E 联调校验**（v2.7.0+，使用系统 Chrome，无需额外安装）：
  - 自动启动/检测前后端开发服务器
  - 从 spec.md 提取页面路由，用 headless Chrome 逐页面检查
  - **L1 基础检查**：白屏、JS 异常、框架错误遮罩
  - **L2 联调检查**：API 4xx/5xx、API 返回非 JSON、空数据渲染、控制台 API 错误
  - **L3 交互测试**：搜索框输入验证、分页点击验证、表单提交验证
  - 完成后自动关闭启动的服务器
- **客观评分**（v2.9.0+）：按维度打分（满分 100），与 AI 自评对比

可选 flags：
- `--headed`：显示浏览器窗口（调试用）
- `--base-url http://localhost:5173`：手动指定前端 URL（跳过自动检测）
- `--backend-url http://localhost:8080`：手动指定后端 URL
- `--no-e2e`：跳过 E2E 浏览器检查

**gate 未通过 → 直接进入 /spec:fix，不执行后续步骤。**

> 💡 E2E 使用系统已安装的 Chrome，电脑有 Chrome 即可，无需额外安装。未找到 Chrome 时自动跳过（不阻断）。

### Step 1：接口冒烟

1. 读取 spec.md §3 功能点列表和 §6 API 契约
2. 对 spec 中**每个 API 接口**执行 curl 验证（不仅限"核心接口"），记录状态码和响应摘要
3. 统计接口冒烟覆盖率：`通过接口数/总接口数`

> ⚠️ 仅验证"核心接口"是不够的。Spec 定义的每个 API 都必须 curl 验证可达。不可达的接口记录为失败项。

### Step 2：前端页面验证

如 Step 0 的 E2E 已通过，此步骤可简化为确认性检查。

如未安装 Playwright（E2E 跳过），需手动逐页面确认可渲染、核心交互可操作。

## 结束后

1. **记录到 log.md**：在 `## 时间线` 表格尾部追加一行 `| 当前时间 | smoke | 冒烟测试通过 ✓ |`（失败则写 `| 当前时间 | smoke | 冒烟失败 ✗ <原因> |`）
2. 读取 spec.md §2 复杂度等级后输出：

**通过（gate ✓ + 接口返回正常）：**

🟡 中等需求：
```
冒烟通过 ✓
→ 下一步：/spec:review <变更名>
```

🔴 复杂需求：
```
冒烟通过 ✓
→ 下一步：/spec:review <变更名>
（审查通过后还需 /spec:test）
```

**失败（所有等级）：**
```
冒烟失败 ✗（<失败原因>）
→ 下一步：/spec:fix <变更名> <问题描述>
（修复后自动重新 /spec:smoke）
```

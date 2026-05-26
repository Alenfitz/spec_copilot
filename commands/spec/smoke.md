---
description: 冒烟验证（构建 + 骨架检测 + E2E 浏览器联调）
---

请按 /smoke 流程执行：

**变更名**：$ARGUMENTS

## Step 0 — 程序化 gate 检查

> 先把即将写入的 smoke 结论追加到 `log.md`，再运行 gate。v4.0.17 起 gate 通过记录会绑定 `spec.md/tasks.md/log.md/source` 哈希；gate 后再改 log 会让 review 阶段判定 smoke 证据失效。

```bash
npx @alenfitz/spec-copilot gate $ARGUMENTS smoke
```

自动执行：
- **前后端构建验证**（npm run build / mvn compile）
- **骨架组件检测**（el-empty / TODO-only / 空壳组件）
- **E2E 浏览器联调**（使用系统 Chrome）：
  - 自动启动/检测前后端开发服务器
  - 从 spec.md 提取页面路由，逐页面检查
  - 检查：白屏、JS 异常、API 4xx-5xx、非 JSON 响应、空数据渲染、错误遮罩
  - 主动交互：搜索输入、分页点击、表单提交（自动填表 + 提交）

**Flags**：
- `--headed` 显示浏览器
- `--base-url http://...` 手动指定前端
- `--backend-url http://...` 手动指定后端
- `--no-e2e` 跳过 E2E（仅适合轻量/中等需求；🔴 复杂需求会阻断 smoke）

> E2E 使用系统已安装的 Chrome。🔴 复杂需求中，Chrome/Playwright 不可用或 `--no-e2e` 都会视为未验证，不能通过 smoke；轻量/中等需求会标记为降级证据。

> gate 通过后会写入 CLI 签发的 `.gate-smoke-passed`，后续 review 会校验该证据是否仍匹配当前文件，手写哨兵无效。

**gate 未通过 → /spec:fix，不执行后续。**

## Step 1 — 接口冒烟

对 spec.md §6 中**每个 API** 执行 curl 验证，记录状态码和响应摘要。

> 仅"核心接口"不够。Spec 定义的每个 API 都必须可达。

## Step 2 — 前端页面验证

E2E 已通过时此步骤为确认性检查。
未跑 E2E 时需手动逐页面确认可渲染、核心交互可操作。

## 结束后

1. 确认 `.gate-smoke-passed` 已由 CLI 写入。
2. 输出：

**通过**：
```
冒烟通过 ✓
→ 下一步：/spec:review <变更名>
```

**失败**：
```
冒烟失败 ✗（<原因>）
→ 下一步：/spec:fix <变更名> <问题>
```

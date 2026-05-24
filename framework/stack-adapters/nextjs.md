# Next.js 适配层

> 适用于：Next.js 13+ App Router + TypeScript + 全栈一体。
> 通用原则见 `spec_copilot/rules/coding-style.md`。

## 1. 注释规范

- **Server Component / Client Component / API Route**：JSDoc 注释
- **Server Action**：必须 `'use server'` 头部 + 函数注释包含调用方/副作用说明
- **数据获取函数**：注释说明是 server-side 还是 client-side、缓存策略

## 2. 异常处理

- **Server Component**：使用 `error.tsx` 边界 + `notFound()` / `redirect()`
- **API Route / Server Action**：返回结构化错误
  ```typescript
  type ApiResult<T> = { ok: true; data: T } | { ok: false; code: string; message: string };
  ```
- **Client Component**：用 `<ErrorBoundary>` 包裹关键区域

## 3. 日志规范

- **服务端**：`pino` 或 `winston`，按级别记录
- **客户端**：开发用 `console`，生产上报 Sentry
- **请求日志**：用 middleware.ts 统一记录

## 4. 配置注入

- 环境变量：`.env.local`（本地）/ `.env.production`（生产）
- **客户端可访问**：必须以 `NEXT_PUBLIC_` 前缀
- **服务端 only**：直接命名（如 `DATABASE_URL`、`API_SECRET`）
- ⚠️ 切勿把 server-only env 暴露到 Client Component

## 5. 命名约定

- **页面/Layout/Loading**：`page.tsx` / `layout.tsx` / `loading.tsx` / `error.tsx`（App Router 约定）
- **Server Action**：`actions.ts` 集中放置
- **API Route**：`route.ts`（GET/POST 导出同名函数）
- **组件**：PascalCase
- **Hook**：`use` 前缀

## 6. 分层架构

```
app/
├── (routes)/<page>/page.tsx       ← 路由页面（默认 Server Component）
├── (routes)/<page>/components/    ← 该页专用组件
├── (api)/api/<resource>/route.ts  ← API 路由
├── actions/                       ← Server Actions
├── lib/                           ← 数据访问层（DB / 外部 API）
├── components/                    ← 通用组件
└── hooks/                         ← 通用 hooks
```

## 7. 前端特有

- **Server vs Client Component**：默认 Server，需交互/状态才加 `'use client'`
- **数据获取**：
  - Server Component 直接 await
  - Client Component 用 React Query / SWR
- **缓存**：理解 `fetch` 的 `cache` / `next.revalidate` 选项，避免误用
- **路由跳转**：`useRouter` (client) / `redirect()` (server)
- **元数据**：用 `generateMetadata` 而非 `<Head>`

## 8. 测试规范

- **单元**：Vitest + React Testing Library
- **E2E**：Playwright（与 spec-copilot 内置一致）
- **Server Action 测试**：直接调用函数 + mock DB
- **覆盖率**：核心 lib/ + actions/ > 70%

## 9. 常见坑

- **Server Component 不能用 `useState` / `useEffect`** — 编译会过但运行报错
- **Client Component 不能直接调 DB** — 必须经 API Route 或 Server Action
- **`'use client'` 是边界**：一个组件加了 `'use client'`，它 import 的所有子组件都变成 client component
- **缓存陷阱**：默认 `fetch` 在生产环境会无限期缓存，动态数据需 `cache: 'no-store'` 或 `next: { revalidate: 60 }`
- **环境变量泄漏**：`NEXT_PUBLIC_*` 会打包进客户端 bundle，敏感信息必须不带这个前缀
- **Hydration mismatch**：server render 和 client render 不一致 → 报错。避免依赖 `Date.now()` / `Math.random()` 等
- **Middleware 边界**：middleware 运行在 Edge Runtime，不能用 Node.js 内置模块（如 `fs`）

## 10. code-quality-reviewer 栈相关检查项

### Critical
- [ ] Client Component 是否泄漏了 server-only env（搜 `process.env.` 在 `'use client'` 文件中）
- [ ] Server Action 是否对入参做了校验（zod）
- [ ] API Route 是否处理了 method 不匹配的情况
- [ ] 是否有 `dangerouslySetInnerHTML` 用了用户输入
- [ ] SQL 拼接（应该用 ORM 或参数化）

### Important
- [ ] Server Component 错误地用了 `useState` / `useEffect`（应该改 Client Component）
- [ ] Client Component 直接 fetch 数据（应该用 Server Component 或 React Query）
- [ ] 没正确配置 fetch 缓存策略（默认无限期缓存）
- [ ] 未使用 `<Image>` / `<Link>` 而用了原生标签（失去 Next.js 优化）
- [ ] Server Action 没标 `'use server'` 但放在 actions.ts

### Minor
- [ ] TypeScript `any` 滥用
- [ ] 缺少 `loading.tsx` / `error.tsx` 边界
- [ ] 元数据用了 `<Head>` 而非 `generateMetadata`

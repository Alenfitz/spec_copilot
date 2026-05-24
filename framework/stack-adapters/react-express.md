# React + Express 适配层

> 适用于：前端 React（CRA/Vite）+ 后端 Express + TypeScript。
> 通用原则见 `spec_copilot/rules/coding-style.md`。

## 1. 注释规范

- **类/函数/Hook**：使用 JSDoc/TSDoc
  ```typescript
  /**
   * 获取用户列表
   * @param filter 筛选条件
   * @returns 用户列表分页结果
   */
  ```
- **组件 props**：用 TypeScript interface 自带类型说明 + 复杂字段加注释
- **工具链**：eslint + `eslint-plugin-jsdoc`

## 2. 异常处理

- **后端**：自定义业务异常基类 `BizError extends Error`，统一在 Express error middleware 处理
  ```typescript
  class BizError extends Error {
    constructor(public code: number, public message: string) { super(message); }
  }
  app.use((err, req, res, next) => {
    if (err instanceof BizError) return res.status(400).json({ code: err.code, message: err.message });
    res.status(500).json({ code: 500, message: 'internal error' });
  });
  ```
- **前端**：API 调用统一用 try/catch，错误经 axios interceptor 转 toast

## 3. 日志规范

- **后端**：`winston` 或 `pino`，按级别区分（error/warn/info/debug）
- **前端**：开发环境用 `console.*`，生产环境上报 Sentry 等
- **脱敏**：密码/token 字段统一在日志中间件过滤

## 4. 配置注入

- **后端**：`dotenv` + `.env` / `.env.production`，`.env*` 加 gitignore
- **前端**：Vite 用 `import.meta.env.VITE_*`，CRA 用 `process.env.REACT_APP_*`
- **敏感配置**：仅通过环境变量注入，禁止硬编码到代码

## 5. 命名约定

- **组件**：PascalCase（`UserList.tsx`）
- **Hook**：camelCase + `use` 前缀（`useUserList.ts`）
- **工具函数**：camelCase（`formatDate.ts`）
- **常量**：UPPER_SNAKE_CASE
- **API 客户端**：`src/api/<domain>.ts`，导出函数（`getUserList`、`createUser`）

## 6. 分层架构

**后端**：
```
Router → Controller → Service → Repository (DB)
                 └→ DTO 转换
```

**前端**：
```
Page (路由层) → Component (展示层) ─→ Hook (状态/逻辑)
                                  └→ API Client (调用层)
```

## 7. 前端特有

- **状态管理**：Zustand（小型）/ Redux Toolkit（大型）/ React Query（服务端状态）
- **路由**：`react-router-dom` v6，路由配置集中在 `src/router/index.tsx`
- **样式**：CSS Modules / Tailwind / styled-components 三选一，禁止混用
- **API 调用**：统一封装在 `src/api/<domain>.ts`，组件内禁止直接 `fetch` / `axios`
- **组件目录**：`src/components/<Domain>/<ComponentName>/index.tsx`

## 8. 测试规范

- **后端**：Jest + supertest，Controller 集成测试 + Service 单元测试
- **前端**：Vitest / Jest + React Testing Library
- **测试文件**：`*.test.ts(x)` 与源文件同目录或 `__tests__/`
- **覆盖率**：核心 Service / Hook > 70%

## 9. 常见坑

- **CORS**：开发环境用 Vite proxy，避免后端配 cors 过度宽松
- **大文件上传**：注意 Express body limit 默认 100kb，需 `express.json({ limit: '10mb' })`
- **useEffect 依赖**：复杂 deps 容易死循环，优先用 useCallback/useMemo 稳定引用
- **状态更新批处理**：React 18 自动批处理，但 setTimeout/Promise 内的 setState 不会
- **Hydration mismatch**（如 SSR）：server 和 client 渲染必须一致，避免使用 `Date.now()` / `Math.random()` 在初始 render
- **环境变量泄漏**：前端 env 变量都会打包进 bundle，敏感信息必须放后端

## 10. code-quality-reviewer 栈相关检查项

### Critical
- [ ] 是否有 SQL 拼接（应该用参数化查询或 ORM）
- [ ] 是否有 `dangerouslySetInnerHTML` 直接接用户输入
- [ ] 是否在前端代码暴露 API Key / Secret
- [ ] 后端是否对外接口都做了输入校验（zod / joi / express-validator）
- [ ] 写接口（POST/PUT/DELETE）是否有幂等保护

### Important
- [ ] 异常被 catch 后没有日志或上报
- [ ] useEffect 缺依赖项或依赖项不稳定
- [ ] React 组件文件超 300 行（应拆分）
- [ ] API 客户端函数没在 `src/api/` 集中管理
- [ ] 魔法值（状态字符串、阈值数字）裸出现

### Minor
- [ ] TypeScript `any` 滥用（应使用具体类型或 `unknown`）
- [ ] 注释缺失（导出函数、复杂组件 props）
- [ ] 未使用 import 未清理

---
description: 新项目引导 — 栈选型 + 脚手架搭建
---

# /bootstrap — 新项目引导 & 栈选型

检测到当前项目为空壳（无可识别的构建文件：无 package.json/pom.xml/go.mod/requirements.txt 等）。

你需要和用户协作完成技术栈选型，然后搭建项目骨架。

## Step 1 — 需求澄清（先问再动）

向用户提问以下信息（一次问完，不给四五个问题来回拉扯）。用户可用简答，AI 根据答案补全细节。

### 必问三项

1. **项目类型**：Web 全栈 / API 服务 / CLI 工具 / 定时任务 / 其他
2. **预期规模**：个人小工具 / 团队协作 / 企业级（影响架构复杂度）
3. **是否有技术偏好**：指定语言/框架/数据库，还是让 AI 推荐

### 内网环境

4. **依赖源**：公网下载依赖，还是公司有内部镜像仓库？
   - 公网 → 跳过，不做任何配置
   - 内网镜像 → 追问：registry URL？是否需要认证？认证方式（token / 用户名密码 / 证书）？
   - 此信息记录到 `project-context.md` §9

### 根据项目类型追问

| 项目类型 | 追问 |
|---------|------|
| Web 全栈 | 前端偏好？SEO 重要吗（SSR/CSR）？ |
| API 服务 | REST / GraphQL / gRPC？预期 QPS 量级？ |
| CLI 工具 | 目标平台？需要交互式 UI？ |
| 定时任务 | 调度平台？单次/周期性？ |

## Step 2 — 推荐栈 & 等确认

根据用户回答，推荐一个技术栈组合，必须说明**为什么这个组合适合**：

```
推荐栈：
- 语言：TypeScript
- 运行时：Node.js
- 框架：Express.js
- 数据库：PostgreSQL（本地开发用 SQLite 也行）
- ORM：Prisma

理由：
- Node.js + Express 适合你描述的 QPS < 1000 的中型 API，团队上手快
- TypeScript 提供静态检查，减少运行时类型错误
- PostgreSQL 是此规模最稳妥的选择，支持 JSON 查询方便后续扩展
```

等用户确认或调整后再进入 Step 3。

## Step 3 — 搭建脚手架

用户确认栈选型后，AI 按以下顺序搭建：

0. **配置依赖源**（仅内网环境，公网跳过）：
   - Node.js：创建/追加 `.npmrc`（`registry=<url>`，如需要认证则配置 `//<registry>:_authToken=`）
   - Java/Maven：创建/追加 `~/.m2/settings.xml` 或项目级 `.mvn/settings.xml`
   - Python：创建/追加 `pip.conf` / `pip.ini` 或配置 `PIP_INDEX_URL` 环境变量
   - Go：配置 `GOPROXY` 环境变量
   - **不创建配置文件存认证凭据**，token/密码通过环境变量注入
1. **初始化项目文件**：package.json / pom.xml / go.mod / requirements.txt 等（锁定版本，不用 ^/~）
2. **创建目录结构**：按栈适配器模板的约定目录结构
3. **最小可运行入口**：一个能编译/启动的空壳（如 Express hello world、Spring Boot 空项目）
4. **基础配置**：.gitignore、环境变量示例 .env.example、README 占位
   - `.gitignore` 必须包含 `.npmrc` / `pip.conf` / `settings.xml`（防止误提交内网地址）
5. **选择栈适配器**：
   - 已有匹配的 `spec_copilot/stack-adapters/<stack>.md` → 直接加载
   - 无匹配 → 基于 `spec_copilot/stack-adapters/_template.md` 创建新的适配器文件

## Step 4 — 填充工程上下文

按 `spec_copilot/rules/project-context.md` 模板填充所有章节（应用名、技术栈、目录结构、分层架构、关键依赖、启动命令）。

## Step 5 — 初始化 Git

```bash
git init
git add .
git commit -m "chore: project bootstrap — <栈简述>"
```

## 结束后

```
项目已初始化 ✓
技术栈：<推荐栈>
栈适配器：spec_copilot/stack-adapters/<file>.md
本地启动：<启动命令>

→ 可以开始第一个需求：/spec:propose <需求描述>
```

## 铁律

- **不替用户做栈选型决策**，推荐并解释理由，等用户确认
- 依赖版本锁定（不用 ^/~），安全红线见 `security.md §5`
- 脚手架必须是可编译/启动的最小骨架，不加任何业务代码

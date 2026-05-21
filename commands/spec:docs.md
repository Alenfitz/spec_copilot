---
description: 生成/更新项目文档（README + API + 架构 + 部署）
---

# /spec:docs — 项目文档生成

**参数**：$ARGUMENTS（可选，指定只更新某个文档：readme / api / architecture / deploy）

## 数据源

文档内容从以下来源自动提取，**不凭空编造**：

| 来源 | 提取什么 |
|------|---------|
| `spec_copilot/rules/project-context.md` | 项目概况、技术栈、目录结构、启动命令、依赖版本 |
| `spec_copilot/archives/` | 所有已归档需求的功能清单、业务规则、数据模型 |
| `spec_copilot/changes/` | 进行中的变更（标注为 WIP） |
| `spec_copilot/stack-adapters/<栈>.md` | 技术规范、分层架构 |
| 源代码 | Controller 路由扫描（API 文档）、Entity 扫描（ER 图） |

## 产出文件

### 1. `README.md`（项目根目录）

```markdown
# 项目名称

> 项目简介（来自 project-context.md §1）

## 技术栈
（来自 project-context.md §1 + §4）

## 快速开始
（来自 project-context.md §8）

## 目录结构
（来自 project-context.md §2）

## 功能模块
（从 archives/ 聚合所有已完成需求，每个需求一行：名称 + 简介 + 完成日期）

## API 概览
（从 docs/api.md 提取摘要表格）

## 开发规范
> 详见 spec_copilot/ 目录下的规范文件

## License
```

### 2. `docs/api.md`（API 接口文档）

**生成方式**：扫描所有 Controller 类，提取 `@RequestMapping` / `@GetMapping` / `@PostMapping` 等注解。

```markdown
# API 接口文档

## 概览
| 模块 | 前缀 | 接口数 |
|------|------|--------|

## 详细接口

### 模块名
#### GET /api/xxx — 接口说明
- **参数**：（从 DTO 类提取字段+注释）
- **返回**：（从 VO 类提取字段+注释）
- **业务规则**：（从对应 spec.md §4 提取）
```

> 对于非 Java 项目（Node/Python/Go），扫描对应框架的路由定义文件。

### 3. `docs/architecture.md`（系统架构）

```markdown
# 系统架构

## 分层架构
（来自 stack-adapter §6，Mermaid 流程图）

## 数据模型
（扫描 Entity 类 / schema.sql，生成 Mermaid ER 图）

## 状态机
（如存在状态枚举，生成 Mermaid 状态图）

## 外部依赖
（从 spec.md 提取外部服务清单）

## 模块关系
（Mermaid 组件图，展示模块间调用关系）
```

### 4. `docs/deploy.md`（部署指南）

```markdown
# 部署指南

## 环境要求
（从 project-context.md §4 提取版本要求）

## 配置说明
（从 project-context.md §9 和 stack-adapter §4 提取）

## 构建命令
（从 project-context.md §8 提取）

## 数据库初始化
（检测 schema.sql / flyway / liquibase）

## 注意事项
（从 knowledge/index.md 提取 #deploy 标签的知识条目）
```

## 执行规则

1. **增量更新**：如果文档已存在，只更新有变化的章节，保留用户手动添加的内容（通过 `<!-- auto-generated -->` 和 `<!-- /auto-generated -->` 标记区分）
2. **Mermaid 图表**：使用 Mermaid 语法，GitHub/GitLab 原生渲染
3. **不编造内容**：所有文档内容必须有数据源出处。无法提取的章节标注 `> TODO: 待补充`
4. **中文输出**：与项目语言一致

## 结束后

```
文档已生成/更新 ✓
├── README.md          （项目说明）
├── docs/api.md        （N 个接口）
├── docs/architecture.md（含 ER 图 + 状态机图）
└── docs/deploy.md     （部署指南）

→ 建议：git commit -m "docs: 更新项目文档"
```

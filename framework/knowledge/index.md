# 知识索引

> 领域知识的结构化索引。每条记录用简短格式 + tag 分类，便于 AI 和人类快速检索。
> 来源：`/spec:archive` 时从 `spec_copilot/changes/*/log.md` 的"知识发现"提炼。

## 记录格式

```
- [tag1][tag2] **关键词**: 一句话核心逻辑（触发场景 + 解决方式）→ `包名.类名.方法名`（可选代码出处）
```

## Tag 规范

使用方括号前缀 tag，一个条目可多个 tag。标准 tag 列表如下（新增需 PR 评审）：

**环境与依赖类**
- `[env]` — 运行时环境、JDK/Node 版本、编译工具链
- `[deps]` — 第三方依赖选型、版本兼容性
- `[build]` — 构建/打包相关

**技术实现类**
- `[concurrency]` — 并发、锁、线程安全
- `[transaction]` — 事务、一致性
- `[sql]` — 数据库、SQL 语法、ORM
- `[cache]` — 缓存策略
- `[api]` — 接口设计、REST 规范
- `[frontend]` — 前端框架、组件、状态管理
- `[quartz]` — 定时任务（或其他调度框架）

**质量类**
- `[perf]` — 性能优化
- `[security]` — 安全相关
- `[bug]` — 非平凡 bug 的根因
- `[incident]` — 线上故障（来自 /spec:hotfix 归档）

**业务类**
- `[biz:<领域>]` — 业务规则，如 `[biz:push]` `[biz:auth]`

## 检索约定

- AI 在 `/spec:propose` 时根据需求关键词匹配 tag，提前加载相关历史经验
- 条目超过 50 条后考虑按大类分文件（如 `knowledge/frontend.md`），`index.md` 只保留一级目录

---

## 条目（按 tag 分组展示）

> 待积累。/spec:archive 时沉淀第一条。

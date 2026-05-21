# 任务拆分 — 需求名称

> 拆分顺序：数据模型 → 接口协议 → 底层实现 → 上层编排 → 入口层 → 前端
> 每个任务 = 可独立提交的原子变更（3-5 个文件）
> 每个任务必须精确到文件路径和函数签名

## 前置条件
- [ ] spec 已通过 HARD-GATE 确认
- [ ] 已创建 feature 分支：`git checkout -b feature/<变更名>`（禁止在 main/master 直接编码）
- [ ] 本地环境就绪（数据库/中间件连接正常）
- [ ] （其他依赖/配置前提）

---

## Task 1: 任务名
- **目标**：一句话描述
- **涉及文件**：
  - `path/to/File.java` — 新增/修改，做什么
- **关键签名**：
  ```java
  public ResultDTO doSomething(Long id, String type) { }
  ```
- **依赖**：无
- **验收标准**：
  - 正向：怎样算完成（具体的接口返回值或页面行为）
  - 异常：非法参数/边界值时的预期行为（如 400 返回、空列表等）
- **验证命令**（必填，可直接执行的 curl 或测试命令）：
  ```bash
  curl -s http://localhost:8080/api/xxx | python3 -m json.tool
  ```
- **Git commit**：`git commit -m "[变更名] T1: <中文简述>"`
- 状态：待完成

---

## Task 2: 任务名
（同上格式）

---

## 变更摘要
> ⚠️ /spec:apply 全部完成后必须填写，不填不允许进入 /spec:review

- **总文件数**：X 个新增，Y 个修改
- **Spec-Plan 偏差记录**：（无偏差 / 列出偏差点及原因）
- **魔法值是否已提取为常量**：是 / 否（列出遗留项）
- **注释覆盖情况**：Entity/Service/Controller 注释是否符合 coding-style.md §1
- **遗留问题**：（下一步需处理的已知缺陷或 TODO）

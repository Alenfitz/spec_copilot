# Spring Boot 3 + Vue 3 适配层

## 1. 注释规范
- **Entity 字段**：每个字段必须有 `/** 中文说明 */`，枚举值必须列出（如 `OPEN/CLOSED/CANCELLED`）
- **Service public 方法**：完整 Javadoc（方法用途、参数含义、返回值说明）
- **Controller 接口方法**：必须注释接口用途和关键参数含义
- **Vue 组件**：文件顶部注释说明组件职责；关键 props/emits 注释；复杂业务逻辑行内注释
- **DTO/VO 非显而易见的字段**：必须加注释

## 2. 异常处理
- 业务异常使用自定义 `BizException`，携带错误码（新项目必须在 T1 脚手架阶段创建此类）
- 系统异常向上抛出，由 `GlobalExceptionHandler` 兜底
- 禁止空 catch（吞掉异常）
- catch 中必须 `log.error("msg", e)` 记录完整堆栈，禁止 `log.error(e.getMessage())`

## 3. 日志规范
- 日志框架：SLF4J + Logback（Spring Boot 默认）
- Controller 入口打 INFO，含请求关键参数
- 异常打 ERROR 含完整堆栈
- 敏感字段脱敏：手机号 `138****1234`、API Key `***`、密码不打印

## 4. 配置注入
- 敏感配置放 `application-local.yml`（gitignore）
- 通过 `@Value` 或 `@ConfigurationProperties` 注入
- gitignore 必须包含：`application-local.yml`、`application-prod.yml`
- 禁止硬编码 API 密钥、AK/SK、数据库密码

## 5. 命名约定
- 类名：大驼峰，见名知意（`DefectService` / `PushJob`）
- 方法名：小驼峰，动词开头（`getById` / `sendPush`）
- 常量：全大写下划线分隔（`MAX_RETRY_COUNT`）
- 禁止拼音、中英混拼命名
- Vue 组件名：大驼峰 PascalCase，文件名同名（`DefectsView.vue`）
- 主键命名：`表名_id`（`station_id`、`defect_id`）
- 外键与被引用表主键名完全一致

## 6. 分层架构
```
Controller     ← 入口层，@Valid 校验 + Result 包装
      ↓
Service        ← 业务编排，事务边界 @Transactional
      ↓
Mapper (XML)   ← 纯数据访问，复杂查询写 XML，简单查询用 LambdaQueryWrapper
```

## 7. 前端规范
- 使用 Composition API（setup 语法糖）
- 跨页面复用数据必须用 Pinia store，禁止在多个组件重复请求同一接口
- API 调用统一封装到 `src/api/`，禁止在组件内直接 `import axios`
- 样式优先用 scoped CSS，颜色/尺寸提取为 CSS 变量
- 使用 Element Plus + zhCn locale

## 8. 测试规范
- 后端：JUnit 5 + MockMvc（Controller 层）/ 直接调用（Service 层）
- 测试文件位置：`src/spec:test/java/` 对应包路径
- 测试类命名：`<ClassName>Test.java`
- 前端：Vitest，文件位置 `src/__tests__/` 或组件同目录 `*.spec.js`
- 运行命令：`mvn test` / `npm run test`

## 9. 常见坑

### Lombok 与 Java 21+
Java 21 以上版本 Lombok（≤1.18.36）编译报 `TypeTag::UNKNOWN` 致命错误。
解决：移除 Lombok，用原生 getter/setter，日志用 `LoggerFactory.getLogger(X.class)`。

### MyBatis-Plus Spring Boot 3
必须用 `mybatis-plus-spring-boot3-starter`（非旧版 `mybatis-plus-boot-starter`），否则自动配置不生效。

### 数据初始化 SQL
- `schema.sql` 必须用 `CREATE TABLE IF NOT EXISTS`
- `data.sql` 必须用 `INSERT IGNORE`
- 日期字段禁止写死（`'2026-03-26'`），必须用 `DATE_SUB(NOW(), INTERVAL N DAY)`

### Quartz
- Job 注入 Spring Bean：继承 `QuartzJobBean`（非 `Job` 接口）并 `@Component`
- 更新 Trigger：先 `deleteJob` 再 `scheduleJob`，不要用 `unscheduleJob + rescheduleJob`

### API 响应格式
统一返回 `Result<T>`：
```json
{ "code": 200, "message": "success", "data": { ... } }
```
分页 data 为 MyBatis-Plus `IPage` 结构。

## 10. code-quality-reviewer 栈相关检查项

### Critical
- [ ] Grep 是否有硬编码 API Key / 密码（长度>10的字母数字混合串）
- [ ] Grep 日志是否含 `phone`、`password`、`accessKey` 等敏感字段直接拼接
- [ ] 并发写共享状态是否加锁
- [ ] 推送/支付等有副作用的接口是否有幂等键防重

### Important
- [ ] Grep `"OPEN"` `"CLOSED"` `"SUCCESS"` `"FAILED"` 等状态值是否裸出现在业务 if/switch
- [ ] Grep 是否有空 catch 块
- [ ] Grep `log.error` 是否都带 `e`（完整堆栈）
- [ ] Controller 入参是否有 `@Valid` 或手动非空检查
- [ ] 项目是否存在 BizException 类，业务异常是否统一使用
- [ ] Grep 是否有拼音命名或单字母变量（循环变量除外）
- [ ] 前端是否存在多组件重复请求同一接口（应用 Pinia store）
- [ ] Grep 前端组件是否直接 `import axios`（应走统一 request 封装）

### Minor
- [ ] Entity/Service/Controller 注释抽查（对照本文件 §1）
- [ ] data.sql 是否存在静态日期字符串
- [ ] import 是否已清理

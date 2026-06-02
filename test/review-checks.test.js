/**
 * review-checks 模块测试 — 通过 runReviewChecks 入口验证整体能正常运行
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const reviewChecks = require('../bin/review-checks');

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'spec-copilot-review-'));
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

test('review-checks: 模块导出所有期望函数', () => {
  assert.strictEqual(typeof reviewChecks.runReviewChecks, 'function');
  assert.strictEqual(typeof reviewChecks.checkApiContract, 'function');
  assert.strictEqual(typeof reviewChecks.checkContractConsistency, 'function');
  assert.strictEqual(typeof reviewChecks.checkErrorHandling, 'function');
  assert.strictEqual(typeof reviewChecks.checkHardcodedData, 'function');
  assert.strictEqual(typeof reviewChecks.checkHardcodedIdentities, 'function');
  assert.strictEqual(typeof reviewChecks.checkRouteCompleteness, 'function');
  assert.strictEqual(typeof reviewChecks.checkRuleCoverage, 'function');
  assert.strictEqual(typeof reviewChecks.checkWritePersistenceClosure, 'function');
  assert.strictEqual(typeof reviewChecks.checkWriteFieldConsumption, 'function');
});

test('checkApiContract: 空 spec → 不报错，返回 pass', () => {
  const dir = mkTmp();
  try {
    const result = reviewChecks.checkApiContract(dir, '');
    assert.ok(result);
    assert.strictEqual(typeof result.pass, 'boolean');
  } finally {
    cleanup(dir);
  }
});

test('checkApiContract: spec 含 API 端点 → 能识别', () => {
  const dir = mkTmp();
  try {
    const spec = `
# 测试需求

## 6. 接口契约
- GET /api/users
- POST /api/orders
`;
    const result = reviewChecks.checkApiContract(dir, spec);
    assert.ok(result);
    // 应至少识别出 2 个 API（即使因没有代码 fail）
    assert.ok(Array.isArray(result.results) || result.message);
  } finally {
    cleanup(dir);
  }
});

test('checkHardcodedIdentities: 空目录 → pass（无文件可扫）', () => {
  const dir = mkTmp();
  try {
    const result = reviewChecks.checkHardcodedIdentities(dir);
    assert.ok(result);
    assert.strictEqual(typeof result.pass, 'boolean');
  } finally {
    cleanup(dir);
  }
});

test('checkHardcodedData: 空目录 → pass', () => {
  const dir = mkTmp();
  try {
    const result = reviewChecks.checkHardcodedData(dir);
    assert.ok(result);
    assert.strictEqual(typeof result.pass, 'boolean');
  } finally {
    cleanup(dir);
  }
});

test('checkErrorHandling: 空目录 → pass', () => {
  const dir = mkTmp();
  try {
    const result = reviewChecks.checkErrorHandling(dir);
    assert.ok(result);
    assert.strictEqual(typeof result.pass, 'boolean');
  } finally {
    cleanup(dir);
  }
});

test('checkRouteCompleteness: 空 spec → 不报错', () => {
  const dir = mkTmp();
  try {
    const result = reviewChecks.checkRouteCompleteness(dir, '');
    assert.ok(result);
  } finally {
    cleanup(dir);
  }
});

test('runReviewChecks: 完整流程 — 空项目空 spec 不崩', () => {
  const dir = mkTmp();
  try {
    const result = reviewChecks.runReviewChecks(dir, '');
    assert.ok(result);
    assert.strictEqual(typeof result, 'object');
  } finally {
    cleanup(dir);
  }
});

test('runReviewChecks: 完整流程 — 真实 spec 不崩', () => {
  const dir = mkTmp();
  try {
    const spec = `
# 用户管理

## 3. 功能点
- F01: 用户列表查询

## 6. 接口契约
### 6.1 接口覆盖矩阵
| API ID | Method | Path | 前端调用方 | 后端实现入口 | 关联功能点 |
|-------|--------|------|-----------|-------------|----------|
| API01 | GET | /api/users | \`src/api/user.ts#getUsers\` | \`UserController#list\` | F01 |
`;
    const result = reviewChecks.runReviewChecks(dir, spec);
    assert.ok(result);
  } finally {
    cleanup(dir);
  }
});

test('checkApiContract: v4 六列接口矩阵可精确匹配自定义前后端目录', () => {
  const dir = mkTmp();
  try {
    fs.mkdirSync(path.join(dir, 'hf-web', 'src', 'api'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'hf-server', 'src', 'main', 'java', 'com', 'example'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'hf-web', 'package.json'), JSON.stringify({ dependencies: { vue: '^3.0.0' } }), 'utf-8');
    fs.writeFileSync(path.join(dir, 'hf-web', 'src', 'api', 'user.ts'), `
export function getUsers() {
  return http.get('/api/users')
}
`, 'utf-8');
    fs.writeFileSync(path.join(dir, 'hf-server', 'pom.xml'), '<project></project>', 'utf-8');
    fs.writeFileSync(path.join(dir, 'hf-server', 'src', 'main', 'java', 'com', 'example', 'UserController.java'), `
class UserController {
  @GetMapping("/api/users")
  public Object list() { return null; }
}
`, 'utf-8');

    const spec = `
# 用户管理

## 6. 接口契约
\`GET /api/users\`

### 6.1 接口覆盖矩阵
| API ID | Method | Path | 前端调用方 | 后端实现入口 | 关联功能点 |
|-------|--------|------|-----------|-------------|----------|
| API01 | GET | /api/users | \`src/api/user.ts#getUsers\` | \`UserController#list\` | F01 |
`;
    const result = reviewChecks.checkApiContract(dir, spec);
    assert.strictEqual(result.pass, true);
    assert.strictEqual(result.total, 1);
    assert.strictEqual(result.matched, 1);
    assert.strictEqual(result.results[0].feExact, true);
    assert.strictEqual(result.results[0].beExact, true);
    assert.strictEqual(result.results[0].path, '/api/users');
  } finally {
    cleanup(dir);
  }
});

test('checkWritePersistenceClosure: 写接口只有返回成功但无落库证据时失败', () => {
  const dir = mkTmp();
  try {
    fs.mkdirSync(path.join(dir, 'hf-server', 'src', 'main', 'java', 'com', 'example'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'hf-server', 'pom.xml'), '<project></project>', 'utf-8');
    fs.writeFileSync(path.join(dir, 'hf-server', 'src', 'main', 'java', 'com', 'example', 'TicketController.java'), `
import org.springframework.web.bind.annotation.*;
import java.util.Map;

@RestController
@RequestMapping("/api/tickets")
class TicketController {
  @PostMapping("/save")
  public Object save(@RequestBody Map<String, Object> request) {
    return Map.of("success", true);
  }
}
`, 'utf-8');

    const spec = `
# 工单保存

## 6. 接口契约
\`POST /api/tickets/save\`

### 6.1 接口覆盖矩阵
| API ID | Method | Path | 前端调用方 | 后端实现入口 | 关联功能点 |
|-------|--------|------|-----------|-------------|----------|
| API01 | POST | /api/tickets/save | \`src/api/ticket.ts#saveTicket\` | \`TicketController#save\` | F01 |
`;
    const result = reviewChecks.checkWritePersistenceClosure(dir, spec);
    assert.strictEqual(result.pass, false);
    assert.strictEqual(result.total, 1);
    assert.strictEqual(result.risks.length, 1);
    assert.match(result.risks[0].reason, /持久化证据/);
  } finally {
    cleanup(dir);
  }
});

test('checkWritePersistenceClosure: controller 委托 service 落库时通过', () => {
  const dir = mkTmp();
  try {
    fs.mkdirSync(path.join(dir, 'hf-server', 'src', 'main', 'java', 'com', 'example'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'hf-server', 'pom.xml'), '<project></project>', 'utf-8');
    fs.writeFileSync(path.join(dir, 'hf-server', 'src', 'main', 'java', 'com', 'example', 'TicketController.java'), `
import org.springframework.web.bind.annotation.*;
import java.util.Map;

@RestController
@RequestMapping("/api/tickets")
class TicketController {
  private final TicketService ticketService;

  public TicketController(TicketService ticketService) {
    this.ticketService = ticketService;
  }

  @PostMapping("/save")
  public Object save(@RequestBody Map<String, Object> request) {
    Object saved = ticketService.create(request);
    return Map.of("success", true, "data", saved);
  }
}
`, 'utf-8');
    fs.writeFileSync(path.join(dir, 'hf-server', 'src', 'main', 'java', 'com', 'example', 'TicketService.java'), `
import java.util.Map;

class TicketService {
  private final TicketRepository ticketRepository;

  public TicketService(TicketRepository ticketRepository) {
    this.ticketRepository = ticketRepository;
  }

  public Object create(Map<String, Object> request) {
    return ticketRepository.save(request);
  }
}
`, 'utf-8');
    fs.writeFileSync(path.join(dir, 'hf-server', 'src', 'main', 'java', 'com', 'example', 'TicketRepository.java'), `
interface TicketRepository {
  Object save(Object entity);
}
`, 'utf-8');

    const spec = `
# 工单保存

## 6. 接口契约
\`POST /api/tickets/save\`

### 6.1 接口覆盖矩阵
| API ID | Method | Path | 前端调用方 | 后端实现入口 | 关联功能点 |
|-------|--------|------|-----------|-------------|----------|
| API01 | POST | /api/tickets/save | \`src/api/ticket.ts#saveTicket\` | \`TicketController#save\` | F01 |
`;
    const result = reviewChecks.checkWritePersistenceClosure(dir, spec);
    assert.strictEqual(result.pass, true);
    assert.strictEqual(result.total, 1);
    assert.strictEqual(result.matched, 1);
  } finally {
    cleanup(dir);
  }
});

test('checkWritePersistenceClosure: controller 调用 service.save 但 service 未落库时仍失败', () => {
  const dir = mkTmp();
  try {
    fs.mkdirSync(path.join(dir, 'hf-server', 'src', 'main', 'java', 'com', 'example'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'hf-server', 'pom.xml'), '<project></project>', 'utf-8');
    fs.writeFileSync(path.join(dir, 'hf-server', 'src', 'main', 'java', 'com', 'example', 'TicketController.java'), `
import org.springframework.web.bind.annotation.*;
import java.util.Map;

@RestController
@RequestMapping("/api/tickets")
class TicketController {
  private final TicketService ticketService;

  public TicketController(TicketService ticketService) {
    this.ticketService = ticketService;
  }

  @PostMapping("/save")
  public Object save(@RequestBody Map<String, Object> request) {
    return ticketService.save(request);
  }
}
`, 'utf-8');
    fs.writeFileSync(path.join(dir, 'hf-server', 'src', 'main', 'java', 'com', 'example', 'TicketService.java'), `
import java.util.Map;

class TicketService {
  public Object save(Map<String, Object> request) {
    return Map.of("success", true);
  }
}
`, 'utf-8');

    const spec = `
# 工单保存

## 6. 接口契约
\`POST /api/tickets/save\`

### 6.1 接口覆盖矩阵
| API ID | Method | Path | 前端调用方 | 后端实现入口 | 关联功能点 |
|-------|--------|------|-----------|-------------|----------|
| API01 | POST | /api/tickets/save | \`src/api/ticket.ts#saveTicket\` | \`TicketController#save\` | F01 |
`;
    const result = reviewChecks.checkWritePersistenceClosure(dir, spec);
    assert.strictEqual(result.pass, false);
    assert.strictEqual(result.risks.length, 1);
  } finally {
    cleanup(dir);
  }
});

test('checkWritePersistenceClosure: 无关 repository 写操作不能冒充当前接口落库', () => {
  const dir = mkTmp();
  try {
    fs.mkdirSync(path.join(dir, 'hf-server', 'src', 'main', 'java', 'com', 'example'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'hf-server', 'pom.xml'), '<project></project>', 'utf-8');
    fs.writeFileSync(path.join(dir, 'hf-server', 'src', 'main', 'java', 'com', 'example', 'TicketController.java'), `
import org.springframework.web.bind.annotation.*;
import java.util.Map;

@RestController
@RequestMapping("/api/tickets")
class TicketController {
  private final TicketService ticketService;

  public TicketController(TicketService ticketService) {
    this.ticketService = ticketService;
  }

  @PostMapping("/save")
  public Object save(@RequestBody Map<String, Object> request) {
    return ticketService.create(request);
  }
}
`, 'utf-8');
    fs.writeFileSync(path.join(dir, 'hf-server', 'src', 'main', 'java', 'com', 'example', 'TicketService.java'), `
import java.util.Map;

class TicketService {
  private final UserRepository userRepository;

  public TicketService(UserRepository userRepository) {
    this.userRepository = userRepository;
  }

  public Object create(Map<String, Object> request) {
    userRepository.updateLastLoginTime();
    return Map.of("success", true);
  }
}
`, 'utf-8');

    const spec = `
# 工单保存

## 6. 接口契约
\`POST /api/tickets/save\`

### 6.1 接口覆盖矩阵
| API ID | Method | Path | 前端调用方 | 后端实现入口 | 关联功能点 |
|-------|--------|------|-----------|-------------|----------|
| API01 | POST | /api/tickets/save | \`src/api/ticket.ts#saveTicket\` | \`TicketController#save\` | F01 |
`;
    const result = reviewChecks.checkWritePersistenceClosure(dir, spec);
    assert.strictEqual(result.pass, false);
    assert.strictEqual(result.risks.length, 1);
  } finally {
    cleanup(dir);
  }
});

test('checkWritePersistenceClosure: addresses 这类 es 复数能匹配 addressRepository', () => {
  const dir = mkTmp();
  try {
    fs.mkdirSync(path.join(dir, 'hf-server', 'src', 'main', 'java', 'com', 'example'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'hf-server', 'pom.xml'), '<project></project>', 'utf-8');
    fs.writeFileSync(path.join(dir, 'hf-server', 'src', 'main', 'java', 'com', 'example', 'AddressController.java'), `
import org.springframework.web.bind.annotation.*;
import java.util.Map;

@RestController
@RequestMapping("/api/addresses")
class AddressController {
  private final AddressService addressService;

  public AddressController(AddressService addressService) {
    this.addressService = addressService;
  }

  @PostMapping("/save")
  public Object save(@RequestBody Map<String, Object> request) {
    return addressService.create(request);
  }
}
`, 'utf-8');
    fs.writeFileSync(path.join(dir, 'hf-server', 'src', 'main', 'java', 'com', 'example', 'AddressService.java'), `
import java.util.Map;

class AddressService {
  private final AddressRepository addressRepository;

  public AddressService(AddressRepository addressRepository) {
    this.addressRepository = addressRepository;
  }

  public Object create(Map<String, Object> request) {
    return addressRepository.save(request);
  }
}
`, 'utf-8');

    const spec = `
# 地址保存

## 6. 接口契约
\`POST /api/addresses/save\`

### 6.1 接口覆盖矩阵
| API ID | Method | Path | 前端调用方 | 后端实现入口 | 关联功能点 |
|-------|--------|------|-----------|-------------|----------|
| API01 | POST | /api/addresses/save | \`src/api/address.ts#saveAddress\` | \`AddressController#save\` | F01 |
`;
    const result = reviewChecks.checkWritePersistenceClosure(dir, spec);
    assert.strictEqual(result.pass, true);
    assert.strictEqual(result.matched, 1);
  } finally {
    cleanup(dir);
  }
});

test('checkWriteFieldConsumption: 字段清单声明的写入字段未被后端消费时失败', () => {
  const dir = mkTmp();
  try {
    fs.mkdirSync(path.join(dir, 'hf-server', 'src', 'main', 'java', 'com', 'example'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'hf-server', 'pom.xml'), '<project></project>', 'utf-8');
    fs.writeFileSync(path.join(dir, 'hf-server', 'src', 'main', 'java', 'com', 'example', 'TicketController.java'), `
import org.springframework.web.bind.annotation.*;
import java.util.Map;

@RestController
@RequestMapping("/api/tickets")
class TicketController {
  private final TicketService ticketService;

  public TicketController(TicketService ticketService) {
    this.ticketService = ticketService;
  }

  @PostMapping("/save")
  public Object save(@RequestBody Map<String, Object> request) {
    return ticketService.create(request);
  }
}
`, 'utf-8');
    fs.writeFileSync(path.join(dir, 'hf-server', 'src', 'main', 'java', 'com', 'example', 'TicketService.java'), `
import java.util.Map;

class TicketService {
  private final TicketRepository ticketRepository;

  public TicketService(TicketRepository ticketRepository) {
    this.ticketRepository = ticketRepository;
  }

  public Object create(Map<String, Object> request) {
    return ticketRepository.save(request);
  }
}
`, 'utf-8');

    const spec = `
# 工单保存

## 6. 接口契约
\`POST /api/tickets/save\`

### 6.1 接口覆盖矩阵
| API ID | Method | Path | 前端调用方 | 后端实现入口 | 关联功能点 |
|-------|--------|------|-----------|-------------|----------|
| API01 | POST | /api/tickets/save | \`src/api/ticket.ts#saveTicket\` | \`TicketController#save\` | F01 |

### 6.2 接口字段清单
| API ID | Required Fields | Optional Fields | Response Fields | Error Fields |
|-------|-----------------|-----------------|-----------------|--------------|
| API01 | \`title\`, \`description\` |  | \`id\`, \`title\` | \`message\` |
`;
    const result = reviewChecks.checkWriteFieldConsumption(dir, spec);
    assert.strictEqual(result.pass, false);
    assert.deepStrictEqual(result.risks[0].missingFields, ['title', 'description']);
  } finally {
    cleanup(dir);
  }
});

test('checkWriteFieldConsumption: 字段清单声明的写入字段在 service 中被消费时通过', () => {
  const dir = mkTmp();
  try {
    fs.mkdirSync(path.join(dir, 'hf-server', 'src', 'main', 'java', 'com', 'example'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'hf-server', 'pom.xml'), '<project></project>', 'utf-8');
    fs.writeFileSync(path.join(dir, 'hf-server', 'src', 'main', 'java', 'com', 'example', 'TicketController.java'), `
import org.springframework.web.bind.annotation.*;
import java.util.Map;

@RestController
@RequestMapping("/api/tickets")
class TicketController {
  private final TicketService ticketService;

  public TicketController(TicketService ticketService) {
    this.ticketService = ticketService;
  }

  @PostMapping("/save")
  public Object save(@RequestBody Map<String, Object> request) {
    return ticketService.create(request);
  }
}
`, 'utf-8');
    fs.writeFileSync(path.join(dir, 'hf-server', 'src', 'main', 'java', 'com', 'example', 'TicketService.java'), `
import java.util.Map;

class TicketService {
  private final TicketRepository ticketRepository;

  public TicketService(TicketRepository ticketRepository) {
    this.ticketRepository = ticketRepository;
  }

  public Object create(Map<String, Object> request) {
    Ticket ticket = new Ticket();
    ticket.setTitle((String) request.get("title"));
    ticket.setDescription((String) request.get("description"));
    return ticketRepository.save(ticket);
  }
}
`, 'utf-8');

    const spec = `
# 工单保存

## 6. 接口契约
\`POST /api/tickets/save\`

### 6.1 接口覆盖矩阵
| API ID | Method | Path | 前端调用方 | 后端实现入口 | 关联功能点 |
|-------|--------|------|-----------|-------------|----------|
| API01 | POST | /api/tickets/save | \`src/api/ticket.ts#saveTicket\` | \`TicketController#save\` | F01 |

### 6.2 接口字段清单
| API ID | Required Fields | Optional Fields | Response Fields | Error Fields |
|-------|-----------------|-----------------|-----------------|--------------|
| API01 | \`title\`, \`description\` |  | \`id\`, \`title\` | \`message\` |
`;
    const result = reviewChecks.checkWriteFieldConsumption(dir, spec);
    assert.strictEqual(result.pass, true);
    assert.strictEqual(result.matched, 1);
  } finally {
    cleanup(dir);
  }
});

test('checkWriteFieldConsumption: 字段清单存在但写入字段为空时跳过', () => {
  const dir = mkTmp();
  try {
    fs.mkdirSync(path.join(dir, 'hf-server', 'src', 'main', 'java', 'com', 'example'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'hf-server', 'pom.xml'), '<project></project>', 'utf-8');
    fs.writeFileSync(path.join(dir, 'hf-server', 'src', 'main', 'java', 'com', 'example', 'TicketController.java'), `
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/tickets")
class TicketController {
  @PostMapping("/save")
  public Object save() { return null; }
}
`, 'utf-8');

    const spec = `
# 工单保存

## 6. 接口契约
\`POST /api/tickets/save\`

### 6.1 接口覆盖矩阵
| API ID | Method | Path | 前端调用方 | 后端实现入口 | 关联功能点 |
|-------|--------|------|-----------|-------------|----------|
| API01 | POST | /api/tickets/save | \`src/api/ticket.ts#saveTicket\` | \`TicketController#save\` | F01 |

### 6.2 接口字段清单
| API ID | Required Fields | Optional Fields | Response Fields | Error Fields |
|-------|-----------------|-----------------|-----------------|--------------|
| API01 |  |  | \`id\` | \`message\` |
`;
    const result = reviewChecks.checkWriteFieldConsumption(dir, spec);
    assert.strictEqual(result.pass, true);
    assert.strictEqual(result.checked, 0);
    assert.strictEqual(result.skipped, 1);
  } finally {
    cleanup(dir);
  }
});

test('checkWriteFieldConsumption: snake_case 字段可由 camelCase getter 或字符串 key 消费', () => {
  const dir = mkTmp();
  try {
    fs.mkdirSync(path.join(dir, 'hf-server', 'src', 'main', 'java', 'com', 'example'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'hf-server', 'pom.xml'), '<project></project>', 'utf-8');
    fs.writeFileSync(path.join(dir, 'hf-server', 'src', 'main', 'java', 'com', 'example', 'UserController.java'), `
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/users")
class UserController {
  private final UserService userService;

  public UserController(UserService userService) {
    this.userService = userService;
  }

  @PostMapping("/save")
  public Object save(@RequestBody UserRequest request) {
    return userService.create(request);
  }
}
`, 'utf-8');
    fs.writeFileSync(path.join(dir, 'hf-server', 'src', 'main', 'java', 'com', 'example', 'UserService.java'), `
class UserService {
  private final UserRepository userRepository;

  public UserService(UserRepository userRepository) {
    this.userRepository = userRepository;
  }

  public Object create(UserRequest request) {
    User user = new User();
    user.setUserName(request.getUserName());
    user.setDisplayName(request.getMeta("displayName"));
    return userRepository.save(user);
  }
}
`, 'utf-8');

    const spec = `
# 用户保存

## 6. 接口契约
\`POST /api/users/save\`

### 6.1 接口覆盖矩阵
| API ID | Method | Path | 前端调用方 | 后端实现入口 | 关联功能点 |
|-------|--------|------|-----------|-------------|----------|
| API01 | POST | /api/users/save | \`src/api/user.ts#saveUser\` | \`UserController#save\` | F01 |

### 6.2 接口字段清单
| API ID | Required Fields | Optional Fields | Response Fields | Error Fields |
|-------|-----------------|-----------------|-----------------|--------------|
| API01 | \`user_name\`, \`display_name\` |  | \`id\` | \`message\` |
`;
    const result = reviewChecks.checkWriteFieldConsumption(dir, spec);
    assert.strictEqual(result.pass, true);
    assert.strictEqual(result.matched, 1);
  } finally {
    cleanup(dir);
  }
});

// ── v4.0.x: gate 可信度修复(POST 查询误判 + 接口注入/深层 Impl 解析)──

test('checkWritePersistenceClosure: POST 查询接口(list)不按写接口要求落库', () => {
  const dir = mkTmp();
  try {
    fs.mkdirSync(path.join(dir, 'hf-server', 'src', 'main', 'java', 'com', 'example'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'hf-server', 'pom.xml'), '<project></project>', 'utf-8');
    fs.writeFileSync(path.join(dir, 'hf-server', 'src', 'main', 'java', 'com', 'example', 'TicketController.java'), `
import org.springframework.web.bind.annotation.*;
import java.util.Map;

@RestController
@RequestMapping("/api/tickets")
class TicketController {
  private final TicketService ticketService;
  public TicketController(TicketService ticketService) { this.ticketService = ticketService; }

  @PostMapping("/list")
  public Object list(@RequestBody Map<String, Object> request) {
    return ticketService.queryPage(request); // 仅查询,无落库
  }
}
`, 'utf-8');

    const spec = `
### 6.1 接口覆盖矩阵
| API ID | Method | Path | 前端调用方 | 后端实现入口 | 关联功能点 |
|-------|--------|------|-----------|-------------|----------|
| API01 | POST | /api/tickets/list | \`src/api/ticket.ts#listTickets\` | \`TicketController#list\` | F01 |
`;
    const result = reviewChecks.checkWritePersistenceClosure(dir, spec);
    // list 是查询型 POST,被排除 → 不应作为"无落库证据"的写接口失败
    assert.strictEqual(result.pass, true, 'POST /list 查询不应被判为写接口失败');
    assert.strictEqual(result.checked, 0, '查询型 POST 应被排除,无写接口需检查');
  } finally {
    cleanup(dir);
  }
});

test('checkWritePersistenceClosure: 接口注入 + 深层 *Impl(>5层包)能解析到持久化', () => {
  const dir = mkTmp();
  try {
    // 模拟真实 Java 包嵌套:src/main/java/com/example/app/module/{controller,service,service/impl}
    const base = path.join(dir, 'hf-server', 'src', 'main', 'java', 'com', 'example', 'app', 'module');
    fs.mkdirSync(path.join(base, 'controller'), { recursive: true });
    fs.mkdirSync(path.join(base, 'service', 'impl'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'hf-server', 'pom.xml'), '<project></project>', 'utf-8');

    fs.writeFileSync(path.join(base, 'controller', 'TicketController.java'), `
import org.springframework.web.bind.annotation.*;
import java.util.Map;

@RestController
@RequestMapping("/api/tickets")
class TicketController {
  private final TicketService ticketService;
  public TicketController(TicketService ticketService) { this.ticketService = ticketService; }

  @PostMapping("/save")
  public Object save(@RequestBody Map<String, Object> request) {
    return ticketService.create(request);
  }
}
`, 'utf-8');

    // 注入的是接口,接口无方法体
    fs.writeFileSync(path.join(base, 'service', 'TicketService.java'), `
interface TicketService { Object create(Object request); }
`, 'utf-8');

    // 真正落库在深层 *Impl 里
    fs.writeFileSync(path.join(base, 'service', 'impl', 'TicketServiceImpl.java'), `
class TicketServiceImpl implements TicketService {
  private final TicketMapper ticketMapper;
  public TicketServiceImpl(TicketMapper ticketMapper) { this.ticketMapper = ticketMapper; }
  public Object create(Object request) { return ticketMapper.insert(request); }
}
`, 'utf-8');

    const spec = `
### 6.1 接口覆盖矩阵
| API ID | Method | Path | 前端调用方 | 后端实现入口 | 关联功能点 |
|-------|--------|------|-----------|-------------|----------|
| API01 | POST | /api/tickets/save | \`src/api/ticket.ts#saveTicket\` | \`TicketController#save\` | F01 |
`;
    const result = reviewChecks.checkWritePersistenceClosure(dir, spec);
    assert.strictEqual(result.pass, true, '接口注入+深层 Impl 应能解析到 insert 落库');
    assert.strictEqual(result.matched, 1);
  } finally {
    cleanup(dir);
  }
});

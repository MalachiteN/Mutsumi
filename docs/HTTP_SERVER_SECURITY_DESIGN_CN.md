# HTTP Server 安全加固 终状态设计文档

> 本文档是本次改动的唯一权威目标状态描述，供 implementer / reviewer 使用。
> 状态：已冻结（待用户最终确认后实施）。

---

## 1. 背景与问题

当前 `HttpServer` 在扩展激活时**无条件启动**（`src/extension.ts`），监听 `127.0.0.1:3000`（端口占用时顺延扫描 +100），全部端点**无任何鉴权**。

核心风险：`POST /agent/:uuid/chat` 可驱动带 `shell`/`write`/`edit` 工具的 Agent（`allowedUris` 默认 `['/']`），且 `POST /approval/:id/approve` 可远程批准待审批的工具调用——组合起来即绕过 human-in-the-loop 的远程代码执行。虽然当前绑定 loopback，但 loopback 是机器级共享的（本机任意进程/其他用户可达），且用户未来可能开放 LAN 访问。

## 2. 目标终状态

HTTP Server 默认关闭；用户显式开启后，所有端点必须携带正确的 Bearer Token 才可访问。客户端形态为非浏览器客户端（手机 APP、curl、脚本等），**不考虑浏览器调用场景，不实现任何 CORS 支持**。

## 3. 已冻结的决策

| 决策点 | 结论 |
|---|---|
| 认证头 | 标准 `Authorization: Bearer <password>`（scheme 匹配按 RFC 7235 大小写不敏感） |
| 密码存储 | 明文存于 VS Code 设置（与现有 `mutsumi.providers[].api_key` 明文策略一致），设置描述中注明 |
| 密码比较 | 常量时间比较（`crypto.timingSafeEqual` 或等效手段），避免时序侧信道 |
| 空密码行为 | `enabled=true` 但密码为空 → **拒绝启动**，弹警告通知，提供"打开设置"与"生成随机密码"入口 |
| 浏览器/CSRF 防护 | 不实现。Bearer 头本身即非简单请求头，天然阻断浏览器预检外请求；无浏览器使用场景 |
| CORS / allowedOrigins | **不实现** |
| 绑定地址 | 默认 `127.0.0.1`，可通过设置改为 `0.0.0.0` 等（设置描述中加安全警告） |
| 端口扫描 | 保留现有行为：从配置端口起顺延扫描最多 +100 |

## 4. 新增配置项（`package.json` → `contributes.configuration`）

| 配置键 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `mutsumi.httpServer.enabled` | boolean | `false` | HTTP Server 总开关，**默认关闭** |
| `mutsumi.httpServer.password` | string | `""` | Bearer Token 明文密码；为空且 enabled 时拒绝启动 |
| `mutsumi.httpServer.host` | string | `"127.0.0.1"` | 绑定地址；设置描述注明改为 `0.0.0.0` 会暴露到局域网/公网，务必先设置强密码 |
| `mutsumi.httpServer.port` | number | `3000` | 起始端口，占用时顺延扫描；范围 1–65535 |

## 5. 行为契约

### 5.1 生命周期

- **激活时**：读取配置。
  - `enabled=false` → 不启动（当前默认路径）。
  - `enabled=true` 且密码非空 → 启动。
  - `enabled=true` 但密码为空 → 不启动，弹出警告通知（按钮：打开设置 / 生成随机密码）。
- **配置变更时**（`onDidChangeConfiguration`，仅响应 `mutsumi.httpServer.*`）：
  - `enabled` 切换 → 立即 start / stop，无需重载窗口。
  - `host` / `port` 变更 → 若运行中则自动重启生效。
  - `password` 变更 → **对运行中的服务立即生效**（鉴权中间件每次请求实时读取，不要求重启）。
- **停用时**：`dispose` 停止服务（现有逻辑保留）。

### 5.2 鉴权中间件

- 注册在所有路由之前，**覆盖全部端点**（含 SSE 流式 chat、approval 系列）。
- 提取 `Authorization` 头，按 `Bearer <token>` 解析；与配置密码做常量时间比较。
- 缺失或不匹配 → `401`，JSON 响应体 `{ status: 'error', content: 'Unauthorized.' }`，并携带 `WWW-Authenticate: Bearer realm="mutsumi"` 响应头。
- 匹配 → 放行。
- 现有各 endpoint handler（chat / agents / agent / approval / rules / model / reasoningEffort / stop）**零改动**。

### 5.3 新增命令 `mutsumi.generateHttpServerPassword`

- 生成密码学安全的随机密码（建议 32 字节熵，base64url 或 hex 编码）。
- 写入用户级设置 `mutsumi.httpServer.password`（Global target）。
- 复制到剪贴板，并弹通知告知用户。
- 若此时 `enabled=true` 且服务因空密码未启动 → 写入后自动启动服务。
- 同步注册到 `package.json` 的 `commands` 列表。

## 6. 改动范围（文件级）

| 文件 | 改动 |
|---|---|
| `package.json` | 新增 4 个配置项 + 1 个命令声明 |
| `src/extension.ts` | 启动逻辑按开关门控；新增配置变更监听；注册生成密码命令；空密码警告通知 |
| `src/httpServer/index.ts` | 构造函数接收 host/port（经 `HttpServerOptions`）；`configureServer` 内注册鉴权中间件（于全部路由之前） |
| `src/httpServer/types.ts` | `HttpServerOptions` 扩展 `host` 字段 |
| 其余 handler 文件 | **不改动** |

## 7. 明确不做（Out of Scope）

- CORS 支持 / Origin 白名单 / `allowedOrigins` 配置。
- HTTPS / TLS 终止（内网明文 HTTP + Bearer Token 为本设计的既定取舍）。
- 多用户 / 多 Token / 权限分级。
- 速率限制、请求审计日志。
- 密码哈希存储（明文是用户明确接受的取舍）。
- 修改任何现有 endpoint handler 的业务逻辑。

## 8. 不阻塞实施的已知不确定项

- 生成随机密码的具体编码形式（hex / base64url）由 implementer 决定，不影响契约。
- 密码变更"立即生效"的实现方式（中间件实时读配置 vs 内部可变字段）由 implementer 决定，行为契约不变。
- `OPTIONS` 预检请求在无 CORS 支持下的具体响应（404 或同样 401）不影响安全性，由 implementer 按最简方式处理。

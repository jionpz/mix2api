# mix2api - 详细技术架构

**日期：** 2026-02-28
**项目类型：** backend
**架构模式：** 分层单体 + 依赖注入

## 系统架构

### 部署拓扑

```
Claude Code / OpenCode  →  new-api（入口网关）  →  mix2api（协议适配层）  →  上游模型站点
                                                        ↕
                                                   Redis（可选）
```

### 职责边界

| 组件 | 职责 |
|------|------|
| new-api | 用户/Key/配额/路由/模型映射、管理后台、统计审计限流、对外 OpenAI/Claude 入口 |
| mix2api | 协议适配、流式桥接、会话管理、工具调用闭环、可观测性、上游 token 管理 |
| Redis | 多实例会话共享（可选，自动降级到进程内存） |
| 上游模型站点 | 实际的大模型推理服务 |

## 分层架构

```
┌─────────────────────────────────────┐
│           Entry Layer               │
│  server.js → src/server.js          │
│  启动、监听、生命周期管理              │
├─────────────────────────────────────┤
│         Middleware Layer             │
│  request-id → json-parser →         │
│  json-body-error → request-log      │
│  请求预处理、错误拦截、日志            │
├─────────────────────────────────────┤
│          Route Layer                 │
│  register-core-routes.js            │
│  路由注册、端点映射                   │
├─────────────────────────────────────┤
│        Bootstrap Layer               │
│  chat-handler.js + observability.js  │
│  请求生命周期编排、trace 采样          │
├─────────────────────────────────────┤
│         Service Layer                │
│  chat-auth / chat-request /          │
│  chat-orchestration / session-*  /   │
│  upstream-* / tool-response /        │
│  openai-response                     │
│  业务逻辑、外部集成                   │
├─────────────────────────────────────┤
│          Core (app.js)               │
│  依赖注入编排、格式转换、模型画像       │
│  工具选择、预算管理                    │
├─────────────────────────────────────┤
│         Utility Layer                │
│  common / text / json-text /         │
│  tool-parser / tool-calls /          │
│  openai-error                        │
│  纯函数工具                          │
├─────────────────────────────────────┤
│         Config Layer                 │
│  env.js / runtime-config.js /        │
│  model-utils.js                      │
│  环境变量解析、配置聚合               │
└─────────────────────────────────────┘
```

## 请求生命周期

一个 `POST /v1/chat/completions` 请求的完整处理流程：

```
1. [middleware] request-id        — 生成/提取 x-request-id，初始化 res.locals 可观测性字段
2. [middleware] express.json      — 解析 JSON body
3. [middleware] json-body-error   — 拦截 JSON 解析错误 (400/413)
4. [middleware] request-log       — 记录 request.received
5. [handler]   resolveInboundToken  — 验证入站 Bearer token
6. [handler]   prepareChatRequestContext — 验证 body、规范化工具、解析动态上游 URL、解析模型画像
7. [handler]   resolveUpstreamToken — 获取上游鉴权 token (pass_through/static/managed)
8. [handler]   inspectTokenInfo    — 可选 JWT 检查
9. [handler]   resolveSessionContext — 会话查询/引导/创建
10.[handler]   prepareUpstreamRequest — 格式转换 + 预算预检（超限则裁剪重试）
11.[handler]   fetchWithAuthRecovery — HTTP 请求上游（含重试 + 401 恢复）
12.[handler]   路由响应：
              ├─ stream=true  → startUpstreamStreamBridge（SSE 实时转发）
              └─ stream=false → readUpstreamStream/readNonStreamJsonResponse
                               → evaluate（工具调用 vs 最终文本）
                               → renderToolCalls / renderFinalText
13.[middleware] request-log (finish) — 记录 request.completed + 全维度日志
```

## 依赖注入体系

所有服务通过工厂函数创建，在 `src/app.js` 中统一编排：

```javascript
// 典型的依赖注入模式
const sessionStoreService = createSessionStoreService({ config });
const upstreamRequestService = createUpstreamRequestService({ config });
const chatHandler = createChatHandler({
  config,
  sessionKeyService,
  sessionStoreService,
  observability,
  upstreamRequestService,
  // ... 更多依赖
});
```

**优势：**
- 每个服务可独立单元测试（mock 注入依赖）
- 无全局状态，无 require-time 副作用
- 服务之间的依赖关系清晰可见

## 鉴权架构

### 入站鉴权（new-api → mix2api）

| 模式 | 行为 |
|------|------|
| `none` | 不验证入站请求 |
| `bearer` | 验证 `Authorization: Bearer <token>` 匹配 `INBOUND_BEARER_TOKEN` |

### 上游鉴权（mix2api → 上游）

| 模式 | 行为 |
|------|------|
| `pass_through` | 透传入站 Bearer token 到上游 |
| `static` | 使用固定的 `UPSTREAM_BEARER_TOKEN` |
| `managed` | 自动获取/续期 token，支持 JWT 过期检测 + 401/403 恢复 |
| `none` | 不发送 Authorization |

### Managed Token 生命周期

```
请求进入 → 检查缓存 token → 有效？
  ├─ 是 → 使用缓存 token
  └─ 否 → 从 UPSTREAM_TOKEN_URL 获取新 token
          → 解析过期时间（响应字段 或 JWT payload）
          → 缓存 token（去重刷新）
          → 使用新 token

响应 401/403 → 清除缓存 → 重新获取 → 重试请求（最多 UPSTREAM_AUTH_RECOVERY_RETRY 次）
```

## 会话管理架构

### 存储后端

```
SESSION_STORE_MODE:
├─ redis   → Redis 优先，自动降级内存
├─ auto    → 有 REDIS_URL 用 Redis，否则内存
└─ memory  → 仅进程内存

数据格式：{ schemaVersion, sessionId, exchangeId, timestamp, turnCount }
```

### 会话键生成策略

| SESSION_KEY_MODE | 键组成 |
|-----------------|--------|
| `model` | model |
| `auth` | fingerprint(auth_token) |
| `auth_model_client` | fingerprint(auth) + model + client（默认） |

### 会话引导规则

1. 首次请求（无缓存）→ 不透传客户端 session_id → 上游返回新 session_id → 写入 store
2. 后续请求 → 从 store 读取 session_id → 透传到上游
3. `session_id: "new"` → 强制开启新会话

## 模型能力画像与预算系统

```
MODEL_PROFILE_JSON → 按模型配置 context_window / max_input_tokens / max_new_tokens

请求预算预检：
  estimated_input = estimate(messages + tools)
  available_input = min(max_input_tokens, context_window - reserved_output)

  estimated_input > available_input ?
    ├─ 是 → 触发裁剪恢复（保留 system + 最近 N 条消息）
    │       → 可选注入历史摘要
    │       → 重新估算 → 仍超限 → 400 context_length_exceeded
    └─ 否 → 通过，继续请求
```

## SSRF 防护（动态上游 URL）

当 `UPSTREAM_DYNAMIC_BASE_ENABLED=true` 时：

1. **协议限制：** 默认仅允许 HTTPS
2. **私网/回环拦截：** 检测 IPv4/IPv6 私有地址 + IPv4-mapped IPv6
3. **DNS 重绑定防护：** 对域名做 DNS 解析，检查解析结果是否为私有 IP
4. **域名白名单：** `UPSTREAM_BASE_ALLOWLIST` 限制可访问域名

## 错误处理

所有错误统一使用 OpenAI 兼容信封：

```json
{
  "error": {
    "message": "描述信息",
    "type": "error_type",
    "code": "error_code",
    "param": null
  }
}
```

| HTTP 状态码 | 错误码 | 场景 |
|------------|--------|------|
| 400 | `invalid_request` | body 缺失 model/messages |
| 400 | `invalid_json` | JSON 解析失败 |
| 400 | `context_length_exceeded` | 输入超出模型预算 |
| 401 | `unauthorized` | 入站鉴权失败 |
| 413 | `request_too_large` | 请求体超限 |
| 500 | `internal_server_error` | 适配器内部错误 |
| 502 | `upstream_error` | 上游业务错误 |
| 502 | `upstream_auth_error` | Managed token 获取失败 |
| 504 | `upstream_timeout` | 上游超时 |

## 可观测性

### 请求追踪

- 每个请求分配 `x-request-id`（客户端提供或自动生成 UUIDv4）
- `res.locals` 携带全维度观测字段：`endReason`, `upstreamStatus`, `client`, `stream`, `model`, `inputBudget`, `outputBudget`, `truncationApplied`, `rejectReason`

### 结构化日志

- `request.received` — 请求进入
- `request.completed` — 请求完成（含所有维度）
- `model.profile.budget_observation` — 预算决策
- `model.profile.fallback` — 模型画像回退告警

### Trace 采样

- 概率采样 + TTL 驱逐
- 周期性清理过期 trace

## 测试架构

### 策略

- **单元测试：** 每个模块 1:1 对应测试文件，mock 所有外部依赖
- **集成测试：** 启动真实 Express + mock 上游服务器，端到端验证
- **发布门禁：** Pack A（stream）、Pack B（tools）、Pack C（错误处理）分包回归

### 工具

- Node.js 内置 `node:test` + `node:assert/strict`
- 无额外测试框架依赖
- 工厂函数 + 依赖注入使 mock 自然而然

---

_使用 BMAD Method `document-project` 工作流生成_

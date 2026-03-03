# mix2api - 数据模型

**日期：** 2026-02-28

## 概述

mix2api 没有传统数据库，其数据持久化仅涉及 Redis 会话存储。以下记录所有关键数据结构。

## 会话存储 Schema

**存储位置：** Redis（可选） + 进程内存（Map）
**键格式：** `<REDIS_SESSION_PREFIX>:<session_key_mode 生成的键>`
**默认前缀：** `mix2api:session`

### 会话记录

```json
{
  "schemaVersion": 1,
  "sessionId": "string — 上游返回的会话 ID",
  "exchangeId": "string — 上游返回的交换 ID",
  "timestamp": 1234567890000,
  "turnCount": 5
}
```

| 字段 | 类型 | 描述 |
|------|------|------|
| `schemaVersion` | number | Schema 版本号，当前为 1 |
| `sessionId` | string | 上游会话 ID，首次由上游响应返回 |
| `exchangeId` | string | 上游交换 ID，每轮更新 |
| `timestamp` | number | 最后更新时间戳（ms） |
| `turnCount` | number | 对话轮次计数 |

**TTL：** `SESSION_TTL_MS`（默认 1800000ms = 30 分钟）

### 会话键生成规则

| SESSION_KEY_MODE | 键组成 | 示例 |
|-----------------|--------|------|
| `model` | `{model}` | `mix/qwen-3-235b-instruct` |
| `auth` | `{fingerprint(auth_token)}` | `a1b2c3d4e5f6` |
| `auth_model_client` | `{fingerprint(auth)}:{model}:{client}` | `a1b2c3:mix/qwen:claude-code` |

`fingerprint()` = SHA-256 前 12 位十六进制

## 运行时配置对象

由 `config/runtime-config.js` 的 `loadRuntimeConfig()` 返回：

```javascript
{
  // 服务端口
  port: 3001,

  // 上游连接
  upstreamApiBase: 'https://...',
  upstreamChatPath: '/v2/chats',
  upstreamReferer: '',
  upstreamAcceptLanguage: 'zh-CN,...',
  upstreamTimeoutMs: 180000,
  upstreamRetryCount: 0,
  upstreamRetryBaseMs: 250,
  upstreamKeepAlive: true,

  // 动态上游
  upstreamDynamicBaseEnabled: false,
  upstreamBaseAllowlist: [],
  upstreamBaseAllowHttp: false,
  upstreamBaseAllowPrivate: false,

  // 入站鉴权
  inboundAuthMode: 'bearer',
  inboundBearerToken: '...',

  // 上游鉴权
  upstreamAuthMode: 'static',
  upstreamBearerToken: '...',
  upstreamTokenUrl: '',
  upstreamTokenPath: '/v2/token',
  // ... 更多 token 管理字段

  // 日志
  logHeaders: false,
  logBodies: false,
  logToolParse: false,
  logToolSelection: false,
  logTokenInfo: false,
  exposeStack: false,

  // 请求限制
  bodySizeLimit: '5mb',

  // 工具调用
  forceToolCall: 0,
  toolKeepAll: true,
  toolMaxCount: 15,
  toolDescMaxChars: 500,
  systemPromptMaxChars: 10000,
  toolInstructionMode: 'both',
  sendUpstreamTools: false,

  // Persona
  defaultPersonaId: '',

  // 会话
  sessionTtlMs: 1800000,
  sessionStoreMode: 'auto',
  redisUrl: '',
  redisConnectTimeoutMs: 2000,
  redisSessionPrefix: 'mix2api:session',
  sessionKeyMode: 'auth_model_client',
  sessionKeyHeader: 'x-session-key',

  // 上下文
  includeContextInQuery: false,
  // ... 更多上下文字段

  // 上游消息裁剪
  upstreamMessagesMax: 20,
  upstreamMessageMaxChars: 8000,

  // 模型列表
  modelList: 'mix/qwen-3-235b-instruct,...',

  // 模型画像
  modelProfileJson: { ... },
  modelProfileDefaultContextWindow: 200000,
  modelProfileDefaultMaxInputTokens: 120000,
  modelProfileDefaultMaxNewTokens: 8192,
  tokenBudgetDefaultReservedOutputTokens: 1024,
  // ... 更多预算字段
}
```

## 模型画像

```json
{
  "mix/qwen-3-235b-instruct": {
    "context_window": 200000,
    "max_input_tokens": 150000,
    "max_new_tokens": 8192
  },
  "claude-sonnet-4-5": {
    "context_window": 200000,
    "max_input_tokens": 120000,
    "max_new_tokens": 8192
  }
}
```

| 字段 | 类型 | 描述 |
|------|------|------|
| `context_window` | number | 模型上下文窗口总大小 |
| `max_input_tokens` | number | 单次请求最大输入 token |
| `max_new_tokens` | number | 单次请求最大生成 token |

## 上游请求体结构

```javascript
{
  request: {
    agent_slug: String,      // persona ID
    model_slug: String,      // 模型标识
    locale: String,          // 语言偏好
    query: String,           // 查询文本（含工具指令/上下文）
    modes: ['tool_use'],     // 模式标志
  },
  stream: Boolean,
  messages: Array,           // 裁剪后的消息数组
  session_id: String|null,   // 上游会话 ID
  exchange_id: String|null,  // 上游交换 ID
  max_tokens: Number,        // 输出预算
}
```

## 上游响应事件（SSE）

| 事件类型 | 数据结构 | 描述 |
|---------|---------|------|
| `start` | `{ sessionId, exchangeId }` | 流开始，携带会话标识 |
| `text-delta` | `{ text: "..." }` | 文本增量 |
| `finish` | `{ reason: "stop" }` | 流结束 |

## 上游响应体（非流式）

```json
{
  "parts": [
    { "type": "text", "text": "响应文本" },
    { "type": "tool-input", "name": "fn_name", "input": {...} },
    { "type": "error", "text": "错误信息" }
  ]
}
```

## Managed Token 响应

```json
{
  "<UPSTREAM_TOKEN_FIELD>": "eyJ...",
  "<UPSTREAM_TOKEN_EXPIRES_IN_FIELD>": 3600
}
```

Token 过期时间解析优先级：
1. 响应中的 `expires_in` 字段（秒）
2. JWT payload 中的 `exp` 字段
3. 默认不设过期（每次请求都检查）

---

_使用 BMAD Method `document-project` 工作流生成_

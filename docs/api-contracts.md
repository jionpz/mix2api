# mix2api - API 契约文档

**日期：** 2026-02-28

> 完整 OpenAPI 3.0 规范请参见 [openapi.yaml](./openapi.yaml)

## 端点总览

| 方法 | 路径 | 描述 |
|------|------|------|
| POST | `/v1/chat/completions` | Chat Completions（OpenAI 兼容） |
| POST | `/` | Chat Completions 别名 |
| GET | `/v1/models` | 模型列表 |
| GET | `/health` | 健康检查 |

## POST /v1/chat/completions

OpenAI Chat Completions 兼容端点，支持流式和非流式响应。

### 请求

**Headers：**

| Header | 必填 | 描述 |
|--------|------|------|
| `Authorization` | 取决于 INBOUND_AUTH_MODE | `Bearer <token>` |
| `Content-Type` | 是 | `application/json` |
| `x-request-id` | 否 | 请求追踪 ID（未提供则自动生成 UUIDv4） |
| `x-client` / `x-client-id` | 否 | 客户端标识 |
| `x-session-id` | 否 | 会话 ID（`new` 强制新会话） |
| `x-upstream-base-url` | 否 | 动态上游 base URL（需开启 UPSTREAM_DYNAMIC_BASE_ENABLED） |

**Body（JSON）：**

```json
{
  "model": "mix/qwen-3-235b-instruct",
  "messages": [
    { "role": "system", "content": "You are a helpful assistant." },
    { "role": "user", "content": "Hello" }
  ],
  "stream": true,
  "max_tokens": 4096,
  "tools": [...],
  "session_id": "optional-session-id",
  "upstream_base_url": "https://alt-upstream.example"
}
```

| 字段 | 类型 | 必填 | 描述 |
|------|------|------|------|
| `model` | string | 是 | 模型标识（非空字符串） |
| `messages` | array | 是 | 消息数组（非空） |
| `stream` | boolean | 否 | 是否流式，默认 false |
| `max_tokens` | integer | 否 | 最大输出 token 数（裁剪到模型 max_new_tokens） |
| `max_completion_tokens` | integer | 否 | 同上（优先级高于 max_tokens） |
| `tools` | array | 否 | OpenAI 工具定义（仅支持 function 类型） |
| `functions` | array | 否 | 旧版 function calling 格式（兼容） |
| `session_id` | string | 否 | 指定会话 / `"new"` 强制新建 |
| `upstream_base_url` | string | 否 | 动态上游 base URL |
| `upstream_api_base` | string | 否 | 动态上游 base URL（兼容别名） |

### 响应 — 非流式

```json
{
  "id": "chatcmpl-<uuid>",
  "object": "chat.completion",
  "created": 1234567890,
  "model": "mix/qwen-3-235b-instruct",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "Hello! How can I help you?"
      },
      "finish_reason": "stop"
    }
  ],
  "usage": null
}
```

**工具调用响应：**

```json
{
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": null,
        "tool_calls": [
          {
            "id": "call_abc123",
            "type": "function",
            "function": {
              "name": "read_file",
              "arguments": "{\"path\":\"/src/main.js\"}"
            }
          }
        ]
      },
      "finish_reason": "tool_calls"
    }
  ]
}
```

### 响应 — 流式 (SSE)

`Content-Type: text/event-stream`

```
data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}

data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}

data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}

data: [DONE]
```

### 错误响应

```json
{
  "error": {
    "message": "错误描述",
    "type": "invalid_request_error",
    "code": "invalid_request",
    "param": null
  }
}
```

| HTTP 状态码 | type | code | 场景 |
|------------|------|------|------|
| 400 | `invalid_request_error` | `invalid_request` | 缺失 model/messages |
| 400 | `invalid_request_error` | `invalid_json` | JSON 解析失败 |
| 400 | `invalid_request_error` | `context_length_exceeded` | 输入超限 |
| 401 | `authentication_error` | `unauthorized` | 鉴权失败 |
| 413 | `invalid_request_error` | `request_too_large` | body 超限 |
| 500 | `server_error` | `internal_server_error` | 适配器错误 |
| 502 | `upstream_error` | `upstream_error` | 上游业务错误 |
| 502 | `upstream_error` | `upstream_auth_error` | token 获取失败 |
| 504 | `upstream_error` | `upstream_timeout` | 上游超时 |

## GET /v1/models

返回可用模型列表。

### 响应

```json
{
  "object": "list",
  "data": [
    {
      "id": "mix/qwen-3-235b-instruct",
      "object": "model",
      "created": 0,
      "owned_by": "mix2api"
    }
  ]
}
```

模型列表由环境变量 `MODEL_LIST` 配置。

## GET /health

健康检查端点。

### 响应 — 正常（200）

```json
{
  "status": "ok",
  "sessionStore": {
    "mode": "redis",
    "connected": true,
    "degraded": false
  }
}
```

### 响应 — 降级（503）

```json
{
  "status": "degraded",
  "sessionStore": {
    "mode": "redis",
    "connected": false,
    "degraded": true
  }
}
```

会话存储不可用时（Redis 断连且未完成降级切换），返回 503。

## 上游请求格式

mix2api 将 OpenAI 格式转换为以下上游格式：

```json
{
  "request": {
    "agent_slug": "<persona_id>",
    "model_slug": "<model>",
    "locale": "<UPSTREAM_ACCEPT_LANGUAGE>",
    "query": "<用户查询 + 工具指令 + 上下文>",
    "modes": ["tool_use"]
  },
  "stream": true,
  "messages": [...],
  "session_id": "<会话ID>",
  "exchange_id": "<交换ID>",
  "max_tokens": 4096
}
```

上游响应格式（SSE 事件）：

```
event: start
data: {"sessionId":"...","exchangeId":"..."}

event: text-delta
data: {"text":"Hello"}

event: finish
data: {"reason":"stop"}
```

---

_使用 BMAD Method `document-project` 工作流生成_

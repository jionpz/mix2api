# session_id 机制（重点）

`mix2api` 的目标是让**不透传 session** 的客户端（例如某些 IDE/代理客户端）也能稳定复用上游上下文。

## 关键结论

- 上游会在响应的 START 帧/metadata 中返回 `sessionId`（以及可能的 `exchangeId`）。
- 首轮请求（当前会话 key 为 miss）由上游负责创建会话，`mix2api` 不透传客户端传入的 `session_id` / `exchange_id`。
- `mix2api` 会优先使用 `sessionId` 作为后续请求的 `session_id`。
- 如果上游没有提供 `sessionId`，才会回退使用 `exchangeId`。

## 提取与回传

- 流式（SSE）场景：在解析到第一条包含 session 的事件后：
  - 设置响应头 `x-session-id: <sessionId>`
  - 写入本地 session store，供后续自动复用
- 非流式场景：同样尝试从 JSON 或 SSE 拼接结果中提取 session，并回传 `x-session-id`

## session store（自动复用）

存储结构（Redis/内存）：

- `key -> { schemaVersion, sessionId, exchangeId, timestamp, turnCount }`

默认 `SESSION_STORE_MODE=redis`（配置了 `REDIS_URL` 时优先使用 Redis；不可用时自动降级到内存）。

- Redis key 前缀：`REDIS_SESSION_PREFIX`（默认 `mix2api:session`）
- schema 校验：`schemaVersion` 必须匹配当前版本；未知/损坏会按 miss 降级为新会话

### key 的隔离策略

默认按 `auth + model + client` 隔离（`SESSION_KEY_MODE=auth_model_client`）。

如果你把 `mix2api` 放在 `new-api` 后面，为避免不同渠道/Key 互相串上下文，建议设置：

- `SESSION_KEY_MODE=auth`

这样 session store 会按入站 `Authorization` 的指纹进行隔离（不会把 token 原文打印到日志）。

你也可以让调用方显式传一个 header（例如灰度/分组用）：

- `SESSION_KEY_HEADER=x-session-key`

## TTL 与清理

- `SESSION_TTL_MS` 控制自动过期时间（默认 30 分钟）
- 客户端也可以通过请求的 `x-session-id: new` 或 body 的 `session_id: "new"` 强制开启新会话（并清理当前 key 的缓存）

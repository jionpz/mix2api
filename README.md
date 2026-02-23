# mix2api

`mix2api` 是一个 OpenAI Chat Completions 兼容适配层，推荐作为 `new-api` 的内部上游通道：

```
Claude Code / OpenCode -> new-api -> mix2api -> upstream model site
```

## 1. API 范围

- `POST /v1/chat/completions`（兼容 `POST /`）
- `GET /v1/models`
- `GET /health`

## 2. 快速接入

1. 初始化配置：

```bash
cp .env.example .env
```

2. 最少配置：

- `UPSTREAM_API_BASE`
- `UPSTREAM_CHAT_PATH`（默认 `/v2/chats`）
- 依据部署策略选择鉴权模式（见下文）

3. 启动：

```bash
npm start
```

默认监听：`http://localhost:3001`

4. 烟测：

```bash
curl -sS http://127.0.0.1:3001/health
curl -sS http://127.0.0.1:3001/v1/models
```

## 3. 与 new-api 集成

在 new-api 控制台新增 OpenAI Compatible channel，`base_url` 指向 `mix2api`（容器内建议 `http://mix2api:3001`）。

推荐配置（生产）：

- `INBOUND_AUTH_MODE=bearer`
- `INBOUND_BEARER_TOKEN=<new-api channel key>`
- `UPSTREAM_AUTH_MODE=static`
- `UPSTREAM_BEARER_TOKEN=<upstream token>`

常见鉴权模式：

- `UPSTREAM_AUTH_MODE=pass_through`：
  入站 Bearer 直接透传为上游 token（兼容旧链路）
- `UPSTREAM_AUTH_MODE=static`：
  入站鉴权与上游鉴权分离（推荐）
- `UPSTREAM_AUTH_MODE=managed`：
  由适配器管理上游 token 生命周期（支持自动刷新+重试）

会话共享（stable/canary 必开）：

- `SESSION_STORE_MODE=redis`
- `REDIS_URL=redis://<host>:6379`
- 可选 `REDIS_SESSION_PREFIX` 自定义前缀

会话引导规则（重要）：

- 首次请求（当前会话键无缓存）时，`mix2api` 不会向上游透传客户端传入的 `session_id` / `exchange_id`。
- 第一个可复用 `session_id` 由上游响应返回，适配器写入 session store 后用于后续请求。
- 如需强制开启新会话，使用 `session_id: "new"`（或 header `x-session-id: new`）。

模型能力画像（多模型上下文预算基础）：

- `MODEL_PROFILE_JSON`：按模型配置 `context_window`、`max_input_tokens`、`max_new_tokens`
- 未配置模型会回退到默认画像并记录告警日志（`model.profile.fallback`）
- 建议将 `max_input_tokens` 控制在 `context_window` 的 `70%~85%`，避免贴上限导致边界超限
- 输入预算估算会同时考虑 `messages` 与 `tools` 负载
- 预留输出预算后可用输入预算计算：`available_input_tokens = min(max_input_tokens, context_window - reserved_output_tokens)`
- 请求输入估算超出模型 `max_input_tokens` 时，返回 `400`（`context_length_exceeded`）
- 客户端 `max_tokens` / `max_completion_tokens` 会映射并裁剪到模型 `max_new_tokens`
- 未显式传输出参数时，默认预留由 `TOKEN_BUDGET_DEFAULT_RESERVED_OUTPUT_TOKENS` 控制
- `max_tokens` / `max_completion_tokens` 非法值不会透传，会回退到模型默认输出预算
- 输出预算映射在 stream 与 non-stream 路径保持一致
- 若首次预算预检超限，会触发“保留 system + 最近关键消息”的二次裁剪策略；仍超限才返回 `context_length_exceeded`
- 可选开启历史摘要记忆块（注入 query 的 `[历史摘要记忆]` 段）以在强裁剪下保留早期语义
- 统一预算观测日志 `model.profile.budget_observation` 包含：`model`、`input_budget`、`output_budget`、`truncation_applied`、`reject_reason`
- `request.completed` 也会携带同组预算字段，可按 `model` 聚合并结合 `x-request-id` 追踪失败样本
- 简化配置建议：保持 `INCLUDE_CONTEXT_IN_QUERY=false`，通常无需配置 `CONTEXT_*` / `QUERY_MAX_CHARS` / `TOOL_RESULT_MAX_CHARS`
- 默认画像由以下参数控制：
  - `MODEL_PROFILE_DEFAULT_CONTEXT_WINDOW`
  - `MODEL_PROFILE_DEFAULT_MAX_INPUT_TOKENS`
  - `MODEL_PROFILE_DEFAULT_MAX_NEW_TOKENS`
  - `TOKEN_BUDGET_DEFAULT_RESERVED_OUTPUT_TOKENS`
  - `MODEL_PROFILE_FALLBACK_WARN_CACHE_SIZE`（fallback 告警去重缓存上限）
  - `BUDGET_TRIM_RECENT_MESSAGES`
  - `BUDGET_TRIM_MESSAGE_MAX_CHARS`
  - `BUDGET_HISTORY_SUMMARY_ENABLED`
  - `BUDGET_HISTORY_SUMMARY_MAX_CHARS`
  - `BUDGET_HISTORY_SUMMARY_MAX_LINES`

示例：

```bash
MODEL_PROFILE_JSON='{"mix/qwen-3-235b-instruct":{"context_window":200000,"max_input_tokens":150000,"max_new_tokens":8192},"claude-sonnet-4-5":{"context_window":200000,"max_input_tokens":120000,"max_new_tokens":8192}}'
MODEL_PROFILE_DEFAULT_MAX_INPUT_TOKENS=120000
TOKEN_BUDGET_DEFAULT_RESERVED_OUTPUT_TOKENS=1024
INCLUDE_CONTEXT_IN_QUERY=false
```

## 4. 灰度与回滚建议

推荐放量：`0% -> 5% -> 20% -> 50% -> 100%`。每一档至少观察 10 分钟。

建议观察指标（按 `client` 分组）：

- `end_reason=timeout|upstream_error|adapter_error` 占比
- `stream=true` 的 `[DONE]` 完成率
- tool loop 成功率（`finish_reason=tool_calls` 后是否能继续生成）

建议回滚触发：

- 非 `client_abort` 的异常终止率超阈值
- stream `[DONE]` 覆盖率异常下降
- tools 闭环回归失败

回滚动作：

1. new-api 将 canary 权重降到 0%
2. 保留 `x-request-id` 样本用于复盘
3. 修复后从 5% 重新放量

## 5. 最小回归包 A/B/C（发布门禁）

包 A（stream 基线）：

```bash
node --test --test-name-pattern "stream=true|DONE|flushes first chunk" tests/integration/chat-completions-auth-nonstream.test.js
```

包 B（tools / legacy / loop）：

```bash
node --test --test-name-pattern "legacy functions|tool_calls|tool backfill|MCP-safe" tests/integration/chat-completions-auth-nonstream.test.js
```

包 C（取消 / 超时 / 上游错误）：

```bash
node --test --test-name-pattern "timeout|client abort|upstream HTTP error" tests/integration/chat-completions-auth-nonstream.test.js
```

一键门禁（会生成 `summary.txt` 与分包日志）：

```bash
npm run release:gate -- stable v2026.02.11
```

全量回归：

```bash
npm test
```

## 6. OpenAPI 契约

OpenAPI 3.0 文档位于：

- `docs/openapi.yaml`

覆盖内容：

- `/v1/chat/completions`（流式与非流式）
- `/v1/models`
- `/health`
- 兼容错误响应（`error.message/type/code/param`）

## 7. 相关设计文档

- `docs/architecture.md`
- `docs/session.md`
- `docs/tools-mcp-skills.md`
- `docs/release-gate.md`

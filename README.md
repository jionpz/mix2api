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

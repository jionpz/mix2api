# mix2api

`mix2api` 是一个 **OpenAI Chat Completions 兼容**的上游适配层，推荐作为 `new-api` 的内部上游（channel）使用：

```
Claude Code / OpenCode → new-api → mix2api → 你的上游模型网站
```

## 支持的接口

- `POST /v1/chat/completions`（以及兼容 `POST /`）
- `GET /v1/models`
- `GET /health`

## 关键能力

- **流式 SSE** 与非流式返回
- **工具调用 tool_calls**：返回 OpenAI 规范的 `tool_calls`，支持客户端工具循环
- **session_id 自动管理**：从上游响应提取 `sessionId` 并自动复用（OpenCode 等客户端不透传时也能保持上下文）
- **上下文控制**：按需拼接对话历史、裁剪 messages、保留工具调用链
- **去敏**：上游域名等敏感信息只放在 `.env`（仓库提供 `.env.example`）

## 快速开始（本地）

1) 复制配置：

```bash
cp .env.example .env
```

2) 编辑 `.env`，至少设置：

- `UPSTREAM_API_BASE`
- （如需要）`UPSTREAM_CHAT_PATH` / `UPSTREAM_REFERER`

3) 运行：

```bash
node server.js
```

默认监听 `http://localhost:3001`。

## 与 new-api 配合

在 new-api 控制台新增一个 **OpenAI Compatible** 的 channel，上游 base_url 指向 `mix2api`（容器内建议用服务名，例如 `http://mix2api:3001`）。

鉴权建议：

- 默认 `UPSTREAM_AUTH_MODE=pass_through`：入站 `Authorization: Bearer <token>` 会被当作上游 token（兼容旧用法）。
- 与 `new-api` 集成时建议：
  - `INBOUND_AUTH_MODE=bearer` + `INBOUND_BEARER_TOKEN=<channel key>`（只允许 new-api 调用）
  - `UPSTREAM_AUTH_MODE=static` + `UPSTREAM_BEARER_TOKEN=<上游 token>`（上游鉴权与入站解耦）

更多设计细节见：

- `docs/architecture.md`
- `docs/session.md`
- `docs/tools-mcp-skills.md`

# mix2api - 部署指南

**日期：** 2026-02-28

## 部署架构

```
                    ┌─────────────┐
                    │   new-api   │ ← 外部客户端入口
                    └──────┬──────┘
                           │ HTTP
                    ┌──────▼──────┐     ┌─────────┐
                    │   mix2api   │────▶│  Redis   │ (可选)
                    │  :3001      │     │  :6379   │
                    └──────┬──────┘     └─────────┘
                           │ HTTPS
                    ┌──────▼──────┐
                    │ 上游模型站点 │
                    └─────────────┘
```

## Docker 部署

### Dockerfile

```dockerfile
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server.js ./
COPY src ./src
COPY config ./config
COPY middleware ./middleware
COPY routes ./routes
COPY services ./services
COPY utils ./utils

EXPOSE 3001
CMD ["npm", "start"]
```

**特点：**
- Node.js 20 Alpine 基础镜像（体积小）
- 分层 COPY 优化 Docker 缓存
- 生产模式安装（`--omit=dev`）
- 仅复制运行所需文件

### docker-compose.yml

```yaml
services:
  mix2api:
    build:
      context: .
    container_name: mix2api
    restart: unless-stopped
    env_file:
      - .env
    environment:
      TZ: Asia/Shanghai
    ports:
      - "3001:3001"
    healthcheck:
      test: ["CMD", "node", "-e",
        "require('http').get('http://127.0.0.1:3001/health',(res)=>process.exit(res.statusCode===200?0:1)).on('error',()=>process.exit(1))"]
      interval: 10s
      timeout: 3s
      retries: 5
      start_period: 15s
```

### 常用命令

```bash
# 构建并启动
docker compose up -d --build

# 查看日志
docker compose logs -f mix2api

# 重启
docker compose restart mix2api

# 停止
docker compose down
```

## 环境变量配置

### 必填

| 变量 | 描述 | 示例 |
|------|------|------|
| `UPSTREAM_API_BASE` | 上游 API 基础地址 | `https://your-upstream.example` |

### 推荐配置

| 变量 | 描述 | 推荐值 |
|------|------|--------|
| `UPSTREAM_CHAT_PATH` | 上游聊天端点路径 | `/v2/chats` |
| `INBOUND_AUTH_MODE` | 入站鉴权模式 | `bearer` |
| `INBOUND_BEARER_TOKEN` | 入站 Bearer token | `<new-api channel key>` |
| `UPSTREAM_AUTH_MODE` | 上游鉴权模式 | `static` |
| `UPSTREAM_BEARER_TOKEN` | 上游 Bearer token | `<upstream token>` |

### 会话共享（多实例必需）

| 变量 | 描述 | 推荐值 |
|------|------|--------|
| `SESSION_STORE_MODE` | 存储后端 | `redis` |
| `REDIS_URL` | Redis 连接地址 | `redis://redis:6379` |
| `REDIS_SESSION_PREFIX` | Redis 键前缀 | `mix2api:session` |

### 安全相关

| 变量 | 描述 | 默认值 |
|------|------|--------|
| `UPSTREAM_DYNAMIC_BASE_ENABLED` | 动态上游 URL | `false` |
| `UPSTREAM_BASE_ALLOWLIST` | 允许的上游域名 | 空 |
| `UPSTREAM_BASE_ALLOW_HTTP` | 允许 HTTP | `false` |
| `UPSTREAM_BASE_ALLOW_PRIVATE` | 允许私网地址 | `false` |

## 健康检查

### 端点

`GET /health`

### 正常响应（200）

```json
{ "status": "ok", "sessionStore": { "mode": "redis", "connected": true, "degraded": false } }
```

### 降级响应（503）

```json
{ "status": "degraded", "sessionStore": { "mode": "redis", "connected": false, "degraded": true } }
```

### 监控建议

- 监控 `/health` 端点
- 关注 `status=degraded` 告警（Redis 断连）
- 关注 `end_reason=timeout|upstream_error|adapter_error` 比例
- stream 模式下关注 `[DONE]` 完成率

## 灰度发布

### 推荐放量策略

```
0% → 5% → 20% → 50% → 100%
```

每档至少观察 10 分钟。

### 观察指标（按 client 分组）

- `end_reason=timeout|upstream_error|adapter_error` 占比
- `stream=true` 的 `[DONE]` 完成率
- tool loop 成功率

### 回滚触发条件

- 非 `client_abort` 的异常终止率超阈值
- stream `[DONE]` 覆盖率异常下降
- tools 闭环回归失败

### 回滚动作

1. new-api 将 canary 权重降到 0%
2. 保留 `x-request-id` 样本用于复盘
3. 修复后从 5% 重新放量

## 发布门禁

```bash
npm run release:gate -- stable v<version>
```

三个回归包：
- **Pack A** — stream 基线
- **Pack B** — tools / legacy / loop
- **Pack C** — 取消 / 超时 / 上游错误

任一包失败则整体失败，生成报告到 `_bmad-output/release-gates/`。

## 扩展建议

### 水平扩展

- 多实例时**必须配置 Redis** 共享会话
- 使用 `SESSION_KEY_MODE=auth_model_client` 避免会话冲突
- 无状态请求处理（除会话外），可自由水平扩展

### 安全加固

- 生产环境设置 `INBOUND_AUTH_MODE=bearer`
- 关闭调试日志：`LOG_HEADERS=false`, `LOG_BODIES=false`, `EXPOSE_STACK=false`
- 使用 `UPSTREAM_BASE_ALLOWLIST` 限制动态上游
- 确保 Redis 配置密码认证

---

_使用 BMAD Method `document-project` 工作流生成_

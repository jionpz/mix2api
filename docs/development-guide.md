# mix2api - 开发指南

**日期：** 2026-02-28

## 前置条件

- **Node.js** >= 20（推荐 20 LTS）
- **npm**（随 Node.js 安装）
- **Redis**（可选，用于多实例会话共享；不配置时自动降级到进程内存）
- **Docker + docker-compose**（可选，用于容器化部署）

## 环境搭建

### 1. 安装依赖

```bash
npm install
```

生产依赖仅 4 个：`express`、`node-fetch`、`redis`、`uuid`。

### 2. 配置环境变量

```bash
cp .env.example .env
```

**最小配置：**

```bash
UPSTREAM_API_BASE=https://your-upstream.example
UPSTREAM_CHAT_PATH=/v2/chats
UPSTREAM_AUTH_MODE=static
UPSTREAM_BEARER_TOKEN=<your-upstream-token>
```

**推荐配置（与 new-api 搭配）：**

```bash
INBOUND_AUTH_MODE=bearer
INBOUND_BEARER_TOKEN=<new-api-channel-key>
UPSTREAM_AUTH_MODE=static
UPSTREAM_BEARER_TOKEN=<upstream-token>
SESSION_STORE_MODE=auto
```

完整配置项参见 `.env.example`（80+ 配置项，带详细中文注释）。

### 3. 启动服务

```bash
npm start
# 监听 http://localhost:3001
```

### 4. 验证

```bash
curl -sS http://127.0.0.1:3001/health
# {"status":"ok","sessionStore":{"mode":"memory","connected":true}}

curl -sS http://127.0.0.1:3001/v1/models
# {"object":"list","data":[{"id":"mix/qwen-3-235b-instruct",...}]}
```

## Docker 部署

### 构建并启动

```bash
docker compose up -d --build
```

### 环境变量

通过 `.env` 文件注入（`docker-compose.yml` 已配置 `env_file`）。

### 健康检查

Docker 内置健康检查配置：
- 端点：`GET /health`
- 间隔：10s
- 超时：3s
- 重试：5 次
- 启动等待：15s

## 测试

### 测试框架

使用 Node.js 内置 `node:test` + `node:assert/strict`，无需额外安装。

### 运行全量测试

```bash
npm test
```

### 分包回归测试

```bash
# Pack A — stream 基线
npm run test:pack:a

# Pack B — tools / legacy / loop
npm run test:pack:b

# Pack C — 取消 / 超时 / 上游错误
npm run test:pack:c
```

### 发布门禁

```bash
npm run release:gate -- stable v<version>
```

生成 `_bmad-output/release-gates/` 下的汇总和分包日志。任何包失败则整体失败。

### 测试组织

- **单元测试：** `tests/unit/<layer>-<module>.test.js`
  - 每个源模块 1:1 对应测试文件
  - 使用工厂函数 mock 注入依赖
  - 覆盖：config、middleware、routes、services、utils

- **集成测试：** `tests/integration/`
  - `health.test.js` — 健康检查 + 模型列表端点
  - `chat-completions-auth-nonstream.test.js` — 完整端到端测试
    - 启动真实 Express + mock 上游
    - 覆盖 stream/non-stream、tools、timeout、abort、错误处理

### 编写新测试

遵循现有模式：

```javascript
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

describe('moduleName', () => {
  let sut; // System Under Test

  beforeEach(() => {
    // 创建被测模块实例，mock 依赖
    sut = createModule({
      config: { /* mock config */ },
      dependency: { /* mock */ },
    });
  });

  it('should do something', () => {
    const result = sut.doSomething(input);
    assert.strictEqual(result, expected);
  });
});
```

## 代码组织约定

### 目录结构

| 目录 | 存放内容 |
|------|---------|
| `config/` | 配置读取、环境变量解析 |
| `middleware/` | Express 中间件（工厂函数导出） |
| `routes/` | 路由注册 |
| `services/` | 业务逻辑服务（工厂函数导出） |
| `utils/` | 纯函数工具 |
| `src/bootstrap/` | 启动时编排逻辑 |
| `src/` | 核心 app 构建 |

### 命名约定

- **服务工厂：** `create<ServiceName>(deps)` → 返回方法对象
- **中间件工厂：** `create<Name>Middleware(deps)` → 返回 `(req, res, next)`
- **测试文件：** `<layer>-<module>.test.js`
- **配置键：** 全大写下划线 `UPSTREAM_API_BASE`

### 依赖注入模式

所有服务通过工厂函数创建，接收依赖对象：

```javascript
// services/my-service.js
function createMyService({ config, otherService }) {
  function doWork(input) {
    // 使用 config 和 otherService
  }
  return { doWork };
}
module.exports = { createMyService };
```

在 `src/app.js` 中编排：

```javascript
const myService = createMyService({ config, otherService });
```

### 错误处理约定

使用 `utils/openai-error.js` 的 `sendOpenAIError` 返回标准格式：

```javascript
const { sendOpenAIError } = require('../utils/openai-error');
sendOpenAIError(res, 400, '描述信息', 'invalid_request_error', 'invalid_request');
```

## 调试

### 日志开关

```bash
LOG_HEADERS=true      # 记录请求头（脱敏）
LOG_BODIES=true       # 记录请求/响应体
LOG_TOOL_PARSE=true   # 工具调用解析详情
LOG_TOOL_SELECTION=true # 工具选择过程
LOG_TOKEN_INFO=true   # Token 信息（脱敏）
EXPOSE_STACK=true     # 错误响应包含堆栈
```

### VS Code 调试

项目包含 `.vscode/launch.json` 配置，可直接在 VS Code 中 F5 调试。

## 新增功能开发指引

### 新增 API 端点

1. 在 `routes/register-core-routes.js` 添加路由
2. 实现 handler（如需复杂逻辑，创建新的 service）
3. 在 `src/app.js` 中注入依赖
4. 添加测试

### 新增服务

1. 在 `services/` 创建 `<name>.js`，导出工厂函数
2. 在 `src/app.js` 中实例化并注入到需要的地方
3. 在 `tests/unit/services-<name>.test.js` 编写测试

### 新增中间件

1. 在 `middleware/` 创建 `<name>.js`，导出 `create<Name>Middleware`
2. 在 `middleware/register-core-middlewares.js` 中按顺序注册
3. 添加测试

### 新增配置项

1. 在 `.env.example` 添加配置项说明
2. 在 `config/runtime-config.js` 的 `loadRuntimeConfig()` 中读取
3. 如需验证，在对应服务中处理

---

_使用 BMAD Method `document-project` 工作流生成_

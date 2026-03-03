# mix2api - 源码目录结构分析

**日期：** 2026-02-28

## 概览

mix2api 采用扁平分层结构，将关注点清晰分离到不同顶层目录中。项目为单体 Node.js 后端，无前端代码，总计约 40 个源文件（不含测试），代码组织紧凑，生产依赖仅 4 个。

## 完整目录结构

```
mix2api/
├── server.js                          # 进程入口 → 委托到 src/server.js
├── package.json                       # 项目元数据、依赖、脚本
├── package-lock.json                  # 锁定依赖版本
├── Dockerfile                         # Docker 构建（Node 20 Alpine）
├── docker-compose.yml                 # 容器编排
├── .env.example                       # 环境变量示例（~80+ 配置项）
├── .gitignore
├── .dockerignore
├── README.md                          # 项目文档（中文）
│
├── src/                               # 核心应用逻辑
│   ├── server.js                      # 服务器启动（createApp + listen）
│   ├── app.js                         # 核心应用 — 依赖注入、业务逻辑
│   └── bootstrap/
│       ├── chat-handler.js            # 请求生命周期编排器
│       └── observability.js           # Trace 采样 + 预算观测
│
├── config/                            # 配置管理
│   ├── env.js                         # 环境变量解析工具（envInt/envBool/envJson）
│   ├── model-utils.js                 # 模型列表解析、token 估算
│   └── runtime-config.js             # 运行时配置加载（所有 env 聚合）
│
├── middleware/                        # Express 中间件
│   ├── register-core-middlewares.js   # 中间件注册入口
│   ├── request-id.js                  # 请求 ID 生成 + 可观测性字段初始化
│   ├── json-body-error.js             # JSON 解析错误处理（400/413）
│   └── request-log.js                 # 请求/响应日志 + trace 采样
│
├── routes/                            # 路由
│   └── register-core-routes.js        # 路由注册（/v1/chat/completions, /health, /v1/models）
│
├── services/                          # 业务服务层
│   ├── chat-auth.js                   # 入站/上游鉴权
│   ├── chat-request.js                # 请求验证 + 上下文准备
│   ├── chat-orchestration.js          # 会话解析 + 上游请求构建
│   ├── session-key.js                 # 客户端识别 + 会话键生成
│   ├── session-store.js               # Redis + 内存双后端会话存储
│   ├── upstream-token.js              # Managed token 生命周期
│   ├── upstream-request.js            # HTTP 请求 + 重试 + auth 恢复
│   ├── upstream-stream.js             # SSE 流式桥接（上游 → OpenAI 格式）
│   ├── upstream-read.js               # 上游响应读取（流式/非流式）
│   ├── sse-parser.js                  # SSE 协议解析器
│   ├── tool-response.js               # 工具调用评估 + 解析
│   └── openai-response.js             # OpenAI 格式响应渲染
│
├── utils/                             # 通用工具
│   ├── common.js                      # 请求 ID 规范化、header 脱敏、JWT 解码等
│   ├── text.js                        # 文本截断（保头尾）
│   ├── json-text.js                   # JSON 提取、{final:"..."} 协议解析
│   ├── tool-parser.js                 # 松散工具调用解析器
│   ├── tool-calls.js                  # 工具调用验证/规范化/格式化
│   └── openai-error.js                # OpenAI 错误信封构造
│
├── scripts/
│   └── release-gate.sh                # 发布门禁脚本（Pack A/B/C）
│
├── tests/
│   ├── unit/                          # 单元测试（20 个文件）
│   │   ├── baseline-files.test.js
│   │   ├── config-env.test.js
│   │   ├── config-model-utils.test.js
│   │   ├── middleware-register-core-middlewares.test.js
│   │   ├── middleware-request-id.test.js
│   │   ├── routes-register-core-routes.test.js
│   │   ├── services-chat-auth.test.js
│   │   ├── services-chat-orchestration.test.js
│   │   ├── services-chat-request.test.js
│   │   ├── services-openai-response.test.js
│   │   ├── services-session-key.test.js
│   │   ├── services-session-store.test.js
│   │   ├── services-tool-response.test.js
│   │   ├── services-upstream-read.test.js
│   │   ├── services-upstream-request.test.js
│   │   ├── services-upstream-stream.test.js
│   │   ├── services-upstream-token.test.js
│   │   ├── utils-common.test.js
│   │   ├── utils-json-text.test.js
│   │   ├── utils-openai-error.test.js
│   │   ├── utils-text.test.js
│   │   ├── utils-tool-calls.test.js
│   │   └── utils-tool-parser.test.js
│   └── integration/                   # 集成测试（2 个文件）
│       ├── health.test.js
│       └── chat-completions-auth-nonstream.test.js
│
└── docs/                              # 项目文档
    ├── architecture.md
    ├── openapi.yaml
    ├── release-gate.md
    ├── session.md
    └── tools-mcp-skills.md
```

## 关键目录说明

### `src/`

核心应用逻辑的主目录。

**用途：** 包含服务器启动、应用构建和请求编排
**内容：** 3 个主文件 + 1 个子目录
**入口点：** `src/server.js`（由根 `server.js` 委托）

`src/app.js` 是项目最大的文件，包含核心业务逻辑：请求格式转换（`convertToUpstreamFormat`）、工具选择（`reduceTools`）、预算管理消息构建（`buildBudgetManagedMessages`）、工具调用解析、模型画像系统等。

### `config/`

配置管理层。

**用途：** 环境变量解析、运行时配置加载、模型工具函数
**内容：** 3 个文件
**特点：** `runtime-config.js` 将 80+ 环境变量聚合为单一配置对象

### `middleware/`

Express 中间件管道。

**用途：** 请求预处理、错误拦截、日志记录
**内容：** 4 个文件
**执行顺序：** request-id → express.json → json-body-error → request-log

### `services/`

业务服务层 — 项目的核心。

**用途：** 鉴权、请求处理、会话管理、上游通信、响应渲染
**内容：** 12 个服务文件
**模式：** 工厂函数 + 依赖注入，每个服务可独立测试

### `utils/`

通用工具函数。

**用途：** 字符串处理、JSON 提取、工具调用解析/验证、错误格式化
**内容：** 6 个文件
**特点：** 纯函数为主，无外部依赖，高度可复用

### `tests/`

测试目录。

**用途：** 单元测试 + 集成测试
**内容：** 20 个单元测试 + 2 个集成测试
**命名约定：** `<layer>-<module>.test.js`（如 `services-chat-auth.test.js`）

## 入口点

- **主入口：** `server.js` → `src/server.js` → `src/app.js`
- **启动流程：**
  1. `server.js` 调用 `startServer()`
  2. `src/server.js` 中 `startServer()` 调用 `createApp()` + `app.listen()` + `onServerStarted()`
  3. `src/app.js` 中 `createApp()` 完成依赖注入、中间件注册、路由注册
  4. `onServerStarted()` 启动 trace 清理定时器 + Redis 会话客户端初始化

## 文件组织模式

- **按职责分层：** config → middleware → routes → services → utils → bootstrap
- **1:1 测试映射：** 每个源文件对应一个 `tests/unit/<layer>-<module>.test.js`
- **扁平结构：** 除 `src/bootstrap/` 外无深层嵌套
- **工厂模式命名：** `create<ServiceName>(deps)` 返回服务实例

## 关键文件类型

### 服务文件

- **模式：** `services/<name>.js`
- **用途：** 业务逻辑封装，通过工厂函数导出
- **示例：** `services/session-store.js`、`services/upstream-stream.js`

### 中间件文件

- **模式：** `middleware/<name>.js`
- **用途：** Express 中间件，通过 `create<Name>Middleware` 工厂导出
- **示例：** `middleware/request-id.js`、`middleware/request-log.js`

### 测试文件

- **模式：** `tests/unit/<layer>-<module>.test.js`
- **用途：** 使用 Node.js 内置 test runner，mock 依赖注入
- **示例：** `tests/unit/services-chat-auth.test.js`

## 配置文件

- **`.env.example`**：环境变量模板（80+ 配置项，详细中文注释）
- **`package.json`**：项目元数据、4 个生产依赖、5 个脚本
- **`Dockerfile`**：Node 20 Alpine，分层 COPY 优化缓存
- **`docker-compose.yml`**：单服务编排，健康检查，端口 3001
- **`.dockerignore`**：排除 node_modules、.git 等
- **`.gitignore`**：标准 Node.js 忽略规则

## 开发注意事项

- `src/app.js` 是最大文件（约 1800+ 行），包含大量尚未提取到 services 的业务逻辑
- 所有服务使用依赖注入，测试时可完全 mock
- 无 TypeScript，无构建步骤，源码即运行代码
- 测试使用 Node.js 内置 `node:test`，无需额外测试框架
- 集成测试会启动真实 Express 服务器和 mock 上游

---

_使用 BMAD Method `document-project` 工作流生成_

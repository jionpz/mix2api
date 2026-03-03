# mix2api - 项目总览

**日期：** 2026-02-28
**类型：** backend
**架构：** 分层单体（Layered Monolith）

## 概要

mix2api 是一个 Node.js/Express 后端适配器，为 `new-api` 网关提供 OpenAI Chat Completions 兼容的上游通道。它在调用方（如 Claude Code、OpenCode）与上游模型站点之间充当协议翻译层，将 OpenAI 格式的请求转换为上游专有格式，并将响应（包括 SSE 流式）转换回 OpenAI 标准格式。

```
Claude Code / OpenCode  →  new-api  →  mix2api  →  上游模型站点
```

## 项目分类

- **仓库类型：** 单体（Monolith）
- **项目类型：** backend
- **主要语言：** JavaScript (Node.js, CommonJS)
- **架构模式：** 分层架构 + 依赖注入（工厂函数模式）

## 技术栈总览

| 类别 | 技术 | 版本/说明 |
|------|------|-----------|
| 运行时 | Node.js | 20 (Alpine) |
| Web 框架 | Express | ^4.22.1 |
| HTTP 客户端 | node-fetch | ^2.7.0 |
| 会话存储 | Redis | ^4.7.1（可选，自动降级到内存） |
| UUID | uuid | ^8.3.2 |
| 测试框架 | node:test + node:assert/strict | Node.js 内置 |
| 容器化 | Docker + docker-compose | Node 20 Alpine 基础镜像 |
| 模块系统 | CommonJS (require/module.exports) | — |
| 生产依赖数 | 4 个 | 极简依赖设计 |

## 核心功能

1. **OpenAI 兼容 API** — 提供 `POST /v1/chat/completions`、`GET /v1/models`、`GET /health` 端点
2. **协议翻译** — OpenAI 格式 ↔ 上游专有格式的双向转换
3. **SSE 流式桥接** — 将上游 SSE 事件（text-delta、finish、start）实时转换为 OpenAI SSE chunk
4. **多模式鉴权** — 入站（none/bearer）+ 上游（pass_through/static/managed/none）灵活组合
5. **工具调用支持** — 多策略解析（JSON → 结构化 → 正则回退），支持 function calling 和 MCP 安全过滤
6. **会话管理** — Redis + 内存双后端，支持会话引导规则和多维度会话键
7. **动态上游路由** — 按请求覆盖上游 base URL，内置 SSRF 防护
8. **模型能力画像** — 按模型配置上下文预算，支持输入预检、超限裁剪和历史摘要
9. **可观测性** — 请求 ID 追踪、采样 trace、结构化日志、预算观测维度
10. **Managed Token 生命周期** — 自动获取/续期/恢复上游令牌，支持 JWT 过期检测

## 架构亮点

- **依赖注入（工厂函数）**：所有服务通过工厂函数创建，接收 `{ config, ... }` 依赖对象，便于独立测试
- **分层启动**：`server.js` → `src/server.js` → `src/app.js` 三层分离，app 构建与服务器启动解耦
- **中间件管道**：请求 ID → JSON 解析 → 错误处理 → 日志，统一注入可观测性字段
- **Write-as-you-go 文档策略**：每个模块配有对应的单元测试文件
- **OpenAI 错误信封**：所有错误统一返回 `{error: {message, type, code, param}}` 格式

## 开发概览

### 前置条件

- Node.js >= 20
- npm
- Redis（可选，用于多实例会话共享）
- Docker + docker-compose（可选，用于容器化部署）

### 快速开始

```bash
# 克隆并安装依赖
git clone <repo-url> && cd mix2api
npm install

# 配置环境变量
cp .env.example .env
# 编辑 .env，至少设置 UPSTREAM_API_BASE

# 启动服务
npm start
# 默认监听 http://localhost:3001

# 健康检查
curl -sS http://127.0.0.1:3001/health
curl -sS http://127.0.0.1:3001/v1/models
```

### 关键命令

- **安装：** `npm install`
- **启动：** `npm start`
- **测试：** `npm test`（全量） / `npm run test:pack:a|b|c`（分包）
- **发布门禁：** `npm run release:gate -- stable v<version>`

## 仓库结构概览

```
mix2api/
├── server.js              # 进程入口（委托到 src/server.js）
├── src/
│   ├── server.js          # 服务器启动逻辑
│   ├── app.js             # 核心应用（依赖注入、业务逻辑）
│   └── bootstrap/         # 启动模块
│       ├── chat-handler.js   # 请求生命周期编排
│       └── observability.js  # Trace 采样与预算观测
├── config/                # 配置管理
├── middleware/            # Express 中间件
├── routes/                # 路由注册
├── services/              # 业务服务层
├── utils/                 # 通用工具函数
├── tests/                 # 测试（unit + integration）
├── docs/                  # 文档
├── scripts/               # 脚本（发布门禁）
├── Dockerfile             # Docker 构建
└── docker-compose.yml     # 编排
```

## 文档导航

详细信息请参阅：

- [index.md](./index.md) - 文档总索引
- [architecture.md](./architecture.md) - 详细架构设计
- [source-tree-analysis.md](./source-tree-analysis.md) - 源码目录结构分析
- [development-guide.md](./development-guide.md) - 开发工作流指南

---

_使用 BMAD Method `document-project` 工作流生成_

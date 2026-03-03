# mix2api 文档索引

**类型：** 单体（Monolith）
**主要语言：** JavaScript (Node.js)
**架构：** 分层单体 + 依赖注入
**最后更新：** 2026-02-28

## 项目简介

mix2api 是一个 OpenAI Chat Completions 兼容的上游适配层，推荐作为 `new-api` 网关的内部上游通道。将 OpenAI 格式请求转换为上游模型站点的专有协议，支持 SSE 流式桥接、多模式鉴权、工具调用闭环和会话管理。

```
Claude Code / OpenCode  →  new-api  →  mix2api  →  上游模型站点
```

## 快速参考

- **技术栈：** Node.js 20 + Express 4 + Redis（可选）
- **入口点：** `server.js` → `src/server.js` → `src/app.js`
- **架构模式：** 分层架构（config → middleware → routes → services → utils → bootstrap）
- **数据库：** Redis（可选，会话存储，自动降级到内存）
- **部署：** Docker + docker-compose（端口 3001）

## 生成的文档

### 核心文档

- [项目总览](./project-overview.md) - 概要、技术栈、核心功能、快速开始
- [源码目录结构分析](./source-tree-analysis.md) - 完整目录树、关键目录说明、文件组织模式
- [详细技术架构](./architecture-detail.md) - 分层架构、请求生命周期、依赖注入、鉴权、会话、预算系统
- [组件清单](./component-inventory.md) - 所有服务/中间件/工具函数的完整 API 文档
- [开发指南](./development-guide.md) - 环境搭建、测试、调试、开发约定
- [API 契约](./api-contracts.md) - 端点详情、请求/响应格式、错误码
- [数据模型](./data-models.md) - 会话 Schema、配置对象、上游格式
- [部署指南](./deployment-guide.md) - Docker 部署、环境变量、健康检查、灰度发布

### 已有文档

- [架构与职责边界](./architecture.md) - 系统组件职责划分
- [OpenAPI 规范](./openapi.yaml) - OpenAPI 3.0 完整 API 规范
- [发布门禁](./release-gate.md) - 发布回归测试策略
- [会话管理](./session.md) - 会话设计详情
- [工具/MCP/Skills](./tools-mcp-skills.md) - 工具调用与 MCP 兼容性

## 快速开始

### 前置条件

- Node.js >= 20
- npm
- Redis（可选）
- Docker（可选）

### 搭建

```bash
git clone <repo-url> && cd mix2api
npm install
cp .env.example .env
# 编辑 .env，至少设置 UPSTREAM_API_BASE
```

### 启动

```bash
npm start
# http://localhost:3001
```

### 测试

```bash
npm test                    # 全量测试
npm run test:pack:a         # Pack A — stream 基线
npm run test:pack:b         # Pack B — tools
npm run test:pack:c         # Pack C — 错误处理
npm run release:gate        # 发布门禁
```

## AI 辅助开发参考

本文档专为 AI Agent 理解和扩展本代码库而生成。

### 规划新功能时：

**API/后端功能：**
→ 参考：`architecture-detail.md`、`api-contracts.md`、`data-models.md`、`component-inventory.md`

**会话/鉴权相关：**
→ 参考：`architecture-detail.md`（鉴权架构 + 会话管理章节）、`session.md`

**工具调用相关：**
→ 参考：`tools-mcp-skills.md`、`component-inventory.md`（tool-response / tool-calls 章节）

**部署变更：**
→ 参考：`deployment-guide.md`

**添加新服务/中间件：**
→ 参考：`development-guide.md`（新增功能开发指引章节）

---

_文档由 BMAD Method `document-project` 工作流生成_

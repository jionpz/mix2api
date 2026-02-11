# Story 1.2: 入站鉴权与非流式 Chat Completions 入口

Status: done

## Story

As a AI 工程师,  
I want 在受控鉴权下使用 `/v1/chat/completions` 发送请求并得到兼容响应,  
so that IDE/SDK 可以安全接入并稳定调用基础能力.

## Acceptance Criteria

1. **Given** 合法的 Chat Completions 请求（`model` 与 `messages`）  
   **When** 调用 `POST /v1/chat/completions` 且 `stream=false`  
   **Then** 返回 OpenAI 兼容的非流式响应结构  
   **And** 响应字段满足客户端解析要求
2. **Given** 未授权或鉴权信息错误的请求  
   **When** 调用 `POST /v1/chat/completions`  
   **Then** 返回未授权错误且中断业务处理  
   **And** 错误响应保持兼容 envelope 结构
3. **Given** 非法请求（如 `messages` 为空）  
   **When** 调用端点  
   **Then** 返回 OpenAI 兼容 error envelope  
   **And** HTTP status 与错误类型一致

## Tasks / Subtasks

- [x] 1. 入站鉴权策略收敛与拒绝路径实现（AC: #2）
  - [x] 将入站鉴权逻辑收敛到统一守卫（支持 `INBOUND_AUTH_MODE=bearer|none` 与静态 token 校验）
  - [x] 未授权请求立即返回 401 并中断业务处理（不得继续访问上游）
  - [x] 401 错误响应统一为 OpenAI 兼容 `error` envelope（含 `message/type/code/param`）
- [x] 2. 非流式 Chat Completions 成功响应契约（AC: #1）
  - [x] 对 `stream=false` 返回 `chat.completion` 响应结构（`id/object/created/model/choices`）
  - [x] 确保 `choices[0].message` 与 `finish_reason` 字段可被 OpenAI 客户端稳定解析
  - [x] 保持 `x-request-id` 透出，便于后续归因排障
- [x] 3. 非法请求校验与错误映射（AC: #3）
  - [x] 为 `model/messages` 增加基础入参校验（`messages` 非空数组、`model` 非空）
  - [x] 对校验失败返回 400 + OpenAI 兼容 `error` envelope
  - [x] 保证 HTTP status 与错误类型一致（400/401）
- [x] 4. 测试与回归覆盖（AC: #1 #2 #3）
  - [x] 新增集成测试：`stream=false` 的成功响应结构
  - [x] 新增集成测试：缺失/错误鉴权返回 401 且 envelope 兼容
  - [x] 新增集成测试：非法请求返回 400 且 envelope 兼容

## Dev Notes

### Architectural Guardrails

- 北向契约以 OpenAI Chat Completions 为准，MVP 核心端点是 `POST /v1/chat/completions`，非流式成功响应需保持 `chat.completion` 结构。  
  [Source: `_bmad-output/planning-artifacts/architecture.md#API & Communication Patterns`]
- 入站必须实施 service-to-service 鉴权并拒绝未授权请求；策略需可配置（启用/关闭/静态校验）。  
  [Source: `_bmad-output/planning-artifacts/prd.md#入站鉴权、上游访问与安全边界`]
- 错误响应需统一 OpenAI error envelope，并使用正确 HTTP status（本故事重点 400/401）。  
  [Source: `_bmad-output/planning-artifacts/prd.md#错误响应与归因（北向契约）`]

### Current Repo Reality Check (Do Not Reinvent Wheels)

- `server.js` 已存在 `/v1/chat/completions` 路由、基础鉴权分支与 `messages` 非空校验；本故事应优先做“契约收敛与补齐”，避免重复造轮子。  
  [Source: `server.js`]
- 当前错误响应多为 `{ error: { message } }`，需补齐 OpenAI 兼容字段（`type/code/param`）并统一映射。  
  [Source: `server.js`]
- 现有测试框架为 Node 内置 `node:test`，应沿用并扩展到鉴权/非流式/错误 envelope 场景。  
  [Source: `tests/integration/health.test.js`]

### Testing Requirements

- 覆盖 AC #1：`stream=false` 的成功响应结构可被客户端解析（关键字段断言）。  
- 覆盖 AC #2：鉴权缺失或错误时返回 401，且 body 为兼容 error envelope。  
- 覆盖 AC #3：非法请求返回 400，且 body 为兼容 error envelope。  
- 回归要求：不得破坏现有 `GET /health` 基线测试。  

### Project Structure Notes

- 短期允许继续在 `server.js` 完成功能闭环，避免为本故事引入大规模重构风险。  
- 长期目标按架构演进到 `src/` 分层与 `middleware/auth-guard.middleware.js`，本故事实现需保持可迁移边界清晰。  
  [Source: `_bmad-output/planning-artifacts/architecture.md#Project Structure & Boundaries`]

### References

- `_bmad-output/planning-artifacts/epics.md#Story 1.2: 入站鉴权与非流式 Chat Completions 入口`
- `_bmad-output/planning-artifacts/prd.md#Functional Requirements`
- `_bmad-output/planning-artifacts/prd.md#错误响应与归因（北向契约）`
- `_bmad-output/planning-artifacts/architecture.md#API & Communication Patterns`
- `server.js`
- `tests/integration/chat-completions-auth-nonstream.test.js`
- `tests/integration/health.test.js`

## Dev Agent Record

### Agent Model Used

GPT-5 (Codex)

### Debug Log References

- N/A

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created
- 新增 `sendOpenAIError` 统一错误输出，401/400 路径对齐 OpenAI error envelope（`message/type/code/param`）
- 增加基础入参校验：`model` 必须非空字符串，`messages` 必须非空数组
- 增加 JSON 解析错误统一处理：畸形 JSON 返回 400 + OpenAI 兼容 error envelope（不再返回 HTML 错页）
- 新增 Story 1.2 集成测试：非流式成功结构、未授权 401、错误 token 401、非法请求 400、畸形 JSON 400
- 执行 `npm test`，9/9 用例通过

### File List

- `server.js`
- `package.json`
- `tests/integration/chat-completions-auth-nonstream.test.js`
- `tests/integration/health.test.js`
- `_bmad-output/implementation-artifacts/1-2-入站鉴权与非流式-chat-completions-入口.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `_bmad-output/workflow-status.yaml`

### Change Log

- 2026-02-11: 实现 Story 1.2（入站鉴权与非流式入口）：统一 401/400 错误 envelope、补齐 `model/messages` 校验、新增 3 个集成测试并通过
- 2026-02-11: 修复 Code Review 高/中优先级问题：畸形 JSON 错误 envelope、错误鉴权测试覆盖、File List 与 git 变更对齐

## Senior Developer Review (AI)

### Review Date

2026-02-11

### Outcome

Approved after fixes (HIGH/MEDIUM resolved)

### Findings Resolved

- [HIGH] `application/json` 畸形请求不再返回 HTML 错页，已统一为 OpenAI 兼容 error envelope。
- [MEDIUM] 新增“错误鉴权”自动化测试（错误 Bearer token）。
- [MEDIUM] Story File List 已补齐与当前工作区变更的透明对齐记录。

### Verification

- `npm test` 通过

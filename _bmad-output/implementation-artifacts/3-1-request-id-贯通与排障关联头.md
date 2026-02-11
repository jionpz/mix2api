# Story 3.1: request_id 贯通与排障关联头

Status: review

## Story

As a 平台工程师,  
I want 为每个请求生成并贯通唯一 request_id,  
so that 客户端与服务端可以使用同一 ID 快速定位问题.

## Acceptance Criteria

1. **Given** 任意请求进入服务  
   **When** 请求未携带可用 request_id  
   **Then** 服务生成唯一 request_id  
   **And** 在响应头返回 `x-request-id`
2. **Given** 请求处理过程写入日志与指标  
   **When** 记录结构化字段  
   **Then** 均包含同一 request_id  
   **And** 能通过 request_id 检索完整链路事件

## Tasks / Subtasks

- [x] 1. request_id 入口与响应头贯通（AC: #1）
  - [x] 支持透传合法入站 `x-request-id`
  - [x] 对缺失/非法入站值生成新 request_id
  - [x] 确保响应头始终返回最终 request_id
- [x] 2. 日志贯通（AC: #2）
  - [x] 请求接收日志包含 request_id
  - [x] 请求完成日志包含 request_id / status / duration
  - [x] chat 主流程统一使用 `req.requestId`
- [x] 3. 自动化回归（AC: #1 #2）
  - [x] 新增集成测试：合法入站 request_id 透传到响应与上游
  - [x] 新增集成测试：非法入站 request_id 自动重建
  - [x] 新增日志断言：`request.received/request.completed` 同一 request_id
  - [x] 全量回归通过

## Dev Notes

### Architectural Guardrails

- 每请求需具备可关联 request_id，并在响应头返回 `x-request-id`。  
  [Source: `_bmad-output/planning-artifacts/epics.md#Story 3.1: request_id 贯通与排障关联头`]
- 排障日志需可通过 request_id 聚合检索。  
  [Source: `_bmad-output/planning-artifacts/architecture.md#Monitoring and Logging`]

### Current Repo Reality Check (Do Not Reinvent Wheels)

- 现有代码会注入 `x-request-id`，但未校验入站值合法性，也未统一请求生命周期日志格式。  
  [Source: `server.js`]
- 现有集成测试未覆盖 request_id 透传与重建行为。  
  [Source: `tests/integration/chat-completions-auth-nonstream.test.js`]

### Testing Requirements

- 覆盖合法入站 `x-request-id` 在响应与上游透传。
- 覆盖非法入站 `x-request-id` 自动重建。
- 覆盖日志含同一 request_id 的接收/完成事件。

### References

- `_bmad-output/planning-artifacts/epics.md#Story 3.1: request_id 贯通与排障关联头`
- `server.js`
- `tests/integration/chat-completions-auth-nonstream.test.js`

## Dev Agent Record

### Agent Model Used

GPT-5 (Codex)

### Debug Log References

- `node --test tests/integration/chat-completions-auth-nonstream.test.js`
- `npm test`

### Completion Notes List

- 新增 `normalizeRequestId` 校验逻辑，支持合法 ID 透传，非法值重建。
- 在请求入口统一设置 `req.requestId`/`x-request-id`，并贯通到 chat 流程和上游请求头。
- 新增请求生命周期日志：`request.received` 与 `request.completed`，统一包含 request_id。
- 补齐 request_id 透传、重建与日志关联的集成测试。

### File List

- `server.js`
- `tests/integration/chat-completions-auth-nonstream.test.js`
- `_bmad-output/implementation-artifacts/3-1-request-id-贯通与排障关联头.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `_bmad-output/workflow-status.yaml`

### Change Log

- 2026-02-11: 实现 Story 3.1（request_id 贯通与排障关联头）：补齐 request_id 透传/重建、生命周期日志与回归测试。

# Story 3.3: 流式终止分型与 end_reason 归因

Status: review

## Story

As a 平台工程师,  
I want 将流式中断统一分型为稳定 end_reason,  
so that 可以区分 `client_abort` 与系统问题并支持回滚决策.

## Acceptance Criteria

1. **Given** 客户端主动断连  
   **When** 服务检测连接关闭  
   **Then** 归因为 `client_abort` 并释放资源  
   **And** 不计入失败口径
2. **Given** 上游超时、上游错误或适配异常  
   **When** 流式处理终止  
   **Then** 归因为对应 `end_reason`（如 `timeout`/`upstream_error`/`adapter_error`）  
   **And** 写入可聚合观测字段

## Tasks / Subtasks

- [x] 1. `end_reason` 分类落地（AC: #1 #2）
  - [x] 请求上下文新增 `endReason`/`upstreamStatus` 字段
  - [x] 统一分类并设置 `end_reason`：`client_abort`/`timeout`/`upstream_error`/`adapter_error`/`stop`
  - [x] 流式桥接新增 `client_abort` 检测与上游 reader 资源释放
- [x] 2. 观测日志与关联（AC: #2）
  - [x] `request.completed` 日志追加 `end_reason` 与 `upstream_status`
  - [x] 流式终止时输出 `stream.terminated end_reason=...` 事件
- [x] 3. 自动化回归（AC: #1 #2）
  - [x] 新增流式 timeout 分类用例
  - [x] 新增流式 upstream error 分类用例
  - [x] 新增流式 client abort 分类用例
  - [x] 全量回归通过

## Dev Notes

### Architectural Guardrails

- 流式异常终止需稳定分型，支持回滚判定与排障。  
  [Source: `_bmad-output/planning-artifacts/epics.md#Story 3.3: 流式终止分型与 end_reason 归因`]
- 归因字段需与 request_id 关联并可聚合。  
  [Source: `_bmad-output/planning-artifacts/architecture.md#Monitoring and Logging`]

### Current Repo Reality Check (Do Not Reinvent Wheels)

- 现有实现已有 SSE 转发与错误 envelope，但缺少统一 `end_reason` 分型与日志字段。  
  [Source: `server.js`]
- 现有测试覆盖 stream 成功路径，未覆盖 `client_abort/timeout/upstream_error` 分型。  
  [Source: `tests/integration/chat-completions-auth-nonstream.test.js`]

### Testing Requirements

- 覆盖流式 timeout 场景的 `end_reason=timeout`。
- 覆盖上游错误场景的 `end_reason=upstream_error`。
- 覆盖客户端主动断流场景的 `end_reason=client_abort`。
- 回归通过且不破坏现有兼容语义。

### References

- `_bmad-output/planning-artifacts/epics.md#Story 3.3: 流式终止分型与 end_reason 归因`
- `server.js`
- `tests/integration/chat-completions-auth-nonstream.test.js`

## Dev Agent Record

### Agent Model Used

GPT-5 (Codex)

### Debug Log References

- `node --test tests/integration/chat-completions-auth-nonstream.test.js`
- `npm test`

### Completion Notes List

- 请求中间件新增 `endReason/upstreamStatus` 上下文并写入 `request.completed` 结构化日志。
- 流式桥接新增 `client_abort` 检测：客户端断开时标记分型并销毁上游 reader 释放资源。
- 为 upstream HTTP 错误、timeout、adapter 错误路径补齐 `end_reason` 赋值。
- 新增 3 条集成测试验证 `timeout/upstream_error/client_abort` 分型日志输出。

### File List

- `server.js`
- `tests/integration/chat-completions-auth-nonstream.test.js`
- `_bmad-output/implementation-artifacts/3-3-流式终止分型与-end-reason-归因.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `_bmad-output/workflow-status.yaml`

### Change Log

- 2026-02-11: 实现 Story 3.3（流式终止分型与 end_reason 归因）：统一 end_reason 分型并补齐流式终止归因回归测试。

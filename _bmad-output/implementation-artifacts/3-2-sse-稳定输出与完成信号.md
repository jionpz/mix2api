# Story 3.2: SSE 稳定输出与完成信号

Status: done

## Story

As a AI 工程师,  
I want 在 `stream=true` 时获得稳定的 SSE 增量输出,  
so that IDE 端不会出现卡住、半截断或无完成信号.

## Acceptance Criteria

1. **Given** `stream=true` 的合法请求  
   **When** 上游持续返回增量内容  
   **Then** 服务以 `text/event-stream` 实时转发 chunk  
   **And** 每个 chunk 保持可消费格式
2. **Given** 请求正常完成  
   **When** 流式输出结束  
   **Then** 服务发送 `data: [DONE]` 完成信号  
   **And** 连接按预期关闭

## Tasks / Subtasks

- [x] 1. SSE 直通桥接稳定化（AC: #1 #2）
  - [x] 优化无 `sessionId` 场景下的首包发送策略，避免首 chunk 被缓冲到流结束
  - [x] 保持 `chat.completion.chunk` 输出格式与 `text/event-stream` 语义
  - [x] 保持 `[DONE]` 结束信号与连接关闭行为
- [x] 2. 自动化回归增强（AC: #1 #2）
  - [x] 新增集成测试验证“无 session metadata 时首 chunk 先于流结束到达”
  - [x] 保持既有 DONE/顺序回归用例通过
  - [x] 全量回归通过

## Dev Notes

### Architectural Guardrails

- `stream=true` 需提供可实时消费的 SSE 增量输出，结束时发送 `[DONE]`。  
  [Source: `_bmad-output/planning-artifacts/epics.md#Story 3.2: SSE 稳定输出与完成信号`]
- SSE 语义优先，避免因会话元信息缺失导致流式卡顿。  
  [Source: `_bmad-output/planning-artifacts/architecture.md#API & Communication Patterns`]

### Current Repo Reality Check (Do Not Reinvent Wheels)

- 当前桥接逻辑为设置 `x-session-id` 会短暂缓存首批 chunk；无 session metadata 时可能退化为“接近尾部才输出”。  
  [Source: `server.js`]
- 既有测试覆盖 DONE 与 chunk 顺序，但未验证“首包实时性”。  
  [Source: `tests/integration/chat-completions-auth-nonstream.test.js`]

### Testing Requirements

- 覆盖无 session metadata 时首包在流结束前送达。
- 覆盖 DONE 仍按预期出现且连接关闭。
- 全量测试回归通过。

### References

- `_bmad-output/planning-artifacts/epics.md#Story 3.2: SSE 稳定输出与完成信号`
- `server.js`
- `tests/integration/chat-completions-auth-nonstream.test.js`

## Dev Agent Record

### Agent Model Used

GPT-5 (Codex)

### Debug Log References

- `node --test tests/integration/chat-completions-auth-nonstream.test.js`
- `npm test`

### Completion Notes List

- 调整 SSE 桥接缓存策略：在无 session metadata 情况下，首个可发送 chunk 到达后立即 flush，避免首包延迟到流尾。
- 保持已存在的 `[DONE]` 发送逻辑，确保完成信号仅在流结束阶段输出。
- 新增“首包实时性”集成测试，使用上游延迟场景验证 chunk 实时送达。
- 所有回归测试通过。

### File List

- `server.js`
- `tests/integration/chat-completions-auth-nonstream.test.js`
- `_bmad-output/implementation-artifacts/3-2-sse-稳定输出与完成信号.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `_bmad-output/workflow-status.yaml`

### Change Log

- 2026-02-11: 实现 Story 3.2（SSE 稳定输出与完成信号）：修复无 session metadata 场景下首包延迟问题并补齐实时性回归测试。
- 2026-02-11: 完成 Story 3.2 代码审查并通过，状态由 review 更新为 done。

## Senior Developer Review (AI)

### Review Date

2026-02-11

### Outcome

Approved (no blocking findings)

### Findings

- [LOW] 建议后续增加上游异常断流（`reader.on('error')`）下的端到端断流分型断言，为 Story 3.3 做前置保障。

### Verification

- `npm test` 通过（26 passed, 2 skipped）

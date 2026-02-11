# Story 4.2: tool_calls 输出与 tool_call_id 一致性

Status: done

## Story

As a AI 工程师,  
I want 在 assistant 响应中获得稳定的 `tool_calls` 与 `tool_call_id`,  
so that 客户端可以精确执行并回填工具结果.

## Acceptance Criteria

1. **Given** 模型决定调用工具  
   **When** 服务返回 assistant 消息  
   **Then** 输出 OpenAI 兼容 `assistant.tool_calls[]`  
   **And** 每个调用包含可关联的 `tool_call_id`
2. **Given** 同一轮存在多个工具调用  
   **When** 生成输出  
   **Then** `tool_call_id` 唯一且可追踪  
   **And** 顺序与语义不冲突

## Tasks / Subtasks

- [x] 1. `tool_call_id` 归一化与唯一性保障（AC: #1 #2）
  - [x] 新增 `tool_call_id` 归一化函数（兼容上游已有 id）
  - [x] 新增冲突去重逻辑，保证同一轮多调用唯一
  - [x] 无 id 场景自动生成稳定可用 id
- [x] 2. 输出链路一致性（AC: #1 #2）
  - [x] 流式 `tool_calls` chunk 输出统一使用归一化 id
  - [x] 非流式 `assistant.tool_calls[]` 输出统一使用归一化 id
  - [x] 保持调用顺序不变
- [x] 3. 自动化回归（AC: #1 #2）
  - [x] 新增非流式多工具调用 id 唯一性断言
  - [x] 新增流式上游 id 冲突场景断言（保留/去重）
  - [x] 全量回归通过

## Dev Notes

### Architectural Guardrails

- 工具调用链需输出 OpenAI 兼容 `tool_calls`，并保持 `tool_call_id` 可追踪。  
  [Source: `_bmad-output/planning-artifacts/epics.md#Story 4.2: tool_calls 输出与 tool_call_id 一致性`]
- `tool_call_id` 关联建议集中维护，避免多处分散生成导致不一致。  
  [Source: `_bmad-output/planning-artifacts/architecture.md#Architecture Guardrails`]

### Current Repo Reality Check (Do Not Reinvent Wheels)

- 现有 `tool_calls` 输出会在不同路径直接生成随机 id，缺少统一归一化与冲突处理。  
  [Source: `server.js`]
- 现有测试缺少“多工具调用 + id 冲突”覆盖。  
  [Source: `tests/integration/chat-completions-auth-nonstream.test.js`]

### Testing Requirements

- 验证非流式多工具调用时 `tool_call_id` 唯一且顺序正确。
- 验证流式场景下上游冲突 id 会被去重，仍保持可追踪。
- 回归通过且不破坏现有 stream/non-stream 契约。

### References

- `_bmad-output/planning-artifacts/epics.md#Story 4.2: tool_calls 输出与 tool_call_id 一致性`
- `server.js`
- `tests/integration/chat-completions-auth-nonstream.test.js`

## Dev Agent Record

### Agent Model Used

GPT-5 (Codex)

### Debug Log References

- `node --test tests/integration/chat-completions-auth-nonstream.test.js`
- `npm test`

### Completion Notes List

- 新增 `tool_call_id` 归一化与冲突去重逻辑，覆盖无 id / 有 id / 重复 id 场景。
- 流式与非流式输出统一使用归一化后的 `tool_call_id`。
- 新增 2 条集成测试覆盖多工具调用唯一性与流式冲突 id 场景。

### File List

- `server.js`
- `tests/integration/chat-completions-auth-nonstream.test.js`
- `_bmad-output/implementation-artifacts/4-2-tool-calls-输出与-tool-call-id-一致性.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `_bmad-output/workflow-status.yaml`

### Change Log

- 2026-02-11: 实现 Story 4.2（tool_calls 输出与 tool_call_id 一致性）：统一 id 归一化与多调用去重策略并补齐回归测试。
- 2026-02-11: 完成 Story 4.2 代码审查并通过，状态由 review 更新为 done。

## Senior Developer Review (AI)

### Review Date

2026-02-11

### Outcome

Approved (no blocking findings)

### Findings

- [LOW] 当前 `tool_call_id` 生成策略在同一请求内稳定且可追踪；后续如要做到“跨重试/跨流段稳定”，建议把 id 绑定到规范化后的 `name+arguments` 哈希并加冲突盐。

### Verification

- `node --test` 通过（35 passed, 2 skipped）

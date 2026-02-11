# Story 4.3: tool 结果回填与继续生成闭环

Status: review

## Story

As a AI 工程师,  
I want 回填 `role=tool` 结果后模型继续生成最终答复,  
so that 工具链任务可以完整结束而非中途卡死.

## Acceptance Criteria

1. **Given** 已返回 `assistant.tool_calls` 且客户端回填 `tool` 消息  
   **When** 发起下一次请求  
   **Then** 服务正确关联 `tool_call_id` 并继续生成  
   **And** 不出现提前 stop 或状态错乱
2. **Given** 回填缺失或不匹配的 `tool_call_id`  
   **When** 服务校验消息链  
   **Then** 返回兼容错误响应  
   **And** 给出可定位的问题类别

## Tasks / Subtasks

- [x] 1. tool backfill 链路校验（AC: #2）
  - [x] 校验末尾 tool 消息必须紧跟 `assistant(tool_calls)`
  - [x] 校验 `tool_call_id` 必填且可在上一条 `assistant.tool_calls[]` 中找到
  - [x] 校验同一轮 tool 回填不允许重复 `tool_call_id`
- [x] 2. 继续生成闭环验证（AC: #1）
  - [x] 工具回填后请求正常继续转发并返回最终 assistant 内容
  - [x] 保持与现有 tools 模式兼容（不破坏非流式/流式行为）
- [x] 3. 自动化回归（AC: #1 #2）
  - [x] 新增 tool loop 集成测试：tool_calls -> tool backfill -> final answer
  - [x] 新增非法回填测试：tool_call_id mismatch 返回 400 兼容错误
  - [x] 回归通过

## Dev Notes

### Architectural Guardrails

- Tool loop 必须保持 `assistant(tool_calls) -> tool -> assistant(final)` 状态机一致。  
  [Source: `_bmad-output/planning-artifacts/architecture.md#Tool loop 状态机一致性`]
- 回填缺失/不匹配应返回可定位类别的兼容错误 envelope。  
  [Source: `_bmad-output/planning-artifacts/epics.md#Story 4.3: tool 结果回填与继续生成闭环`]

### Current Repo Reality Check (Do Not Reinvent Wheels)

- 现有实现已支持将 tool 结果拼接进 query 继续生成，但缺少对回填链路的严格校验。  
  [Source: `server.js`]
- 缺少 tool loop 的端到端集成测试覆盖。  
  [Source: `tests/integration/chat-completions-auth-nonstream.test.js`]

### Testing Requirements

- 覆盖闭环：第一次返回 `tool_calls`，第二次回填 tool 结果后返回最终答复。
- 覆盖非法回填：tool_call_id 不匹配时返回 400 兼容错误，并且不上游转发。

### References

- `_bmad-output/planning-artifacts/epics.md#Story 4.3: tool 结果回填与继续生成闭环`
- `server.js`
- `tests/integration/chat-completions-auth-nonstream.test.js`

## Dev Agent Record

### Agent Model Used

GPT-5 (Codex)

### Debug Log References

- `node --test tests/integration/chat-completions-auth-nonstream.test.js`

### Completion Notes List

- 新增 tool 回填链路校验：缺失/不匹配/重复 `tool_call_id` 直接返回 400。
- 新增 tool loop 集成回归：验证回填后继续生成并返回最终内容。

### File List

- `server.js`
- `tests/integration/chat-completions-auth-nonstream.test.js`
- `_bmad-output/implementation-artifacts/4-3-tool-结果回填与继续生成闭环.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `_bmad-output/workflow-status.yaml`

### Change Log

- 2026-02-11: 实现 Story 4.3（tool 结果回填与继续生成闭环）：补齐回填校验并新增 tool loop 集成回归。

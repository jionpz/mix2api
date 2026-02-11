# Story 4.1: tools 与 legacy functions 入参兼容

Status: done

## Story

As a AI 工程师,  
I want 同时提交 `tools` 与 legacy `functions/function_call` 格式,  
so that 现有不同客户端都可无缝接入.

## Acceptance Criteria

1. **Given** 请求使用 `tools` 格式  
   **When** 服务解析入参  
   **Then** 正确映射到内部调用模型  
   **And** 不丢失工具 schema 关键字段
2. **Given** 请求使用 legacy `functions/function_call`  
   **When** 服务解析入参  
   **Then** 转换为兼容内部结构  
   **And** 与 `tools` 流程行为一致

## Tasks / Subtasks

- [x] 1. 请求归一化兼容层（AC: #1 #2）
  - [x] 新增 `functions[] -> tools[]` 归一化逻辑
  - [x] 新增 `function_call -> tool_choice` 映射逻辑
  - [x] 保持 `tools/tool_choice` 现有优先级行为不变
- [x] 2. 主流程统一消费规范结构（AC: #1 #2）
  - [x] chat 主流程改为消费归一化后的请求对象
  - [x] 工具存在判定与下游透传统一使用 `tools`
  - [x] legacy 输入与 tools 输入走同一路径
- [x] 3. 自动化回归（AC: #1 #2）
  - [x] 新增 tools 场景测试，断言关键 schema 字段保留
  - [x] 新增 legacy functions/function_call 场景测试，断言兼容映射结果
  - [x] 全量回归通过

## Dev Notes

### Architectural Guardrails

- 工具兼容范围需覆盖 `tools` 与 legacy `functions/function_call`，并保持 OpenAI Chat Completions 语义。  
  [Source: `_bmad-output/planning-artifacts/epics.md#Story 4.1: tools 与 legacy functions 入参兼容`]
- 工具链路需遵循 MCP-safe 边界，服务端仅做协议映射与转发。  
  [Source: `_bmad-output/planning-artifacts/architecture.md#MVP 边界和延后项`]

### Current Repo Reality Check (Do Not Reinvent Wheels)

- 现有工具主流程依赖 `openaiRequest.tools`，legacy `functions/function_call` 缺少统一归一化入口。  
  [Source: `server.js`]
- 现有集成测试缺少 legacy 入参兼容断言。  
  [Source: `tests/integration/chat-completions-auth-nonstream.test.js`]

### Testing Requirements

- 验证 `tools` 入参下关键 schema 字段不丢失。
- 验证 `functions/function_call` 能映射为统一内部结构并复用工具流程。
- 回归通过且不破坏现有 stream/non-stream 行为。

### References

- `_bmad-output/planning-artifacts/epics.md#Story 4.1: tools 与 legacy functions 入参兼容`
- `server.js`
- `tests/integration/chat-completions-auth-nonstream.test.js`

## Dev Agent Record

### Agent Model Used

GPT-5 (Codex)

### Debug Log References

- `node --test tests/integration/chat-completions-auth-nonstream.test.js`
- `npm test`

### Completion Notes List

- 新增请求工具兼容归一化：`functions[] -> tools[]` 与 `function_call -> tool_choice`。
- chat 主流程统一消费归一化结构，legacy 与 tools 走同一工具路径。
- 新增 2 条集成测试覆盖 schema 保留和 legacy 映射行为。

### File List

- `server.js`
- `tests/integration/chat-completions-auth-nonstream.test.js`
- `_bmad-output/implementation-artifacts/4-1-tools-与-legacy-functions-入参兼容.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `_bmad-output/workflow-status.yaml`

### Change Log

- 2026-02-11: 实现 Story 4.1（tools 与 legacy functions 入参兼容）：新增入参归一化兼容层并补齐回归测试。
- 2026-02-11: 完成 Story 4.1 代码审查并通过，状态由 review 更新为 done。

## Senior Developer Review (AI)

### Review Date

2026-02-11

### Outcome

Approved (no blocking findings)

### Findings

- [LOW] 建议后续在入参校验层增加 `functions/tool_choice` 枚举与 schema 约束，尽量把异常输入拦在更早阶段。

### Verification

- `npm test` 通过（33 passed, 2 skipped）

# Story 4.4: MCP-safe 透传与服务端执行隔离

Status: review

## Story

As a 平台工程师,  
I want 保证 MCP 相关工具形态透传兼容且不在服务端执行,  
so that MVP 边界清晰并避免越权执行风险.

## Acceptance Criteria

1. **Given** 请求包含 MCP 相关工具定义  
   **When** 服务处理请求与响应映射  
   **Then** 工具形态保持兼容透传  
   **And** 不改写关键协议字段语义
2. **Given** 运行期收到工具执行请求上下文  
   **When** 服务进入适配流程  
   **Then** 不触发服务端 MCP 执行  
   **And** 仅执行协议映射与转发职责

## Tasks / Subtasks

- [x] 1. MCP-safe 防守性处理（AC: #1 #2）
  - [x] 避免将 `type!="function"` 的 tools（如 `type:"mcp"`）误归一化为 function
  - [x] tool_calls 校验过滤仅认可 function tools，非 function 工具不允许落到客户端 tool_calls
  - [x] 保持现有“不执行服务端 MCP/skills”边界不变
- [x] 2. 自动化回归（AC: #1 #2）
  - [x] 新增集成测试：当请求仅包含 `type:"mcp"` tools 时，上游 tool_calls 会被过滤并走 final fallback
  - [x] 回归通过

## Dev Notes

### Architectural Guardrails

- MVP 阶段不执行 MCP 工具，仅保证工具协议不被破坏（MCP-safe）。  
  [Source: `docs/tools-mcp-skills.md`]
- 仅 function tools 进入 tool schema/选择/校验链路，避免把 MCP 描述符误当 function。  
  [Source: `server.js`]

### Current Repo Reality Check (Do Not Reinvent Wheels)

- 现有实现会忽略非 function tools，但入参归一化与 tool_calls 过滤需要更严格的 MCP-safe 约束。  
  [Source: `server.js`]

### Testing Requirements

- 覆盖非 function tools（type="mcp"）输入场景，确保不会输出 tool_calls 或触发执行。

### References

- `_bmad-output/planning-artifacts/epics.md#Story 4.4: MCP-safe 透传与服务端执行隔离`
- `docs/tools-mcp-skills.md`
- `server.js`
- `tests/integration/chat-completions-auth-nonstream.test.js`

## Dev Agent Record

### Agent Model Used

GPT-5 (Codex)

### Debug Log References

- `node --test tests/integration/chat-completions-auth-nonstream.test.js`

### Completion Notes List

- 修复入参归一化：不再把 `type:"mcp"` tools 误映射为 function tools。
- 修复 tool_calls 过滤：仅 function tools 进入 valid tool 名单；无可用 function tools 时过滤所有 tool_calls 并走 final fallback。
- 新增 MCP-safe 集成回归用例，验证不会输出工具调用或触发执行。

### File List

- `server.js`
- `tests/integration/chat-completions-auth-nonstream.test.js`
- `_bmad-output/implementation-artifacts/4-4-mcp-safe-透传与服务端执行隔离.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `_bmad-output/workflow-status.yaml`

### Change Log

- 2026-02-11: 实现 Story 4.4（MCP-safe 透传与服务端执行隔离）：加强非 function tools 的防守性处理与回归覆盖。

# Story 3.4: 按 client×stream×tools 维度的指标统计

Status: done

## Story

As a 平台工程师,  
I want 生成固定维度的分型指标,  
so that 可以对 OpenCode/Claude Code 分别验收并触发灰度决策.

## Acceptance Criteria

1. **Given** 请求完成（成功或失败）  
   **When** 记录指标事件  
   **Then** 至少包含 `client`、`stream`、`tools_present`、`end_reason`、`http_status`、`upstream_status`  
   **And** 字段命名与枚举保持稳定
2. **Given** 需要查看流式故障趋势  
   **When** 按 `client` 与 `stream` 聚合  
   **Then** 可定位断流或失败类别  
   **And** 支持 rollout/rollback 判定

## Tasks / Subtasks

- [x] 1. 观测字段固定化（AC: #1）
  - [x] 请求上下文新增 `client/stream/toolsPresent` 默认值
  - [x] `request.completed` 日志统一输出 `client/stream/tools_present/end_reason/http_status/upstream_status`
  - [x] chat 主流程填充维度字段（含 legacy `functions` 判定为 tools_present）
- [x] 2. 聚合可用性保障（AC: #2）
  - [x] 保持字段命名稳定，避免同义字段并存
  - [x] 成功/失败路径都输出完整维度
- [x] 3. 自动化回归（AC: #1 #2）
  - [x] 新增成功路径维度日志断言（含 tools_present=true）
  - [x] 新增上游错误路径维度日志断言（含 tools_present=false）
  - [x] 全量回归通过

## Dev Notes

### Architectural Guardrails

- 指标分型字段需固定为 `client/stream/tools_present/end_reason/http_status/upstream_status`。  
  [Source: `_bmad-output/planning-artifacts/epics.md#Story 3.4: 按 client×stream×tools 维度的指标统计`]
- request_id 与归因字段需可用于检索和聚合。  
  [Source: `_bmad-output/planning-artifacts/architecture.md#Monitoring and Logging`]

### Current Repo Reality Check (Do Not Reinvent Wheels)

- 现有日志已有 request_id 与 status，但维度字段不完整，不满足固定分型口径。  
  [Source: `server.js`]
- 缺少对维度字段稳定输出的自动化断言。  
  [Source: `tests/integration/chat-completions-auth-nonstream.test.js`]

### Testing Requirements

- 验证成功路径日志输出完整固定维度。
- 验证失败路径日志输出完整固定维度。
- 回归通过且不破坏现有契约行为。

### References

- `_bmad-output/planning-artifacts/epics.md#Story 3.4: 按 client×stream×tools 维度的指标统计`
- `server.js`
- `tests/integration/chat-completions-auth-nonstream.test.js`

## Dev Agent Record

### Agent Model Used

GPT-5 (Codex)

### Debug Log References

- `node --test tests/integration/chat-completions-auth-nonstream.test.js`
- `npm test`

### Completion Notes List

- 统一 `request.completed` 输出字段：`client/stream/tools_present/end_reason/http_status/upstream_status`。
- 在请求入口和 chat 主流程补齐维度字段赋值，确保成功/失败路径一致。
- `tools_present` 同时兼容 `tools` 与 legacy `functions`。
- 新增 2 条集成测试验证维度日志稳定输出。

### File List

- `server.js`
- `tests/integration/chat-completions-auth-nonstream.test.js`
- `_bmad-output/implementation-artifacts/3-4-按-client-stream-tools-维度的指标统计.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `_bmad-output/workflow-status.yaml`

### Change Log

- 2026-02-11: 实现 Story 3.4（按 client×stream×tools 维度的指标统计）：固定请求完成日志维度并补齐回归测试。
- 2026-02-11: 完成 Story 3.4 代码审查并通过，状态由 review 更新为 done。

## Senior Developer Review (AI)

### Review Date

2026-02-11

### Outcome

Approved (no blocking findings)

### Findings

- [LOW] 建议后续在观测平台增加 `client/stream/tools_present` 的枚举约束看板，提前发现异常维度值。

### Verification

- `npm test` 通过（31 passed, 2 skipped）

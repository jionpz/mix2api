# Story 2.2: 上游 token 生命周期管理

Status: review

## Story

As a 平台工程师,  
I want 统一管理上游 token 的获取、续期与失效恢复,  
so that 上游调用稳定且无需客户端承担登录态复杂度.

## Acceptance Criteria

1. **Given** 当前无可用上游 token  
   **When** 发起需要上游调用的请求  
   **Then** 服务自动获取可用 token  
   **And** 成功后继续处理请求
2. **Given** 上游返回 token 失效相关错误  
   **When** 服务检测到失效  
   **Then** 触发续期或重登流程并重试  
   **And** 敏感 token 不以明文写入日志

## Tasks / Subtasks

- [x] 1. 增加上游 managed token 生命周期管理（AC: #1 #2）
  - [x] 新增 `UPSTREAM_AUTH_MODE=managed` 模式
  - [x] 新增 token 拉取配置（URL/Path/Method/Headers/Body/字段映射/超时）
  - [x] 新增内存态 token 缓存与过期前刷新窗口
  - [x] 新增并发刷新保护（共享 refresh promise）
- [x] 2. 鉴权失效恢复与重试（AC: #2）
  - [x] 当上游返回 401/403 或 token 失效错误时触发 token 清理与强制刷新
  - [x] 在恢复后自动重试上游请求（默认 1 次）
  - [x] 失败路径保持 OpenAI 兼容 error envelope
- [x] 3. 敏感信息保护与回归测试（AC: #2）
  - [x] 新增日志敏感字段脱敏（Bearer / token 字段）
  - [x] 新增集成测试：无 token 自动获取
  - [x] 新增集成测试：鉴权失效后刷新并重试
  - [x] 新增集成测试：日志不输出 token 明文

## Dev Notes

### Architectural Guardrails

- 上游鉴权由 mix2api 管理 token 生命周期（获取/续期/失败重登），避免外溢给客户端。  
  [Source: `_bmad-output/planning-artifacts/prd.md#Auth Model`]
- 敏感信息不得以明文出现在日志、响应体或指标中。  
  [Source: `_bmad-output/planning-artifacts/prd.md#Functional Requirements`]
- Story 2.2 的验收重点是“自动获取 + 失效恢复 + 脱敏”。  
  [Source: `_bmad-output/planning-artifacts/epics.md#Story 2.2: 上游 token 生命周期管理`]

### Current Repo Reality Check (Do Not Reinvent Wheels)

- 当前代码已支持 `pass_through/static/none` 三种上游鉴权模式，缺失 managed 生命周期。  
  [Source: `server.js`]
- 现有集成测试未覆盖上游 token 失效恢复路径。  
  [Source: `tests/integration/chat-completions-auth-nonstream.test.js`]

### Testing Requirements

- 覆盖 managed 模式下的首次自动取 token。
- 覆盖 token 失效后刷新并重试上游请求。
- 覆盖日志中不出现 token 明文。
- 全量回归通过。

### References

- `_bmad-output/planning-artifacts/epics.md#Story 2.2: 上游 token 生命周期管理`
- `_bmad-output/planning-artifacts/prd.md#Auth Model`
- `server.js`
- `tests/integration/chat-completions-auth-nonstream.test.js`

## Dev Agent Record

### Agent Model Used

GPT-5 (Codex)

### Debug Log References

- `node --test tests/integration/chat-completions-auth-nonstream.test.js`
- `npm test`

### Completion Notes List

- 新增 `UPSTREAM_AUTH_MODE=managed`：支持自动获取并缓存上游 token。
- 新增 token 配置项：`UPSTREAM_TOKEN_URL/PATH/METHOD/HEADERS_JSON/BODY_JSON/FIELD/EXPIRES_IN_FIELD/TIMEOUT_MS/EXPIRY_SKEW_MS`。
- 新增鉴权恢复逻辑：遇到 401/403 或 token 失效错误时，清理缓存、刷新 token 并自动重试一次。
- 新增 `redactSensitiveText`，避免日志输出 Bearer/token 明文。
- 新增两条集成测试，覆盖自动获取与失效恢复路径，并断言日志不泄露 token。

### File List

- `server.js`
- `tests/integration/chat-completions-auth-nonstream.test.js`
- `.env.example`
- `README.md`
- `_bmad-output/implementation-artifacts/2-2-上游-token-生命周期管理.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `_bmad-output/workflow-status.yaml`

### Change Log

- 2026-02-11: 实现 Story 2.2（上游 token 生命周期管理）：新增 managed 鉴权模式、token 失效恢复重试与日志脱敏，并补齐集成回归测试。

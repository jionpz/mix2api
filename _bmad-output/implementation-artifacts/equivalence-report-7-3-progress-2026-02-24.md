# Stage Equivalence Report - Story 7.3 (Progress)

Date: 2026-02-24
Story: 7-3-会话与上游交互服务抽离
Status: in-progress

## Scope Completed

- Added upstream token interaction service
  - `services/upstream-token.js`
- Added upstream request service
  - `services/upstream-request.js`
- Added upstream stream bridge service
  - `services/upstream-stream.js`
- Added upstream read service
  - `services/upstream-read.js`
- Added tool response service
  - `services/tool-response.js`
- Added OpenAI response rendering service
  - `services/openai-response.js`
- Added session-key service
  - `services/session-key.js`
- Added session-store service
  - `services/session-store.js`
- Server integration
  - `server.js` now delegates managed-token lifecycle and auth-recovery decisions to `createManagedUpstreamTokenService(...)`
  - `server.js` now delegates upstream fetch retry/auth-recovery flow to `createUpstreamRequestService(...)`
  - `server.js` now delegates direct SSE bridge handling to `startUpstreamStreamBridge(...)`
  - `server.js` now delegates non-stream JSON read and SSE-to-text read to `createUpstreamReadService(...)`
  - `server.js` now delegates tool-call parsing/fallback decision to `createToolResponseService(...)`
  - `server.js` now delegates stream/non-stream response envelope rendering to `createOpenAIResponseService(...)`
  - `server.js` now delegates session-key generation to `createSessionKeyService(...)`
  - `server.js` now delegates session read/write/clear and redis init to `createSessionStoreService(...)`
  - Preserved existing behavior for:
    - managed token fetch and caching
    - token refresh on upstream auth errors
    - retry path after token recovery
    - upstream 5xx retry and timeout/retry backoff behavior
    - stream chunk forwarding, DONE emission, stream end_reason attribution
    - non-stream upstream JSON error extraction and session id extraction
    - tool_call parse/filter/fallback decision and text fallback safety
    - tool_calls/text OpenAI envelope rendering with consistent finish_reason and session_id
    - session key composition and client inference
    - session schema guard and memory fallback path

## Validation Executed

```bash
node --test tests/unit/services-upstream-token.test.js tests/unit/middleware-register-core-middlewares.test.js tests/unit/routes-register-core-routes.test.js tests/unit/utils-openai-error.test.js
node --test tests/unit/services-session-key.test.js tests/unit/services-session-store.test.js
node --test tests/unit/services-upstream-request.test.js
node --test tests/unit/services-upstream-stream.test.js
node --test tests/unit/services-upstream-read.test.js
node --test tests/unit/services-tool-response.test.js
node --test tests/unit/services-openai-response.test.js
node --test tests/integration/health.test.js
node --test --test-name-pattern "stream=false returns OpenAI compatible non-stream response|preserves inbound x-request-id and forwards it upstream|with managed auth fetches upstream token when cache is empty|with managed auth refreshes token and retries after auth failure" tests/integration/chat-completions-auth-nonstream.test.js
node --test --test-name-pattern "stream=true returns SSE chunks with DONE signal|stream=true keeps DONE after chunks when upstream has no session metadata|stream=true flushes first chunk before stream end when no session metadata" tests/integration/chat-completions-auth-nonstream.test.js
node --test --test-name-pattern "returns unique tool_call ids for multiple tool calls (non-stream)|parses loose tool_call protocol text from upstream" tests/integration/chat-completions-auth-nonstream.test.js
node --test --test-name-pattern "reuses session mapping across adapters when sharing redis|treats unknown schemaVersion in redis as miss and recreates session mapping" tests/integration/chat-completions-auth-nonstream.test.js
```

Result: all executed tests passed; redis-dependent tests skipped in current environment (redis-server unavailable).

## Recommendation

- Story `7-3` is ready to move to review based on the current extraction scope and passing validation set.

## Remaining

- Continue extracting session-store related functions into dedicated services.
- Run broader regression selection before moving 7-3 to review.

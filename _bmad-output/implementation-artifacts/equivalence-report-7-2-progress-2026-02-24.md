# Stage Equivalence Report - Story 7.2

Date: 2026-02-24
Story: 7-2-中间件与路由入口抽离
Status: review-ready

## Scope Completed

- Middleware extraction
  - `middleware/request-id.js`
  - `middleware/json-body-error.js`
  - `middleware/request-log.js`
- Route registration extraction
  - `routes/register-core-routes.js`
- Entry wiring in `server.js`
  - Replace inline middleware with factory-based middleware registration
  - Replace inline core route declarations with `registerCoreRoutes(...)`

## Additional Progress

- Added middleware bootstrap wiring module
  - `middleware/register-core-middlewares.js`
- Added shared OpenAI error envelope utility
  - `utils/openai-error.js`
- `server.js` now uses `registerCoreMiddlewares(...)` for middleware assembly

## Added Unit Tests

- `tests/unit/middleware-register-core-middlewares.test.js`
- `tests/unit/routes-register-core-routes.test.js`
- `tests/unit/utils-openai-error.test.js`

## Equivalence Checks Executed

```bash
node --test tests/integration/health.test.js
node --test tests/unit/config-env.test.js tests/unit/config-model-utils.test.js tests/unit/utils-common.test.js tests/unit/utils-text.test.js tests/unit/utils-json-text.test.js tests/unit/utils-tool-parser.test.js tests/unit/utils-tool-calls.test.js
node --test --test-name-pattern "stream=false returns OpenAI compatible non-stream response" tests/integration/chat-completions-auth-nonstream.test.js
node --test --test-name-pattern "POST / and /v1/chat/completions return equivalent non-stream success semantics|POST / keeps 401 auth error envelope semantics aligned with /v1/chat/completions|POST / keeps 400 validation error envelope semantics aligned with /v1/chat/completions|POST /v1/chat/completions with malformed JSON returns 400 OpenAI error envelope|POST /v1/chat/completions preserves inbound x-request-id and forwards it upstream|POST /v1/chat/completions request.completed logs fixed dimensions for success" tests/integration/chat-completions-auth-nonstream.test.js
```

Result: all passed.

## Conclusion

- Route and middleware entry wiring now complete for this story scope.
- Northbound route behavior and key middleware semantics remain equivalent in executed checks.
- Story is ready to move to review.

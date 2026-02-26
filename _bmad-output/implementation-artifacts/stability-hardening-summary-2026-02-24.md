# Stability Hardening Summary (2026-02-24)

## Scope

Post-Epic-7 hardening patch focused on runtime safety and protocol robustness.

## Delivered

1. Stream lifecycle hardening
   - Added timeout control into stream bridge and upstream SSE read path.
   - Unified timeout/client_abort/upstream_error termination semantics.

2. SSE parser hardening
   - Added reusable parser for framed SSE events (`services/sse-parser.js`).
   - Replaced line-split parsing in stream bridge and non-stream SSE reader.

3. Session store health signal
   - Added `getStoreHealth()` in session-store service.
   - Health route now reports `status=degraded` with `503` when Redis-expected mode is degraded.

4. Safer operational defaults
   - Default `UPSTREAM_AUTH_MODE` moved to `static`.
   - Default `SESSION_STORE_MODE` moved to `auto`.
   - `.env.example` aligned.

5. Contract/documentation alignment
   - OpenAPI includes `413 request_too_large`.
   - OpenAPI includes degraded `/health` response schema.
   - README updated for default-mode behavior.

## Verification

- `npm test` → pass=118 fail=0 skipped=2
- LSP diagnostics (modified JS files) → clean (hints only)

## Changed Files

- `services/upstream-stream.js`
- `services/upstream-read.js`
- `services/sse-parser.js`
- `services/session-store.js`
- `routes/register-core-routes.js`
- `src/bootstrap/chat-handler.js`
- `src/app.js`
- `middleware/request-log.js`
- `config/runtime-config.js`
- `.env.example`
- `docs/openapi.yaml`
- `README.md`
- tests: `health.test.js`, `routes-register-core-routes.test.js`, `services-upstream-read.test.js`, `services-upstream-stream.test.js`

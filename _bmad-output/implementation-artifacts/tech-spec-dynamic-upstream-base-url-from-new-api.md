# Tech Spec: Dynamic Upstream Base URL from New API Input

Status: proposed

## Objective

Enable `mix2api` to accept a per-request upstream (northbound) base URL from `new-api` instead of always using a single static `UPSTREAM_API_BASE`.

Implementation must remain backward compatible: if request-level value is absent, behavior remains unchanged (fallback to env config).

## Problem Statement

Current forwarding path only supports one fixed upstream base address:

- `services/upstream-request.js` builds target URL from `UPSTREAM_API_BASE + UPSTREAM_CHAT_PATH`
- `src/bootstrap/chat-handler.js` calls `upstreamRequestService.fetchWithAuthRecovery(...)` without per-request upstream target input
- `services/chat-request.js` validates request body but does not parse a northbound target field
- `services/upstream-token.js` (managed auth mode) derives token endpoint from static config, which can become inconsistent with per-request upstream routing

This blocks scenarios where `new-api` needs to route different requests to different northbound addresses through the same `mix2api` instance.

## Scope

### In Scope

1. Add optional request/header-based upstream base URL input.
2. Add strict validation and SSRF guardrails.
3. Thread resolved upstream target through request context to upstream request service.
4. Preserve existing env-based default path.
5. Update OpenAPI + README contract docs.
6. Add unit/integration tests for compatibility + safety.

### Out of Scope

1. Multi-upstream load balancing policy engine.
2. Persistent upstream routing profile storage.
3. Refactoring whole server into new architecture layers.
4. Breaking request contract changes requiring mandatory client migration.

## Current Anchor Points (Code Mapping)

### API Entry / Request Context

- `routes/register-core-routes.js`
  - `POST /v1/chat/completions` and `POST /` both route to same handler.
- `services/chat-request.js`
  - `validateRequestBody` validates `model/messages` only.
  - `prepareChatRequestContext` returns normalized request context consumed by handler.
- `src/bootstrap/chat-handler.js`
  - Reads request context and calls upstream service.

### Upstream Call Construction

- `services/upstream-request.js`
  - `fetchWithRetry` currently hard-depends on config `UPSTREAM_API_BASE`, combines with `UPSTREAM_CHAT_PATH`.
  - `fetchWithAuthRecovery` wraps retry + managed token refresh recovery.

### Managed Token Endpoint Construction

- `services/upstream-token.js`
  - `resolveUpstreamTokenEndpoint` uses `UPSTREAM_TOKEN_URL` or fallback `UPSTREAM_API_BASE + UPSTREAM_TOKEN_PATH`.

### Config & Contract

- `config/runtime-config.js` provides static upstream config.
- `docs/openapi.yaml` currently has no explicit upstream base override field.
- `README.md` documents static env-based upstream setup.

## Proposed Contract

### Request Inputs

Support the following optional inputs (priority order):

1. `x-upstream-base-url` header
2. body `upstream_base_url`
3. body alias `upstream_api_base` (compat alias)
4. fallback `UPSTREAM_API_BASE` env

Rationale:

- Header is easy for gateway-side injection without mutating request JSON.
- Body field provides explicit contract and easier API-level visibility.
- Alias avoids brittle integration if `new-api` naming differs.

### Validation Rules

Resolved candidate upstream base URL must satisfy all:

1. Parseable absolute URL.
2. Protocol in allowlist: `http:` or `https:` (default allow only `https:` in production profile, configurable).
3. Host not loopback (`localhost`, `127.0.0.1`, `::1`) unless explicitly allowed.
4. Host/IP not private network range unless explicitly allowed.
5. Optional allowlist gate (env): only hostnames in `UPSTREAM_BASE_ALLOWLIST` allowed when configured.

If invalid, return OpenAI-style `400 invalid_request_error` with clear `param` value:

- `upstream_base_url`

## Design Changes by File

### 1) `services/chat-request.js`

Add small resolver utility and expose via request context:

- `resolveUpstreamBaseUrl(req, openaiRequest)`:
  - Reads header/body candidates (priority above).
  - Returns raw user-provided value or `null`.
- Validate/normalize with helper (new helper in `utils/common.js` or new `utils/url-policy.js`).
- Include in `prepareChatRequestContext(...)` output:
  - `resolvedUpstreamBaseUrl` (sanitized string or `null`)

### 2) `src/bootstrap/chat-handler.js`

Consume new context field and pass to upstream service:

- extend call:
  - `upstreamRequestService.fetchWithAuthRecovery({ ..., upstreamBaseUrl: resolvedUpstreamBaseUrl })`

Observability:

- set `res.locals.upstreamHost` (sanitized hostname only, no full URL/query)

### 3) `services/upstream-request.js`

Make base URL dynamic per request while retaining fallback:

- `fetchWithRetry` params include `upstreamBaseUrl`
- resolve base as:
  - `const baseSource = upstreamBaseUrl || UPSTREAM_API_BASE`
- preserve existing path compose logic with `UPSTREAM_CHAT_PATH`

Error handling:

- if both request-level and env-level base are missing -> existing `Missing UPSTREAM_API_BASE...` style error can be generalized to include request override hint.

### 4) `services/upstream-token.js` (managed auth alignment)

Avoid mismatched auth endpoint when dynamic upstream used:

Option A (recommended minimal-safe):

- Keep managed token endpoint static by default, but allow explicit request-level token endpoint override only when `UPSTREAM_TOKEN_URL` not set and policy allows dynamic base.

Option B (stricter / simpler):

- When dynamic upstream base is used and `UPSTREAM_AUTH_MODE=managed`, require explicit static `UPSTREAM_TOKEN_URL`; otherwise reject request with clear 400/500 config error.

Recommended now: **Option B** for deterministic security and lower complexity.

### 5) `docs/openapi.yaml`

Under `ChatCompletionRequest.properties`, add:

- `upstream_base_url: string (uri)`
- `upstream_api_base: string (uri)` (deprecated alias)

And document optional header `x-upstream-base-url` in endpoint parameters.

### 6) `README.md`

Add section for dynamic upstream routing:

- field/header usage
- security controls (allowlist/private network policy)
- backward compatibility behavior

## Security Guardrails (Must-Have)

1. Default deny internal network destinations for dynamic input.
2. Optional explicit overrides via env flags (for local integration tests only).
3. Never log full upstream URL; log only hostname and scheme.
4. Keep auth token handling unchanged (do not expose tokens in errors/logs).

Suggested env additions:

- `UPSTREAM_DYNAMIC_BASE_ENABLED=true|false` (default false for safe rollout)
- `UPSTREAM_BASE_ALLOWLIST=host1,host2,...` (optional)
- `UPSTREAM_BASE_ALLOW_PRIVATE=false` (default false)
- `UPSTREAM_BASE_ALLOW_HTTP=false` (default false in prod)

## Backward Compatibility

If `UPSTREAM_DYNAMIC_BASE_ENABLED=false`:

- Ignore request-level upstream field/header and keep current static behavior.

If enabled but request-level field/header missing:

- Continue using `UPSTREAM_API_BASE` exactly as today.

No changes to existing required fields (`model/messages`) or response envelope.

## Testing Plan

### Unit Tests

1. `services/chat-request`:
   - resolves candidate from header/body priority.
   - rejects invalid URL/protocol/host.
2. `services/upstream-request`:
   - uses request-level base when provided.
   - falls back to env base when absent.
3. URL policy helper:
   - allowlist pass/fail.
   - loopback/private network rejection.

### Integration Tests (`tests/integration/chat-completions-auth-nonstream.test.js`)

1. dynamic base routes request to selected upstream server A/B.
2. fallback path still routes by env `UPSTREAM_API_BASE`.
3. invalid dynamic base returns `400 invalid_request_error`.
4. managed auth mode + dynamic base behavior matches chosen policy (Option B expected error when token URL ambiguous).

## Acceptance Criteria (for this change)

1. Given dynamic upstream enabled and request provides valid `upstream_base_url`, request is forwarded to that target.
2. Given no request override, forwarding remains based on env `UPSTREAM_API_BASE`.
3. Invalid or forbidden target returns OpenAI-style 400 with clear parameter attribution.
4. OpenAPI + README document new optional fields/headers and security behavior.
5. Existing tests pass; new tests cover override/fallback/validation paths.

## Rollout Strategy

1. Merge behind `UPSTREAM_DYNAMIC_BASE_ENABLED=false` default.
2. Canary enable in controlled environment.
3. Observe `end_reason`, `upstream_status`, and new sanitized `upstream_host` dimension.
4. Expand rollout gradually.

## Risks & Mitigations

1. **SSRF risk** from user-controlled target
   - Mitigation: strict URL policy + allowlist + private network deny by default.
2. **Managed token endpoint mismatch**
   - Mitigation: policy Option B; explicit error when ambiguous.
3. **Regression in existing routing path**
   - Mitigation: keep fallback unchanged + integration regression tests.

## Notes

- Oracle background task launched for additional architecture review but did not return before task eviction; spec above is grounded in verified repository anchors and existing test patterns.
- Next step after this spec: implement minimal vertical slice (`chat-request` -> `chat-handler` -> `upstream-request`) with feature flag and tests.

# mix2api - 组件清单

**日期：** 2026-02-28

## 服务组件

### chat-auth.js

- **路径：** `services/chat-auth.js`
- **职责：** 入站 + 上游鉴权逻辑
- **导出：**
  - `resolveInboundToken(req, config)` — 验证入站 Bearer token
  - `resolveUpstreamToken(config, inboundToken, managedTokenService)` — 解析上游 token
  - `inspectTokenInfo(token, config)` — JWT 检查 + 过期检测
- **依赖：** `utils/common.js`（fingerprint, base64UrlToJson）
- **测试：** `tests/unit/services-chat-auth.test.js`

### chat-request.js

- **路径：** `services/chat-request.js`
- **职责：** 请求验证、工具规范化、动态上游 URL 解析、模型画像解析
- **导出：**
  - `validateRequestBody(body)` — 验证 model + messages 字段
  - `prepareChatRequestContext(req, config, ...)` — 编排请求上下文准备
- **特性：** 动态上游 URL 支持 + SSRF 防护（私网/回环/DNS 重绑定）
- **依赖：** `config/model-utils.js`、`utils/common.js`
- **测试：** `tests/unit/services-chat-request.test.js`

### chat-orchestration.js

- **路径：** `services/chat-orchestration.js`
- **职责：** 会话解析、上游请求构建
- **导出：**
  - `resolveSessionContext(req, config, sessionKeyService, sessionStoreService)` — 会话查询/引导
  - `prepareUpstreamRequest(req, config, ...)` — OpenAI → 上游格式转换 + 预算预检
- **特性：** 会话引导规则、`session_id: "new"` 强制新会话、预算超限裁剪恢复
- **测试：** `tests/unit/services-chat-orchestration.test.js`

### session-key.js

- **路径：** `services/session-key.js`
- **职责：** 客户端识别 + 会话存储键生成
- **导出：**
  - `inferClientId(req)` — 从 header/user-agent 推断客户端类型
  - `getSessionStoreKey(req, model, token)` — 基于 SESSION_KEY_MODE 生成键
- **测试：** `tests/unit/services-session-key.test.js`

### session-store.js

- **路径：** `services/session-store.js`
- **职责：** Redis + 内存双后端会话存储
- **导出：** `createSessionStoreService(config)` → `{ getStoredSession, updateStoredSession, clearStoredSession, getStoreHealth, initClient }`
- **特性：** 自动降级、schema 版本验证、TTL 过期、Redis 重连退避
- **数据格式：** `{ schemaVersion, sessionId, exchangeId, timestamp, turnCount }`
- **测试：** `tests/unit/services-session-store.test.js`

### upstream-token.js

- **路径：** `services/upstream-token.js`
- **职责：** Managed token 生命周期管理
- **导出：** `createManagedUpstreamTokenService(config)` → `{ getToken, clearToken, shouldRecoverManagedTokenFromResponse }`
- **特性：** Token 获取、JWT 过期检测、刷新去重（singleton promise）、401/403 恢复
- **测试：** `tests/unit/services-upstream-token.test.js`

### upstream-request.js

- **路径：** `services/upstream-request.js`
- **职责：** HTTP 请求 + 重试 + auth 恢复
- **导出：** `createUpstreamRequestService(config)` → `{ fetchWithRetry, fetchWithAuthRecovery }`
- **特性：** 指数退避重试（5xx）、managed token 恢复、keep-alive agent、SSRF DNS 检查
- **测试：** `tests/unit/services-upstream-request.test.js`

### upstream-stream.js

- **路径：** `services/upstream-stream.js`
- **职责：** SSE 流式桥接（上游 → OpenAI 格式）
- **导出：** `startUpstreamStreamBridge(res, upstreamRes, ...)`
- **特性：** 事件类型转换（text-delta→content, finish→stop）、sessionId 捕获、客户端中断处理、超时检测
- **测试：** `tests/unit/services-upstream-stream.test.js`

### upstream-read.js

- **路径：** `services/upstream-read.js`
- **职责：** 上游响应读取
- **导出：**
  - `readUpstreamStream(res)` — 读取完整 SSE 流为文本
  - `readNonStreamJsonResponse(res)` — 读取 JSON 响应
- **测试：** `tests/unit/services-upstream-read.test.js`

### sse-parser.js

- **路径：** `services/sse-parser.js`
- **职责：** SSE 协议解析
- **导出：** `createSseEventParser(onEvent)` — 有状态的行级 SSE 解析器
- **特性：** data/event 行处理、注释行、多行 data、CR/LF 规范化

### tool-response.js

- **路径：** `services/tool-response.js`
- **职责：** 工具调用评估与解析
- **导出：** `evaluate(upstreamText, tools, config)` → `{ type: 'tool_calls'|'final_text', ... }`
- **特性：** 多策略解析管道（JSON → 结构化 → 松散正则）、工具验证过滤、{final:""} 协议
- **测试：** `tests/unit/services-tool-response.test.js`

### openai-response.js

- **路径：** `services/openai-response.js`
- **职责：** OpenAI 格式响应渲染
- **导出：**
  - `renderToolCalls(res, toolCalls, model)` — JSON 或 SSE 格式工具调用响应
  - `renderFinalText(res, text, model)` — JSON 或 SSE 格式文本响应
- **测试：** `tests/unit/services-openai-response.test.js`

## 中间件组件

### request-id.js

- **路径：** `middleware/request-id.js`
- **职责：** 请求 ID 管理 + 可观测性字段初始化
- **导出：** `createRequestIdMiddleware()`
- **初始化字段：** `endReason`, `upstreamStatus`, `client`, `stream`, `toolsPresent`, `model`, `inputBudget`, `outputBudget`, `truncationApplied`, `rejectReason`, `upstreamHost`, `upstreamOverride`
- **测试：** `tests/unit/middleware-request-id.test.js`

### json-body-error.js

- **路径：** `middleware/json-body-error.js`
- **职责：** JSON 解析错误拦截
- **导出：** `createJsonBodyErrorMiddleware()`
- **处理：** `entity.parse.failed` → 400, `entity.too.large` → 413

### request-log.js

- **路径：** `middleware/request-log.js`
- **职责：** 请求/响应日志
- **导出：** `createRequestLogMiddleware(config, observability)`
- **特性：** `request.received` / `request.completed` 结构化日志、trace 采样
- **测试：** `tests/unit/middleware-register-core-middlewares.test.js`

## Bootstrap 组件

### chat-handler.js

- **路径：** `src/bootstrap/chat-handler.js`
- **职责：** 请求生命周期编排
- **导出：** `createChatHandler(deps)` → `handleChatCompletion(req, res)`
- **编排步骤：** 鉴权 → 上下文准备 → 会话解析 → 格式转换 → HTTP 请求 → 响应路由

### observability.js

- **路径：** `src/bootstrap/observability.js`
- **职责：** Trace 采样 + 预算观测
- **导出：** `createObservability()` → `{ maybeRecordSampleTrace, observeBudgetDecision, startSampleTraceCleanupTask }`

## 配置组件

### env.js

- **路径：** `config/env.js`
- **导出：** `envInt()`, `envBool()`, `envJson()`
- **测试：** `tests/unit/config-env.test.js`

### runtime-config.js

- **路径：** `config/runtime-config.js`
- **导出：** `loadRuntimeConfig()` — 聚合 80+ 环境变量为单一配置对象

### model-utils.js

- **路径：** `config/model-utils.js`
- **导出：** `parseModelList()`, `estimateTokenByChars()`, `resolveModelIds()`
- **测试：** `tests/unit/config-model-utils.test.js`

## 工具函数

### common.js

- **路径：** `utils/common.js`
- **导出：** `normalizeRequestId`, `redactHeaders`, `redactSensitiveText`, `extractMessageText`, `base64UrlToJson`, `redactRedisUrl`, `fingerprint`, `sanitizeKeyPart`, `toPositiveInt`
- **测试：** `tests/unit/utils-common.test.js`

### text.js

- **路径：** `utils/text.js`
- **导出：** `truncateTextKeepTail`, `truncateTextKeepHeadAndTail`
- **测试：** `tests/unit/utils-text.test.js`

### json-text.js

- **路径：** `utils/json-text.js`
- **导出：** `extractJsonObjectsFromText`, `extractJsonFromText`, `extractFinalFromTextProtocol`
- **测试：** `tests/unit/utils-json-text.test.js`

### tool-parser.js

- **路径：** `utils/tool-parser.js`
- **导出：** `parseLooseToolCallsFromText`, `looksLikeToolCallPayload`, `ensureSafeFinalText`
- **测试：** `tests/unit/utils-tool-parser.test.js`

### tool-calls.js

- **路径：** `utils/tool-calls.js`
- **导出：** `validateAndFilterToolCalls`, `normalizeToolCallArguments`, `toOpenAIToolCallsForChunk`, `toOpenAIToolCallsForMessage`, `attachStableToolCallIds`
- **测试：** `tests/unit/utils-tool-calls.test.js`

### openai-error.js

- **路径：** `utils/openai-error.js`
- **导出：** `sendOpenAIError(res, status, message, type, code)`
- **测试：** `tests/unit/utils-openai-error.test.js`

---

_使用 BMAD Method `document-project` 工作流生成_

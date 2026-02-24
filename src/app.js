// mix2api 上游适配器
// 将 OpenAI Chat Completions 请求转换为上游模型网站的请求格式

const express = require('express');
const fetch = require('node-fetch');
const { v4: uuidv4 } = require('uuid');
const http = require('http');
const https = require('https');
const { envInt, envBool } = require('../config/env');
const { loadRuntimeConfig } = require('../config/runtime-config');
const { resolveModelIds, estimateTokenByChars } = require('../config/model-utils');
const { createRequestIdMiddleware } = require('../middleware/request-id');
const { createRequestLogMiddleware } = require('../middleware/request-log');
const { createJsonBodyErrorMiddleware } = require('../middleware/json-body-error');
const { registerCoreMiddlewares } = require('../middleware/register-core-middlewares');
const { registerCoreRoutes } = require('../routes/register-core-routes');
const { createSessionKeyService } = require('../services/session-key');
const { createSessionStoreService } = require('../services/session-store');
const { createManagedUpstreamTokenService } = require('../services/upstream-token');
const { createUpstreamRequestService } = require('../services/upstream-request');
const { startUpstreamStreamBridge } = require('../services/upstream-stream');
const { createUpstreamReadService } = require('../services/upstream-read');
const { createToolResponseService } = require('../services/tool-response');
const { createOpenAIResponseService } = require('../services/openai-response');
const { createChatOrchestrationService } = require('../services/chat-orchestration');
const { resolveInboundToken, resolveUpstreamToken, inspectTokenInfo } = require('../services/chat-auth');
const { prepareChatRequestContext } = require('../services/chat-request');
const {
  normalizeRequestId,
  redactHeaders,
  redactSensitiveText,
  extractMessageText,
  base64UrlToJson,
  redactRedisUrl,
  fingerprint,
  sanitizeKeyPart,
  toPositiveInt
} = require('../utils/common');
const { truncateTextKeepTail, truncateTextKeepHeadAndTail } = require('../utils/text');
const { sendOpenAIError } = require('../utils/openai-error');
const {
  extractJsonObjectsFromText,
  extractJsonFromText,
  extractFinalFromTextProtocol
} = require('../utils/json-text');
const {
  parseLooseToolCallsFromText,
  looksLikeToolCallPayload,
  ensureSafeFinalText
} = require('../utils/tool-parser');
const {
  validateAndFilterToolCalls,
  normalizeToolCallArguments,
  toOpenAIToolCallsForChunk,
  toOpenAIToolCallsForMessage
} = require('../utils/tool-calls');
const { createChatHandler } = require('./bootstrap/chat-handler');
const { createObservability } = require('./bootstrap/observability');

function setRequestEndReason(res, reason) {
  if (!res || !res.locals || !reason) return;
  res.locals.endReason = String(reason);
}

function setRequestUpstreamStatus(res, status) {
  if (!res || !res.locals) return;
  if (status === undefined || status === null || status === '') return;
  res.locals.upstreamStatus = Number.isFinite(Number(status)) ? Number(status) : String(status);
}


// 配置
const {
  UPSTREAM_API_BASE,
  UPSTREAM_CHAT_PATH,
  UPSTREAM_REFERER,
  UPSTREAM_ACCEPT_LANGUAGE,
  PORT,
  DEFAULT_MODEL_IDS,
  MODEL_PROFILE_DEFAULT_CONTEXT_WINDOW,
  MODEL_PROFILE_DEFAULT_MAX_INPUT_TOKENS,
  MODEL_PROFILE_DEFAULT_MAX_NEW_TOKENS,
  MODEL_PROFILE_FALLBACK_WARN_CACHE_SIZE,
  TOKEN_BUDGET_DEFAULT_RESERVED_OUTPUT_TOKENS,
  MODEL_PROFILE_JSON,
  UPSTREAM_TOKEN_URL,
  UPSTREAM_TOKEN_PATH,
  UPSTREAM_TOKEN_METHOD,
  UPSTREAM_TOKEN_HEADERS_JSON,
  UPSTREAM_TOKEN_BODY_JSON,
  UPSTREAM_TOKEN_FIELD,
  UPSTREAM_TOKEN_EXPIRES_IN_FIELD,
  UPSTREAM_TOKEN_TIMEOUT_MS,
  UPSTREAM_TOKEN_EXPIRY_SKEW_MS,
  UPSTREAM_AUTH_RECOVERY_RETRY,
  SESSION_SCHEMA_VERSION,
  SESSION_STORE_MODE,
  REDIS_URL,
  REDIS_CONNECT_TIMEOUT_MS,
  REDIS_SESSION_PREFIX,
  TRACE_SAMPLING_ENABLED,
  TRACE_SAMPLING_RATE,
  TRACE_RETENTION_MS,
  TRACE_MAX_ENTRIES,
  TRACE_CLEANUP_INTERVAL_MS,
  SESSION_TTL_MS
} = loadRuntimeConfig();

const modelProfileFallbackWarned = new Set();
const sessionKeyService = createSessionKeyService({ sanitizeKeyPart, fingerprint });
const sessionStoreService = createSessionStoreService({
  config: {
    SESSION_STORE_MODE,
    REDIS_URL,
    REDIS_CONNECT_TIMEOUT_MS,
    REDIS_SESSION_PREFIX,
    SESSION_SCHEMA_VERSION,
    SESSION_TTL_MS
  },
  helpers: {
    redactSensitiveText,
    redactRedisUrl,
    fingerprint
  }
});
const observability = createObservability({
  uuidv4,
  fingerprint,
  config: {
    TRACE_SAMPLING_ENABLED,
    TRACE_SAMPLING_RATE,
    TRACE_RETENTION_MS,
    TRACE_MAX_ENTRIES,
    TRACE_CLEANUP_INTERVAL_MS
  }
});
const { maybeRecordSampleTrace, startSampleTraceCleanupTask, observeBudgetDecision } = observability;
function estimateInputPayloadChars(input) {
  if (!input || typeof input !== 'object') return 0;
  let totalChars = 0;
  const messages = Array.isArray(input.messages) ? input.messages : [];
  for (const msg of messages) {
    if (!msg || typeof msg !== 'object') continue;
    totalChars += extractMessageText(msg.content).length;
    if (msg.name) totalChars += String(msg.name).length;
    if (msg.tool_call_id) totalChars += String(msg.tool_call_id).length;
    if (Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
      try {
        totalChars += JSON.stringify(msg.tool_calls).length;
      } catch {
        // ignore
      }
    }
  }

  if (Array.isArray(input.tools) && input.tools.length > 0) {
    try {
      totalChars += JSON.stringify(input.tools).length;
    } catch {
      // ignore
    }
  }

  if (input.tool_choice !== undefined) {
    try {
      totalChars += JSON.stringify(input.tool_choice).length;
    } catch {
      // ignore
    }
  }

  return totalChars;
}

function estimateInputTokens(openaiRequest) {
  const totalChars = estimateInputPayloadChars(openaiRequest);
  return estimateTokenByChars(totalChars);
}

function estimateUpstreamInputTokens(upstreamRequest) {
  if (!upstreamRequest || typeof upstreamRequest !== 'object') return 0;
  const request = (upstreamRequest.request && typeof upstreamRequest.request === 'object')
    ? upstreamRequest.request
    : null;
  const queryChars = (request && typeof request.query === 'string') ? request.query.length : 0;
  const payloadChars = estimateInputPayloadChars(upstreamRequest);
  return estimateTokenByChars(queryChars + payloadChars);
}

function buildDefaultModelProfile() {
  const contextWindow = MODEL_PROFILE_DEFAULT_CONTEXT_WINDOW;
  const maxInputTokens = Math.min(MODEL_PROFILE_DEFAULT_MAX_INPUT_TOKENS, contextWindow);
  const maxNewTokens = Math.min(MODEL_PROFILE_DEFAULT_MAX_NEW_TOKENS, contextWindow);
  return {
    contextWindow,
    maxInputTokens,
    maxNewTokens
  };
}

function normalizeModelProfileEntry(modelKey, rawProfile, defaultProfile) {
  if (!rawProfile || typeof rawProfile !== 'object' || Array.isArray(rawProfile)) {
    console.warn(`⚠ model.profile.invalid model=${modelKey} reason=invalid_profile_type`);
    return null;
  }

  const contextRaw = rawProfile.context_window !== undefined ? rawProfile.context_window : rawProfile.contextWindow;
  const maxInputRaw = rawProfile.max_input_tokens !== undefined ? rawProfile.max_input_tokens : rawProfile.maxInputTokens;
  const maxNewRaw = rawProfile.max_new_tokens !== undefined ? rawProfile.max_new_tokens : rawProfile.maxNewTokens;

  let contextWindow = toPositiveInt(contextRaw);
  let maxInputTokens = toPositiveInt(maxInputRaw);
  let maxNewTokens = toPositiveInt(maxNewRaw);

  if (!contextWindow) contextWindow = defaultProfile.contextWindow;
  if (!maxInputTokens) maxInputTokens = defaultProfile.maxInputTokens;
  if (!maxNewTokens) maxNewTokens = defaultProfile.maxNewTokens;

  if (maxInputTokens > contextWindow) {
    console.warn(`⚠ model.profile.adjusted model=${modelKey} field=max_input_tokens from=${maxInputTokens} to=${contextWindow}`);
    maxInputTokens = contextWindow;
  }
  if (maxNewTokens > contextWindow) {
    console.warn(`⚠ model.profile.adjusted model=${modelKey} field=max_new_tokens from=${maxNewTokens} to=${contextWindow}`);
    maxNewTokens = contextWindow;
  }

  return {
    contextWindow,
    maxInputTokens,
    maxNewTokens,
    source: 'configured'
  };
}

function resolveTokenBudgetDecision(
  openaiRequest,
  modelProfile,
  requestId,
  estimatedInputTokensOverride = null,
  options = {}
) {
  const logDecision = options && options.logDecision !== false;
  const suppressWarnings = options && options.suppressWarnings === true;
  const hasMaxCompletionTokens = openaiRequest && openaiRequest.max_completion_tokens !== undefined;
  const hasMaxTokens = openaiRequest && openaiRequest.max_tokens !== undefined;
  const parsedMaxCompletionTokens = hasMaxCompletionTokens ? toPositiveInt(openaiRequest.max_completion_tokens) : null;
  const parsedMaxTokens = hasMaxTokens ? toPositiveInt(openaiRequest.max_tokens) : null;
  const estimatedInputTokens = estimatedInputTokensOverride === null || estimatedInputTokensOverride === undefined
    ? estimateInputTokens(openaiRequest)
    : Math.max(0, Math.floor(Number(estimatedInputTokensOverride) || 0));

  let requestedOutputTokens = null;
  let requestField = null;
  if (parsedMaxCompletionTokens) {
    requestedOutputTokens = parsedMaxCompletionTokens;
    requestField = 'max_completion_tokens';
  } else if (parsedMaxTokens) {
    requestedOutputTokens = parsedMaxTokens;
    requestField = 'max_tokens';
  }

  if (!suppressWarnings && hasMaxCompletionTokens && !parsedMaxCompletionTokens) {
    console.warn(`[${requestId}] ⚠ model.profile.output_budget.invalid field=max_completion_tokens value=${openaiRequest.max_completion_tokens}`);
  }
  if (!suppressWarnings && hasMaxTokens && !parsedMaxTokens) {
    console.warn(`[${requestId}] ⚠ model.profile.output_budget.invalid field=max_tokens value=${openaiRequest.max_tokens}`);
  }

  const maxOutputByContext = Math.max(1, modelProfile.contextWindow - 1);
  const maxOutputTokens = Math.min(modelProfile.maxNewTokens, maxOutputByContext);
  const defaultReservedOutputTokens = Math.min(maxOutputTokens, TOKEN_BUDGET_DEFAULT_RESERVED_OUTPUT_TOKENS);
  const requestedOrDefault = requestedOutputTokens || defaultReservedOutputTokens;
  if (!suppressWarnings && requestedOrDefault > maxOutputTokens) {
    console.warn(
      `[${requestId}] ⚠ model.profile.output_budget.clamped ` +
      `requested=${requestedOrDefault} max_new_tokens=${maxOutputTokens}`
    );
  }
  const reservedOutputTokens = Math.min(requestedOrDefault, maxOutputTokens);
  const source = requestField || 'profile_default';
  const availableInputByContext = Math.max(1, modelProfile.contextWindow - reservedOutputTokens);
  const availableInputTokens = Math.min(modelProfile.maxInputTokens, availableInputByContext);
  const outputClamped = reservedOutputTokens < requestedOrDefault;
  const action = estimatedInputTokens > availableInputTokens
    ? 'reject'
    : (outputClamped ? 'clamp' : 'pass');
  const reason = action === 'reject'
    ? 'input_exceeds_available_budget'
    : (outputClamped ? 'output_clamped' : 'within_budget');

  if (logDecision) {
    console.log(
      `[${requestId}] model.profile.input_budget ` +
      `estimated_input_tokens=${estimatedInputTokens} available_input_tokens=${availableInputTokens} ` +
      `reserved_output_tokens=${reservedOutputTokens} action=${action} reason=${reason}`
    );

    console.log(
      `[${requestId}] model.profile.output_budget source=${source} ` +
      `effective_max_tokens=${reservedOutputTokens} max_new_tokens=${maxOutputTokens}`
    );
  }

  return {
    estimatedInputTokens,
    reservedOutputTokens,
    availableInputTokens,
    action,
    reason
  };
}

function buildModelProfileMap(rawConfig, defaultProfile, modelIds) {
  const map = new Map();

  const addAliases = (rawKey, profile) => {
    const modelKey = String(rawKey || '').trim();
    if (!modelKey) return;
    const keys = new Set();
    keys.add(modelKey);
    const slug = normalizeModelSlug(modelKey);
    if (slug) keys.add(slug);
    if (slug) keys.add(`mix/${slug}`);
    for (const key of keys) {
      map.set(key, profile);
    }
  };

  const modelIdList = Array.isArray(modelIds) ? modelIds : [];
  for (const modelId of modelIdList) {
    const modelKey = String(modelId || '').trim();
    if (!modelKey) continue;
    addAliases(modelKey, {
      contextWindow: defaultProfile.contextWindow,
      maxInputTokens: defaultProfile.maxInputTokens,
      maxNewTokens: defaultProfile.maxNewTokens,
      source: 'default'
    });
  }

  if (!rawConfig || typeof rawConfig !== 'object' || Array.isArray(rawConfig)) {
    if (rawConfig !== null && rawConfig !== undefined) {
      console.warn('⚠ model.profile.invalid reason=config_must_be_object');
    }
    return map;
  }

  for (const [rawKey, rawProfile] of Object.entries(rawConfig)) {
    const modelKey = String(rawKey || '').trim();
    if (!modelKey) continue;
    const normalized = normalizeModelProfileEntry(modelKey, rawProfile, defaultProfile);
    if (!normalized) continue;
    addAliases(modelKey, normalized);
  }
  return map;
}

function rememberModelProfileFallbackWarn(modelId) {
  if (modelProfileFallbackWarned.has(modelId)) return false;
  if (modelProfileFallbackWarned.size >= MODEL_PROFILE_FALLBACK_WARN_CACHE_SIZE) {
    const oldest = modelProfileFallbackWarned.values().next().value;
    if (oldest !== undefined) modelProfileFallbackWarned.delete(oldest);
  }
  modelProfileFallbackWarned.add(modelId);
  return true;
}

function warnModelProfileFallback(modelId, reason, profile) {
  if (!rememberModelProfileFallbackWarn(modelId)) return;
  console.warn(
    `⚠ model.profile.fallback model=${modelId} reason=${reason} ` +
    `context_window=${profile.contextWindow} max_input_tokens=${profile.maxInputTokens} max_new_tokens=${profile.maxNewTokens}`
  );
}

const DEFAULT_MODEL_PROFILE = buildDefaultModelProfile();
const MODEL_PROFILE_MODEL_IDS = resolveModelIds(process.env.MODEL_LIST, DEFAULT_MODEL_IDS);
const MODEL_PROFILE_MAP = buildModelProfileMap(MODEL_PROFILE_JSON, DEFAULT_MODEL_PROFILE, MODEL_PROFILE_MODEL_IDS);

function resolveModelProfile(model, requestId) {
  const modelId = String(model || '').trim() || '_default';
  const slug = normalizeModelSlug(modelId);
  const candidates = [];
  for (const c of [modelId, slug, `mix/${slug}`]) {
    const key = String(c || '').trim();
    if (!key) continue;
    if (!candidates.includes(key)) candidates.push(key);
  }

  let profile = null;
  for (const key of candidates) {
    if (MODEL_PROFILE_MAP.has(key)) {
      profile = MODEL_PROFILE_MAP.get(key);
      break;
    }
  }

  if (profile && profile.source !== 'configured') {
    warnModelProfileFallback(modelId, 'model_list_default', profile);
  }

  if (!profile) {
    profile = {
      contextWindow: DEFAULT_MODEL_PROFILE.contextWindow,
      maxInputTokens: DEFAULT_MODEL_PROFILE.maxInputTokens,
      maxNewTokens: DEFAULT_MODEL_PROFILE.maxNewTokens,
      source: 'default'
    };
    warnModelProfileFallback(modelId, 'not_configured', profile);
  }

  if (requestId) {
    console.log(
      `[${requestId}] model.profile model=${modelId} ` +
      `context_window=${profile.contextWindow} ` +
      `max_input_tokens=${profile.maxInputTokens} ` +
      `max_new_tokens=${profile.maxNewTokens} source=${profile.source}`
    );
  }

  return {
    contextWindow: profile.contextWindow,
    maxInputTokens: profile.maxInputTokens,
    maxNewTokens: profile.maxNewTokens,
    source: profile.source
  };
}

// 从上游 SSE START 帧中提取 exchangeId 和 sessionId
// 参考实际响应格式：
// {"type":"start","messageMetadata":{"sessionId":"48d73bfd-...","exchangeId":"8e42f4e2-..."},"messageId":"8e42f4e2-..."}
// 后续请求的 sessionId 应使用 messageMetadata.sessionId，exchangeId 用于其他用途
function extractIdsFromUpstream(upstreamData) {
  if (!upstreamData || typeof upstreamData !== 'object') return null;
  const md = upstreamData.messageMetadata || upstreamData.metadata || null;
  const exchangeId = (
    (md && (md.exchangeId || md.exchange_id))
    || upstreamData.messageId
    || upstreamData.message_id
    || null
  );
  const sessionId = (
    (md && (md.sessionId || md.session_id))
    || null
  );
  if (!exchangeId && !sessionId) return null;
  return { exchangeId, sessionId };
}

function buildToolInstruction(tools, forceToolCall) {
  // 上游通常已经收到 tools schema（如果你选择透传 tools），这里的指令仅用于“提醒模型按协议输出”。
  // 为降低 token 压力，只在提示中保留 name/description/参数键名摘要。
  const simplifiedTools = (tools || []).map((tool) => {
    const fn = tool.function || tool;
    const params = fn.parameters || {};
    const props = (params && params.properties && typeof params.properties === 'object') ? Object.keys(params.properties) : [];
    return {
      name: fn.name,
      description: (fn.description || '').slice(0, envInt('TOOL_DESC_MAX_CHARS', 500)),
      parameters_keys: props.slice(0, 30),
      required: Array.isArray(params.required) ? params.required.slice(0, 30) : []
    };
  });

  const requirement = forceToolCall
    ? '必须选择并调用一个最合适的工具，禁止直接回答。'
    : '优先使用工具来完成任务（特别是文件读写、编辑、代码执行等操作）；只有确实不需要工具时才直接回答。';

  return [
    requirement,
    '你可以使用以下工具。需要调用工具时，请严格输出 JSON（不要加解释）：',
    '{"tool_call":{"name":"<tool_name>","arguments":{...}}}',
    '如果不需要工具，请输出：',
    '{"final":"<你的回答>"}',
    '工具列表（JSON）：',
    JSON.stringify(simplifiedTools)
  ].join('\n');
}


function buildSafeQueryForUpstream({
  conversationText,
  toolResultsText,
  questionText,
  toolInstruction,
  injectIntoQuery,
  injectIntoMessages,
  queryMaxChars
}) {
  const toolInstructionText = (typeof toolInstruction === 'string') ? toolInstruction.trim() : '';
  const originalConversation = (typeof conversationText === 'string') ? conversationText.trim() : '';
  const originalToolResults = (typeof toolResultsText === 'string') ? toolResultsText.trim() : '';
  const originalQuestion = (typeof questionText === 'string') ? questionText.trim() : '';

  let conversation = originalConversation ? originalConversation : null;
  let toolResults = originalToolResults ? originalToolResults : null;
  let question = originalQuestion;
  let includeToolInstructionInQuery = Boolean(injectIntoQuery && toolInstructionText);

  const compose = ({
    conversationOverride = conversation,
    toolResultsOverride = toolResults,
    questionOverride = question,
    includeToolInstructionOverride = includeToolInstructionInQuery
  } = {}) => {
    const parts = [];
    if (conversationOverride !== null && conversationOverride !== undefined) {
      parts.push(`[对话历史]\n${conversationOverride}`);
    }
    if (toolResultsOverride !== null && toolResultsOverride !== undefined) {
      parts.push(`[工具执行结果]\n${toolResultsOverride}`);
    }
    parts.push(`[当前问题]\n${questionOverride || ''}`);
    if (toolResultsOverride !== null && toolResultsOverride !== undefined) {
      parts.push('请基于以上工具输出给出最终回答。');
    }
    if (includeToolInstructionOverride) {
      parts.push(toolInstructionText);
    }
    return parts.join('\n\n');
  };

  const maxChars = Number(queryMaxChars || 0);
  if (!maxChars || maxChars <= 0) return compose();

  let query = compose();
  if (query.length <= maxChars) return query;

  // 优先：如果 tool 指令已经注入 messages（TOOL_INSTRUCTION_MODE=both），则从 query 去掉重复指令以节省预算
  if (includeToolInstructionInQuery && injectIntoMessages) {
    includeToolInstructionInQuery = false;
    query = compose({ includeToolInstructionOverride: false });
    if (query.length <= maxChars) return query;
  }

  // 有工具结果时：对话历史优先级最低，超限则先移除（避免挤掉“当前问题/工具结果”）
  if (toolResults && conversation) {
    conversation = null;
    query = compose();
    if (query.length <= maxChars) return query;
  }

  // 依次压缩：工具结果 -> 对话历史 -> 当前问题
  if (toolResults !== null && toolResults !== undefined) {
    const base = compose({ toolResultsOverride: '' });
    const available = maxChars - base.length;
    if (available <= 0) {
      toolResults = null;
    } else {
      toolResults = truncateTextKeepHeadAndTail(toolResults, available, '[工具执行结果已截断]');
    }
    query = compose();
    if (query.length <= maxChars) return query;
  }

  if (conversation !== null && conversation !== undefined) {
    const base = compose({ conversationOverride: '' });
    const available = maxChars - base.length;
    if (available <= 0) {
      conversation = null;
    } else {
      conversation = truncateTextKeepHeadAndTail(conversation, available, '[对话历史已截断]');
    }
    query = compose();
    if (query.length <= maxChars) return query;
  }

  {
    const base = compose({ questionOverride: '' });
    const available = maxChars - base.length;
    if (available <= 0) {
      question = '';
    } else {
      question = truncateTextKeepHeadAndTail(question, available, '[当前问题已截断]', 0.75);
    }
    query = compose();
    if (query.length <= maxChars) return query;
  }

  // 最后兜底：整体截断（理论上不应触发，但避免极端输入导致上游 4xx）
  return truncateTextKeepTail(query, maxChars, '[query已截断]');
}

function trimMessagesForUpstream(messages) {
  // 限制发送给上游的 messages 数量与单条长度，避免触发 token 上限。
  if (!Array.isArray(messages) || messages.length === 0) return messages;
  const maxCount = envInt('UPSTREAM_MESSAGES_MAX', 20);
  const perMsgMaxChars = envInt('UPSTREAM_MESSAGE_MAX_CHARS', 8000);

  const system = messages.find((m) => m && m.role === 'system') || null;
  const nonSystem = messages.filter((m) => m && m.role !== 'system');
  const tail = maxCount > 0 ? nonSystem.slice(-maxCount) : nonSystem;
  const trimmedTail = tail.map((m) => {
    const cloned = { ...m };
    if (cloned && cloned.content != null) {
      const t = extractMessageText(cloned.content);
      cloned.content = (perMsgMaxChars > 0) ? truncateTextKeepTail(t, perMsgMaxChars, '[消息内容已截断]') : t;
    }
    return cloned;
  });
  return system ? [system, ...trimmedTail] : trimmedTail;
}

function cloneMessageWithTrimmedContent(message, maxChars, marker = '[消息内容已截断]') {
  const cloned = { ...message };
  if (cloned && cloned.content != null) {
    const t = extractMessageText(cloned.content);
    cloned.content = (maxChars > 0) ? truncateTextKeepHeadAndTail(t, maxChars, marker) : t;
  }
  return cloned;
}

function adjustKeepStartForToolChain(nonSystemMessages, keepStart) {
  if (!Array.isArray(nonSystemMessages) || nonSystemMessages.length === 0) return 0;
  let start = Math.max(0, Math.min(nonSystemMessages.length, keepStart));

  // 避免从 tool 消息中间截断，回退到对应 assistant(tool_calls) 起点
  while (start > 0 && nonSystemMessages[start] && nonSystemMessages[start].role === 'tool') {
    start--;
  }

  if (start > 0) {
    const current = nonSystemMessages[start];
    const next = nonSystemMessages[start + 1];
    const startsToolChain = current
      && current.role === 'assistant'
      && Array.isArray(current.tool_calls)
      && current.tool_calls.length > 0
      && next
      && next.role === 'tool';
    if (startsToolChain) {
      // 优先回退到该链路前最近一条 user，保留“问题 -> tool -> 结果”最小闭环
      for (let i = start - 1; i >= 0; i--) {
        if (nonSystemMessages[i] && nonSystemMessages[i].role === 'user') {
          start = i;
          break;
        }
      }
    }
  }

  return start;
}

function summarizeTrimmedHistory(messages, maxChars, maxLines) {
  if (!Array.isArray(messages) || messages.length === 0) return '';

  const lineLimit = Math.max(1, toPositiveInt(maxLines) || 10);
  const lines = [];
  const tail = messages.slice(-lineLimit);

  for (const msg of tail) {
    if (!msg || typeof msg !== 'object') continue;
    const role = String(msg.role || 'message');
    const roleLabel = role === 'user'
      ? 'User'
      : role === 'assistant'
        ? 'Assistant'
        : role === 'tool'
          ? `Tool(${msg.name || 'tool'})`
          : role;
    let text = extractMessageText(msg.content);
    if (!text && role === 'assistant' && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
      const names = msg.tool_calls
        .map((c) => (c && c.function && c.function.name) ? c.function.name : (c && c.name) ? c.name : 'tool')
        .slice(0, 5);
      text = `[调用工具: ${names.join(', ')}]`;
    }
    if (!text) continue;
    const compact = text.replace(/\s+/g, ' ').trim();
    if (!compact) continue;
    lines.push(`${roleLabel}: ${truncateTextKeepHeadAndTail(compact, 180, '[内容已压缩]')}`);
  }

  if (lines.length === 0) return '';

  const summary = [
    '以下为较早历史消息的压缩摘要，用于保持上下文连续性：',
    ...lines
  ].join('\n');
  const budget = Math.max(1, toPositiveInt(maxChars) || 600);
  return truncateTextKeepHeadAndTail(summary, budget, '[历史摘要已截断]');
}

function buildBudgetManagedMessages(messages, options = {}) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return {
      messages: Array.isArray(messages) ? messages : [],
      truncationApplied: false,
      droppedMessageCount: 0,
      summaryApplied: false,
      summaryText: ''
    };
  }

  const recentMessageCount = Math.max(1, toPositiveInt(options.recentMessageCount) || toPositiveInt(envInt('BUDGET_TRIM_RECENT_MESSAGES', 6)) || 6);
  const perMessageMaxChars = Math.max(64, toPositiveInt(options.perMessageMaxChars) || toPositiveInt(envInt('BUDGET_TRIM_MESSAGE_MAX_CHARS', 1200)) || 1200);
  const summaryEnabled = options.summaryEnabled === undefined
    ? envBool('BUDGET_HISTORY_SUMMARY_ENABLED', false)
    : Boolean(options.summaryEnabled);
  const summaryMaxChars = Math.max(128, toPositiveInt(options.summaryMaxChars) || toPositiveInt(envInt('BUDGET_HISTORY_SUMMARY_MAX_CHARS', 600)) || 600);
  const summaryMaxLines = Math.max(1, toPositiveInt(options.summaryMaxLines) || toPositiveInt(envInt('BUDGET_HISTORY_SUMMARY_MAX_LINES', 10)) || 10);

  const firstSystem = messages.find((m) => m && m.role === 'system') || null;
  const nonSystem = messages.filter((m) => m && m.role !== 'system');
  const keepStartRaw = Math.max(0, nonSystem.length - recentMessageCount);
  const keepStart = adjustKeepStartForToolChain(nonSystem, keepStartRaw);

  const keptRawNonSystem = nonSystem.slice(keepStart);
  const keptNonSystem = keptRawNonSystem
    .map((m) => cloneMessageWithTrimmedContent(m, perMessageMaxChars));
  const keptSet = new Set(keptRawNonSystem);

  const normalizedSystem = firstSystem ? cloneMessageWithTrimmedContent(firstSystem, perMessageMaxChars, '[系统提示已截断]') : null;
  const managedMessages = normalizedSystem ? [normalizedSystem, ...keptNonSystem] : keptNonSystem;

  // 按原始顺序找出被裁剪掉的历史（用于可选摘要）
  const droppedMessages = [];
  for (const msg of messages) {
    if (!msg || typeof msg !== 'object') continue;
    if (normalizedSystem && msg === firstSystem) continue;
    if (keptSet.has(msg)) continue;
    droppedMessages.push(msg);
  }

  const summaryText = summaryEnabled
    ? summarizeTrimmedHistory(droppedMessages, summaryMaxChars, summaryMaxLines)
    : '';

  return {
    messages: managedMessages,
    truncationApplied: droppedMessages.length > 0,
    droppedMessageCount: droppedMessages.length,
    summaryApplied: Boolean(summaryText),
    summaryText
  };
}

function reduceTools(tools, maxCount, descMaxChars, messages) {
  // 重要：OpenCode/类似客户端可能一次性传入很多工具（例如 30+）。
  // 如果我们仅截取前 N 个，可能把“write/edit/apply_patch”等关键工具裁掉，导致模型只能“口头说要改文件”却无法真正调用工具。
  if (!Array.isArray(tools) || tools.length === 0) return [];

  // 兼容：部分网关/客户端会塞入非 OpenAI Function 工具（例如 type="mcp" 的描述符）。
  // 当前适配器只支持 OpenAI Function 工具；其他类型先忽略，避免污染提示词与工具选择。
  const supportedTools = tools.filter((tool) => {
    if (!tool) return false;
    if (tool.type && tool.type !== 'function') {
      if (envBool('LOG_TOOL_SELECTION', false)) {
        console.warn(`⚠ Ignoring non-function tool type=${tool.type}`);
      }
      return false;
    }
    const fn = tool.function || tool;
    if (!fn || !fn.name) {
      if (envBool('LOG_TOOL_SELECTION', false)) {
        console.warn('⚠ Ignoring tool without name');
      }
      return false;
    }
    return true;
  });
  if (supportedTools.length === 0) return [];

  // TOOL_KEEP_ALL=1 时不裁剪，完整透传全部工具（仍会裁剪 description/parameters 以控 token）
  const keepAll = envBool('TOOL_KEEP_ALL', false);
  if (!keepAll && (!maxCount || maxCount <= 0)) return [];

  const toolNameOf = (tool) => {
    const fn = tool && (tool.function || tool);
    return (fn && fn.name) ? String(fn.name) : '';
  };

  const detectFileIntent = (text) => {
    if (typeof text !== 'string' || !text) return false;
    // 中英混合关键词：覆盖“编辑/修改/写入/创建文件/补丁”等典型本地文件操作诉求
    return /(编辑|修改|更新|写入|保存|创建|删除|重命名|补丁|文件|本地|apply[_-]?patch|patch|diff|edit|write|save|create|delete|rename|file)/i.test(text);
  };

  const extractLastUserText = (msgs) => {
    if (!Array.isArray(msgs) || msgs.length === 0) return '';
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      if (m && m.role === 'user') {
        return extractMessageText(m.content);
      }
    }
    return '';
  };

  // 不裁剪时：保留原始顺序，避免意外的工具排序副作用
  if (keepAll || maxCount >= supportedTools.length) {
    return supportedTools.map((tool) => {
      const fn = tool.function || tool;
      const description = (fn.description || '').slice(0, descMaxChars);
      return {
        ...tool,
        type: tool.type || 'function',
        function: {
          ...fn,
          name: fn.name,
          description,
          parameters: fn.parameters || {}
        }
      };
    });
  }

  const hintText = extractLastUserText(messages);
  const fileIntent = detectFileIntent(hintText);

  const scoreTool = (name, index) => {
    const n = String(name || '').toLowerCase();
    let score = 0;

    // 保底：越靠前的工具轻微加分（保持一定稳定性）
    score += Math.max(0, 50 - index);

    // 通用高频工具
    if (/(read|glob|grep|search|list|dir|ls)/.test(n)) score += 150;

    // 文件编辑意图：强烈偏向“读写编辑相关工具”
    if (fileIntent) {
      if (/(apply_patch|patch|diff)/.test(n)) score += 1200;
      if (/(edit|write|create|update|save)/.test(n)) score += 1000;
      if (/(file|path)/.test(n)) score += 700;
      if (/(read|glob|grep|search|list|dir|ls)/.test(n)) score += 600;
    }

    return score;
  };

  const ranked = supportedTools
    .map((tool, index) => {
      const name = toolNameOf(tool);
      return { tool, index, name, score: scoreTool(name, index) };
    })
    .sort((a, b) => (b.score - a.score) || (a.index - b.index));

  const selected = ranked.slice(0, maxCount).map((x) => x.tool);

  // 统一裁剪 description（保留完整 parameters 结构），降低 token 压力
  return selected.map((tool) => {
    const fn = tool.function || tool;
    const description = (fn.description || '').slice(0, descMaxChars);
    return {
      ...tool,
      type: tool.type || 'function',
      function: {
        ...fn,
        name: fn.name,
        description,
        parameters: fn.parameters || {}
      }
    };
  });
}

function trimSystemMessages(messages, maxChars) {
  if (!Array.isArray(messages) || messages.length === 0) return messages;
  const systemMessages = messages.filter((msg) => msg.role === 'system');
  if (systemMessages.length === 0) return messages;

  const firstSystem = systemMessages[0];
  // content 可能是 string 或 OpenAI 新版的多段数组；统一转成纯文本再截断
  const systemText = extractMessageText(firstSystem && firstSystem.content);
  const trimmedContent = systemText.length > maxChars
    ? `${systemText.slice(0, maxChars)}\n[系统提示已截断]`
    : systemText;

  const nonSystem = messages.filter((msg) => msg.role !== 'system');
  return [{ role: 'system', content: trimmedContent }, ...nonSystem];
}

function injectToolInstruction(messages, tools, forceToolCall) {
  if (!tools || tools.length === 0) return messages;
  const instruction = buildToolInstruction(tools, forceToolCall);
  if (messages.length > 0 && messages[0].role === 'system') {
    const existing = extractMessageText(messages[0].content);
    return [{
      role: 'system',
      content: existing ? `${existing}\n\n${instruction}` : instruction
    }, ...messages.slice(1)];
  }
  return [{ role: 'system', content: instruction }, ...messages];
}

function normalizeModelSlug(model) {
  if (!model) return 'qwen-3-235b-instruct';
  const raw = model.includes('/') ? model.split('/').pop() : model;
  const aliasMap = {
    'claude-sonnet-4-5': 'claude-sonnet-4-5',
    'grok-4-1-fast': 'grok-4-1-fast'
  };
  return aliasMap[raw] || raw;
}

function findLastMessageByRole(messages, role) {
  if (!Array.isArray(messages)) return null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m && m.role === role) return m;
  }
  return null;
}

function collectTrailingToolMessages(messages) {
  // 收集消息末尾连续出现的 tool 消息（OpenAI 工具调用第二轮通常是 ... assistant(tool_calls) -> tool -> tool -> ...）
  if (!Array.isArray(messages) || messages.length === 0) return [];
  const out = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m && m.role === 'tool') {
      out.push(m);
      continue;
    }
    break;
  }
  return out.reverse();
}

function validateTrailingToolBackfill(messages) {
  const toolMessages = collectTrailingToolMessages(messages);
  if (toolMessages.length === 0) return null;

  const firstToolIndex = messages.length - toolMessages.length;
  const prev = messages[firstToolIndex - 1];
  if (!prev || prev.role !== 'assistant' || !Array.isArray(prev.tool_calls) || prev.tool_calls.length === 0) {
    return {
      code: 'missing_assistant_tool_calls',
      message: 'Invalid tool backfill: trailing tool messages must follow an assistant message with tool_calls',
      param: 'messages'
    };
  }

  const idToName = new Map();
  for (const call of prev.tool_calls) {
    if (!call || typeof call !== 'object') continue;
    const id = typeof call.id === 'string' ? call.id.trim() : '';
    if (!id) continue;
    const name = call.function && typeof call.function.name === 'string' ? call.function.name : '';
    idToName.set(id, name);
  }

  if (idToName.size === 0) {
    return {
      code: 'missing_tool_call_id',
      message: 'Invalid tool backfill: assistant.tool_calls[] must include id fields',
      param: 'messages'
    };
  }

  const seen = new Set();
  for (const m of toolMessages) {
    const toolCallId = typeof m.tool_call_id === 'string' ? m.tool_call_id.trim() : '';
    if (!toolCallId) {
      return {
        code: 'missing_tool_call_id',
        message: 'Invalid tool backfill: tool messages must include tool_call_id',
        param: 'messages'
      };
    }
    if (!idToName.has(toolCallId)) {
      return {
        code: 'tool_call_id_mismatch',
        message: `Invalid tool backfill: tool_call_id not found in previous assistant.tool_calls: ${toolCallId}`,
        param: 'messages'
      };
    }
    if (seen.has(toolCallId)) {
      return {
        code: 'duplicate_tool_call_id',
        message: `Invalid tool backfill: duplicate tool_call_id in tool messages: ${toolCallId}`,
        param: 'messages'
      };
    }
    seen.add(toolCallId);

    const expectedName = idToName.get(toolCallId) || '';
    const providedName = typeof m.name === 'string' ? m.name.trim() : '';
    if (providedName && expectedName && providedName !== expectedName) {
      return {
        code: 'tool_name_mismatch',
        message: `Invalid tool backfill: tool name does not match tool_call_id ${toolCallId} (expected ${expectedName}, got ${providedName})`,
        param: 'messages'
      };
    }
  }

  return null;
}

function formatToolResultsForPrompt(toolMessages) {
  if (!Array.isArray(toolMessages) || toolMessages.length === 0) return '';
  const maxChars = envInt('TOOL_RESULT_MAX_CHARS', 20_000);
  const lines = [];
  for (const m of toolMessages) {
    const name = m.name || 'tool';
    const toolCallId = m.tool_call_id || '';
    let content = extractMessageText(m.content);
    if (maxChars > 0 && content.length > maxChars) {
      content = truncateTextKeepHeadAndTail(content, maxChars, '[工具输出已截断]');
    }
    const header = toolCallId ? `- 工具 ${name}（tool_call_id=${toolCallId}）输出：` : `- 工具 ${name} 输出：`;
    lines.push(header);
    lines.push(content);
  }
  return lines.join('\n');
}

function groupToolCallChains(messages) {
  // 将消息分组：识别完整的 [user → assistant(tool_calls) → tool...] 链
  const groups = [];
  let current = [];
  
  for (const m of messages) {
    if (m.role === 'user') {
      // 新的 user 消息开启新组
      if (current.length > 0) {
        groups.push({ messages: current, hasTools: current.some(x => x.role === 'tool') });
      }
      current = [m];
    } else {
      current.push(m);
    }
  }
  if (current.length > 0) {
    groups.push({ messages: current, hasTools: current.some(x => x.role === 'tool') });
  }
  return groups;
}

function selectImportantGroups(groups, maxTurns) {
  // 智能选择：优先保留工具调用链 + 最近对话
  if (groups.length <= maxTurns) return groups;
  
  const result = [];
  const toolGroups = groups.filter(g => g.hasTools);
  const recentGroups = groups.slice(-Math.ceil(maxTurns * 0.6)); // 最近 60% 必保留
  
  // 合并去重：工具组（最多保留最近3个）+ 最近组
  const toolGroupsToKeep = toolGroups.slice(-3);
  const combined = new Map();
  for (const g of [...toolGroupsToKeep, ...recentGroups]) {
    const key = g.messages[0] ? JSON.stringify(g.messages[0]) : Math.random();
    combined.set(key, g);
  }
  
  const selected = Array.from(combined.values());
  // 按原始顺序排序并限制数量
  return selected
    .sort((a, b) => groups.indexOf(a) - groups.indexOf(b))
    .slice(-maxTurns);
}

function formatConversationForQuery(messages) {
  // 兼容上游忽略 messages 的情况：将最近对话历史压缩拼进 query
  // 仅保留 user/assistant/tool，忽略 system（system 会单独通过 messages/instruction 注入）
  if (!Array.isArray(messages) || messages.length === 0) return '';

  const maxTurns = envInt('CONTEXT_MAX_TURNS', 15); // Claude Sonnet 4.5 支持 200K token 上下文
  const maxChars = envInt('CONTEXT_MAX_CHARS', 20_000);
  const smartCompress = envBool('CONTEXT_SMART_COMPRESS', true);
  const preserveToolChains = envBool('CONTEXT_PRESERVE_TOOL_CHAINS', true);

  const filtered = messages.filter((m) => m && (m.role === 'user' || m.role === 'assistant' || m.role === 'tool'));
  let tail = [];

  // 智能压缩：识别并完整保留工具调用链
  if (smartCompress && preserveToolChains && filtered.length > maxTurns) {
    const groups = groupToolCallChains(filtered);
    const selectedGroups = selectImportantGroups(groups, maxTurns);
    tail = selectedGroups.flatMap(g => g.messages);
  } else {
    tail = maxTurns > 0 ? filtered.slice(-maxTurns) : filtered;
  }

  const lines = [];
  for (const m of tail) {
    if (m.role === 'user') {
      const t = extractMessageText(m.content);
      if (t) {
        const userMax = envInt('CONTEXT_USER_MAX_CHARS', 5000);
        const truncated = userMax > 0 && t.length > userMax ? `${t.slice(0, userMax)}...` : t;
        lines.push(`User: ${truncated}`);
      }
      continue;
    }
    if (m.role === 'assistant') {
      // assistant 可能 content=null（tool_calls），尽量用简短信息表示
      const t = extractMessageText(m.content);
      if (t) {
        const asstMax = envInt('CONTEXT_ASST_MAX_CHARS', 3000);
        const truncated = asstMax > 0 && t.length > asstMax ? `${t.slice(0, asstMax)}...` : t;
        lines.push(`Assistant: ${truncated}`);
      } else if (Array.isArray(m.tool_calls) && m.tool_calls.length) {
        const names = m.tool_calls.map((c) => (c && c.function && c.function.name) ? c.function.name : (c && c.name) ? c.name : 'tool').slice(0, 5);
        lines.push(`Assistant: [调用工具: ${names.join(', ')}]`);
      }
      continue;
    }
    if (m.role === 'tool') {
      const name = m.name || 'tool';
      let t = extractMessageText(m.content);
      if (t) {
        const perToolMax = envInt('TOOL_RESULT_MAX_CHARS', 20_000);
        if (perToolMax > 0 && t.length > perToolMax) {
          t = truncateTextKeepHeadAndTail(t, perToolMax, '[工具输出已截断]');
        }
        lines.push(`Tool(${name}): ${t}`);
      }
    }
  }

  let out = lines.join('\n');
  
  // 智能截断：如果超长，尝试保留完整的最近几轮而非简单切尾部
  if (maxChars > 0 && out.length > maxChars) {
    const reverseLines = [...lines].reverse();
    const kept = [];
    let currentLen = 0;
    const marker = '[对话历史已截断，仅保留最近关键上下文]\n';
    const budget = maxChars - marker.length;
    
    for (const line of reverseLines) {
      if (currentLen + line.length + 1 <= budget) {
        kept.unshift(line);
        currentLen += line.length + 1;
      } else {
        break;
      }
    }
    
    out = kept.length > 0 ? marker + kept.join('\n') : `${out.slice(out.length - maxChars)}\n[对话历史已截断]`;
  }
  
  return out;
}

function normalizeLegacyFunctionsToTools(functions) {
  if (!Array.isArray(functions) || functions.length === 0) return [];
  return functions
    .filter((fn) => fn && typeof fn === 'object')
    .map((fn) => {
      const name = typeof fn.name === 'string' ? fn.name.trim() : '';
      if (!name) return null;
      return {
        type: 'function',
        function: {
          ...fn,
          name
        }
      };
    })
    .filter(Boolean);
}

function normalizeLegacyFunctionCallToToolChoice(functionCall) {
  if (functionCall == null) return undefined;
  if (typeof functionCall === 'string') {
    const mode = functionCall.trim().toLowerCase();
    if (mode === 'auto' || mode === 'none' || mode === 'required') return mode;
    return undefined;
  }
  if (typeof functionCall === 'object') {
    const name = typeof functionCall.name === 'string' ? functionCall.name.trim() : '';
    if (!name) return undefined;
    return {
      type: 'function',
      function: { name }
    };
  }
  return undefined;
}

function normalizeOpenAIRequestTooling(input) {
  if (!input || typeof input !== 'object') return input;
  const normalized = { ...input };

  let normalizedTools = [];
  if (Array.isArray(input.tools) && input.tools.length > 0) {
    normalizedTools = input.tools
      .filter((tool) => tool && typeof tool === 'object')
      .map((tool) => {
        if (tool.type === 'function' && tool.function && typeof tool.function === 'object') {
          const fnName = typeof tool.function.name === 'string' ? tool.function.name.trim() : tool.function.name;
          return {
            ...tool,
            function: {
              ...tool.function,
              ...(typeof fnName === 'string' ? { name: fnName } : {})
            }
          };
        }
        // 兼容旧格式：tools 里直接传 function schema（没有 type/function 外壳）。
        // 注意：不要把非 function 的 tools（如 MCP 描述符 type="mcp"）误判为 function。
        if ((!tool.type || tool.type === 'function') && typeof tool.name === 'string' && tool.name.trim()) {
          return {
            type: 'function',
            function: {
              ...tool,
              name: tool.name.trim()
            }
          };
        }
        return { ...tool };
      });
  } else if (Array.isArray(input.functions) && input.functions.length > 0) {
    normalizedTools = normalizeLegacyFunctionsToTools(input.functions);
  }

  if (normalizedTools.length > 0) {
    normalized.tools = normalizedTools;
  }

  if (normalized.tool_choice == null) {
    const mappedToolChoice = normalizeLegacyFunctionCallToToolChoice(input.function_call);
    if (mappedToolChoice !== undefined) {
      normalized.tool_choice = mappedToolChoice;
    }
  }

  return normalized;
}

// OpenAI 格式转上游格式 (完整传递，支持工具调用)
function convertToUpstreamFormat(
  openaiRequest,
  sessionId,
  exchangeId,
  personaId,
  storedSession,
  modelProfile,
  tokenBudgetDecision,
  requestId,
  contextManagementOptions = {}
) {
  const contextMode = contextManagementOptions && contextManagementOptions.mode === 'budget_recover'
    ? 'budget_recover'
    : 'normal';
  const defaultContextManagement = {
    messages: Array.isArray(openaiRequest.messages) ? openaiRequest.messages : [],
    truncationApplied: false,
    droppedMessageCount: 0,
    summaryApplied: false,
    summaryText: ''
  };
  const contextManagement = contextMode === 'budget_recover'
    ? buildBudgetManagedMessages(openaiRequest.messages, contextManagementOptions)
    : defaultContextManagement;
  const workingMessages = Array.isArray(contextManagement.messages) ? contextManagement.messages : [];
  const lastMessage = workingMessages[workingMessages.length - 1];
  const rawTools = Array.isArray(openaiRequest.tools) ? openaiRequest.tools : [];
  
  // 工具策略：
  // - 对客户端：只要请求里带 tools，就进入 toolMode（保证“工具调用闭环”稳定）
  // - 对上游：默认不透传 tools（避免上游误以为要执行工具）；如需透传，建议仅在新会话/定期刷新时发送
  const isNewSession = !sessionId || sessionId === 'new';
  const turnCount = storedSession ? storedSession.turnCount || 0 : 0;
  const hasToolsInRequest = rawTools.length > 0;
  
  const toolMaxCount = Number(process.env.TOOL_MAX_COUNT || 15);
  const toolDescMaxChars = Number(process.env.TOOL_DESC_MAX_CHARS || 200);
  const tools = hasToolsInRequest ? reduceTools(rawTools, toolMaxCount, toolDescMaxChars, workingMessages) : [];
  const toolMode = tools.length > 0;
  const sendUpstreamTools = envBool('SEND_UPSTREAM_TOOLS', false);
  const shouldSendUpstreamTools = sendUpstreamTools && (isNewSession || (turnCount > 0 && turnCount % 20 === 0));
  
  if (shouldSendUpstreamTools && !isNewSession) {
    console.log(`🔄 Refreshing upstream tools at turn ${turnCount}`);
  }
  if (hasToolsInRequest && rawTools.length > tools.length) {
    console.log(`⚠ Tools trimmed: ${rawTools.length} -> ${tools.length}`);
  }
  if (hasToolsInRequest && envBool('LOG_TOOL_SELECTION', false)) {
    const toolNameOf = (tool) => {
      const fn = tool && (tool.function || tool);
      return (fn && fn.name) ? String(fn.name) : '';
    };
    const selectedNames = tools.map(toolNameOf).filter(Boolean);
    console.log(`🧰 Selected tools (${selectedNames.length}/${rawTools.length}): ${selectedNames.join(', ')}`);
  }
  const trailingToolMessages = collectTrailingToolMessages(workingMessages);
  const hasToolResults = trailingToolMessages.length > 0;

  // 注意：当本轮是“工具已执行完成 → 请求模型总结/回答”时，不要强制再次调用工具
  const forceToolCall = !hasToolResults && (openaiRequest.tool_choice === 'required' || process.env.FORCE_TOOL_CALL === '1');
  const toolInstruction = toolMode ? buildToolInstruction(tools, forceToolCall) : '';

  // OpenAI 工具调用闭环：如果最后一条是 tool，则 query 应该基于最后一个 user 问题 + 工具结果
  const lastUser = findLastMessageByRole(workingMessages, 'user');
  const baseUserText = extractMessageText(lastUser ? lastUser.content : (lastMessage && lastMessage.content));
  const toolResultsText = formatToolResultsForPrompt(trailingToolMessages);

  // 上下文记忆策略：
  // 1. 如果有 session_id，后端会自动记住上下文，无需在 query 里重复拼接
  // 2. 如果是新会话（无 session_id），可选择性拼接对话历史
  const hasSession = sessionId && sessionId !== 'new';
  const shouldIncludeContext = envBool('INCLUDE_CONTEXT_IN_QUERY', true) && !hasSession;
  const conversationBaseText = shouldIncludeContext ? formatConversationForQuery(workingMessages) : '';
  const summaryMemoryText = (shouldIncludeContext && contextManagement.summaryApplied && contextManagement.summaryText)
    ? `[历史摘要记忆]\n${contextManagement.summaryText}`
    : '';
  const conversationText = [summaryMemoryText, conversationBaseText].filter(Boolean).join('\n\n');

  if (hasSession) {
    console.log(`ℹ Using session_id_fp=${fingerprint(sessionId)}, context managed by backend`);
  } else if (conversationText) {
    console.log(`ℹ New session, including ${conversationText.length} chars context in query`);
  }

  const toolInstructionMode = (process.env.TOOL_INSTRUCTION_MODE || 'both').toLowerCase();
  const injectIntoQuery = toolMode && (toolInstructionMode === 'query' || toolInstructionMode === 'both');
  const injectIntoMessages = toolMode && (toolInstructionMode === 'messages' || toolInstructionMode === 'both');
  // query 做总长度保护：优先分段裁剪（工具结果/对话历史/工具协议），避免整体截断导致“当前问题”丢失
  const inputCharBudget = Math.max(1, tokenBudgetDecision.availableInputTokens * 4);
  const queryMaxCharsConfigured = toPositiveInt(envInt('QUERY_MAX_CHARS', 30_000)) || 30_000;
  const queryMaxChars = Math.min(queryMaxCharsConfigured, inputCharBudget);
  const safeQuery = buildSafeQueryForUpstream({
    conversationText,
    toolResultsText,
    questionText: baseUserText,
    toolInstruction,
    injectIntoQuery,
    injectIntoMessages,
    queryMaxChars
  });
  if (envBool('LOG_TOOL_PARSE', false)) {
    if (typeof safeQuery === 'string' && safeQuery.length > queryMaxChars) {
      console.warn(`⚠ SafeQuery still exceeds QUERY_MAX_CHARS: ${safeQuery.length} > ${queryMaxChars}`);
    }
  }
  
  // 从 model 参数提取实际的模型名称
  // 例如: "mix/qwen-3-235b-instruct" -> "qwen-3-235b-instruct"
  const modelSlug = normalizeModelSlug(openaiRequest.model);
  
  // 构建基础请求
  const systemPromptConfigured = toPositiveInt(process.env.SYSTEM_PROMPT_MAX_CHARS) || 10_000;
  const systemMaxChars = Math.min(systemPromptConfigured, inputCharBudget);
  const safeMessages = toolMode ? trimSystemMessages(workingMessages, systemMaxChars) : workingMessages;
  if (toolMode && workingMessages !== safeMessages) {
    console.log(`⚠ System prompt trimmed to ${systemMaxChars} chars to avoid token overflow`);
  }

  // 根据是否有 session 决定 messages 处理策略：
  // - 有 session：后端会管理历史，可以发送较少的 messages（最近几条即可）
  // - 无 session 且拼接了上下文：避免重复，裁剪 messages
  // - 无 session 且未拼接：发送完整 messages 让后端处理
  let upstreamMessages = safeMessages;
  if (hasSession) {
    // 有 session 时只发送最近几条消息即可，后端会自动关联历史
    upstreamMessages = trimMessagesForUpstream(safeMessages);
    console.log('ℹ Session mode: sending recent messages only');
  } else if (shouldIncludeContext) {
    // 新会话且已拼接上下文到 query，裁剪 messages 避免重复
    upstreamMessages = trimMessagesForUpstream(safeMessages);
    console.log('⚠ Context included in query, trimming messages to avoid duplication');
  }

  const resolvedPersonaId = personaId || process.env.DEFAULT_PERSONA_ID || null;

  const upstreamRequest = {
    request: {
      agent_slug: "web-general",
      model_slug: modelSlug || "qwen-3-235b",
      locale: {
        location: "Asia/Shanghai",
        language: "zh-CN"
      },
      ...(resolvedPersonaId ? { persona_id: resolvedPersonaId } : {}),
      modes: {
        search: true
      },
      query: safeQuery
    },
    is_personalized: true,
    // 工具模式/工具结果/请求中带工具时使用非流式，确保完整解析工具调用或等待总结
    stream: (toolMode || hasToolResults || hasToolsInRequest) ? false : openaiRequest.stream !== false,
    // 完整传递消息历史（注入工具说明）
    messages: injectIntoMessages ? injectToolInstruction(upstreamMessages, tools, forceToolCall) : upstreamMessages
  };
    // 传递工具调用相关字段（新会话或每20轮时）
    // 默认不向上游发送 tools，避免上游尝试“执行工具”而导致 registry 不存在
    if (shouldSendUpstreamTools && tools.length > 0) {
      upstreamRequest.tools = tools;
    }
    if (shouldSendUpstreamTools && openaiRequest.tool_choice) {
      upstreamRequest.tool_choice = openaiRequest.tool_choice;
    }
  
    // 传递其他OpenAI参数
    if (openaiRequest.temperature !== undefined) {
      upstreamRequest.temperature = openaiRequest.temperature;
    }
    if (openaiRequest.top_p !== undefined) {
      upstreamRequest.top_p = openaiRequest.top_p;
    }
    upstreamRequest.max_tokens = tokenBudgetDecision.reservedOutputTokens;
  
  
  // 只有在提供了有效 session_id 时才添加
  // 注意：上游请求用 session_id（下划线），响应用 sessionId（驼峰）
  if (sessionId && sessionId !== 'new') {
    upstreamRequest.session_id = sessionId;
  }
  if (exchangeId && exchangeId !== 'new') {
    upstreamRequest.exchange_id = exchangeId;
  }

  const contextManagementResult = {
    mode: contextMode,
    truncationApplied: contextManagement.truncationApplied,
    summaryApplied: contextManagement.summaryApplied,
    droppedMessageCount: contextManagement.droppedMessageCount,
    keptMessageCount: workingMessages.length
  };

  if (contextMode === 'budget_recover') {
    console.log(
      `[${requestId}] model.profile.context_management ` +
      `mode=${contextManagementResult.mode} truncation_applied=${contextManagementResult.truncationApplied} ` +
      `summary_applied=${contextManagementResult.summaryApplied} dropped_messages=${contextManagementResult.droppedMessageCount} ` +
      `kept_messages=${contextManagementResult.keptMessageCount}`
    );
  }

  return { upstreamRequest, toolMode, hasToolResults, contextManagement: contextManagementResult };
}

function extractTextFromUpstreamResponse(input) {
  // 上游非流式响应格式（常见）：{"id":"...","parts":[{"type":"text","text":"..."},{"type":"tool-input",...}]}
  // 兼容：input 可能是 string / object
  try {
    const obj = (typeof input === 'string') ? JSON.parse(input) : input;
    if (obj && obj.parts) {
      const parts = Array.isArray(obj.parts) ? obj.parts : [obj.parts];
      const toolCalls = [];
      let textContent = '';

      // 🔧 遍历所有 parts，提取工具调用和文本内容
      for (const part of parts) {
        if (part && part.type === 'error' && part.error_text) {
          return `[Upstream Error] ${part.error_text}`;
        }
        if (part && part.type === 'tool-input' && part.tool_name && part.tool_input !== undefined) {
          toolCalls.push({
            tool_call: {
              name: part.tool_name,
              arguments: part.tool_input
            }
          });
        } else if (part && part.type === 'text' && typeof part.text === 'string') {
          textContent += part.text;
        }
      }

      // 如果有工具调用：返回 tool_call JSON（可多条）+（可选）final，用于“工具名不合法/被过滤”时降级成纯文本
      if (toolCalls.length > 0) {
        const result = toolCalls.map((tc) => JSON.stringify(tc)).join('\n');
        if (textContent) {
          return `${result}\n${JSON.stringify({ final: textContent })}`;
        }
        return result;
      }

      // 只有文本内容
      if (textContent) return textContent;
    }
  } catch (e) {
    // ignore
  }
  if (typeof input === 'string') return input;
  if (input == null) return '';
  return JSON.stringify(input);
}

function extractErrorFromUpstreamResponse(input) {
  try {
    const obj = (typeof input === 'string') ? JSON.parse(input) : input;
    if (!obj) return null;
    if (obj.error && (obj.error.message || obj.error.error_text)) {
      return obj.error.message || obj.error.error_text;
    }
    if (obj.parts) {
      const parts = Array.isArray(obj.parts) ? obj.parts : [obj.parts];
      for (const part of parts) {
        if (part && part.type === 'error' && part.error_text) {
          return part.error_text;
        }
      }
    }
  } catch {
    return null;
  }
  return null;
}

function parseToolCallFromText(text) {
  const jsonObjects = extractJsonObjectsFromText(text);
  if (!jsonObjects.length) {
    const jsonText = extractJsonFromText(text);
    if (!jsonText) {
      if (envBool('LOG_TOOL_PARSE', false)) {
        console.log('⚠ extractJsonFromText returned null');
      }
      return null;
    }
    jsonObjects.push(jsonText);
  }

  if (envBool('LOG_TOOL_PARSE', false)) {
    console.log('🔧 JSON objects to parse:', jsonObjects.length);
  }
  const toolCalls = [];
  let final = null;
  let hasAnyJsonParsed = false;

  for (const jsonText of jsonObjects) {
    try {
      const obj = JSON.parse(jsonText);
      hasAnyJsonParsed = true;
      if (envBool('LOG_TOOL_PARSE', false)) {
        console.log('✅ JSON parsed successfully:', JSON.stringify(obj).substring(0, 300));
      }
      if (obj.tool_call) {
        toolCalls.push(obj.tool_call);
        continue;
      }
      if (Array.isArray(obj.tool_calls)) {
        toolCalls.push(...obj.tool_calls);
        continue;
      }
      if (obj.name && obj.arguments) {
        toolCalls.push({ name: obj.name, arguments: obj.arguments });
        continue;
      }
      if (obj.final) {
        final = obj.final;
      }
    } catch (e) {
      if (envBool('LOG_TOOL_PARSE', false)) {
        console.warn('⚠ JSON object parse skipped:', e.message);
      }
    }
  }

  if (toolCalls.length > 0) {
    // 重要：保留 final（如果存在），用于“工具调用被过滤/降级成文本”场景
    return { toolCalls, final };
  }
  if (final) {
    return { toolCalls: null, final };
  }
  if (hasAnyJsonParsed && envBool('LOG_TOOL_PARSE', false)) {
    console.log('⚠ JSON parsed but no matching structure found');
  }

  const looseParsed = parseLooseToolCallsFromText(text);
  if (looseParsed) {
    if (envBool('LOG_TOOL_PARSE', false)) {
      console.log(`✅ Loose tool_call parsed: ${looseParsed.toolCalls.map((t) => t.name).join(', ')}`);
    }
    return looseParsed;
  }
  return null;
}

function createUpstreamAgents() {
  const keepAlive = envBool('UPSTREAM_KEEP_ALIVE', true);
  return {
    httpAgent: new http.Agent({ keepAlive }),
    httpsAgent: new https.Agent({ keepAlive })
  };
}

const UPSTREAM_AGENTS = createUpstreamAgents();
const managedUpstreamTokenService = createManagedUpstreamTokenService({
  fetch,
  httpAgent: UPSTREAM_AGENTS.httpAgent,
  httpsAgent: UPSTREAM_AGENTS.httpsAgent,
  config: {
    UPSTREAM_API_BASE,
    UPSTREAM_TOKEN_URL,
    UPSTREAM_TOKEN_PATH,
    UPSTREAM_TOKEN_METHOD,
    UPSTREAM_TOKEN_HEADERS_JSON,
    UPSTREAM_TOKEN_BODY_JSON,
    UPSTREAM_TOKEN_FIELD,
    UPSTREAM_TOKEN_EXPIRES_IN_FIELD,
    UPSTREAM_TOKEN_TIMEOUT_MS,
    UPSTREAM_TOKEN_EXPIRY_SKEW_MS
  },
  helpers: {
    base64UrlToJson,
    redactSensitiveText,
    fingerprint,
    extractErrorFromUpstreamResponse
  }
});
const upstreamRequestService = createUpstreamRequestService({
  fetch,
  httpAgent: UPSTREAM_AGENTS.httpAgent,
  httpsAgent: UPSTREAM_AGENTS.httpsAgent,
  config: {
    UPSTREAM_API_BASE,
    UPSTREAM_CHAT_PATH,
    UPSTREAM_ACCEPT_LANGUAGE,
    UPSTREAM_REFERER
  },
  helpers: {
    redactSensitiveText
  }
});
const upstreamReadService = createUpstreamReadService({
  helpers: {
    extractIdsFromUpstream,
    extractErrorFromUpstreamResponse,
    redactSensitiveText,
    fingerprint
  }
});
const toolResponseService = createToolResponseService({
  helpers: {
    extractTextFromUpstreamResponse,
    parseToolCallFromText,
    normalizeToolCallArguments,
    validateAndFilterToolCalls,
    extractFinalFromTextProtocol,
    looksLikeToolCallPayload,
    ensureSafeFinalText
  }
});
const openAIResponseService = createOpenAIResponseService({
  helpers: {
    toOpenAIToolCallsForMessage,
    writeToolCallStream,
    writeFinalStream,
    setRequestEndReason,
    uuidv4
  }
});
const chatOrchestrationService = createChatOrchestrationService({
  helpers: {
    fingerprint,
    convertToUpstreamFormat,
    resolveTokenBudgetDecision,
    estimateUpstreamInputTokens
  }
});

function writeSseChunk(res, chunk) {
  res.write(`data: ${JSON.stringify(chunk)}\n\n`);
}

function writeToolCallStream(res, id, model, toolCalls) {
  const openAiToolCalls = toOpenAIToolCallsForChunk(toolCalls);
  const chunk = {
    id,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{
      index: 0,
      delta: { role: 'assistant', tool_calls: openAiToolCalls },
      finish_reason: null
    }]
  };
  writeSseChunk(res, chunk);
  const endChunk = {
    id,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{
      index: 0,
      delta: {},
      finish_reason: 'tool_calls'
    }]
  };
  writeSseChunk(res, endChunk);
  res.write('data: [DONE]\n\n');
  res.end();
}

function writeFinalStream(res, id, model, content) {
  const chunk = {
    id,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{
      index: 0,
      delta: { role: 'assistant', content },
      finish_reason: null
    }]
  };
  writeSseChunk(res, chunk);
  const endChunk = {
    id,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{
      index: 0,
      delta: {},
      finish_reason: 'stop'
    }]
  };
  writeSseChunk(res, endChunk);
  res.write('data: [DONE]\n\n');
  res.end();
}

// 上游 SSE 格式转 OpenAI SSE 格式
function convertUpstreamToOpenAI(upstreamData, model, id) {
  // 上游 API 实际返回格式：
  // {"type":"start","messageMetadata":{...},"messageId":"..."}
  // {"type":"start-step"}
  // {"type":"text-start","id":"..."}
  // {"type":"text-delta","id":"...","delta":"实际内容"}  <- 这是文本增量
  // {"type":"text-end","id":"..."}
  // {"type":"finish-step"}
  // {"type":"finish"}
  // {"type":"data-usage","data":{...}}
  
  // 只有 type=text-delta 时才返回内容
  if (upstreamData.type === 'text-delta') {
    return {
      id,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: model,
      choices: [{
        index: 0,
        delta: {
          content: upstreamData.delta || ''
        },
        finish_reason: null
      }]
    };
  }
  
  // type=finish 时返回结束标记
  if (upstreamData.type === 'finish') {
    return {
      id,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: model,
      choices: [{
        index: 0,
        delta: {},
        finish_reason: 'stop'
      }]
    };
  }
  
  // 其他类型（start, start-step, text-start, text-end, finish-step, data-usage等）返回 null
  return null;
}

const handleChatCompletion = createChatHandler({
  uuidv4,
  envInt,
  envBool,
  sendOpenAIError,
  setRequestEndReason,
  setRequestUpstreamStatus,
  resolveInboundToken,
  resolveUpstreamToken,
  inspectTokenInfo,
  prepareChatRequestContext,
  normalizeOpenAIRequestTooling,
  validateTrailingToolBackfill,
  resolveModelProfile,
  resolveTokenBudgetDecision,
  sessionKeyService,
  managedUpstreamTokenService,
  chatOrchestrationService,
  observeBudgetDecision,
  upstreamRequestService,
  UPSTREAM_AUTH_RECOVERY_RETRY,
  upstreamReadService,
  toolResponseService,
  openAIResponseService,
  startUpstreamStreamBridge,
  sessionStoreService,
  redactSensitiveText,
  fingerprint,
  extractIdsFromUpstream,
  convertUpstreamToOpenAI,
  base64UrlToJson
});

function createApp() {
  const app = express();
  app.disable('x-powered-by');

  registerCoreMiddlewares(app, {
    createRequestIdMiddleware,
    createJsonBodyErrorMiddleware,
    createRequestLogMiddleware,
    normalizeRequestId,
    uuidv4,
    expressJson: express.json,
    bodySizeLimit: process.env.BODY_SIZE_LIMIT || '5mb',
    sendOpenAIError,
    envBool,
    redactHeaders,
    maybeRecordSampleTrace
  });

  registerCoreRoutes(app, {
    handleChatCompletion,
    resolveModelIds,
    defaultModelIds: DEFAULT_MODEL_IDS
  });

  return app;
}

function onServerStarted() {
  startSampleTraceCleanupTask();
  void sessionStoreService.initRedisSessionClient();
}

module.exports = {
  createApp,
  onServerStarted,
  PORT
};

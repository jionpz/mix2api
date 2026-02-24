function createObservability({ uuidv4, fingerprint, config }) {
  const {
    TRACE_SAMPLING_ENABLED,
    TRACE_SAMPLING_RATE,
    TRACE_RETENTION_MS,
    TRACE_MAX_ENTRIES,
    TRACE_CLEANUP_INTERVAL_MS
  } = config;

  const sampleTraceStore = new Map();
  let sampleTraceCleanupTimer = null;

  function purgeExpiredSampleTraces(nowMs, reason) {
    if (sampleTraceStore.size === 0) return 0;
    const now = Number.isFinite(Number(nowMs)) ? Number(nowMs) : Date.now();
    let removed = 0;
    for (const [traceId, trace] of sampleTraceStore.entries()) {
      const expiresAt = trace && Number.isFinite(Number(trace.expiresAt)) ? Number(trace.expiresAt) : 0;
      if (expiresAt > 0 && expiresAt <= now) {
        sampleTraceStore.delete(traceId);
        removed++;
      }
    }
    if (removed > 0) {
      const why = reason ? ` reason=${reason}` : '';
      console.log(`[${new Date().toISOString()}] trace.purged count=${removed} remaining=${sampleTraceStore.size}${why}`);
    }
    return removed;
  }

  function evictOldestSampleTraceIfNeeded() {
    while (sampleTraceStore.size >= TRACE_MAX_ENTRIES) {
      const oldestKey = sampleTraceStore.keys().next();
      if (!oldestKey || oldestKey.done) break;
      sampleTraceStore.delete(oldestKey.value);
    }
  }

  function shouldSampleCurrentRequest() {
    if (!TRACE_SAMPLING_ENABLED) return false;
    if (!Number.isFinite(TRACE_SAMPLING_RATE) || TRACE_SAMPLING_RATE <= 0) return false;
    if (TRACE_SAMPLING_RATE >= 1) return true;
    return Math.random() < TRACE_SAMPLING_RATE;
  }

  function buildSampleTrace(req, res, meta) {
    const now = Date.now();
    const requestId = req && req.requestId ? String(req.requestId) : uuidv4();
    const body = (req && req.body && typeof req.body === 'object') ? req.body : {};
    const headers = req && req.headers ? req.headers : {};
    const messageCount = Array.isArray(body.messages) ? body.messages.length : 0;
    const toolCount = Array.isArray(body.tools) ? body.tools.length : 0;
    const hasFunctions = Array.isArray(body.functions) && body.functions.length > 0;
    const authHeader = Array.isArray(headers.authorization) ? headers.authorization[0] : headers.authorization;

    return {
      traceId: `trace_${uuidv4()}`,
      requestId,
      createdAt: now,
      expiresAt: now + TRACE_RETENTION_MS,
      method: req && req.method ? String(req.method) : 'UNKNOWN',
      path: req && req.url ? String(req.url) : '/',
      client: res && res.locals && res.locals.client != null ? String(res.locals.client) : 'unknown',
      stream: res && res.locals && res.locals.stream != null ? String(res.locals.stream) : 'unknown',
      toolsPresent: res && res.locals && res.locals.toolsPresent != null ? String(res.locals.toolsPresent) : 'unknown',
      endReason: res && res.locals && res.locals.endReason ? String(res.locals.endReason) : 'unknown',
      httpStatus: res && Number.isFinite(Number(res.statusCode)) ? Number(res.statusCode) : 0,
      upstreamStatus: res && res.locals && res.locals.upstreamStatus != null ? String(res.locals.upstreamStatus) : 'none',
      durationMs: meta && Number.isFinite(Number(meta.durationMs)) ? Number(meta.durationMs) : 0,
      requestSummary: {
        model: typeof body.model === 'string' ? body.model : null,
        messageCount,
        toolCount,
        hasLegacyFunctions: hasFunctions,
        authFingerprint: authHeader ? fingerprint(authHeader) : 'none'
      }
    };
  }

  function maybeRecordSampleTrace(req, res, meta) {
    if (!shouldSampleCurrentRequest()) return;
    const now = Date.now();
    purgeExpiredSampleTraces(now, 'before_store');
    evictOldestSampleTraceIfNeeded();
    const trace = buildSampleTrace(req, res, meta);
    sampleTraceStore.set(trace.traceId, trace);
    console.log(
      `[${new Date().toISOString()}] [${trace.requestId}] trace.sampled trace_id=${trace.traceId} ` +
      `expires_at=${new Date(trace.expiresAt).toISOString()} status=${trace.httpStatus} ` +
      `end_reason=${trace.endReason} client=${trace.client} stream=${trace.stream} tools_present=${trace.toolsPresent}`
    );
  }

  function startSampleTraceCleanupTask() {
    if (!TRACE_SAMPLING_ENABLED) return;
    if (sampleTraceCleanupTimer) return;
    sampleTraceCleanupTimer = setInterval(() => {
      purgeExpiredSampleTraces(Date.now(), 'timer');
    }, TRACE_CLEANUP_INTERVAL_MS);
    if (typeof sampleTraceCleanupTimer.unref === 'function') {
      sampleTraceCleanupTimer.unref();
    }
  }

  function observeBudgetDecision(res, requestId, model, tokenBudgetDecision, contextManagement) {
    const safeModel = String(model || 'unknown');
    const decision = tokenBudgetDecision && typeof tokenBudgetDecision === 'object'
      ? tokenBudgetDecision
      : null;
    const context = contextManagement && typeof contextManagement === 'object'
      ? contextManagement
      : {};
    const inputBudget = decision
      ? `${decision.estimatedInputTokens}/${decision.availableInputTokens}`
      : 'none';
    const outputBudget = decision
      ? String(decision.reservedOutputTokens)
      : 'none';
    const truncationApplied = Boolean(context.truncationApplied);
    const rejectReason = decision && decision.action === 'reject'
      ? String(decision.reason || 'input_exceeds_available_budget')
      : 'none';

    if (res && res.locals) {
      res.locals.model = safeModel;
      res.locals.inputBudget = inputBudget;
      res.locals.outputBudget = outputBudget;
      res.locals.truncationApplied = String(truncationApplied);
      res.locals.rejectReason = rejectReason;
    }

    if (!requestId) return;
    console.log(
      `[${requestId}] model.profile.budget_observation ` +
      `model=${safeModel} input_budget=${inputBudget} output_budget=${outputBudget} ` +
      `truncation_applied=${truncationApplied} reject_reason=${rejectReason}`
    );
  }

  return {
    maybeRecordSampleTrace,
    startSampleTraceCleanupTask,
    observeBudgetDecision
  };
}

module.exports = {
  createObservability
};

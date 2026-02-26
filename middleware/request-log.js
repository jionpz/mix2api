function createRequestLogMiddleware({ envBool, redactHeaders, maybeRecordSampleTrace, uuidv4 }) {
  return function requestLogMiddleware(req, res, next) {
    const logHeaders = envBool('LOG_HEADERS', false);
    const requestId = req.requestId || String(res.getHeader('x-request-id') || uuidv4());
    const startedAt = Date.now();
    console.log(`[${new Date().toISOString()}] [${requestId}] request.received method=${req.method} path=${req.url}`);
    if (logHeaders) {
      console.log(`[${new Date().toISOString()}] [${requestId}] headers=${JSON.stringify(redactHeaders(req.headers), null, 2)}`);
    }
    let logged = false;
    const writeCompletedLog = () => {
      if (logged) return;
      logged = true;
      const durationMs = Date.now() - startedAt;
      const endReason = res.locals && res.locals.endReason ? res.locals.endReason : 'unknown';
      const upstreamStatus = res.locals && res.locals.upstreamStatus != null ? res.locals.upstreamStatus : 'none';
      const client = res.locals && res.locals.client != null ? res.locals.client : 'unknown';
      const stream = res.locals && res.locals.stream != null ? res.locals.stream : 'unknown';
      const toolsPresent = res.locals && res.locals.toolsPresent != null ? res.locals.toolsPresent : 'unknown';
      const model = res.locals && res.locals.model != null ? res.locals.model : 'unknown';
      const inputBudget = res.locals && res.locals.inputBudget != null ? res.locals.inputBudget : 'none';
      const outputBudget = res.locals && res.locals.outputBudget != null ? res.locals.outputBudget : 'none';
      const truncationApplied = res.locals && res.locals.truncationApplied != null ? res.locals.truncationApplied : 'false';
      const rejectReason = res.locals && res.locals.rejectReason != null ? res.locals.rejectReason : 'none';
      console.log(
        `[${new Date().toISOString()}] [${requestId}] request.completed ` +
        `http_status=${res.statusCode} duration_ms=${durationMs} client=${client} stream=${stream} tools_present=${toolsPresent} ` +
        `model=${model} input_budget=${inputBudget} output_budget=${outputBudget} ` +
        `truncation_applied=${truncationApplied} reject_reason=${rejectReason} ` +
        `end_reason=${endReason} upstream_status=${upstreamStatus}`
      );
      maybeRecordSampleTrace(req, res, { durationMs, startedAt });
    };

    res.on('finish', writeCompletedLog);
    res.on('close', writeCompletedLog);
    next();
  };
}

module.exports = {
  createRequestLogMiddleware
};

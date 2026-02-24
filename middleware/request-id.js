function createRequestIdMiddleware({ normalizeRequestId, uuidv4 }) {
  return function requestIdMiddleware(req, res, next) {
    const headerValue = Array.isArray(req.headers['x-request-id'])
      ? req.headers['x-request-id'][0]
      : req.headers['x-request-id'];
    const requestId = normalizeRequestId(headerValue) || uuidv4();
    req.requestId = requestId;
    res.locals.requestId = requestId;
    res.locals.endReason = 'unknown';
    res.locals.upstreamStatus = null;
    res.locals.client = 'unknown';
    res.locals.stream = 'unknown';
    res.locals.toolsPresent = 'unknown';
    res.locals.model = 'unknown';
    res.locals.inputBudget = 'none';
    res.locals.outputBudget = 'none';
    res.locals.truncationApplied = 'false';
    res.locals.rejectReason = 'none';
    res.setHeader('x-request-id', requestId);
    next();
  };
}

module.exports = {
  createRequestIdMiddleware
};

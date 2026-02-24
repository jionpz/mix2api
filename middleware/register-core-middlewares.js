function registerCoreMiddlewares(app, {
  createRequestIdMiddleware,
  createJsonBodyErrorMiddleware,
  createRequestLogMiddleware,
  normalizeRequestId,
  uuidv4,
  expressJson,
  bodySizeLimit,
  sendOpenAIError,
  envBool,
  redactHeaders,
  maybeRecordSampleTrace
}) {
  app.use(createRequestIdMiddleware({ normalizeRequestId, uuidv4 }));
  app.use(expressJson({ limit: bodySizeLimit || '5mb' }));
  app.use(createJsonBodyErrorMiddleware(sendOpenAIError));
  app.use(createRequestLogMiddleware({ envBool, redactHeaders, maybeRecordSampleTrace, uuidv4 }));
}

module.exports = {
  registerCoreMiddlewares
};

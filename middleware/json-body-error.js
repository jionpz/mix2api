function createJsonBodyErrorMiddleware(sendOpenAIError) {
  return function jsonBodyErrorMiddleware(err, req, res, next) {
    if (!err) return next();

    if (err.type === 'entity.parse.failed') {
      return sendOpenAIError(res, 400, {
        message: 'Invalid JSON body',
        type: 'invalid_request_error',
        code: 'invalid_json',
        param: null
      });
    }
    if (err.type === 'entity.too.large') {
      return sendOpenAIError(res, 413, {
        message: 'Request body too large',
        type: 'invalid_request_error',
        code: 'request_too_large',
        param: null
      });
    }
    return next(err);
  };
}

module.exports = {
  createJsonBodyErrorMiddleware
};

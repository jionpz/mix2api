function sendOpenAIError(res, status, {
  message,
  type = 'invalid_request_error',
  code = null,
  param = null,
  ...extra
}) {
  return res.status(status).json({
    error: {
      message,
      type,
      code,
      param,
      ...extra
    }
  });
}

module.exports = {
  sendOpenAIError
};

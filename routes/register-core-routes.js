function registerCoreRoutes(app, { handleChatCompletion, resolveModelIds, defaultModelIds }) {
  app.post('/v1/chat/completions', handleChatCompletion);
  app.post('/', handleChatCompletion);

  app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'mix2api' });
  });

  app.get('/v1/models', (req, res) => {
    const modelIds = resolveModelIds(process.env.MODEL_LIST, defaultModelIds);
    res.json({
      object: 'list',
      data: modelIds.map((id) => ({
        id,
        object: 'model',
        created: Math.floor(Date.now() / 1000),
        owned_by: 'mix2api'
      }))
    });
  });
}

module.exports = {
  registerCoreRoutes
};

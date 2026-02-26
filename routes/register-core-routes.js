function registerCoreRoutes(app, { handleChatCompletion, resolveModelIds, defaultModelIds, sessionStoreService }) {
  app.post('/v1/chat/completions', handleChatCompletion);
  app.post('/', handleChatCompletion);

  app.get('/health', (req, res) => {
    const storeHealth = sessionStoreService && typeof sessionStoreService.getStoreHealth === 'function'
      ? sessionStoreService.getStoreHealth()
      : { mode: 'memory', degraded: false, reason: null, connected: false };
    const payload = {
      status: storeHealth.degraded ? 'degraded' : 'ok',
      service: 'mix2api',
      session_store: {
        mode: storeHealth.mode,
        degraded: storeHealth.degraded,
        connected: storeHealth.connected,
        reason: storeHealth.reason || null
      }
    };
    res.status(storeHealth.degraded ? 503 : 200).json(payload);
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

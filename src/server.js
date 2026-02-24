const { createApp, onServerStarted, PORT } = require('./app');

function startServer() {
  const app = createApp();
  const server = app.listen(PORT, () => {
    console.log(`mix2api adapter running on port ${PORT}`);
    console.log(`Access at: http://localhost:${PORT}`);
    console.log(`OpenAI-compatible endpoint: http://localhost:${PORT}/v1/chat/completions`);
    onServerStarted();
  });
  return server;
}

module.exports = {
  startServer
};

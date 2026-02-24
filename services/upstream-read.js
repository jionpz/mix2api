function createUpstreamReadService({ helpers }) {
  const {
    extractIdsFromUpstream,
    extractErrorFromUpstreamResponse,
    redactSensitiveText,
    fingerprint
  } = helpers;

  async function readUpstreamStream(response) {
    return new Promise((resolve, reject) => {
      const reader = response.body;
      let buffer = '';
      let text = '';
      let exchangeId = null;
      let sessionId = null;

      reader.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (!line.trim()) continue;
          let jsonData;
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') {
              continue;
            }
            jsonData = data;
          } else {
            jsonData = line;
          }

          try {
            const upstreamData = JSON.parse(jsonData);
            if (!sessionId) {
              const ids = extractIdsFromUpstream(upstreamData);
              if (ids) {
                exchangeId = ids.exchangeId || exchangeId;
                sessionId = ids.sessionId || ids.exchangeId || sessionId;
              }
            }
            if (upstreamData.type === 'text-delta' && upstreamData.delta) {
              text += upstreamData.delta;
            }
          } catch {}
        }
      });

      reader.on('end', () => resolve({ text, sessionId, exchangeId }));
      reader.on('error', (error) => reject(error));
    });
  }

  async function readNonStreamJsonResponse(response, { requestId, logBodies }) {
    const data = await response.json();
    if (logBodies) {
      const safeJson = redactSensitiveText(JSON.stringify(data, null, 2));
      console.log(`[${requestId}] 🔍 Upstream non-stream response:`, safeJson);
    }

    const upstreamError = extractErrorFromUpstreamResponse(data);
    if (upstreamError) {
      return {
        upstreamError: redactSensitiveText(upstreamError),
        text: null,
        upstreamSessionId: null,
        upstreamExchangeId: null
      };
    }

    let upstreamSessionId = null;
    let upstreamExchangeId = null;
    if (data) {
      const ids = extractIdsFromUpstream(data);
      if (logBodies) {
        const exchangeFp = ids && ids.exchangeId ? fingerprint(ids.exchangeId) : 'none';
        const sessionFp = ids && ids.sessionId ? fingerprint(ids.sessionId) : 'none';
        console.log(`[${requestId}] 📋 Extracted IDs from non-stream: exchange_fp=${exchangeFp} session_fp=${sessionFp}`);
      }
      if (ids && (ids.sessionId || ids.exchangeId)) {
        upstreamSessionId = ids.sessionId || ids.exchangeId;
        upstreamExchangeId = ids.exchangeId || upstreamExchangeId;
      }
    }

    return {
      upstreamError: null,
      text: data.content || data.text || JSON.stringify(data),
      upstreamSessionId,
      upstreamExchangeId
    };
  }

  return {
    readUpstreamStream,
    readNonStreamJsonResponse
  };
}

module.exports = {
  createUpstreamReadService
};

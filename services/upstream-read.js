const { createSseEventParser } = require('./sse-parser');

function createUpstreamReadService({ helpers }) {
  const {
    extractIdsFromUpstream,
    extractErrorFromUpstreamResponse,
    redactSensitiveText,
    fingerprint
  } = helpers;

  async function readUpstreamStream(response, options = {}) {
    const {
      timeoutMs = 0,
      requestId = 'unknown',
      redactLine = null
    } = options;
    return new Promise((resolve, reject) => {
      const reader = response.body;
      let text = '';
      let exchangeId = null;
      let sessionId = null;
      let done = false;
      let timeout = null;

      const clearTimer = () => {
        if (timeout) {
          clearTimeout(timeout);
          timeout = null;
        }
      };

      const resetTimer = () => {
        clearTimer();
        if (!Number.isFinite(Number(timeoutMs)) || Number(timeoutMs) <= 0) return;
        timeout = setTimeout(() => {
          if (done) return;
          done = true;
          if (reader && typeof reader.destroy === 'function' && !reader.destroyed) {
            reader.destroy(new Error('stream timeout'));
          }
          reject(new Error('stream timeout'));
        }, Number(timeoutMs));
        if (typeof timeout.unref === 'function') timeout.unref();
      };

      const parser = createSseEventParser(({ data }) => {
        if (!data || !data.trim()) return;
        if (data === '[DONE]') return;

        try {
          const upstreamData = JSON.parse(data);
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
        } catch (error) {
          if (typeof redactLine === 'function') {
            const safeLine = String(redactLine(String(data || '')) || '').slice(0, 300);
            console.warn(`[${requestId}] upstream stream parse skipped line=${safeLine}`);
          }
        }
      });

      resetTimer();

      reader.on('data', (chunk) => {
        resetTimer();
        parser.push(chunk.toString());
      });

      reader.on('end', () => {
        if (done) return;
        done = true;
        clearTimer();
        parser.flush();
        resolve({ text, sessionId, exchangeId });
      });
      reader.on('error', (error) => {
        if (done) return;
        done = true;
        clearTimer();
        reject(error);
      });
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

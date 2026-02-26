const { createSseEventParser } = require('./sse-parser');

function startUpstreamStreamBridge({
  req,
  res,
  response,
  requestId,
  storeKey,
  model,
  streamId,
  logBodies,
  sessionStoreService,
  setRequestEndReason,
  redactSensitiveText,
  fingerprint,
  extractIdsFromUpstream,
  convertUpstreamToOpenAI,
  timeoutMs
}) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  let capturedSessionId = null;
  let sentAny = false;
  let doneSent = false;
  const pendingChunks = [];
  const flushPending = () => {
    if (pendingChunks.length === 0) return;
    for (const s of pendingChunks) {
      res.write(s);
    }
    pendingChunks.length = 0;
    sentAny = true;
  };

  const reader = response.body;
  let streamEndReason = 'unknown';
  let clientAborted = false;
  let closed = false;
  let timeout = null;

  const finalizeStreamEndReason = (reason) => {
    if (!reason || streamEndReason !== 'unknown') return;
    streamEndReason = reason;
    setRequestEndReason(res, reason);
    console.log(`[${requestId}] stream.terminated end_reason=${reason} upstream_status=${response.status}`);
  };

  const handleClientAbort = () => {
    if (clientAborted) return;
    if (res.writableEnded) return;
    clientAborted = true;
    finalizeStreamEndReason('client_abort');
    if (reader && typeof reader.destroy === 'function' && !reader.destroyed) {
      reader.destroy();
    }
    if (!res.writableEnded) {
      doneSent = true;
      res.end();
    }
  };

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
      if (closed || clientAborted || res.writableEnded) return;
      finalizeStreamEndReason('timeout');
      if (reader && typeof reader.destroy === 'function' && !reader.destroyed) {
        reader.destroy(new Error('stream timeout'));
      }
      if (!doneSent) {
        res.write('data: [DONE]\n\n');
        doneSent = true;
      }
      res.end();
    }, Number(timeoutMs));
    if (typeof timeout.unref === 'function') timeout.unref();
  };

  const closeStream = (reason) => {
    if (closed) return;
    closed = true;
    clearTimer();
    if (reason) finalizeStreamEndReason(reason);
    if (!sentAny) flushPending();
    if (!doneSent) {
      res.write('data: [DONE]\n\n');
      doneSent = true;
    }
    if (!res.writableEnded) {
      res.end();
    }
  };

  req.once('aborted', handleClientAbort);
  res.once('close', () => {
    if (!res.writableEnded) handleClientAbort();
  });

  const parser = createSseEventParser(({ data }) => {
    if (closed || clientAborted) return;
    if (!data || !data.trim()) return;

    if (data === '[DONE]') {
      closeStream('stop');
      return;
    }

    try {
      const upstreamData = JSON.parse(data);
      if (!capturedSessionId) {
        const ids = extractIdsFromUpstream(upstreamData);
        if (logBodies) {
          const exchangeFp = ids && ids.exchangeId ? fingerprint(ids.exchangeId) : 'none';
          const sessionFp = ids && ids.sessionId ? fingerprint(ids.sessionId) : 'none';
          console.log(`[${requestId}] 📋 Extracted IDs: exchange_fp=${exchangeFp} session_fp=${sessionFp}`);
        }
        if (ids && (ids.sessionId || ids.exchangeId)) {
          capturedSessionId = ids.sessionId || ids.exchangeId;
          sessionStoreService.updateStoredSession(storeKey, capturedSessionId, ids.exchangeId).catch((err) => {
            const safeMessage = redactSensitiveText(err && err.message ? err.message : String(err));
            console.warn(`[${requestId}] Failed to store session from stream: ${safeMessage}`);
          });
          if (!res.getHeader('x-session-id')) res.setHeader('x-session-id', capturedSessionId);
        }
      }

      const openaiChunk = convertUpstreamToOpenAI(upstreamData, model, streamId);
      if (openaiChunk) {
        if (!sentAny && openaiChunk.choices && openaiChunk.choices[0] && openaiChunk.choices[0].delta && !openaiChunk.choices[0].delta.role) {
          openaiChunk.choices[0].delta.role = 'assistant';
        }
        const payload = `data: ${JSON.stringify(openaiChunk)}\n\n`;
        if (!sentAny && !capturedSessionId) {
          pendingChunks.push(payload);
          flushPending();
        } else {
          if (!sentAny) flushPending();
          res.write(payload);
          sentAny = true;
        }
      }

      if (upstreamData && upstreamData.type === 'finish') {
        closeStream('stop');
      }
    } catch (e) {
      const safeLine = redactSensitiveText(String(data || '')).slice(0, 300);
      console.error(`[${requestId}] Stream parse error: ${e && e.message ? e.message : String(e)} line=${safeLine}`);
    }
  });

  resetTimer();

  reader.on('data', (chunk) => {
    resetTimer();
    parser.push(chunk.toString());
  });

  reader.on('end', () => {
    parser.flush();
    closeStream('stop');
  });

  reader.on('error', (error) => {
    if (clientAborted) return;
    const msg = String(error && error.message ? error.message : error);
    if (msg.toLowerCase().includes('aborted') || msg.toLowerCase().includes('timeout') || msg.toLowerCase().includes('stream timeout')) {
      closeStream('timeout');
    } else {
      closeStream('upstream_error');
    }
    console.error(`[${requestId}] Stream error:`, error);
  });
}

module.exports = {
  startUpstreamStreamBridge
};

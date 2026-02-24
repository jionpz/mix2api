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
  convertUpstreamToOpenAI
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
  let buffer = '';
  let streamEndReason = 'unknown';
  let clientAborted = false;

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
  };

  req.once('aborted', handleClientAbort);
  res.once('close', () => {
    if (!res.writableEnded) handleClientAbort();
  });

  reader.on('data', (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop();

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        let jsonData;
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') {
            if (!sentAny) flushPending();
            if (!doneSent) {
              res.write('data: [DONE]\n\n');
              doneSent = true;
            }
            continue;
          }
          jsonData = data;
        } else {
          jsonData = line;
        }

        const upstreamData = JSON.parse(jsonData);
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
      } catch (e) {
        console.error('Parse error:', e, 'Line:', line);
      }
    }
  });

  reader.on('end', () => {
    finalizeStreamEndReason('stop');
    if (!sentAny) flushPending();
    if (!doneSent) res.write('data: [DONE]\n\n');
    res.end();
  });

  reader.on('error', (error) => {
    if (clientAborted) return;
    const msg = String(error && error.message ? error.message : error);
    if (msg.toLowerCase().includes('aborted') || msg.toLowerCase().includes('timeout')) {
      finalizeStreamEndReason('timeout');
    } else {
      finalizeStreamEndReason('upstream_error');
    }
    console.error('Stream error:', error);
    res.end();
  });
}

module.exports = {
  startUpstreamStreamBridge
};

function createSseEventParser(onEvent) {
  if (typeof onEvent !== 'function') {
    throw new TypeError('createSseEventParser requires an onEvent callback');
  }

  let buffer = '';
  let eventName = 'message';
  let dataLines = [];

  const emit = () => {
    if (dataLines.length === 0) {
      eventName = 'message';
      return;
    }
    onEvent({
      event: eventName || 'message',
      data: dataLines.join('\n')
    });
    eventName = 'message';
    dataLines = [];
  };

  return {
    push(chunk) {
      const normalized = String(chunk || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      buffer += normalized;
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line === '') {
          emit();
          continue;
        }
        if (line.startsWith(':')) {
          continue;
        }
        if (line.startsWith('event:')) {
          eventName = line.slice(6).trim() || 'message';
          continue;
        }
        if (line.startsWith('data:')) {
          const value = line.slice(5);
          dataLines.push(value.startsWith(' ') ? value.slice(1) : value);
          continue;
        }
        dataLines.push(line);
      }
    },
    flush() {
      if (buffer.length > 0) {
        dataLines.push(buffer);
        buffer = '';
      }
      emit();
    }
  };
}

module.exports = {
  createSseEventParser
};

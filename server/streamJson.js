/**
 * Write `value` as JSON without ever building the whole text as one string.
 *
 * A deck with hundreds of MB of embedded media serializes past V8's maximum
 * string length, so `res.json(deck)` throws. This writes the same bytes as
 * `JSON.stringify(value)` piece by piece: each primitive (and so each media
 * string, which stays far below the limit) is stringified on its own.
 * Honours backpressure, so a slow client does not pile the deck up in memory.
 */
export async function writeJson(stream, value) {
  let buffer = '';
  const flush = async () => {
    if (!buffer) return;
    const chunk = buffer;
    buffer = '';
    if (!stream.write(chunk)) await new Promise(resolve => stream.once('drain', resolve));
  };
  const put = async (text) => {
    buffer += text;
    if (buffer.length >= 1 << 16) await flush();
  };

  async function emit(v) {
    if (v !== null && typeof v === 'object' && typeof v.toJSON === 'function') v = v.toJSON();
    if (v === null || typeof v !== 'object') {
      // Strings, numbers, booleans; NaN/Infinity become null like JSON.stringify.
      const text = JSON.stringify(v);
      if (text.length > 1 << 20) { await flush(); await put(text); await flush(); } else await put(text);
      return;
    }
    if (Array.isArray(v)) {
      await put('[');
      for (let i = 0; i < v.length; i++) {
        if (i) await put(',');
        const item = v[i];
        // JSON.stringify writes null for holes, undefined, functions, symbols.
        if (item === undefined || typeof item === 'function' || typeof item === 'symbol') await put('null');
        else await emit(item);
      }
      await put(']');
      return;
    }
    await put('{');
    let first = true;
    for (const key of Object.keys(v)) {
      const item = v[key];
      if (item === undefined || typeof item === 'function' || typeof item === 'symbol') continue;
      await put(`${first ? '' : ','}${JSON.stringify(key)}:`);
      first = false;
      await emit(item);
    }
    await put('}');
  }

  await emit(value);
  await flush();
}

/** Send `value` as a JSON response, streamed (see writeJson). */
export async function sendJson(res, value, status = 200) {
  res.status(status);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  await writeJson(res, value);
  res.end();
}

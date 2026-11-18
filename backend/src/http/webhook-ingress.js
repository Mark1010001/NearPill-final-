// Preserve the webhook provider's existing UTF-8 text contract, but never
// buffer a complete untrusted request before enforcing a byte limit.
// Content-Length alone is not an authority: it can be absent or misleading.
/** @returns {Promise<{ok: true, rawBody: string} | {ok: false, reason: string}>} */
export async function readWebhookBodyWithinLimit(rawRequest, maxBytes) {
  let copy;
  try {
    copy = rawRequest.clone();
  } catch {
    // An upstream consumer may already have disturbed/locked the body.
    // A failed clone cannot produce trustworthy signed bytes; reject it
    // without propagating a private stream error as an internal HTTP 500.
    return { ok: false, reason: 'read-error' };
  }
  if (!copy.body) return { ok: true, rawBody: '' };

  const reader = copy.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) {
        // Request.clone() tees the source; awaiting cancellation of just one
        // branch may hang while the original branch remains open.
        void reader.cancel('Webhook body exceeds byte limit').catch(() => {});
        return { ok: false, reason: 'too-large' };
      }
      chunks.push(value);
    }
  } catch {
    // A prematurely errored upload cannot be signed or parsed. Do not let
    // arbitrary stream errors escape as an internal HTTP 500 or leak details.
    return { ok: false, reason: 'read-error' };
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  // Signature checks consume the decoded text. The default TextDecoder silently
  // substitutes malformed byte sequences with U+FFFD, allowing distinct raw
  // requests to produce the same signature input. Fail closed instead.
  // Keep a leading BOM as a real U+FEFF: removing it would also change the
  // exact UTF-8 payload covered by the provider signature.
  try {
    return { ok: true, rawBody: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes) };
  } catch {
    return { ok: false, reason: 'invalid-utf8' };
  }
}

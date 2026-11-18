// A development inbox must never intercept a real staging/production OTP.
// An unset NODE_ENV retains the legacy local-development default.
export function verificationRecipient(email, env = process.env) {
  const local = env.NODE_ENV === undefined || env.NODE_ENV === 'development' || env.NODE_ENV === 'test';
  return local && env.DEV_OTP_INBOX?.trim() || email;
}

// When delivery is unavailable, only local development/test may echo an OTP.
// Staging and production fail closed; the identity service maps { sent: false }
// to a 503 response without exposing the verification challenge.
// The server only echoes the code when DEV_ECHO_OTP=true is set on purpose, so a
// normal run always needs real email delivery.
export function verificationDeliveryUnavailable(nodeEnv, code, allowEcho = true) {
  return allowEcho && (nodeEnv === 'development' || nodeEnv === 'test')
    ? { devMode: true, devCode: code }
    : { sent: false };
}

// Email goes out through Brevo (BREVO_API_KEY + MAIL_FROM). MAIL_FROM may be
// "Name <address>" or just an address, and must be a sender verified in Brevo.
export async function sendEmail(email, subject, text) {
  const apiKey = process.env.BREVO_API_KEY;
  const from = process.env.MAIL_FROM;
  if (!apiKey || !from) {
    console.warn('email_delivery_unavailable');
    return false;
  }
  try {
    const match = /^\s*(?:"?([^"<]*?)"?\s*)?<([^>]+)>\s*$/.exec(from);
    const sender = match
      ? { name: (match[1] || 'NearPill').trim() || 'NearPill', email: match[2].trim() }
      : { name: 'NearPill', email: from.trim() };
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': apiKey, 'Content-Type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ sender, to: [{ email }], subject, textContent: text }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) console.error('email_delivery_failed', { status: response.status });
    return response.ok;
  } catch (_) {
    console.error('email_delivery_failed');
    return false;
  }
}

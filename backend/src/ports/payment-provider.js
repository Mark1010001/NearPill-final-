const requiredMethods = [
  'createIntent',
  'verifyWebhook',
  'getPayment',
  'requestRefund',
  'getRefund',
];

export function assertPaymentProvider(provider) {
  if (!provider || typeof provider !== 'object') throw new TypeError('Payment provider is required.');
  if (!provider.id || typeof provider.id !== 'string') throw new TypeError('Payment provider id is required.');
  for (const method of requiredMethods) {
    if (typeof provider[method] !== 'function') throw new TypeError(`Payment provider must implement ${method}().`);
  }
  return provider;
}

export function createPaymentProviderRegistry(providers = []) {
  const entries = new Map();
  for (const provider of providers) {
    const checked = assertPaymentProvider(provider);
    if (entries.has(checked.id)) throw new TypeError(`Duplicate payment provider: ${checked.id}`);
    entries.set(checked.id, checked);
  }
  return Object.freeze({
    get(id) { return entries.get(String(id || '').trim().toLowerCase()) ?? null; },
    ids() { return Object.freeze([...entries.keys()]); },
  });
}

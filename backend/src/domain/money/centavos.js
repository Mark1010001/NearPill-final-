export function pesosToCentavos(value) {
  const text = String(value ?? '').trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ''] = text.split('.');
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(result) && result >= 0 ? result : null;
}

export function centavosToPesosNumber(value) {
  const centavos = Number(value);
  return Number.isSafeInteger(centavos) ? centavos / 100 : 0;
}

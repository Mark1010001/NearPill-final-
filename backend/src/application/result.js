export function success(body, status = 200) {
  return Object.freeze({ ok: true, status, body });
}

export function failure(status, error) {
  return Object.freeze({ ok: false, status, body: { error } });
}

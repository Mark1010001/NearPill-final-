/**
 * "Remember me" for the website. Nothing here is sent to the server.
 * - Ticked (default): nothing changes; the session lasts as long as the server allows.
 * - Unticked: the session ends once the site has been closed for a few minutes.
 *   While any NearPill tab is open it writes a heartbeat; on the next load, an old heartbeat
 *   means the browser was closed, so the session is ended.
 */
const REMEMBER_KEY = 'nearpill-remember';
const ALIVE_KEY = 'nearpill-alive';
const CLOSED_AFTER_MS = 3 * 60_000;

export function touchAlive() {
  try { localStorage.setItem(ALIVE_KEY, String(Date.now())); } catch { /* storage unavailable */ }
}

export function setRemember(remember: boolean) {
  try { localStorage.setItem(REMEMBER_KEY, remember ? '1' : '0'); } catch { /* storage unavailable */ }
  touchAlive();
}

export function clearRemember() {
  try { localStorage.removeItem(REMEMBER_KEY); localStorage.removeItem(ALIVE_KEY); } catch { /* storage unavailable */ }
}

/** True when the last sign-in was not remembered and the site has been closed for a while. */
export function rememberExpired(now = Date.now()): boolean {
  try {
    if (localStorage.getItem(REMEMBER_KEY) !== '0') return false;
    const last = Number(localStorage.getItem(ALIVE_KEY));
    return !Number.isFinite(last) || now - last > CLOSED_AFTER_MS;
  } catch { return false; }
}

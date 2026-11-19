/**
 * Pickup date helpers. The Android app (lib/features/orders/pickup.dart) uses the same rules and wording.
 * Dates are calendar dates in Philippine time; a customer can pick today up to 7 days ahead.
 */
export const maxPickupDaysAhead = 7;
export const pickupWindows = [
  { id: 'morning', label: 'Morning', hours: '8–12', startHour: 8, endHour: 12 },
  { id: 'afternoon', label: 'Afternoon', hours: '12–5', startHour: 12, endHour: 17 },
  { id: 'evening', label: 'Evening', hours: '5–8', startHour: 17, endHour: 20 },
] as const;
export type PickupWindowId = (typeof pickupWindows)[number]['id'];

const dayMs = 24 * 60 * 60 * 1000;
const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function manila(now: number) {
  const shifted = new Date(now + 8 * 60 * 60 * 1000);
  return { date: shifted.toISOString().slice(0, 10), hour: shifted.getUTCHours(), minute: shifted.getUTCMinutes() };
}
const dayNumber = (isoDate: string) => Math.round(Date.parse(`${isoDate}T00:00:00Z`) / dayMs);
const addDays = (isoDate: string, days: number) => new Date(Date.parse(`${isoDate}T00:00:00Z`) + days * dayMs).toISOString().slice(0, 10);

export const manilaToday = (now = Date.now()) => manila(now).date;

/** "Mon, 17 Nov" */
export function shortDate(isoDate: string) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  return `${weekdays[d.getUTCDay()]}, ${d.getUTCDate()} ${months[d.getUTCMonth()]}`;
}

/** Chip text: Today, Tomorrow, then "Wed 18". */
export function chipLabel(isoDate: string, now = Date.now()) {
  const diff = dayNumber(isoDate) - dayNumber(manilaToday(now));
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  const d = new Date(`${isoDate}T00:00:00Z`);
  return `${weekdays[d.getUTCDay()]} ${d.getUTCDate()}`;
}

export function pickupDays(now = Date.now()) {
  const today = manilaToday(now);
  return Array.from({ length: maxPickupDaysAhead + 1 }, (_, i) => addDays(today, i));
}

/** Pickup today stops being offered this many minutes before the pharmacy closes. */
const closingBufferMinutes = 60;

/** Closing time in minutes after midnight from text like "8:00 AM - 6:00 PM". Null when missing, unreadable or overnight (then nothing is restricted). */
export function closingMinute(operatingHours?: string | null): number | null {
  const match = (operatingHours ?? '').trim().match(/(\d{1,2}):?(\d{2})?\s*(AM|PM)?\s*[-–]\s*(\d{1,2}):?(\d{2})?\s*(AM|PM)?/i);
  if (!match) return null;
  const minutes = (hourText: string, minuteText: string | undefined, ampm: string | undefined) => {
    let hour = Number(hourText);
    const period = ampm?.toUpperCase();
    if (period === 'PM' && hour !== 12) hour += 12;
    if (period === 'AM' && hour === 12) hour = 0;
    return hour * 60 + Number(minuteText || 0);
  };
  const open = minutes(match[1], match[2], match[3]);
  const close = minutes(match[4], match[5], match[6]);
  return close > open && close <= 24 * 60 ? close : null;
}
const cutoffMinute = (operatingHours?: string | null) => { const close = closingMinute(operatingHours); return close === null ? null : close - closingBufferMinutes; };

/** A day can be chosen unless it is today and the pharmacy closes within the hour (or already closed). */
export function dayAvailable(isoDate: string, operatingHours?: string | null, now = Date.now()) {
  const cutoff = cutoffMinute(operatingHours);
  const today = manila(now);
  return cutoff === null || isoDate !== today.date || today.hour * 60 + today.minute < cutoff;
}

/** "Any time" is never allowed for today when the pharmacy's hours are known: pick a window that fits. */
export function anyTimeAvailable(isoDate: string, operatingHours?: string | null, now = Date.now()) {
  return cutoffMinute(operatingHours) === null || isoDate !== manila(now).date;
}

/** A window that already ended today cannot be chosen for today, nor one that starts at or after the closing cutoff. */
export function windowAvailable(isoDate: string, windowId: PickupWindowId, now = Date.now(), operatingHours?: string | null) {
  const { date, hour } = manila(now);
  if (isoDate !== date) return true;
  const window = pickupWindows.find((w) => w.id === windowId)!;
  if (hour >= window.endHour) return false;
  const cutoff = cutoffMinute(operatingHours);
  return cutoff === null || window.startHour * 60 < cutoff;
}

/** First day that can be chosen (today, unless the pharmacy is about to close). */
export function firstPickupDay(operatingHours?: string | null, now = Date.now()) {
  const days = pickupDays(now);
  return days.find((day) => dayAvailable(day, operatingHours, now)) ?? days[days.length - 1];
}

/** The window to select for [isoDate]: none ("Any time") when allowed, otherwise the first one that fits. */
export function defaultWindow(isoDate: string, operatingHours?: string | null, now = Date.now()): PickupWindowId | '' {
  if (anyTimeAvailable(isoDate, operatingHours, now)) return '';
  return pickupWindows.find((w) => windowAvailable(isoDate, w.id, now, operatingHours))?.id ?? '';
}

/** Keeps a chosen window valid when the day or the hours change. */
export function windowForDay(isoDate: string, window: PickupWindowId | '', operatingHours?: string | null, now = Date.now()): PickupWindowId | '' {
  if (window === '') return defaultWindow(isoDate, operatingHours, now);
  return windowAvailable(isoDate, window, now, operatingHours) ? window : defaultWindow(isoDate, operatingHours, now);
}

export function windowText(windowId?: string | null) {
  const found = pickupWindows.find((w) => w.id === windowId);
  return found ? `${found.label} (${found.hours})` : '';
}

/** "Mon, 17 Nov · Morning (8–12)" or "Mon, 17 Nov". Empty text for old orders. */
export function pickupText(isoDate?: string | null, windowId?: string | null) {
  if (!isoDate) return '';
  return windowId ? `${shortDate(isoDate)} · ${windowText(windowId)}` : shortDate(isoDate);
}

export type PickupFlag = 'today' | 'missed' | null;
export function pickupFlag(isoDate: string | null | undefined, active: boolean, now = Date.now()): PickupFlag {
  if (!isoDate || !active) return null;
  const today = manilaToday(now);
  return isoDate === today ? 'today' : isoDate < today ? 'missed' : null;
}

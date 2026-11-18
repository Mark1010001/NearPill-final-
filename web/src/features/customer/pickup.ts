/**
 * Pickup date helpers. The Android app (lib/features/orders/pickup.dart) uses the same rules and wording.
 * Dates are calendar dates in Philippine time; a customer can pick today up to 7 days ahead.
 */
export const maxPickupDaysAhead = 7;
export const pickupWindows = [
  { id: 'morning', label: 'Morning', hours: '8–12', endHour: 12 },
  { id: 'afternoon', label: 'Afternoon', hours: '12–5', endHour: 17 },
  { id: 'evening', label: 'Evening', hours: '5–8', endHour: 20 },
] as const;
export type PickupWindowId = (typeof pickupWindows)[number]['id'];

const dayMs = 24 * 60 * 60 * 1000;
const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function manila(now: number) {
  const shifted = new Date(now + 8 * 60 * 60 * 1000);
  return { date: shifted.toISOString().slice(0, 10), hour: shifted.getUTCHours() };
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

/** A window that already ended today cannot be chosen for today. */
export function windowAvailable(isoDate: string, windowId: PickupWindowId, now = Date.now()) {
  const { date, hour } = manila(now);
  const end = pickupWindows.find((w) => w.id === windowId)!.endHour;
  return isoDate !== date || hour < end;
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

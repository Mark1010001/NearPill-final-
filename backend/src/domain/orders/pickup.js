// Pickup date rules, shared by order creation and rescheduling.
// "Today" is the calendar date in Philippine time (UTC+8, no daylight saving).
export const pickupWindows = Object.freeze(['morning', 'afternoon', 'evening']);
export const maxPickupDaysAhead = 7;
const windowEndHour = Object.freeze({ morning: 12, afternoon: 17, evening: 20 });
const dayMs = 24 * 60 * 60 * 1000;
const manilaOffsetMs = 8 * 60 * 60 * 1000;

function manilaParts(timeMs) {
  const shifted = new Date(timeMs + manilaOffsetMs);
  return { date: shifted.toISOString().slice(0, 10), hour: shifted.getUTCHours() };
}

export function manilaToday(nowMs) {
  return manilaParts(nowMs).date;
}

function dayNumber(isoDate) {
  return Math.round(Date.parse(`${isoDate}T00:00:00Z`) / dayMs);
}

export function isCalendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

// Returns { ok: true, pickupDate, pickupWindow } or { ok: false, message }.
export function validatePickup({ pickupDate, pickupWindow }, nowMs) {
  const hasDate = pickupDate !== undefined && pickupDate !== null && pickupDate !== '';
  const hasWindow = pickupWindow !== undefined && pickupWindow !== null && pickupWindow !== '';
  if (!hasDate && !hasWindow) return { ok: true, pickupDate: null, pickupWindow: null };
  if (!hasDate) return { ok: false, message: 'Choose a pickup date to go with the time window.' };
  if (!isCalendarDate(pickupDate)) return { ok: false, message: 'Pickup date must be a valid date (YYYY-MM-DD).' };
  if (hasWindow && !pickupWindows.includes(pickupWindow)) return { ok: false, message: 'Pickup time must be morning, afternoon or evening.' };
  const today = manilaParts(nowMs);
  const daysAhead = dayNumber(pickupDate) - dayNumber(today.date);
  if (daysAhead < 0) return { ok: false, message: 'Pickup date cannot be in the past.' };
  if (daysAhead > maxPickupDaysAhead) return { ok: false, message: `Pickup date must be within ${maxPickupDaysAhead} days from today.` };
  if (hasWindow && daysAhead === 0 && today.hour >= windowEndHour[pickupWindow]) {
    return { ok: false, message: 'That pickup time has already passed today. Choose a later time or another day.' };
  }
  return { ok: true, pickupDate, pickupWindow: hasWindow ? pickupWindow : null };
}

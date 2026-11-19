// Pickup date rules, shared by order creation and rescheduling.
// "Today" is the calendar date in Philippine time (UTC+8, no daylight saving).
export const pickupWindows = Object.freeze(['morning', 'afternoon', 'evening']);
export const maxPickupDaysAhead = 7;
const windowEndHour = Object.freeze({ morning: 12, afternoon: 17, evening: 20 });
const dayMs = 24 * 60 * 60 * 1000;
const manilaOffsetMs = 8 * 60 * 60 * 1000;

function manilaParts(timeMs) {
  const shifted = new Date(timeMs + manilaOffsetMs);
  return { date: shifted.toISOString().slice(0, 10), hour: shifted.getUTCHours(), minute: shifted.getUTCMinutes() };
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

// Closing rule: pickup today stops being offered one hour before the pharmacy closes, and "any time" is never
// allowed for today, so the customer must choose a window that still fits.
export const closingBufferMinutes = 60;
const windowStartHour = Object.freeze({ morning: 8, afternoon: 12, evening: 17 });

// "8:00 AM - 6:00 PM" -> { openMinute, closeMinute }. Null when the text is missing, unreadable or overnight.
export function parseOperatingHours(text) {
  const match = String(text ?? '').trim().match(/(\d{1,2}):?(\d{2})?\s*(AM|PM)?\s*[-–]\s*(\d{1,2}):?(\d{2})?\s*(AM|PM)?/i);
  if (!match) return null;
  const toMinutes = (hourText, minuteText, ampm) => {
    let hour = Number(hourText);
    if (ampm) {
      const period = ampm.toUpperCase();
      if (period === 'PM' && hour !== 12) hour += 12;
      if (period === 'AM' && hour === 12) hour = 0;
    }
    return hour * 60 + Number(minuteText || 0);
  };
  const openMinute = toMinutes(match[1], match[2], match[3]);
  const closeMinute = toMinutes(match[4], match[5], match[6]);
  if (![openMinute, closeMinute].every((m) => Number.isFinite(m) && m >= 0 && m <= 24 * 60) || closeMinute <= openMinute) return null;
  return { openMinute, closeMinute };
}

// Returns { ok: true } or { ok: false, message }. Pharmacies with unreadable hours are not restricted.
export function validatePickupForHours({ pickupDate, pickupWindow }, operatingHours, nowMs) {
  const hours = parseOperatingHours(operatingHours);
  if (!hours || !pickupDate) return { ok: true };
  const today = manilaParts(nowMs);
  if (pickupDate !== today.date) return { ok: true };
  const cutoff = hours.closeMinute - closingBufferMinutes;
  if (today.hour * 60 + today.minute >= cutoff) {
    return { ok: false, message: 'This pharmacy is closing soon, so pickup today is no longer available. Choose another day.' };
  }
  if (!pickupWindow) return { ok: false, message: 'Choose a pickup time for today. "Any time" is only available for later days.' };
  if (windowStartHour[pickupWindow] * 60 >= cutoff) {
    return { ok: false, message: 'That pickup time is too close to closing. Choose an earlier time or another day.' };
  }
  return { ok: true };
}

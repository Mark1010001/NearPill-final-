/** Opening hours for a new pharmacy: one daily time range plus the days open, saved as readable text such as "Mon-Sat, 8:00 AM - 8:00 PM". */
export const weekDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

export interface HoursInput { open: string; close: string; days: number[] }

const toMinutes = (value: string) => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
};

function clock(value: string) {
  const minutes = toMinutes(value);
  if (minutes === null) return '';
  const hour = Math.floor(minutes / 60);
  return `${hour % 12 === 0 ? 12 : hour % 12}:${String(minutes % 60).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`;
}

/** Days open as short ranges: [0,1,2,3,4,5] becomes "Mon-Sat", [0,2,3] becomes "Mon, Wed-Thu". */
export function dayText(days: number[]) {
  const sorted = [...new Set(days)].filter((day) => day >= 0 && day < 7).sort((a, b) => a - b);
  if (sorted.length === 7) return 'Daily';
  const parts: string[] = [];
  for (let i = 0; i < sorted.length;) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j += 1;
    parts.push(j - i >= 2 ? `${weekDays[sorted[i]]}-${weekDays[sorted[j]]}` : sorted.slice(i, j + 1).map((day) => weekDays[day]).join(', '));
    i = j + 1;
  }
  return parts.join(', ');
}

/** Hours open per day and per week. A closing time earlier than the opening time means the pharmacy closes after midnight. */
export function hoursSummary({ open, close, days }: HoursInput) {
  const start = toMinutes(open);
  const end = toMinutes(close);
  if (start === null || end === null || start === end || days.length === 0) return null;
  const perDay = (end > start ? end - start : end + 24 * 60 - start) / 60;
  return { perDay, perWeek: perDay * new Set(days).size, daysOpen: new Set(days).size };
}

const hoursLabel = (hours: number) => `${Number.isInteger(hours) ? hours : hours.toFixed(1).replace(/\.0$/, '')} ${hours === 1 ? 'hour' : 'hours'}`;
export const summaryText = (summary: NonNullable<ReturnType<typeof hoursSummary>>) =>
  `${hoursLabel(summary.perDay)} per day · ${hoursLabel(summary.perWeek)} per week (${summary.daysOpen} ${summary.daysOpen === 1 ? 'day' : 'days'} open)`;

/** The text saved on the pharmacy; the app reads the first "time - time" range in it, so the days come before the times. */
export function hoursToText(input: HoursInput) {
  if (!hoursSummary(input)) return null;
  return `${dayText(input.days)}, ${clock(input.open)} - ${clock(input.close)}`;
}

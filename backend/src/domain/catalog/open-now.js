export function calculateOpenNow(operatingHours, isActive, now = new Date()) {
  if (!isActive || !operatingHours) return false;

  const value = String(operatingHours).trim();
  const match = value.match(
    /(\d{1,2}):?(\d{2})?\s*(AM|PM)?\s*[-–]\s*(\d{1,2}):?(\d{2})?\s*(AM|PM)?/i,
  );

  if (!match) return false;

  const parseTime = (hourText, minuteText, ampm) => {
    let hour = Number(hourText);
    const minute = Number(minuteText || 0);

    if (ampm) {
      const period = ampm.toUpperCase();
      if (period === 'PM' && hour !== 12) hour += 12;
      if (period === 'AM' && hour === 12) hour = 0;
    }

    return hour * 60 + minute;
  };

  try {
    const start = parseTime(match[1], match[2], match[3]);
    const end = parseTime(match[4], match[5], match[6]);
    const current = now.getHours() * 60 + now.getMinutes();

    if (end >= start) return current >= start && current <= end;
    return current >= start || current <= end;
  } catch {
    return false;
  }
}

export function pharmacySlug(name) {
  return String(name || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

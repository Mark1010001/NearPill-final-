/// Pickup date rules and wording. The website (web/src/features/customer/pickup.ts) uses the same ones.
/// Dates are calendar dates in Philippine time; a customer can pick today up to 7 days ahead.
const maxPickupDaysAhead = 7;

typedef PickupWindow = ({String id, String label, String hours, int startHour, int endHour});

const pickupWindows = <PickupWindow>[
  (id: 'morning', label: 'Morning', hours: '8–12', startHour: 8, endHour: 12),
  (id: 'afternoon', label: 'Afternoon', hours: '12–5', startHour: 12, endHour: 17),
  (id: 'evening', label: 'Evening', hours: '5–8', startHour: 17, endHour: 20),
];

const _weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const _months = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

DateTime _manila(DateTime now) => now.toUtc().add(const Duration(hours: 8));

String _iso(DateTime utc) =>
    '${utc.year.toString().padLeft(4, '0')}-${utc.month.toString().padLeft(2, '0')}-${utc.day.toString().padLeft(2, '0')}';

DateTime _parse(String isoDate) => DateTime.parse('${isoDate}T00:00:00Z');

String manilaToday([DateTime? now]) => _iso(_manila(now ?? DateTime.now()));

/// "Mon, 17 Nov"
String shortDate(String isoDate) {
  final d = _parse(isoDate);
  return '${_weekdays[d.weekday - 1]}, ${d.day} ${_months[d.month - 1]}';
}

/// Chip text: Today, Tomorrow, then "Wed 18".
String chipLabel(String isoDate, [DateTime? now]) {
  final diff = _parse(isoDate).difference(_parse(manilaToday(now))).inDays;
  if (diff == 0) return 'Today';
  if (diff == 1) return 'Tomorrow';
  final d = _parse(isoDate);
  return '${_weekdays[d.weekday - 1]} ${d.day}';
}

List<String> pickupDays([DateTime? now]) {
  final today = _parse(manilaToday(now));
  return [
    for (var i = 0; i <= maxPickupDaysAhead; i++)
      _iso(today.add(Duration(days: i))),
  ];
}

/// Pickup today stops being offered this many minutes before the pharmacy closes.
const closingBufferMinutes = 60;

/// Closing time in minutes after midnight from text like "8:00 AM - 6:00 PM".
/// Null when the text is missing, unreadable or overnight (then nothing is restricted).
int? closingMinute(String? operatingHours) {
  final match = RegExp(
    r'(\d{1,2}):?(\d{2})?\s*(AM|PM)?\s*[-–]\s*(\d{1,2}):?(\d{2})?\s*(AM|PM)?',
    caseSensitive: false,
  ).firstMatch((operatingHours ?? '').trim());
  if (match == null) return null;
  int minutes(String? hourText, String? minuteText, String? ampm) {
    var hour = int.parse(hourText!);
    final period = ampm?.toUpperCase();
    if (period == 'PM' && hour != 12) hour += 12;
    if (period == 'AM' && hour == 12) hour = 0;
    return hour * 60 + (int.tryParse(minuteText ?? '') ?? 0);
  }

  final open = minutes(match[1], match[2], match[3]);
  final close = minutes(match[4], match[5], match[6]);
  if (close <= open || close > 24 * 60) return null;
  return close;
}

/// Minutes after midnight in Philippine time when pickup today is no longer offered, or null when unrestricted.
int? _cutoffMinute(String? operatingHours) {
  final close = closingMinute(operatingHours);
  return close == null ? null : close - closingBufferMinutes;
}

bool _isToday(String isoDate, DateTime manila) => isoDate == _iso(manila);

/// A day can be chosen unless it is today and the pharmacy closes within the hour (or already closed).
bool dayAvailable(String isoDate, [String? operatingHours, DateTime? now]) {
  final manila = _manila(now ?? DateTime.now());
  final cutoff = _cutoffMinute(operatingHours);
  if (cutoff == null || !_isToday(isoDate, manila)) return true;
  return manila.hour * 60 + manila.minute < cutoff;
}

/// "Any time" is never allowed for today when the pharmacy's hours are known: pick a window that fits.
bool anyTimeAvailable(String isoDate, [String? operatingHours, DateTime? now]) {
  final manila = _manila(now ?? DateTime.now());
  return _cutoffMinute(operatingHours) == null || !_isToday(isoDate, manila);
}

/// A window that already ended today cannot be chosen for today, nor one that starts at or after the closing cutoff.
bool windowAvailable(String isoDate, String windowId, [DateTime? now, String? operatingHours]) {
  final manila = _manila(now ?? DateTime.now());
  if (!_isToday(isoDate, manila)) return true;
  final window = pickupWindows.firstWhere((w) => w.id == windowId);
  if (manila.hour >= window.endHour) return false;
  final cutoff = _cutoffMinute(operatingHours);
  return cutoff == null || window.startHour * 60 < cutoff;
}

/// First day that can be chosen (today, unless the pharmacy is about to close).
String firstPickupDay([String? operatingHours, DateTime? now]) => pickupDays(now).firstWhere(
  (day) => dayAvailable(day, operatingHours, now),
  orElse: () => pickupDays(now).last,
);

/// The window to select for [isoDate]: none ("Any time") when allowed, otherwise the first one that fits.
String? defaultWindow(String isoDate, [String? operatingHours, DateTime? now]) {
  if (anyTimeAvailable(isoDate, operatingHours, now)) return null;
  for (final w in pickupWindows) {
    if (windowAvailable(isoDate, w.id, now, operatingHours)) return w.id;
  }
  return null;
}

/// Keeps a chosen window valid when the day changes.
String? windowForDay(String isoDate, String? window, [String? operatingHours, DateTime? now]) {
  if (window == null) return defaultWindow(isoDate, operatingHours, now);
  return windowAvailable(isoDate, window, now, operatingHours)
      ? window
      : defaultWindow(isoDate, operatingHours, now);
}

String windowText(String? windowId) {
  for (final w in pickupWindows) {
    if (w.id == windowId) return '${w.label} (${w.hours})';
  }
  return '';
}

/// "Mon, 17 Nov · Morning (8–12)" or "Mon, 17 Nov". Empty text for old orders.
String pickupText(String? isoDate, String? windowId) {
  if (isoDate == null || isoDate.isEmpty) return '';
  final window = windowText(windowId);
  return window.isEmpty ? shortDate(isoDate) : '${shortDate(isoDate)} · $window';
}

/// 'today' or 'missed' while an active order's pickup date is today or already passed.
String? pickupFlag(String? isoDate, bool active, [DateTime? now]) {
  if (isoDate == null || isoDate.isEmpty || !active) return null;
  final today = manilaToday(now);
  if (isoDate == today) return 'today';
  return isoDate.compareTo(today) < 0 ? 'missed' : null;
}

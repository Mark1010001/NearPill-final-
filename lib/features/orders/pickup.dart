/// Pickup date rules and wording. The website (web/src/features/customer/pickup.ts) uses the same ones.
/// Dates are calendar dates in Philippine time; a customer can pick today up to 7 days ahead.
const maxPickupDaysAhead = 7;

typedef PickupWindow = ({String id, String label, String hours, int endHour});

const pickupWindows = <PickupWindow>[
  (id: 'morning', label: 'Morning', hours: '8–12', endHour: 12),
  (id: 'afternoon', label: 'Afternoon', hours: '12–5', endHour: 17),
  (id: 'evening', label: 'Evening', hours: '5–8', endHour: 20),
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

/// A window that already ended today cannot be chosen for today.
bool windowAvailable(String isoDate, String windowId, [DateTime? now]) {
  final manila = _manila(now ?? DateTime.now());
  if (isoDate != _iso(manila)) return true;
  final end = pickupWindows.firstWhere((w) => w.id == windowId).endHour;
  return manila.hour < end;
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

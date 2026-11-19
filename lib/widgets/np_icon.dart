// ignore_for_file: constant_identifier_names
import 'package:flutter/material.dart';

part 'np_icons_data.dart';

/// One icon of the NearPill set: stroke paths (and optional solid shapes) on a 24 x 24 grid.
/// The website draws the very same paths, so both apps show identical icons.
class NpIconData {
  const NpIconData(this.name, this.strokes, {this.fills = const []});
  final String name;
  final List<List<double>> strokes;
  final List<List<double>> fills;

  static Path _build(List<double> ops) {
    final path = Path();
    var i = 0;
    while (i < ops.length) {
      switch (ops[i].toInt()) {
        case 0:
          path.moveTo(ops[i + 1], ops[i + 2]);
          i += 3;
        case 1:
          path.lineTo(ops[i + 1], ops[i + 2]);
          i += 3;
        case 2:
          path.cubicTo(ops[i + 1], ops[i + 2], ops[i + 3], ops[i + 4], ops[i + 5], ops[i + 6]);
          i += 7;
        default:
          path.close();
          i += 1;
      }
    }
    return path;
  }
}

/// Draws an [NpIconData]. Takes colour and size from the surrounding [IconTheme] like the built-in Icon,
/// so it works unchanged inside IconButton, NavigationBar, InputDecoration and so on.
class NpIcon extends StatelessWidget {
  const NpIcon(this.icon, {super.key, this.size, this.color, this.semanticLabel});
  final NpIconData? icon;
  final double? size;
  final Color? color;
  final String? semanticLabel;

  /// Stroke weight in logical pixels at 24px: 1.75, never thinner than 1.5px on small icons.
  static const double stroke = 1.75;

  @override
  Widget build(BuildContext context) {
    final theme = IconTheme.of(context);
    final s = size ?? theme.size ?? 24.0;
    final base = color ?? theme.color ?? const Color(0xFF1B1B1B);
    final c = theme.opacity == null ? base : base.withValues(alpha: base.a * theme.opacity!);
    final data = icon;
    final box = SizedBox(
      width: s,
      height: s,
      child: data == null ? null : CustomPaint(painter: _NpIconPainter(data, c, s)),
    );
    if (semanticLabel == null) return ExcludeSemantics(child: box);
    return Semantics(label: semanticLabel, image: true, child: box);
  }
}

class _NpIconPainter extends CustomPainter {
  _NpIconPainter(this.icon, this.color, this.size);
  final NpIconData icon;
  final Color color;
  final double size;

  @override
  void paint(Canvas canvas, Size box) {
    final scale = size / 24;
    // Like the built-in Icon: when a tight parent (a tile, a leading slot) makes the box larger than the icon, draw it centred.
    canvas.translate((box.width - size) / 2, (box.height - size) / 2);
    canvas.scale(scale);
    final px = (NpIcon.stroke * scale) < 1.5 ? 1.5 : NpIcon.stroke * scale;
    final stroke = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = px / scale
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round;
    for (final ops in icon.strokes) {
      canvas.drawPath(NpIconData._build(ops), stroke);
    }
    final fill = Paint()
      ..color = color
      ..style = PaintingStyle.fill;
    for (final ops in icon.fills) {
      canvas.drawPath(NpIconData._build(ops), fill);
    }
  }

  @override
  bool shouldRepaint(_NpIconPainter old) => old.icon != icon || old.color != color || old.size != size;
}

/// Material-style names mapped onto the NearPill set, so every screen asks for what it means
/// (`NpIcons.add`) and the one set decides how it looks.
abstract final class NpIcons {
  static const add = NpIconSet.plus;
  static const add_rounded = NpIconSet.plus;
  static const remove = NpIconSet.minus;
  static const add_comment_outlined = NpIconSet.messagePlus;
  static const add_shopping_cart = NpIconSet.bagPlus;
  static const account_balance_wallet_outlined = NpIconSet.wallet;
  static const account_circle = NpIconSet.userCircle;
  static const arrow_back = NpIconSet.arrowLeft;
  static const arrow_upward = NpIconSet.arrowUp;
  static const assignment_outlined = NpIconSet.clipboardList;
  static const assignment_turned_in_outlined = NpIconSet.clipboardCheck;
  static const calendar_today_outlined = NpIconSet.calendar;
  static const event_outlined = NpIconSet.calendar;
  static const cancel = NpIconSet.xCircle;
  static const cancel_outlined = NpIconSet.xCircle;
  static const chat_bubble_outline = NpIconSet.message;
  static const check = NpIconSet.check;
  static const check_circle = NpIconSet.checkCircle;
  static const check_circle_outline = NpIconSet.checkCircle;
  static const chevron_right = NpIconSet.chevronRight;
  static const circle = NpIconSet.dot;
  static const circle_outlined = NpIconSet.circle;
  static const radio_button_off = NpIconSet.circle;
  static const radio_button_unchecked_rounded = NpIconSet.circle;
  static const radio_button_checked = NpIconSet.radioOn;
  static const radio_button_checked_rounded = NpIconSet.radioOn;
  static const close = NpIconSet.x;
  static const close_rounded = NpIconSet.x;
  static const content_paste_outlined = NpIconSet.clipboard;
  static const delete_outline = NpIconSet.trash;
  static const devices_outlined = NpIconSet.devices;
  static const directions = NpIconSet.directions;
  static const download_outlined = NpIconSet.download;
  static const edit_outlined = NpIconSet.pencil;
  static const email_outlined = NpIconSet.mail;
  static const mail_outline = NpIconSet.mail;
  static const error_outline = NpIconSet.alertCircle;
  static const favorite_rounded = NpIconSet.heartFilled;
  static const favorite_border_rounded = NpIconSet.heart;
  static const home = NpIconSet.home;
  static const hourglass_top = NpIconSet.hourglass;
  static const info_outline = NpIconSet.info;
  static const key_outlined = NpIconSet.key;
  static const local_pharmacy = NpIconSet.pharmacy;
  static const local_pharmacy_outlined = NpIconSet.pharmacy;
  static const location_off_outlined = NpIconSet.locationOff;
  static const location_on_outlined = NpIconSet.mapPin;
  static const place_rounded = NpIconSet.mapPin;
  static const lock_outline = NpIconSet.lock;
  static const logout = NpIconSet.logOut;
  static const map = NpIconSet.map;
  static const medical_services = NpIconSet.medical;
  static const medical_services_outlined = NpIconSet.medical;
  static const medication = NpIconSet.pill;
  static const medication_outlined = NpIconSet.pill;
  static const my_location = NpIconSet.locate;
  static const navigation = NpIconSet.navigation;
  static const notifications = NpIconSet.bell;
  static const notifications_outlined = NpIconSet.bell;
  static const notifications_rounded = NpIconSet.bellDot;
  static const payments_outlined = NpIconSet.banknote;
  static const person = NpIconSet.user;
  static const person_outline = NpIconSet.user;
  static const person_outline_rounded = NpIconSet.user;
  static const phone_outlined = NpIconSet.phone;
  static const photo_camera_outlined = NpIconSet.camera;
  static const privacy_tip_outlined = NpIconSet.shield;
  static const receipt_long = NpIconSet.receipt;
  static const receipt_long_outlined = NpIconSet.receipt;
  static const refresh = NpIconSet.refresh;
  static const refresh_rounded = NpIconSet.refresh;
  static const save_outlined = NpIconSet.save;
  static const search = NpIconSet.search;
  static const search_rounded = NpIconSet.search;
  static const settings_outlined = NpIconSet.settings;
  static const shopping_bag_outlined = NpIconSet.bag;
  static const smartphone_outlined = NpIconSet.smartphone;
  static const storefront = NpIconSet.store;
  static const storefront_outlined = NpIconSet.store;
  static const timelapse = NpIconSet.timer;
  static const visibility_outlined = NpIconSet.eye;
  static const visibility = NpIconSet.eye;
  static const visibility_off_outlined = NpIconSet.eyeOff;
  static const visibility_off = NpIconSet.eyeOff;
  static const warning_amber_rounded = NpIconSet.alertTriangle;
  static const rx = NpIconSet.rx;
  static const box = NpIconSet.box;
}

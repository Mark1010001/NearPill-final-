import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nearpill/widgets/np_icon.dart';

/// Finds an [IconButton] that shows the given NearPill icon (the NearPill equivalent of
/// `find.widgetWithIcon(IconButton, Icons.x)`).
Finder findIconButton(NpIconData icon) => find.byWidgetPredicate(
      (widget) => widget is IconButton && widget.icon is NpIcon && (widget.icon as NpIcon).icon == icon,
      description: 'IconButton with NpIcon ${icon.name}',
    );

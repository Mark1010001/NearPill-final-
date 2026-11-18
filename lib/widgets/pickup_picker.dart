import 'package:flutter/material.dart';

import '../app_theme.dart';
import '../features/orders/pickup.dart';

/// Date chips (Today ... 7 days ahead) and an optional time window. Used on Checkout and when changing a pickup date.
class PickupPicker extends StatelessWidget {
  const PickupPicker({
    super.key,
    required this.date,
    required this.window,
    required this.onChanged,
    this.dateLabel = 'Pickup date',
    this.timeLabel = 'Pickup time',
  });

  final String date;
  final String? window;
  final void Function(String date, String? window) onChanged;
  final String dateLabel;
  final String timeLabel;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Semantics(
          container: true,
          label: dateLabel,
          child: Wrap(
            spacing: 8,
            runSpacing: 2,
            children: [
              for (final day in pickupDays())
                _AnimatedPickupChip(
                  label: chipLabel(day),
                  tooltip: shortDate(day),
                  selected: day == date,
                  enabled: true,
                  onSelected: (_) => onChanged(
                    day,
                    window != null && !windowAvailable(day, window!)
                        ? null
                        : window,
                  ),
                ),
            ],
          ),
        ),
        const SizedBox(height: 14),
        Semantics(
          container: true,
          label: timeLabel,
          child: Wrap(
            spacing: 8,
            runSpacing: 2,
            children: [
              _AnimatedPickupChip(
                label: 'Any time',
                selected: window == null,
                enabled: true,
                onSelected: (_) => onChanged(date, null),
              ),
              for (final entry in pickupWindows)
                _AnimatedPickupChip(
                  label: '${entry.label} ${entry.hours}',
                  selected: window == entry.id,
                  enabled: windowAvailable(date, entry.id),
                  onSelected: windowAvailable(date, entry.id)
                      ? (_) => onChanged(date, entry.id)
                      : null,
                ),
            ],
          ),
        ),
      ],
    );
  }
}

class _AnimatedPickupChip extends StatelessWidget {
  const _AnimatedPickupChip({
    required this.label,
    required this.selected,
    required this.enabled,
    required this.onSelected,
    this.tooltip,
  });

  final String label;
  final String? tooltip;
  final bool selected;
  final bool enabled;
  final ValueChanged<bool>? onSelected;

  @override
  Widget build(BuildContext context) {
    final disableAnimations = MediaQuery.disableAnimationsOf(context);
    final duration = disableAnimations
        ? Duration.zero
        : const Duration(milliseconds: 180);

    return TweenAnimationBuilder<double>(
      tween: Tween<double>(end: selected ? 1.0 : 0.0),
      duration: duration,
      curve: Curves.easeOutCubic,
      builder: (context, t, _) {
        final fill = enabled
            ? Color.lerp(NpColors.surface, NpColors.primary, t)!
            : NpColors.surface;
        final border = enabled
            ? Color.lerp(NpColors.controlBorder, NpColors.primary, t)!
            : NpColors.line;
        final textColor = enabled
            ? Color.lerp(NpColors.ink, Colors.white, t)!
            : NpColors.disabledInk;

        return ChoiceChip(
          label: Text(label),
          tooltip: tooltip,
          selected: selected,
          showCheckmark: false,
          materialTapTargetSize: MaterialTapTargetSize.padded,
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
          color: WidgetStateProperty.all(fill),
          side: BorderSide(color: border, width: selected ? 1.5 : 1),
          labelStyle: WidgetStateTextStyle.resolveWith(
            (states) => TextStyle(
              color: states.contains(WidgetState.disabled)
                  ? NpColors.disabledInk
                  : textColor,
              fontWeight: FontWeight.w700,
              fontSize: 13.5,
            ),
          ),
          onSelected: onSelected,
        );
      },
    );
  }
}

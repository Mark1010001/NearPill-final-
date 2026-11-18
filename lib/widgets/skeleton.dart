import 'package:flutter/material.dart';
import 'package:shimmer/shimmer.dart';

/// Neutral grey loading placeholder shaped like a list of cards. Use it instead of a spinner on
/// screens that load a list or a detail page.
class SkeletonList extends StatelessWidget {
  const SkeletonList({
    super.key,
    this.count = 4,
    this.itemHeight = 96,
    this.semanticsLabel = 'Loading',
  });

  final int count;
  final double itemHeight;
  final String semanticsLabel;

  @override
  Widget build(BuildContext context) => Semantics(
    label: semanticsLabel,
    liveRegion: true,
    child: ExcludeSemantics(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 16),
        child: Shimmer.fromColors(
          baseColor: Colors.grey[300]!,
          highlightColor: Colors.grey[100]!,
          child: Column(
            children: [
              for (var i = 0; i < count; i++)
                Container(
                  height: itemHeight,
                  margin: const EdgeInsets.only(bottom: 12),
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(16),
                  ),
                ),
            ],
          ),
        ),
      ),
    ),
  );
}

import 'package:flutter/material.dart';
import 'package:nearpill/widgets/np_icon.dart';
import 'package:provider/provider.dart';

import '../app_theme.dart';
import '../features/favourites/favourites_view_model.dart';

/// Heart toggle for a pharmacy. Only signed-in customers can save favourites.
class FavouriteHeart extends StatelessWidget {
  const FavouriteHeart({super.key, required this.storeId, required this.name});

  final int storeId;
  final String name;

  @override
  Widget build(BuildContext context) {
    final FavouritesViewModel favourites;
    try {
      favourites = context.watch<FavouritesViewModel>();
    } on ProviderNotFoundException {
      return const SizedBox.shrink();
    }
    if (!favourites.signedIn) return const SizedBox.shrink();
    final on = favourites.isFavourite(storeId);
    return IconButton(
      tooltip: on ? 'Remove from favourites' : 'Add to favourites',
      isSelected: on,
      icon: NpIcon(
        on ? NpIcons.favorite_rounded : NpIcons.favorite_border_rounded,
        color: on ? const Color(0xFFD32F2F) : NpColors.muted,
      ),
      onPressed: () => favourites.toggle(storeId),
    );
  }
}

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../app_theme.dart';
import '../features/orders/presentation/order_updates_view_model.dart';
import '../widgets/np_ui.dart';

/// "Order updates": the status of each order, with changes since the last
/// visit marked New.
class NotificationsScreen extends StatefulWidget {
  const NotificationsScreen({super.key});

  static const routeName = '/order-updates';

  @override
  State<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends State<NotificationsScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) context.read<OrderUpdatesViewModel>().refresh();
    });
  }

  @override
  Widget build(BuildContext context) {
    final model = context.watch<OrderUpdatesViewModel>();
    final updates = model.updates;
    final unread = model.unreadCount;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Order updates'),
        actions: [
          TextButton(
            onPressed: unread == 0 ? null : model.markAllRead,
            child: const Text('Mark all as read'),
          ),
        ],
      ),
      body: SafeArea(
        child: !model.loaded && model.isLoading
            ? const LinearProgressIndicator(
                semanticsLabel: 'Loading your order updates',
              )
            : !model.loaded && model.error != null
            ? Padding(
                padding: const EdgeInsets.all(20),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(model.error!),
                    TextButton(
                      onPressed: model.refresh,
                      child: const Text('Try again'),
                    ),
                  ],
                ),
              )
            : updates.isEmpty
            ? const Padding(
                padding: EdgeInsets.all(20),
                child: Text(
                  'No order updates yet.\nWhen a pharmacy prepares or finishes your order, you will see it here.',
                ),
              )
            : ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  Semantics(
                    liveRegion: true,
                    child: Text(
                      unread == 0
                          ? 'You are all caught up.'
                          : '$unread new ${unread == 1 ? 'update' : 'updates'}',
                      style: const TextStyle(color: NpColors.muted),
                    ),
                  ),
                  const SizedBox(height: 12),
                  for (final update in updates)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 12),
                      child: Card(
                        color: update.unread ? const Color(0xFFF4FBF5) : null,
                        child: ListTile(
                          leading: IconTile(
                            icon: update.unread
                                ? Icons.notifications_rounded
                                : Icons.notifications_outlined,
                            size: 40,
                          ),
                          title: Text(
                            update.message,
                            style: const TextStyle(fontWeight: FontWeight.w700),
                          ),
                          subtitle: Text(
                            'Order #${update.order.reference}'
                            '${update.order.placedOn.isEmpty ? '' : ' • ${update.order.placedOn}'}',
                          ),
                          trailing: update.unread
                              ? const StatusPill(label: 'New')
                              : null,
                        ),
                      ),
                    ),
                ],
              ),
      ),
    );
  }
}

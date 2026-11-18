import 'dart:convert';

enum OrderStage { placed, preparing, ready, completed, cancelled }

OrderStage stageFromString(String rawStage) {
  switch (rawStage.toLowerCase()) {
    case 'preparing':
      return OrderStage.preparing;
    case 'ready':
    case 'ready_for_pickup':
      return OrderStage.ready;
    case 'completed':
      return OrderStage.completed;
    case 'cancelled':
    case 'expired':
      return OrderStage.cancelled;
    default:
      return OrderStage.placed;
  }
}

class OrderModel {
  const OrderModel({
    this.id,
    this.totalCentavos,
    required this.reference,
    required this.storeName,
    required this.itemSummary,
    required this.itemCount,
    required this.total,
    required this.placedOn,
    required this.stage,
    required this.items,
    this.pickupDate,
    this.pickupWindow,
    this.pickupRescheduled = false,
  });

  final int? id;
  final int? totalCentavos;
  final String reference;
  final String storeName;
  final String itemSummary;
  final int itemCount;
  final String total;
  final String placedOn;
  final String stage;
  final List<dynamic> items;
  final String? pickupDate;
  final String? pickupWindow;
  final bool pickupRescheduled;

  factory OrderModel.fromJson(Map<String, dynamic> json) {
    return OrderModel(
      id: int.tryParse(json['id']?.toString() ?? ''),
      totalCentavos: int.tryParse('${json['totalCentavos']}'),
      reference: json['reference']?.toString() ?? '',
      storeName: json['storeName']?.toString() ?? '',
      itemSummary: json['itemSummary']?.toString() ?? '',
      itemCount: int.tryParse(json['itemCount']?.toString() ?? '') ?? 0,
      total: _peso(int.tryParse('${json['totalCentavos']}'), json['total']),
      placedOn: json['placedOn']?.toString() ?? '',
      stage: json['stage']?.toString().toLowerCase() ?? 'placed',
      items: _parseItems(json['items']),
      pickupDate: _text(json['pickupDate']),
      pickupWindow: _text(json['pickupWindow']),
      pickupRescheduled: json['pickupRescheduled'] == true,
    );
  }

  static String? _text(dynamic value) {
    final text = value?.toString().trim();
    return text == null || text.isEmpty ? null : text;
  }

  static List<dynamic> _parseItems(dynamic itemsJson) {
    if (itemsJson == null) return [];
    if (itemsJson is List) return itemsJson;
    if (itemsJson is String) {
      try {
        final decoded = jsonDecode(itemsJson);
        if (decoded is List) return decoded;
      } catch (_) {
        return [];
      }
    }
    return [];
  }
}

extension OrderModelX on OrderModel {
  OrderStage get parsedStage => stageFromString(stage);

  /// A paid order (payment confirmed or later) that the customer can show the pharmacy at pickup.
  bool get hasReceipt => const {
    'confirmed',
    'preparing',
    'ready_for_pickup',
    'completed',
  }.contains(stage.toLowerCase());

  bool get isActive =>
      parsedStage == OrderStage.placed ||
      parsedStage == OrderStage.preparing ||
      parsedStage == OrderStage.ready;

  /// Reserved and not paid yet.
  bool get toPay => const {
    'reserved',
    'awaiting_payment',
    'pending',
  }.contains(stage.toLowerCase());

  /// Paid and being prepared.
  bool get toPickUp =>
      const {'confirmed', 'preparing'}.contains(stage.toLowerCase());

  bool get isPast =>
      parsedStage == OrderStage.completed ||
      parsedStage == OrderStage.cancelled;
}

String _peso(int? centavos, Object? raw) {
  if (centavos != null) {
    return '₱${centavos ~/ 100}.${(centavos % 100).toString().padLeft(2, '0')}';
  }
  final text = raw?.toString() ?? '';
  if (text.isEmpty) return '₱0.00';
  return text.startsWith('₱') ? text : '₱$text';
}

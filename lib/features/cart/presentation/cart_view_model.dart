import 'dart:convert';
import 'dart:math';

import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../../../core/auth/session_manager.dart';
import '../../../models/medicine_model.dart';
import '../../../models/order_model.dart';
import '../../pharmacy/domain/pharmacy.dart';

int _legacyPriceToCentavos(String value) {
  final cleaned = value.replaceAll(RegExp(r'[^0-9.]'), '');
  final match = RegExp(r'^(\d+)(?:\.(\d{1,2}))?$').firstMatch(cleaned);
  if (match == null) return 0;
  final whole = int.tryParse(match.group(1) ?? '') ?? 0;
  final fraction = (match.group(2) ?? '').padRight(2, '0');
  return whole * 100 + (int.tryParse(fraction) ?? 0);
}

String _formatCentavos(int value) =>
    '₱${value ~/ 100}.${(value % 100).toString().padLeft(2, '0')}';

class CartItem {
  CartItem({
    required this.id,
    required this.name,
    required this.priceCentavos,
    required this.drugstoreName,
    required this.drugstoreId,
    required this.category,
    required this.quantity,
    this.sellingUnit,
    this.selected = true,
  });

  final String id;
  final String name;
  int priceCentavos;
  final String drugstoreName;
  final String drugstoreId;
  final String category;
  final String? sellingUnit;
  int quantity;

  /// Whether this line is ticked for checkout. Unticked lines stay in the cart.
  bool selected;
  int? reviewedStockCount;

  /// Last known prescription review state for this item: 'none', 'pending', 'approved', 'rejected' or 'expired'.
  String? prescriptionStatus;

  String get price => _formatCentavos(priceCentavos);
  String get pricePerUnit =>
      sellingUnit == null ? '$price each' : '$price per $sellingUnit';

  factory CartItem.fromJson(Map<String, dynamic> json) => CartItem(
    id: json['id']?.toString() ?? '',
    name: json['name']?.toString() ?? '',
    priceCentavos:
        int.tryParse(json['priceCentavos']?.toString() ?? '') ??
        _legacyPriceToCentavos(json['price']?.toString() ?? ''),
    drugstoreName: json['drugstoreName']?.toString() ?? '',
    drugstoreId: json['drugstoreId']?.toString() ?? '',
    category: json['category']?.toString() ?? 'General',
    sellingUnit: json['sellingUnit'] is String
        ? json['sellingUnit'] as String
        : null,
    quantity: int.tryParse(json['quantity']?.toString() ?? '') ?? 1,
    selected: json['selected'] != false,
  );

  Map<String, dynamic> toJson() => {
    'id': id,
    'name': name,
    'priceCentavos': priceCentavos,
    'drugstoreName': drugstoreName,
    'drugstoreId': drugstoreId,
    'category': category,
    if (sellingUnit != null) 'sellingUnit': sellingUnit,
    'quantity': quantity,
    if (!selected) 'selected': false,
  };
}

typedef CheckoutAttempt = ({String key, List<CartItem> items, bool grouped});

class CartViewModel extends ChangeNotifier {
  CartViewModel({
    required this._sessionManager,
    FlutterSecureStorage? storage,
    Random? random,
  }) : _storage = storage ?? const FlutterSecureStorage(),
       _random = random ?? Random.secure();

  final SessionManager _sessionManager;
  final FlutterSecureStorage _storage;
  final Random _random;
  final List<CartItem> _items = [];
  int? _userId;
  bool _groupedCheckout = false;
  Future<void> _scopeSync = Future.value();
  Future<void> _checkoutChanges = Future.value();

  List<CartItem> get items => List.unmodifiable(_items);
  List<CartItem> get selectedItems =>
      _items.where((item) => item.selected).toList();
  bool get groupedCheckout =>
      _groupedCheckout ||
      selectedItems.map((item) => item.drugstoreId).toSet().length > 1;

  /// Ticked items for checkout, optionally limited to one pharmacy.
  List<CartItem> itemsForPharmacy(String? pharmacyId) => selectedItems
      .where((item) => pharmacyId == null || item.drugstoreId == pharmacyId)
      .toList();

  /// Every cart line for one pharmacy, ticked or not.
  List<CartItem> allItemsForPharmacy(String pharmacyId) =>
      _items.where((item) => item.drugstoreId == pharmacyId).toList();
  bool pharmacyFullySelected(String pharmacyId) =>
      allItemsForPharmacy(pharmacyId).every((item) => item.selected);
  bool get allSelected => _items.isNotEmpty && _items.every((i) => i.selected);
  int subtotalForPharmacy(String pharmacyId, {bool selectedOnly = true}) =>
      _items
          .where(
            (item) =>
                item.drugstoreId == pharmacyId &&
                (!selectedOnly || item.selected),
          )
          .fold<int>(0, (sum, item) => sum + item.priceCentavos * item.quantity);
  String? get _cartKey =>
      _userId == null ? null : 'nearpill_cart_user_$_userId';
  String? get _checkoutKey =>
      _userId == null ? null : 'nearpill_checkout_idempotency_user_$_userId';
  int get totalCentavos => selectedItems.fold<int>(
    0,
    (sum, item) => sum + item.priceCentavos * item.quantity,
  );
  String get totalPrice => _formatCentavos(totalCentavos);

  Future<void> setSelected(CartItem item, bool value) async {
    if (item.selected == value) return;
    item.selected = value;
    await _invalidateCheckoutKey();
    notifyListeners();
    await _saveCart();
  }

  Future<void> setPharmacySelected(String pharmacyId, bool value) async {
    for (final item in _items.where((i) => i.drugstoreId == pharmacyId)) {
      item.selected = value;
    }
    await _invalidateCheckoutKey();
    notifyListeners();
    await _saveCart();
  }

  Future<void> setAllSelected(bool value) async {
    for (final item in _items) {
      item.selected = value;
    }
    await _invalidateCheckoutKey();
    notifyListeners();
    await _saveCart();
  }

  void setPrescriptionStatus(CartItem item, String status) {
    if (item.prescriptionStatus == status) return;
    item.prescriptionStatus = status;
    notifyListeners();
  }

  /// Button label while a prescription item is not approved yet, or null when no prescription blocks checkout.
  String? get prescriptionBlockLabel {
    String? label;
    for (final item in selectedItems) {
      if (CatalogCategory.fromCatalogValue(item.category) !=
          CatalogCategory.prescription) {
        continue;
      }
      final status = item.prescriptionStatus;
      if (status == 'approved') continue;
      final next = switch (status) {
        null => 'Checking prescription…',
        'pending' => 'Waiting for pharmacy approval',
        'rejected' => 'Fix prescription to continue',
        _ => 'Upload prescription to continue',
      };
      if (label == null || next == 'Fix prescription to continue') label = next;
    }
    return label;
  }

  String? get checkoutBlockReason {
    if (_items.isEmpty) return 'Your cart is empty.';
    final selected = selectedItems;
    if (selected.isEmpty) return 'Select the items you want to check out.';
    if (selected.map((item) => item.drugstoreId).toSet().length > 1) {
      return 'Checkout supports one pharmacy at a time. Keep items from one pharmacy to continue.';
    }
    return null;
  }

  Future<String?> reviewCheckout(
    Future<PharmacyInventory> Function(int) loadInventory, {
    String? pharmacyId,
    void Function(CartItem)? onBlockedItem,
  }) async {
    await _syncUserScope();
    if (pharmacyId == null && checkoutBlockReason != null) {
      return checkoutBlockReason;
    }
    final selected = itemsForPharmacy(pharmacyId);
    if (selected.isEmpty) return 'Your cart is empty.';
    final userId = _userId;
    final storeId = int.tryParse(selected.first.drugstoreId);
    if (storeId == null || storeId <= 0) {
      return 'The pharmacy for this cart is unavailable.';
    }

    final inventory = await loadInventory(storeId);
    if (inventory.store.id != storeId) {
      throw const FormatException('Invalid pharmacy inventory.');
    }
    final current = itemsForPharmacy(pharmacyId);
    if (_userId != userId ||
        current.isEmpty ||
        current.any((item) => item.drugstoreId != '$storeId')) {
      return 'Your cart changed. Review it again.';
    }

    final listings = {
      for (final row in inventory.inventory)
        if (row['drugstoreId'].toString() == '$storeId')
          row['id'].toString(): row,
    };
    final prices = <CartItem, int>{};
    for (final item in current) {
      final row = listings[item.id];
      if (row == null) {
        onBlockedItem?.call(item);
        return '${item.name} is no longer listed at this pharmacy. Remove it from your cart to continue.';
      }
      final listing = MedicineModel.fromJson(row);
      if (listing.sellingUnit != item.sellingUnit) {
        onBlockedItem?.call(item);
        return '${item.name}: the selling unit changed. Remove it and add it again to review the new unit.';
      }
      if (!listing.canOrder) {
        onBlockedItem?.call(item);
        final reason = listing.stockCount > 0 &&
                listing.listingStatus == 'Available'
            ? 'Not available to order right now'
            : listing.listingStatus;
        return '${item.name}: $reason. Remove it from your cart to continue.';
      }
      item.reviewedStockCount = listing.stockCount;
      if (listing.stockCount < item.quantity) {
        onBlockedItem?.call(item);
        notifyListeners();
        return 'Only ${listing.stockCount} units of ${item.name} are available. Reduce the quantity in your cart.';
      }
      final price = int.tryParse(row['priceCentavos']?.toString() ?? '');
      if (price == null || price < 0) {
        throw const FormatException('Invalid medicine price.');
      }
      prices[item] = price;
    }
    for (final entry in prices.entries) {
      entry.key.priceCentavos = entry.value;
    }
    notifyListeners();
    await _saveCart();
    return null;
  }

  Future<void> _syncUserScope() {
    final sync = _scopeSync.then((_) async {
      final nextUserId = await _sessionManager.getUserId();
      if (nextUserId == _userId) return;
      _userId = null;
      _items.clear();
      _groupedCheckout = false;
      if (nextUserId != null) {
        await _storage.delete(key: 'nearpill_cart');
        final raw = await _storage.read(key: 'nearpill_cart_user_$nextUserId');
        if (nextUserId == await _sessionManager.getUserId()) {
          _userId = nextUserId;
          try {
            final decoded = raw == null ? null : jsonDecode(raw);
            _groupedCheckout = decoded is Map && decoded['grouped'] == true;
            final lines = decoded is Map ? decoded['items'] : decoded;
            if (lines is List) _items.addAll(_decodeItems(lines));
          } on FormatException {
            // A damaged cart can be rebuilt from the catalogue.
          }
        }
      }
      notifyListeners();
    });
    _scopeSync = sync.then<void>((_) {}, onError: (_, _) {});
    return sync;
  }

  Future<void> loadCart() => _syncUserScope();

  Future<void> _saveCart() async {
    final key = _cartKey;
    if (key == null) throw StateError('Cart requires an authenticated user.');
    await _storage.write(
      key: key,
      value: jsonEncode({
        'grouped': _groupedCheckout,
        'items': _items.map((item) => item.toJson()).toList(),
      }),
    );
  }

  Future<void> _invalidateCheckoutKey() async {
    final key = _checkoutKey;
    if (key != null) await _storage.delete(key: key);
  }

  List<CartItem> _decodeItems(List lines) => lines
      .whereType<Map>()
      .map((item) => CartItem.fromJson(Map<String, dynamic>.from(item)))
      .where(
        (item) =>
            (int.tryParse(item.id) ?? 0) > 0 &&
            (int.tryParse(item.drugstoreId) ?? 0) > 0 &&
            item.quantity > 0 &&
            item.priceCentavos >= 0,
      )
      .toList();

  Future<CheckoutAttempt?> _readAttempt(
    String storageKey,
    String pharmacyId,
  ) async {
    final raw = await _storage.read(key: storageKey);
    if (raw == null) return null;
    try {
      final separator = raw.lastIndexOf('\n');
      final legacy = separator >= 0;
      final decoded = jsonDecode(legacy ? raw.substring(0, separator) : raw);
      final lines = legacy
          ? decoded
          : decoded is Map
          ? decoded['items']
          : null;
      final key = legacy
          ? raw.substring(separator + 1)
          : decoded is Map
          ? decoded['key']
          : null;
      if (lines is! List ||
          key is! String ||
          !RegExp(r'^[A-Za-z0-9._:-]{8,128}$').hasMatch(key)) {
        return null;
      }
      final items = _decodeItems(lines);
      if (items.length != lines.length ||
          items.isEmpty ||
          items.any((item) => item.drugstoreId != pharmacyId)) {
        return null;
      }
      return (
        key: key,
        items: items,
        grouped: legacy || (decoded is Map && decoded['grouped'] == true),
      );
    } on FormatException {
      return null;
    }
  }

  Future<T> _changeCheckout<T>(Future<T> Function() change) {
    final next = _checkoutChanges.then((_) => change());
    _checkoutChanges = next.then<void>((_) {}, onError: (_, _) {});
    return next;
  }

  Future<CheckoutAttempt?> pendingCheckout(String pharmacyId) async {
    await _syncUserScope();
    final accountId = _userId;
    final key = _checkoutKey;
    if (key == null) return null;
    final attempt = await _readAttempt('${key}_$pharmacyId', pharmacyId);
    return accountId == await _sessionManager.getUserId() ? attempt : null;
  }

  Future<CheckoutAttempt> rememberCheckout(
    String pharmacyId,
    int expectedUserId, {
    required bool grouped,
  }) => _changeCheckout(() async {
    await _syncUserScope();
    final key = _checkoutKey;
    if (key == null || _userId != expectedUserId) {
      throw StateError('Your account changed. Review the cart again.');
    }
    final storageKey = '${key}_$pharmacyId';
    final items = itemsForPharmacy(
      pharmacyId,
    ).map((item) => CartItem.fromJson(item.toJson())).toList();
    final existing = await _readAttempt(storageKey, pharmacyId);
    if (existing != null) return existing;
    if (items.isEmpty) throw StateError('Your cart is empty.');
    final oldKey =
        !grouped && selectedItems.every((item) => item.drugstoreId == pharmacyId)
        ? await _storage.read(key: key)
        : null;
    final bytes = List<int>.generate(16, (_) => _random.nextInt(256));
    final generated =
        'mobile-${bytes.map((b) => b.toRadixString(16).padLeft(2, '0')).join()}';
    final attempt = (key: oldKey ?? generated, items: items, grouped: grouped);
    await _storage.write(
      key: storageKey,
      value: jsonEncode({
        'key': attempt.key,
        'items': items.map((item) => item.toJson()).toList(),
        'grouped': grouped,
      }),
    );
    if (oldKey != null) await _storage.delete(key: key);
    return attempt;
  });

  Future<void> addItem({
    required String id,
    required String name,
    required int priceCentavos,
    required String drugstoreName,
    required String drugstoreId,
    required String category,
    required int quantity,
    String? sellingUnit,
  }) async {
    await _syncUserScope();
    if (_userId == null) {
      throw StateError('Cart requires an authenticated user.');
    }
    if (id.isEmpty || drugstoreId.isEmpty || quantity <= 0) {
      throw ArgumentError(
        'A valid medicine, pharmacy, and quantity are required.',
      );
    }
    final existing = _items.indexWhere(
      (item) => item.id == id && item.drugstoreId == drugstoreId,
    );
    if (existing >= 0) {
      if (_items[existing].sellingUnit != sellingUnit) {
        throw StateError(
          'The selling unit changed. Remove the old item from your cart first.',
        );
      }
      _items[existing].quantity += quantity;
      _items[existing].selected = true;
    } else {
      _items.add(
        CartItem(
          id: id,
          name: name,
          priceCentavos: priceCentavos,
          drugstoreName: drugstoreName,
          drugstoreId: drugstoreId,
          category: category,
          sellingUnit: sellingUnit,
          quantity: quantity,
        ),
      );
    }
    await _invalidateCheckoutKey();
    notifyListeners();
    await _saveCart();
  }

  Future<void> addOrderItems(OrderModel order) async {
    if (order.items.isEmpty) {
      throw StateError('This order has no items to add.');
    }
    final items = order.items.map((raw) {
      if (raw is! Map) throw StateError('Invalid order item.');
      final item = CartItem.fromJson({
        ...Map<String, dynamic>.from(raw),
        'drugstoreName': raw['drugstoreName'] ?? order.storeName,
      });
      if (item.id.isEmpty || item.drugstoreId.isEmpty || item.quantity <= 0) {
        throw StateError('Invalid order item.');
      }
      return item;
    }).toList();
    for (final item in items) {
      await addItem(
        id: item.id,
        name: item.name,
        priceCentavos: item.priceCentavos,
        drugstoreName: item.drugstoreName,
        drugstoreId: item.drugstoreId,
        category: item.category,
        sellingUnit: item.sellingUnit,
        quantity: item.quantity,
      );
    }
  }

  Future<void> updateQuantity(
    String id,
    String drugstoreId,
    int newQuantity,
  ) async {
    await _syncUserScope();
    final index = _items.indexWhere(
      (item) => item.id == id && item.drugstoreId == drugstoreId,
    );
    if (index < 0) return;
    if (newQuantity <= 0) {
      _items.removeAt(index);
    } else {
      _items[index].quantity = newQuantity;
    }
    if (_items.isEmpty) _groupedCheckout = false;
    await _invalidateCheckoutKey();
    notifyListeners();
    await _saveCart();
  }

  Future<void> removeItem(String id, String drugstoreId) async {
    await _syncUserScope();
    _items.removeWhere(
      (item) => item.id == id && item.drugstoreId == drugstoreId,
    );
    if (_items.isEmpty) _groupedCheckout = false;
    await _invalidateCheckoutKey();
    notifyListeners();
    await _saveCart();
  }

  Future<void> clearCart() => _changeCheckout(() async {
    await _syncUserScope();
    _items.clear();
    _groupedCheckout = false;
    notifyListeners();
    final checkoutKey = _checkoutKey;
    if (checkoutKey == null) return;
    await _saveCart();
    for (final key in (await _storage.readAll()).keys) {
      if (key == checkoutKey || key.startsWith('${checkoutKey}_')) {
        await _storage.delete(key: key);
      }
    }
  });

  Future<void> finishCheckout(
    CheckoutAttempt attempt,
    int expectedUserId, {
    required bool reserved,
  }) => _changeCheckout(() async {
    await _syncUserScope();
    if (_userId != expectedUserId) return;
    final pharmacyId = attempt.items.first.drugstoreId;
    final key = '${_checkoutKey}_$pharmacyId';
    if ((await _readAttempt(key, pharmacyId))?.key != attempt.key ||
        _userId != expectedUserId) {
      return;
    }
    if (reserved) {
      final quantities = {
        for (final item in attempt.items) item.id: item.quantity,
      };
      for (final item in itemsForPharmacy(pharmacyId)) {
        item.quantity -= quantities[item.id] ?? 0;
      }
      _items.removeWhere((item) => item.quantity <= 0);
      _groupedCheckout =
          _items.isNotEmpty && (_groupedCheckout || attempt.grouped);
      notifyListeners();
      await _saveCart();
    }
    await _storage.delete(key: key);
  });
}

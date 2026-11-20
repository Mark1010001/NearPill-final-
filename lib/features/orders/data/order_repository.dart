import 'package:dio/dio.dart';

import '../../../config/api_config.dart';
import '../../../core/api/api_client.dart';
import '../../../models/order_model.dart';
import '../order_payment.dart';
import '../prescription_source.dart';

export '../order_payment.dart';

class OrderRepository implements PrescriptionSource {
  OrderRepository({required this.apiClient});

  final ApiClient apiClient;

  @override
  Future<int?> currentAccountId() => apiClient.sessionManager.getUserId();

  @override
  Future<({String? status, String? reason})> prescriptionStatus(
    int account,
    int pharmacy,
    int medicine,
  ) async {
    final response = await apiClient.dio.get(
      ApiConfig.apiPath('/prescription-reviews'),
      queryParameters: {'drugstoreId': pharmacy, 'medicineId': medicine},
      options: Options(headers: {'X-NearPill-Account': '$account'}),
    );
    final review = response.data['review'];
    return (
      status: review?['status'] as String?,
      reason: review?['rejectionReason'] as String?,
    );
  }

  @override
  Future<void> submitPrescription(
    int account,
    int pharmacy,
    int medicine,
    String mimeType,
    String photo,
  ) async {
    await apiClient.dio.post(
      ApiConfig.apiPath('/prescription-reviews'),
      data: {
        'drugstoreId': pharmacy,
        'medicineId': medicine,
        'mimeType': mimeType,
        'photo': photo,
      },
      options: Options(headers: {'X-NearPill-Account': '$account'}),
    );
  }

  Future<OrderPayment> paymentStatus(
    int orderId, {
    bool refresh = false,
    int? expectedUserId,
  }) async {
    final response = await apiClient.dio.request(
      ApiConfig.apiPath('/orders/$orderId/payment'),
      options: Options(
        method: refresh ? 'POST' : 'GET',
        headers: {
          if (expectedUserId != null) 'X-NearPill-Account': '$expectedUserId',
        },
      ),
    );
    final payment = response.data['payment'];
    String? orderStatus = payment?['orderStatus'] as String?;
    if (payment == null) {
      final order = await apiClient.dio.get(
        ApiConfig.apiPath('/orders/$orderId'),
        options: Options(
          headers: {
            if (expectedUserId != null) 'X-NearPill-Account': '$expectedUserId',
          },
        ),
      );
      orderStatus = order.data['status'] as String?;
    }
    return (
      status: payment?['paymentStatus'] as String?,
      plan: payment?['paymentPlan'] as String?,
      amountCentavos: int.tryParse('${payment?['amountCentavos']}'),
      orderStatus: orderStatus,
    );
  }

  Future<Uri?> startTestPayment(
    int orderId, {
    String? paymentPlan,
    int? expectedUserId,
  }) async {
    final response = await apiClient.dio.post(
      ApiConfig.apiPath('/orders/$orderId/payments'),
      data: {
        'provider': 'xendit-test',
        'idempotencyKey': 'xendit-test:$orderId',
        'paymentPlan': ?paymentPlan,
      },
      options: Options(
        headers: {
          if (expectedUserId != null) 'X-NearPill-Account': '$expectedUserId',
        },
      ),
    );
    final value = response.data['payment']?['checkoutUrl'];
    return value is String ? trustedTestCheckoutUri(value) : null;
  }

  static Uri? trustedTestCheckoutUri(String value) {
    final uri = Uri.tryParse(value);
    if (uri == null ||
        uri.scheme != 'https' ||
        uri.userInfo.isNotEmpty ||
        uri.port != 443 ||
        !{'dev.xen.to', 'checkout-staging.xendit.co'}.contains(uri.host)) {
      return null;
    }
    return uri;
  }

  Future<String> cancelReservation(int orderId, {int? expectedUserId}) async {
    final response = await apiClient.dio.put(
      ApiConfig.apiPath('/orders/$orderId/cancel'),
      options: Options(
        headers: {
          if (expectedUserId != null) 'X-NearPill-Account': '$expectedUserId',
        },
      ),
    );
    return response.data['status'] as String;
  }

  /// Changes the pickup date (allowed once, while the order is reserved or paid but not being prepared).
  Future<void> reschedulePickup(
    int orderId,
    String pickupDate,
    String? pickupWindow, {
    int? expectedUserId,
  }) async {
    await apiClient.dio.put(
      ApiConfig.apiPath('/orders/$orderId/pickup'),
      data: {'pickupDate': pickupDate, 'pickupWindow': ?pickupWindow},
      options: Options(
        headers: {
          if (expectedUserId != null) 'X-NearPill-Account': '$expectedUserId',
        },
      ),
    );
  }

  Future<List<OrderModel>> listOrders({int? expectedUserId}) async {
    final response = await apiClient.dio.get(
      ApiConfig.apiPath('/orders'),
      options: Options(
        headers: {
          if (expectedUserId != null) 'X-NearPill-Account': '$expectedUserId',
        },
      ),
    );
    if (response.statusCode != 200 || response.data is! List) return const [];
    return (response.data as List)
        .whereType<Map>()
        .map((item) => OrderModel.fromJson(Map<String, dynamic>.from(item)))
        .toList();
  }

  Future<Map<String, dynamic>> createOrder({
    required List<Map<String, dynamic>> items,
    required String idempotencyKey,
    int? expectedUserId,
    bool grouped = false,
    String? pickupDate,
    String? pickupWindow,
  }) async {
    final response = await apiClient.dio.post(
      ApiConfig.apiPath('/orders'),
      data: {
        'items': items,
        'idempotencyKey': idempotencyKey,
        if (grouped) 'checkoutMode': 'grouped',
        'pickupDate': ?pickupDate,
        'pickupWindow': ?pickupWindow,
      },
      options: Options(
        headers: {
          'Idempotency-Key': idempotencyKey,
          if (expectedUserId != null) 'X-NearPill-Account': '$expectedUserId',
        },
      ),
    );
    if (response.statusCode != 200 && response.statusCode != 201) {
      throw StateError('Order creation failed.');
    }
    final data = response.data;
    if (data is! Map ||
        data['reference'] is! String ||
        (data['reference'] as String).trim().isEmpty) {
      throw const FormatException('Invalid order response.');
    }
    return Map<String, dynamic>.from(data);
  }
}

import 'package:dio/dio.dart';

import '../../config/api_config.dart';
import '../../core/api/api_client.dart';

/// One turn of the chat. [fromUser] false means Ask NearPill said it.
typedef ChatTurn = ({bool fromUser, String text});

typedef ChatCartLine = ({String name, int quantity, String pharmacy});

class AssistantUnavailable implements Exception {
  AssistantUnavailable(this.message);
  final String message;
}

/// What the chat screen needs, so the screen does not depend on the data layer.
abstract interface class AssistantChat {
  Future<String> ask(
    List<ChatTurn> turns, {
    List<ChatCartLine> cart = const [],
  });
}

/// Sends the conversation to NearPill's server, which answers about NearPill only.
class AssistantRepository implements AssistantChat {
  AssistantRepository({required this.apiClient});

  final ApiClient apiClient;

  @override
  Future<String> ask(
    List<ChatTurn> turns, {
    List<ChatCartLine> cart = const [],
  }) async {
    final account = await apiClient.sessionManager.getUserId();
    try {
      final response = await apiClient.dio.post(
        ApiConfig.apiPath('/assistant/chat'),
        data: {
          'messages': [
            for (final turn in turns.length > 12
                ? turns.sublist(turns.length - 12)
                : turns)
              {
                'role': turn.fromUser ? 'user' : 'assistant',
                'content': turn.text.length > 1000
                    ? turn.text.substring(0, 1000)
                    : turn.text,
              },
          ],
          if (cart.isNotEmpty)
            'cart': [
              for (final line in cart.take(20))
                {
                  'name': line.name.length > 80
                      ? line.name.substring(0, 80)
                      : line.name,
                  'quantity': line.quantity.clamp(1, 999),
                  'pharmacy': line.pharmacy.length > 80
                      ? line.pharmacy.substring(0, 80)
                      : line.pharmacy,
                },
            ],
        },
        options: Options(
          headers: {if (account != null) 'X-NearPill-Account': '$account'},
          receiveTimeout: const Duration(seconds: 30),
        ),
      );
      final reply = response.data is Map ? response.data['reply'] : null;
      if (reply is! String || reply.trim().isEmpty) {
        throw AssistantUnavailable('The assistant did not answer. Try again.');
      }
      return reply.trim();
    } on DioException catch (error) {
      final data = error.response?.data;
      final message = data is Map && data['error'] is String
          ? data['error'] as String
          : 'The assistant could not be reached. Check your connection and try again.';
      throw AssistantUnavailable(message);
    }
  }
}

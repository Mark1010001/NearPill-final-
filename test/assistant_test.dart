import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nearpill/features/assistant/assistant_repository.dart';
import 'package:nearpill/screens/assistant_screen.dart';

class _Repository implements AssistantRepository {
  final calls = <List<ChatTurn>>[];
  final replies = <Object>[];

  @override
  Future<String> ask(
    List<ChatTurn> turns, {
    List<ChatCartLine> cart = const [],
  }) async {
    calls.add(List.of(turns));
    final next = replies.removeAt(0);
    if (next is Exception) throw next;
    return next as String;
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

Widget _app(_Repository repository) =>
    MaterialApp(home: AssistantScreen(repository: repository));

Future<void> _send(WidgetTester tester, String text) async {
  await tester.enterText(find.byType(TextField), text);
  await tester.tap(find.byTooltip('Send question'));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('opens as a plain white chat with no preset questions', (
    tester,
  ) async {
    await tester.pumpWidget(_app(_Repository()));
    expect(tester.widget<Scaffold>(find.byType(Scaffold)).backgroundColor, Colors.white);
    expect(find.text('Ask NearPill'), findsWidgets);
    expect(find.textContaining('Ask me anything about using NearPill'), findsOneWidget);
    expect(find.byType(ActionChip), findsNothing);
    expect(find.byType(ChoiceChip), findsNothing);
    expect(find.text('Find a medicine'), findsNothing);
    expect(find.byType(TextField), findsOneWidget);
  });

  testWidgets('a question is sent with the conversation and the answer is shown', (
    tester,
  ) async {
    final repository = _Repository()
      ..replies.addAll(['Your order is ready for pickup.', 'Show your claim code.']);
    await tester.pumpWidget(_app(repository));
    await _send(tester, 'Where is my order?');
    expect(find.text('Where is my order?'), findsOneWidget);
    expect(find.text('Your order is ready for pickup.'), findsOneWidget);
    expect(repository.calls.single.single, (
      fromUser: true,
      text: 'Where is my order?',
    ));
    await _send(tester, 'What do I bring?');
    expect(find.text('Show your claim code.'), findsOneWidget);
    expect(repository.calls.last.length, 3);
    expect(repository.calls.last[1].fromUser, isFalse);
  });

  testWidgets('a failed answer can be retried, and a new chat clears everything', (
    tester,
  ) async {
    final repository = _Repository()
      ..replies.addAll([
        AssistantUnavailable('The assistant is not available right now.'),
        'Back again.',
      ]);
    await tester.pumpWidget(_app(repository));
    await _send(tester, 'hello there');
    expect(find.text('The assistant is not available right now.'), findsOneWidget);
    await tester.tap(find.text('Try again'));
    await tester.pumpAndSettle();
    expect(find.text('Back again.'), findsOneWidget);
    expect(find.text('The assistant is not available right now.'), findsNothing);
    expect(repository.calls.last.length, 1, reason: 'retry does not duplicate the question');
    await tester.tap(find.byTooltip('New chat'));
    await tester.pumpAndSettle();
    expect(find.text('hello there'), findsNothing);
    expect(find.textContaining('Ask me anything about using NearPill'), findsOneWidget);
  });
}

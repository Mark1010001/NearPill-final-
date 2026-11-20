import 'package:flutter/material.dart';
import 'package:nearpill/widgets/np_icon.dart';
import 'package:provider/provider.dart';
import '../features/assistant/assistant_repository.dart';
import '../features/cart/presentation/cart_view_model.dart';

const _green = Color(0xFF2E7D32);
const _ink = Color(0xFF17332A);
const _muted = Color(0xFF55655F);

/// Ask NearPill: a chat that answers questions about NearPill only.
class AssistantScreen extends StatefulWidget {
  const AssistantScreen({super.key, this.repository});

  final AssistantChat? repository;

  @override
  State<AssistantScreen> createState() => _AssistantScreenState();
}

class _AssistantScreenState extends State<AssistantScreen> {
  final _input = TextEditingController();
  final _scroll = ScrollController();
  final _turns = <ChatTurn>[];
  bool _waiting = false;
  String? _error;
  int _request = 0;

  @override
  void dispose() {
    ++_request;
    _input.dispose();
    _scroll.dispose();
    super.dispose();
  }

  List<ChatCartLine> _cart() {
    try {
      return [
        for (final item in context.read<CartViewModel>().items)
          (
            name: item.name,
            quantity: item.quantity,
            pharmacy: item.drugstoreName,
          ),
      ];
    } on ProviderNotFoundException {
      return const [];
    }
  }

  AssistantChat _repository() =>
      widget.repository ?? context.read<AssistantChat>();

  void _scrollDown() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted && _scroll.hasClients) {
        _scroll.animateTo(
          _scroll.position.maxScrollExtent,
          duration: const Duration(milliseconds: 200),
          curve: Curves.easeOut,
        );
      }
    });
  }

  Future<void> _send([String? retry]) async {
    final text = (retry ?? _input.text).trim();
    if (text.isEmpty || _waiting) return;
    if (retry == null) {
      setState(() => _turns.add((fromUser: true, text: text)));
      _input.clear();
    }
    final request = ++_request;
    setState(() {
      _waiting = true;
      _error = null;
    });
    _scrollDown();
    try {
      final reply = await _repository().ask(_turns, cart: _cart());
      if (!mounted || request != _request) return;
      setState(() => _turns.add((fromUser: false, text: reply)));
    } on AssistantUnavailable catch (error) {
      if (!mounted || request != _request) return;
      setState(() => _error = error.message);
    } catch (_) {
      if (!mounted || request != _request) return;
      setState(
        () => _error = 'Something went wrong. Please try again.',
      );
    } finally {
      if (mounted && request == _request) setState(() => _waiting = false);
      _scrollDown();
    }
  }

  void _newChat() {
    ++_request;
    setState(() {
      _turns.clear();
      _waiting = false;
      _error = null;
    });
  }

  Widget _bubble(ChatTurn turn) => Align(
    alignment: turn.fromUser ? Alignment.centerRight : Alignment.centerLeft,
    child: Container(
      margin: const EdgeInsets.symmetric(vertical: 4),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      constraints: BoxConstraints(
        maxWidth: MediaQuery.sizeOf(context).width * 0.82,
      ),
      decoration: BoxDecoration(
        color: turn.fromUser ? _green : const Color(0xFFF1F3F2),
        borderRadius: BorderRadius.circular(18),
      ),
      child: SelectableText(
        turn.text,
        style: TextStyle(
          color: turn.fromUser ? Colors.white : _ink,
          height: 1.4,
          fontSize: 15,
        ),
      ),
    ),
  );

  Widget _empty() => Center(
    child: Padding(
      padding: const EdgeInsets.symmetric(horizontal: 32),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 56,
            height: 56,
            decoration: const BoxDecoration(
              color: Color(0xFFE3FDEF),
              shape: BoxShape.circle,
            ),
            child: const NpIcon(NpIcons.chat_bubble_outline, color: _green),
          ),
          const SizedBox(height: 16),
          const Text(
            'Ask NearPill',
            style: TextStyle(
              fontSize: 22,
              fontWeight: FontWeight.w800,
              color: _ink,
            ),
          ),
          const SizedBox(height: 8),
          const Text(
            'Ask me anything about using NearPill: medicines and pharmacies, your orders and cart, payment and pickup, or your account.',
            textAlign: TextAlign.center,
            style: TextStyle(color: _muted, height: 1.4),
          ),
        ],
      ),
    ),
  );

  @override
  Widget build(BuildContext context) {
    final lastUser = _turns.isNotEmpty && _turns.last.fromUser
        ? _turns.last.text
        : null;
    return Scaffold(
      backgroundColor: Colors.white,
      appBar: AppBar(
        backgroundColor: Colors.white,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        scrolledUnderElevation: 0,
        title: const Text(
          'Ask NearPill',
          style: TextStyle(fontWeight: FontWeight.w800, color: _ink),
        ),
        actions: [
          IconButton(
            tooltip: 'New chat',
            onPressed: _turns.isEmpty && _error == null ? null : _newChat,
            icon: const NpIcon(NpIcons.add_comment_outlined),
          ),
        ],
      ),
      body: SafeArea(
        child: Column(
          children: [
            Expanded(
              child: _turns.isEmpty && !_waiting && _error == null
                  ? _empty()
                  : ListView(
                      controller: _scroll,
                      padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
                      children: [
                        for (final turn in _turns) _bubble(turn),
                        if (_waiting)
                          Align(
                            alignment: Alignment.centerLeft,
                            child: Padding(
                              padding: const EdgeInsets.symmetric(vertical: 8),
                              child: Semantics(
                                liveRegion: true,
                                label: 'Ask NearPill is typing',
                                child: const Text(
                                  'Typing…',
                                  style: TextStyle(color: _muted),
                                ),
                              ),
                            ),
                          ),
                        if (_error != null)
                          Padding(
                            padding: const EdgeInsets.symmetric(vertical: 8),
                            child: Semantics(
                              liveRegion: true,
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    _error!,
                                    style: const TextStyle(
                                      color: Color(0xFFB3261E),
                                    ),
                                  ),
                                  if (lastUser != null)
                                    TextButton(
                                      onPressed: () => _send(lastUser),
                                      child: const Text('Try again'),
                                    ),
                                ],
                              ),
                            ),
                          ),
                      ],
                    ),
            ),
            const Padding(
              padding: EdgeInsets.fromLTRB(16, 0, 16, 6),
              child: Text(
                'Ask NearPill can make mistakes and does not give medical advice.',
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 11, color: _muted),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
              child: Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _input,
                      maxLength: 500,
                      minLines: 1,
                      maxLines: 4,
                      textInputAction: TextInputAction.send,
                      onSubmitted: (_) => _send(),
                      decoration: InputDecoration(
                        counterText: '',
                        hintText: 'Message Ask NearPill',
                        filled: true,
                        fillColor: const Color(0xFFF1F3F2),
                        contentPadding: const EdgeInsets.symmetric(
                          horizontal: 18,
                          vertical: 14,
                        ),
                        border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(28),
                          borderSide: BorderSide.none,
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  IconButton.filled(
                    tooltip: 'Send question',
                    style: IconButton.styleFrom(
                      backgroundColor: _green,
                      minimumSize: const Size(52, 52),
                    ),
                    onPressed: _waiting ? null : _send,
                    icon: const NpIcon(NpIcons.arrow_upward),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

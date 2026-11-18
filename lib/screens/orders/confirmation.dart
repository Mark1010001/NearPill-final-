import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../config/service_notices.dart';

import 'package:dio/dio.dart';
import 'package:share_plus/share_plus.dart';

import '../../features/orders/data/order_repository.dart';
import '../../features/orders/pickup.dart';
import '../../features/orders/receipt_pdf.dart';
import '../../widgets/pickup_picker.dart';
import '../../features/orders/presentation/order_view_model.dart';
import '../../models/order_model.dart';

class OrderConfirmationScreen extends StatefulWidget {
  const OrderConfirmationScreen({
    super.key,
    required this.reference,
    required this.storeName,
    this.orderId,
    this.stage = OrderStage.placed,
    this.totalCentavos,
    this.depositEnabled = false,
    this.accountId,
    this.hasRemainingCart = false,
    this.itemSummary,
    this.status,
    this.receiptItems = const [],
    this.placedOn,
    this.customerName,
    this.customerPhone,
    this.pickupDate,
    this.pickupWindow,
    this.pickupRescheduled = false,
  });

  static const routeName = '/order-confirmation';

  final String reference;
  final String storeName;
  final int? orderId;
  final OrderStage stage;
  final int? totalCentavos;
  final bool depositEnabled;
  final int? accountId;
  final bool hasRemainingCart;
  final String? itemSummary;
  final String? status;
  final List<dynamic> receiptItems;
  final String? placedOn;
  final String? customerName;
  final String? customerPhone;
  final String? pickupDate;
  final String? pickupWindow;
  final bool pickupRescheduled;

  @override
  State<OrderConfirmationScreen> createState() =>
      _OrderConfirmationScreenState();
}

class _OrderConfirmationScreenState extends State<OrderConfirmationScreen>
    with SingleTickerProviderStateMixin, WidgetsBindingObserver {
  late final AnimationController _controller;
  late final Animation<double> _scale;
  String? _paymentStatus;
  String? _paymentError;
  bool _paymentBusy = false;
  bool _paymentChecked = false;
  int _balance = 0;
  String? _paymentPlan;
  late OrderStage _stage;
  String? _orderStatus;
  int _orderGeneration = 0;
  String _choice = 'deposit';
  String? _pickupDate;
  String? _pickupWindow;
  bool _pickupRescheduled = false;
  bool _editingPickup = false;
  bool _savingPickup = false;
  String? _pickupError;
  String _newPickupDate = pickupDays().first;
  String? _newPickupWindow;

  bool get _canChangePickup =>
      widget.orderId != null &&
      !_pickupRescheduled &&
      _paymentStatus != 'confirmed' &&
      const {
        'reserved',
        'awaiting_payment',
      }.contains((_orderStatus ?? widget.status ?? 'reserved').toLowerCase());

  Future<void> _savePickup() async {
    if (_savingPickup) return;
    setState(() {
      _savingPickup = true;
      _pickupError = null;
    });
    try {
      await context.read<OrderViewModel>().repository.reschedulePickup(
        widget.orderId!,
        _newPickupDate,
        _newPickupWindow,
        expectedUserId: widget.accountId,
      );
      if (!mounted) return;
      setState(() {
        _pickupDate = _newPickupDate;
        _pickupWindow = _newPickupWindow;
        _pickupRescheduled = true;
        _editingPickup = false;
      });
      unawaited(context.read<OrderViewModel>().fetchOrders());
    } on DioException catch (error) {
      final data = error.response?.data;
      if (mounted) {
        setState(
          () => _pickupError = data is Map && data['error'] is String
              ? data['error'] as String
              : 'Could not change the pickup date.',
        );
      }
    } catch (_) {
      if (mounted) setState(() => _pickupError = 'Could not change the pickup date.');
    } finally {
      if (mounted) setState(() => _savingPickup = false);
    }
  }

  Future<void> _downloadReceipt() async {
    try {
      final bytes = buildReceiptPdf(
        ReceiptFacts(
          reference: widget.reference,
          storeName: widget.storeName,
          customerName: widget.customerName ?? '',
          customerPhone: widget.customerPhone ?? '',
          placedOn: widget.placedOn ?? '',
          items: widget.receiptItems,
          totalCentavos: widget.totalCentavos ?? 0,
          balanceDue: _stage == OrderStage.completed ? 0 : _balance,
          pickupDate: _pickupDate,
          pickupWindow: _pickupWindow,
        ),
      );
      final name = receiptFileName(widget.reference);
      await SharePlus.instance.share(
        ShareParams(
          files: [XFile.fromData(bytes, mimeType: 'application/pdf', name: name)],
          fileNameOverrides: [name],
          subject: 'NearPill receipt ${widget.reference}',
        ),
      );
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Could not create the receipt PDF.')),
        );
      }
    }
  }

  String _price(int cents) =>
      '₱${cents ~/ 100}.${(cents % 100).toString().padLeft(2, '0')}';

  bool get _testOrder =>
      widget.orderId != null && widget.reference.startsWith('NP-TEST-');

  void _showPayment(OrderPayment payment) {
    setState(() {
      _paymentStatus = payment.status;
      _paymentPlan = payment.plan;
      if (payment.orderStatus != null) {
        _orderStatus = payment.orderStatus;
        _stage = stageFromString(payment.orderStatus!);
      }
      final total = widget.totalCentavos;
      final amount = payment.amountCentavos;
      _balance = payment.plan == 'balance' && payment.status != 'confirmed'
          ? amount ?? 0
          : payment.plan == 'deposit' &&
                total != null &&
                amount != null &&
                amount < total
          ? total - amount
          : 0;
      _paymentChecked = true;
    });
  }

  Future<void> _checkPayment({
    bool openCheckout = false,
    bool refresh = false,
    String? plan,
  }) async {
    if (_paymentBusy) return;
    final generation = _orderGeneration;
    final repository = context.read<OrderViewModel>().repository;
    final orderId = widget.orderId!;
    setState(() {
      _paymentBusy = true;
      _paymentError = null;
    });
    try {
      final payment = await repository.paymentStatus(
        orderId,
        refresh: refresh,
        expectedUserId: widget.accountId,
      );
      final status = payment.status;
      if (!mounted || generation != _orderGeneration) return;
      _showPayment(payment);
      if (openCheckout &&
          (status == null ||
              status == 'pending' ||
              (plan == 'balance' &&
                  status == 'confirmed' &&
                  payment.plan == 'deposit'))) {
        final url = await repository.startTestPayment(
          orderId,
          paymentPlan: plan ?? payment.plan,
          expectedUserId: widget.accountId,
        );
        if (!mounted || generation != _orderGeneration) return;
        if (url == null) {
          final current = await repository.paymentStatus(
            orderId,
            expectedUserId: widget.accountId,
          );
          if (!mounted || generation != _orderGeneration) return;
          _showPayment(current);
          if (current.status != null && current.status != 'pending') return;
          throw StateError('Could not open the test checkout.');
        }
        if (!await launchUrl(url, mode: LaunchMode.externalApplication)) {
          throw StateError('Could not open the test checkout.');
        }
        if (mounted && generation == _orderGeneration) {
          setState(() {
            _paymentStatus = 'pending';
            _paymentPlan = plan ?? payment.plan;
          });
        }
      }
    } catch (_) {
      if (mounted && generation == _orderGeneration) {
        setState(
          () => _paymentError = openCheckout
              ? 'Could not open GCash test checkout. Try again.'
              : 'Could not check the payment status. Try again.',
        );
      }
    } finally {
      if (mounted && generation == _orderGeneration) {
        setState(() => _paymentBusy = false);
      }
    }
  }

  @override
  void initState() {
    super.initState();
    _stage = widget.stage;
    _pickupDate = widget.pickupDate;
    _pickupWindow = widget.pickupWindow;
    _pickupRescheduled = widget.pickupRescheduled;
    _newPickupDate = widget.pickupDate != null && pickupDays().contains(widget.pickupDate)
        ? widget.pickupDate!
        : pickupDays().first;
    _newPickupWindow = widget.pickupWindow;
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 500),
    );
    _scale = CurvedAnimation(parent: _controller, curve: Curves.elasticOut);
    _controller.forward();
    WidgetsBinding.instance.addObserver(this);
    _loadPayment();
  }

  void _loadPayment() {
    final generation = _orderGeneration;
    if (_testOrder) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted && generation == _orderGeneration) _checkPayment();
      });
    }
  }

  @override
  void didUpdateWidget(OrderConfirmationScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.reference != widget.reference ||
        oldWidget.orderId != widget.orderId ||
        oldWidget.accountId != widget.accountId) {
      _orderGeneration++;
      _orderStatus = null;
      _stage = widget.stage;
      _paymentPlan = null;
      _paymentStatus = null;
      _paymentError = null;
      _paymentChecked = false;
      _paymentBusy = false;
      _balance = 0;
      _loadPayment();
    } else if (oldWidget.stage != widget.stage) {
      _stage = widget.stage;
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (_testOrder && state == AppLifecycleState.resumed) {
      _checkPayment(refresh: true);
    }
  }

  Future<void> _cancelReservation() async {
    if (_paymentBusy) return;
    final generation = _orderGeneration;
    final cancel = await showDialog<bool>(
      context: context,
      builder: (dialog) => AlertDialog(
        title: const Text('Cancel this unpaid reservation?'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialog, false),
            child: const Text('Keep reservation'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(dialog, true),
            child: const Text('Cancel reservation'),
          ),
        ],
      ),
    );
    if (!mounted ||
        cancel != true ||
        _paymentBusy ||
        generation != _orderGeneration) {
      return;
    }
    final orders = context.read<OrderViewModel>();
    setState(() {
      _paymentBusy = true;
      _paymentError = null;
    });
    try {
      final status = await orders.repository.cancelReservation(
        widget.orderId!,
        expectedUserId: widget.accountId,
      );
      if (mounted && generation == _orderGeneration) {
        setState(() {
          _orderStatus = status;
          _stage = stageFromString(status);
        });
      }
      await orders.fetchOrders();
    } catch (error) {
      final data = error is DioException ? error.response?.data : null;
      if (mounted && generation == _orderGeneration) {
        setState(
          () => _paymentError = data is Map && data['error'] is String
              ? data['error'] as String
              : 'Could not cancel this reservation. Try again.',
        );
      }
    } finally {
      if (mounted && generation == _orderGeneration) {
        setState(() => _paymentBusy = false);
      }
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final cancelled = _stage == OrderStage.cancelled;
    final currentStatus = (_orderStatus ?? widget.status ?? '').toLowerCase();
    final showReceipt =
        !cancelled &&
        widget.receiptItems.isNotEmpty &&
        (const {
              'confirmed',
              'preparing',
              'ready_for_pickup',
              'completed',
            }.contains(currentStatus) ||
            (_paymentStatus == 'confirmed' && _orderStatus != 'cancelled'));
    final payable =
        _stage == OrderStage.placed &&
        (_orderStatus == null ||
            ['reserved', 'awaiting_payment'].contains(_orderStatus));
    final canChooseDeposit =
        widget.depositEnabled &&
        (widget.totalCentavos ?? 0) > 10000 &&
        payable &&
        _paymentChecked &&
        _paymentStatus == null;
    final total = widget.totalCentavos ?? 0;
    final deposit = total > 10000 ? ((total + 1) ~/ 2).clamp(10000, total) : 0;
    final choice = canChooseDeposit ? _choice : 'full';
    final (heroIcon, heroColor, heroTitle) = switch (_stage) {
      OrderStage.cancelled => (
        Icons.cancel_outlined,
        Colors.red.shade400,
        _orderStatus == 'expired' ? 'Reservation expired' : 'Order Cancelled',
      ),
      OrderStage.completed => (
        Icons.check_circle,
        _green,
        'Collected',
      ),
      OrderStage.placed => (
        Icons.check_circle,
        _green,
        _orderStatus == 'cancellation_pending'
            ? 'Cancellation requested'
            : _paymentStatus == 'confirmed'
            ? 'Payment confirmed'
            : _paymentStatus == 'pending'
            ? 'Waiting for payment confirmation'
            : 'Order reserved',
      ),
      OrderStage.preparing => (
        Icons.timelapse,
        _green,
        'Preparing for pickup',
      ),
      OrderStage.ready => (
        Icons.check_circle,
        _green,
        'Ready for pickup',
      ),
    };
    final paymentText = _testOrder
        ? switch (_paymentStatus) {
            'confirmed' =>
              _paymentPlan == 'balance'
                  ? 'Balance paid with GCash. ₱0.00 due.'
                  : _balance > 0 && _stage == OrderStage.completed
                  ? 'Remaining balance settled at pickup. ₱0.00 due.'
                  : _balance > 0
                  ? 'Deposit confirmed. Balance due: ${_price(_balance)}.'
                  : null,
            'failed' =>
              _paymentPlan == 'balance'
                  ? _stage == OrderStage.completed
                        ? 'Remaining balance settled at pickup. ₱0.00 due.'
                        : 'The online balance checkout ended. Pay ${_price(_balance)} at pickup.'
                  : 'The test checkout ended without payment.',
            'reconciliation_required' => 'The test payment needs staff review.',
            'pending' => 'Waiting for payment.',
            _ => null,
          }
        : null;
    final paymentTone = switch (_paymentStatus) {
      'confirmed' => _Tone.good,
      'failed' || 'reconciliation_required' => _Tone.warn,
      'pending' => _Tone.info,
      _ => _Tone.neutral,
    };
    final paidOnline = _paymentStatus == 'confirmed';

    return Scaffold(
      backgroundColor: const Color(0xFFF6F8F6),
      appBar: AppBar(title: const Text('Order Details'), centerTitle: false),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Center(
            child: ScaleTransition(
              scale: _scale,
              child: Container(
                width: 72,
                height: 72,
                decoration: BoxDecoration(
                  color: _stage == OrderStage.completed
                      ? _greenDark
                      : Colors.white,
                  shape: BoxShape.circle,
                  border: Border.all(color: const Color(0xFFE3EAE7)),
                  boxShadow: const [
                    BoxShadow(
                      color: Color(0x0F0F172A),
                      blurRadius: 24,
                      offset: Offset(0, 8),
                    ),
                  ],
                ),
                child: Icon(
                  heroIcon,
                  color: _stage == OrderStage.completed
                      ? Colors.white
                      : heroColor,
                  size: 36,
                ),
              ),
            ),
          ),
          const SizedBox(height: 12),
          Center(
            child: Text(
              heroTitle,
              textAlign: TextAlign.center,
              style: TextStyle(
                fontSize: 26,
                fontWeight: FontWeight.w700,
                letterSpacing: -0.3,
                color: _stage == OrderStage.completed
                    ? _greenDark
                    : const Color(0xFF0F172A),
              ),
            ),
          ),
          const SizedBox(height: 8),
          const SizedBox(height: 8),
          if (widget.hasRemainingCart) ...[
            _Banner(
              tone: _Tone.neutral,
              icon: Icons.shopping_bag_outlined,
              text: 'Your other items are still in your cart.',
              action: TextButton(
                onPressed: () => Navigator.of(context).maybePop(),
                child: const Text('Back to remaining cart items'),
              ),
            ),
            const SizedBox(height: 12),
          ],
          if (!cancelled) ...[
            _ProgressCard(
              stage: _stage,
              paid: paidOnline,
              showPaidStep: _testOrder,
              depositOnly: _balance > 0,
            ),
            const SizedBox(height: 16),
          ],
          if (_testOrder) ...[
            if (paymentText != null)
              Semantics(
                liveRegion: true,
                child: _Banner(
                  tone: paymentTone,
                  icon: switch (paymentTone) {
                    _Tone.good => Icons.check_circle_outline,
                    _Tone.warn => Icons.warning_amber_rounded,
                    _Tone.info => Icons.hourglass_top,
                    _Tone.neutral => Icons.info_outline,
                  },
                  text: paymentText,
                ),
              ),
            if (_paymentError != null) ...[
              const SizedBox(height: 8),
              Semantics(
                liveRegion: true,
                child: _Banner(
                  tone: _Tone.warn,
                  icon: Icons.error_outline,
                  text: _paymentError!,
                ),
              ),
            ],
            if (_paymentStatus == 'pending') ...[
              const SizedBox(height: 8),
              const _Banner(
                tone: _Tone.info,
                icon: Icons.refresh,
                text: 'Come back here after paying.',
              ),
            ],
            const SizedBox(height: 12),
            if (widget.depositEnabled &&
                _stage == OrderStage.ready &&
                _balance >= 100 &&
                ((_paymentPlan == 'deposit' && _paymentStatus == 'confirmed') ||
                    (_paymentPlan == 'balance' &&
                        _paymentStatus == 'pending'))) ...[
              _Card(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Settle the remaining ${_price(_balance)}?',
                      style: const TextStyle(
                        fontWeight: FontWeight.w800,
                        fontSize: 16,
                      ),
                    ),
                    const SizedBox(height: 4),
                    const Text(
                      'Pay it now with GCash, or pay at the counter when you pick up.',
                    ),
                    const SizedBox(height: 12),
                    FilledButton(
                      style: _bigButton,
                      onPressed: _paymentBusy
                          ? null
                          : () => _checkPayment(
                              openCheckout: true,
                              plan: 'balance',
                            ),
                      child: Text(
                        _paymentStatus == 'pending'
                            ? 'Resume GCash balance checkout'
                            : 'Pay ${_price(_balance)} with GCash',
                      ),
                    ),
                    if (_stage == OrderStage.ready &&
                        _paymentPlan == 'deposit' &&
                        _balance > 0) ...[
                      const SizedBox(height: 8),
                      const Text('You can also pay at pickup.'),
                    ],
                  ],
                ),
              ),
              const SizedBox(height: 12),
            ] else if (_stage == OrderStage.ready &&
                _paymentPlan == 'deposit' &&
                _balance > 0) ...[
              const Padding(
                padding: EdgeInsets.only(bottom: 12),
                child: Text('You can also pay at pickup.'),
              ),
            ],
            if (payable &&
                _paymentChecked &&
                _paymentStatus == null &&
                total > 0) ...[
              _Card(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    const Text(
                      'How would you like to pay?',
                      style: TextStyle(
                        fontWeight: FontWeight.w600,
                        fontSize: 17,
                      ),
                    ),
                    const SizedBox(height: 12),
                    if (canChooseDeposit)
                      _PayOption(
                        title: 'Pay a deposit',
                        payNow: 'Pay now ${_price(deposit)}',
                        payLater: 'Pay ${_price(total - deposit)} at pickup',
                        selected: choice == 'deposit',
                        onTap: () => setState(() => _choice = 'deposit'),
                      ),
                    if (canChooseDeposit) const SizedBox(height: 10),
                    _PayOption(
                      title: 'Pay in full',
                      payNow: 'Pay now ${_price(total)}',
                      payLater: 'Due at pickup ${_price(0)}',
                      selected: choice == 'full',
                      onTap: () => setState(() => _choice = 'full'),
                    ),
                    if (widget.depositEnabled && !canChooseDeposit) ...[
                      const SizedBox(height: 8),
                      const Text(
                        'Orders of ₱100 or less are paid in full.',
                        style: TextStyle(color: Color(0xFF556274)),
                      ),
                    ],
                    const SizedBox(height: 14),
                    FilledButton.icon(
                      style: _bigButton,
                      onPressed: _paymentBusy
                          ? null
                          : () => _checkPayment(
                              openCheckout: true,
                              plan: choice == 'deposit' ? 'deposit' : null,
                            ),
                      icon: const Icon(Icons.account_balance_wallet_outlined),
                      label: Text(
                        choice == 'deposit'
                            ? 'Pay ${_price(deposit)} deposit with GCash'
                            : widget.depositEnabled
                            ? 'Pay ${_price(total)} in full with GCash'
                            : 'Open GCash test checkout',
                      ),
                    ),
                    const SizedBox(height: 4),
                    Center(
                      child: TextButton(
                        style: TextButton.styleFrom(
                          foregroundColor: const Color(0xFFC62828),
                          minimumSize: const Size(48, 48),
                        ),
                        onPressed: _paymentBusy ? null : _cancelReservation,
                        child: const Text('Cancel reservation'),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 12),
            ] else if (payable &&
                _paymentChecked &&
                (_paymentStatus == null || _paymentStatus == 'pending')) ...[
              FilledButton(
                style: _bigButton,
                onPressed: _paymentBusy
                    ? null
                    : () => _checkPayment(openCheckout: true),
                child: Text(
                  _paymentStatus == 'pending'
                      ? 'Continue with GCash'
                      : widget.depositEnabled && widget.totalCentavos != null
                      ? 'Pay ${_price(widget.totalCentavos!)} in full with GCash'
                      : 'Open GCash test checkout',
                ),
              ),
              Center(
                child: TextButton(
                  style: TextButton.styleFrom(
                    foregroundColor: const Color(0xFFC62828),
                    minimumSize: const Size(48, 48),
                  ),
                  onPressed: _paymentBusy ? null : _cancelReservation,
                  child: const Text('Cancel reservation'),
                ),
              ),
              const SizedBox(height: 12),
            ],
            if (payable && _paymentChecked && _paymentStatus == 'failed')
              Center(
                child: TextButton(
                  style: TextButton.styleFrom(
                    foregroundColor: const Color(0xFFC62828),
                    minimumSize: const Size(48, 48),
                  ),
                  onPressed: _paymentBusy ? null : _cancelReservation,
                  child: const Text('Cancel reservation'),
                ),
              ),
            const SizedBox(height: 16),
          ],
          if (!cancelled) ...[
            _Card(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Semantics(
                        label: 'Pickup date',
                        child: const Icon(
                          Icons.event_outlined,
                          size: 22,
                          color: _muted,
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Text(
                          pickupText(_pickupDate, _pickupWindow).isEmpty
                              ? 'No pickup date'
                              : pickupText(_pickupDate, _pickupWindow),
                          style: const TextStyle(
                            fontWeight: FontWeight.w600,
                            fontSize: 17,
                          ),
                        ),
                      ),
                    ],
                  ),
                  if (_canChangePickup && !_editingPickup)
                    TextButton(
                      style: TextButton.styleFrom(
                        alignment: Alignment.centerLeft,
                        padding: EdgeInsets.zero,
                        minimumSize: const Size(48, 48),
                      ),
                      onPressed: () => setState(() => _editingPickup = true),
                      child: Text(
                        _pickupDate == null
                            ? 'Choose pickup date & time'
                            : 'Change pickup date & time',
                      ),
                    ),
                  if (_editingPickup) ...[
                    const SizedBox(height: 10),
                    const Text(
                      'Pick date & time',
                      style: TextStyle(fontWeight: FontWeight.w600, fontSize: 16),
                    ),
                    const SizedBox(height: 8),
                    PickupPicker(
                      date: _newPickupDate,
                      window: _newPickupWindow,
                      dateLabel: 'New pickup date',
                      timeLabel: 'New pickup time',
                      onChanged: (date, window) => setState(() {
                        _newPickupDate = date;
                        _newPickupWindow = window;
                      }),
                    ),
                    const SizedBox(height: 6),
                    const Text(
                      'You can change this once.',
                      style: TextStyle(color: _muted),
                    ),
                    if (_pickupError != null)
                      Semantics(
                        liveRegion: true,
                        child: Text(
                          _pickupError!,
                          style: const TextStyle(color: Color(0xFFB3261E)),
                        ),
                      ),
                    const SizedBox(height: 8),
                    Wrap(
                      spacing: 8,
                      runSpacing: 8,
                      children: [
                        OutlinedButton(
                          onPressed: _savingPickup
                              ? null
                              : () => setState(() {
                                  _editingPickup = false;
                                  _pickupError = null;
                                }),
                          child: const Text('Cancel'),
                        ),
                        FilledButton(
                          style: _bigButton.copyWith(
                            minimumSize: const WidgetStatePropertyAll(
                              Size(0, 48),
                            ),
                          ),
                          onPressed: _savingPickup ? null : _savePickup,
                          child: Text(
                            _savingPickup ? 'Saving…' : 'Save',
                          ),
                        ),
                      ],
                    ),
                  ],
                ],
              ),
            ),
            const SizedBox(height: 16),
          ],
          if (cancelled) ...[_CancelledCard(), const SizedBox(height: 16)],
          if (showReceipt) ...[
            _ReceiptCard(
              reference: widget.reference,
              storeName: widget.storeName,
              customerName: widget.customerName ?? '',
              customerPhone: widget.customerPhone ?? '',
              placedOn: widget.placedOn ?? '',
              stage: _stage,
              items: widget.receiptItems,
              totalCentavos: widget.totalCentavos,
              price: _price,
              checkingPayment: _testOrder && !_paymentChecked,
              balanceDue: _stage == OrderStage.completed ? 0 : _balance,
              pickup: pickupText(_pickupDate, _pickupWindow),
              onDownload: _testOrder && !_paymentChecked ? null : _downloadReceipt,
            ),
            const SizedBox(height: 16),
          ],
        ],
      ),
    );
  }
}

const _green = Color(0xFF2E7D32);
const _greenDark = Color(0xFF1B5E20);
const _greenSoft = Color(0xFFE8F5E9);
const _muted = Color(0xFF556274);
final _bigButton = FilledButton.styleFrom(
  minimumSize: const Size.fromHeight(56),
  backgroundColor: _greenDark,
  shape: const StadiumBorder(),
);

enum _Tone { good, warn, info, neutral }

class _Card extends StatelessWidget {
  const _Card({required this.child});
  final Widget child;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(20),
    decoration: BoxDecoration(
      color: Colors.white,
      borderRadius: BorderRadius.circular(20),
      border: Border.all(color: const Color(0xFFE3EAE7)),
      boxShadow: const [
        BoxShadow(
          color: Color(0x0F0F172A),
          blurRadius: 24,
          offset: Offset(0, 8),
        ),
      ],
    ),
    child: child,
  );
}

class _Banner extends StatelessWidget {
  const _Banner({
    required this.tone,
    required this.icon,
    required this.text,
    this.action,
  });

  final _Tone tone;
  final IconData icon;
  final String text;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    final (Color fg, Color bg) = switch (tone) {
      _Tone.good => (_greenDark, _greenSoft),
      _Tone.warn => (const Color(0xFF8D5A00), const Color(0xFFFFF3CD)),
      _Tone.info => (const Color(0xFF0D47A1), const Color(0xFFE3F2FD)),
      _Tone.neutral => (const Color(0xFF37474F), const Color(0xFFECEFF1)),
    };
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(14),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(icon, size: 20, color: fg),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  text,
                  style: TextStyle(
                    color: fg,
                    fontWeight: FontWeight.w600,
                    height: 1.35,
                  ),
                ),
              ),
            ],
          ),
          ?action,
        ],
      ),
    );
  }
}

class _PayOption extends StatelessWidget {
  const _PayOption({
    required this.title,
    required this.payNow,
    required this.payLater,
    required this.selected,
    required this.onTap,
  });

  final String title;
  final String payNow;
  final String payLater;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Semantics(
    button: true,
    selected: selected,
    child: InkWell(
      borderRadius: BorderRadius.circular(16),
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(
            color: selected ? _greenDark : const Color(0xFFCBD5D1),
            width: 1.5,
          ),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(
              selected ? Icons.radio_button_checked : Icons.radio_button_off,
              color: selected ? _green : _muted,
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Wrap(
                    spacing: 8,
                    crossAxisAlignment: WrapCrossAlignment.center,
                    children: [
                      Text(
                        title,
                        style: const TextStyle(
                          fontWeight: FontWeight.w800,
                          fontSize: 15,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 6),
                  Text(
                    payNow,
                    style: const TextStyle(
                      fontWeight: FontWeight.w700,
                      fontSize: 18,
                      color: _greenDark,
                      fontFeatures: [FontFeature.tabularFigures()],
                    ),
                  ),
                  Text(payLater, style: const TextStyle(color: _muted)),
                ],
              ),
            ),
          ],
        ),
      ),
    ),
  );
}

class _ProgressCard extends StatelessWidget {
  const _ProgressCard({
    required this.stage,
    required this.paid,
    required this.showPaidStep,
    required this.depositOnly,
  });

  final OrderStage stage;
  final bool paid;
  final bool showPaidStep;
  final bool depositOnly;

  @override
  Widget build(BuildContext context) {
    final started = stage == OrderStage.preparing ||
        stage == OrderStage.ready ||
        stage == OrderStage.completed;
    final steps = <(String, String, bool)>[
      ('Placed', '', true),
      if (showPaidStep)
        (
          'Paid',
          paid || started ? (depositOnly ? 'Deposit' : 'GCash') : 'Awaiting',
          paid || started,
        ),
      (
        'Preparing',
        'In pharmacy',
        stage == OrderStage.ready || stage == OrderStage.completed,
      ),
      ('Ready', stage == OrderStage.completed ? 'Picked up' : 'Pickup counter',
          stage == OrderStage.completed),
    ];
    var current = steps.indexWhere((step) => !step.$3);
    if (current < 0) current = steps.length - 1;
    return _Card(
      child: Semantics(
        container: true,
        label: 'Order progress',
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            for (var i = 0; i < steps.length; i++)
              Expanded(
                child: Column(
                  children: [
                    SizedBox(
                      height: 34,
                      child: Row(
                        children: [
                          Expanded(
                            child: Container(
                              height: 2,
                              color: i == 0
                                  ? Colors.transparent
                                  : steps[i - 1].$3
                                  ? _greenDark
                                  : const Color(0xFFE3EAE7),
                            ),
                          ),
                          Container(
                            width: i == current && !steps[i].$3 ? 34 : 30,
                            height: i == current && !steps[i].$3 ? 34 : 30,
                            decoration: BoxDecoration(
                              shape: BoxShape.circle,
                              color: steps[i].$3 ? _greenDark : Colors.white,
                              border: steps[i].$3
                                  ? null
                                  : Border.all(
                                      color: i == current
                                          ? _greenDark
                                          : const Color(0xFFCBD5D1),
                                      width: 2,
                                    ),
                            ),
                            child: Icon(
                              steps[i].$3 ? Icons.check : Icons.circle,
                              size: steps[i].$3 ? 18 : 10,
                              color: steps[i].$3
                                  ? Colors.white
                                  : i == current
                                  ? _greenDark
                                  : Colors.transparent,
                            ),
                          ),
                          Expanded(
                            child: Container(
                              height: 2,
                              color: i == steps.length - 1
                                  ? Colors.transparent
                                  : steps[i].$3
                                  ? _greenDark
                                  : const Color(0xFFE3EAE7),
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      steps[i].$1,
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        fontSize: 13,
                        height: 1.25,
                        color: const Color(0xFF0F172A),
                        fontWeight: i == current || steps[i].$3
                            ? FontWeight.w700
                            : FontWeight.w500,
                      ),
                    ),
                    if (steps[i].$2.isNotEmpty)
                      Text(
                        steps[i].$2,
                        textAlign: TextAlign.center,
                        style: const TextStyle(
                          fontSize: 13,
                          height: 1.25,
                          color: _muted,
                        ),
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

class _CancelledCard extends StatelessWidget {
  const _CancelledCard();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: Colors.red.shade50,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: Colors.red.shade100),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(Icons.info_outline, color: Colors.red.shade400, size: 22),
          const SizedBox(width: 12),
          const Expanded(
            child: Text(
              cancellationNotice,
              style: TextStyle(fontSize: 13, height: 1.4),
            ),
          ),
        ],
      ),
    );
  }
}

/// A paid order the customer can show the pharmacy staff at pickup. Mirrors the website's receipt.
class _ReceiptCard extends StatelessWidget {
  const _ReceiptCard({
    required this.reference,
    required this.storeName,
    required this.customerName,
    required this.customerPhone,
    required this.placedOn,
    required this.stage,
    required this.items,
    required this.totalCentavos,
    required this.price,
    required this.checkingPayment,
    required this.balanceDue,
    required this.pickup,
    required this.onDownload,
  });

  final String pickup;
  final VoidCallback? onDownload;
  final bool checkingPayment;
  final int balanceDue;
  final String reference;
  final String storeName;
  final String customerName;
  final String customerPhone;
  final String placedOn;
  final OrderStage stage;
  final List<dynamic> items;
  final int? totalCentavos;
  final String Function(int cents) price;

  Widget _fact(String label, String value, {Color? color}) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 4),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: const TextStyle(color: _muted)),
        const SizedBox(width: 12),
        Expanded(
          child: Text(
            value,
            textAlign: TextAlign.end,
            style: TextStyle(fontWeight: FontWeight.w700, color: color),
          ),
        ),
      ],
    ),
  );

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final lines = <Widget>[];
    var needsPrescription = false;
    for (final raw in items) {
      if (raw is! Map) continue;
      if (raw['prescriptionRequired'] == true) needsPrescription = true;
      final quantity = int.tryParse('${raw['quantity']}') ?? 0;
      final unitCents = int.tryParse('${raw['priceCentavos']}') ?? 0;
      final unit = raw['sellingUnit']?.toString();
      final name = raw['name']?.toString() ?? 'Medicine';
      lines.add(
        Padding(
          padding: const EdgeInsets.symmetric(vertical: 5),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      '$name${unit != null && unit.isNotEmpty ? ' ($unit)' : ''} × $quantity',
                    ),
                    Text(
                      '${price(unitCents)} each',
                      style: const TextStyle(fontSize: 12, color: _muted),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 12),
              Text(
                price(unitCents * quantity),
                style: const TextStyle(fontWeight: FontWeight.w700),
              ),
            ],
          ),
        ),
      );
    }
    final total = totalCentavos ?? 0;
    final deposit = !checkingPayment && balanceDue > 0;
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: const Color(0xFFC8E6C9), width: 2),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.receipt_long_outlined, color: _greenDark),
              const SizedBox(width: 8),
              Expanded(
                child: Semantics(
                  header: true,
                  child: Text(
                    'Pickup receipt',
                    style: theme.textTheme.titleMedium?.copyWith(
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 4),
          const Text(
            'Show this to the pharmacy staff when you pick up your order.',
            style: TextStyle(fontSize: 13, color: _muted),
          ),
          const SizedBox(height: 12),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: const Color(0xFFF1F4F1),
              borderRadius: BorderRadius.circular(14),
            ),
            child: Column(
              children: [
                const Text(
                  'PICKUP CLAIM CODE',
                  style: TextStyle(
                    fontSize: 11,
                    letterSpacing: 1.2,
                    fontWeight: FontWeight.w700,
                    color: _muted,
                  ),
                ),
                const SizedBox(height: 6),
                FittedBox(
                  fit: BoxFit.scaleDown,
                  child: SelectableText(
                    reference,
                    maxLines: 1,
                    textAlign: TextAlign.center,
                    style: theme.textTheme.titleLarge?.copyWith(
                      color: _greenDark,
                      fontWeight: FontWeight.w800,
                      letterSpacing: 0.5,
                    ),
                  ),
                ),
              ],
            ),
          ),
          if (needsPrescription) ...[
            const SizedBox(height: 12),
            const _Banner(
              tone: _Tone.good,
              icon: Icons.assignment_turned_in_outlined,
              text:
                  'Physical prescription check required. Bring the prescription you uploaded when you claim your order.',
            ),
          ],
          const SizedBox(height: 12),
          _fact('Pharmacy', storeName),
          if (customerName.isNotEmpty) _fact('Customer', customerName),
          if (customerPhone.isNotEmpty) _fact('Phone', customerPhone),
          if (placedOn.isNotEmpty) _fact('Ordered on', placedOn),
          _fact('Pickup date & time', pickup.isEmpty ? 'No pickup date' : pickup),
          _fact(
            'Payment',
            checkingPayment
                ? 'Checking…'
                : deposit
                ? 'Deposit paid'
                : 'Paid in full',
            color: checkingPayment ? null : _greenDark,
          ),
          if (deposit) ...[
            _fact('Paid online', price((total - balanceDue).clamp(0, total))),
            _fact(
              'Balance due at pickup',
              price(balanceDue),
              color: const Color(0xFF8D5A00),
            ),
          ] else if (!checkingPayment)
            _fact('Pay at pickup', '${price(0)} (nothing to pay)'),
          const Divider(height: 24),
          const Text(
            'ITEM SUMMARY',
            style: TextStyle(
              fontSize: 11,
              letterSpacing: 1.1,
              fontWeight: FontWeight.w700,
              color: _muted,
            ),
          ),
          ...lines,
          const Divider(height: 24),
          Row(
            children: [
              Text('Total', style: theme.textTheme.titleMedium),
              const Spacer(),
              Text(
                price(total),
                style: theme.textTheme.titleLarge?.copyWith(
                  fontWeight: FontWeight.w800,
                  color: _greenDark,
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          OutlinedButton.icon(
            style: OutlinedButton.styleFrom(minimumSize: const Size(0, 48)),
            onPressed: onDownload,
            icon: const Icon(Icons.download_outlined, size: 18),
            label: const Text('Download receipt (PDF)'),
          ),
        ],
      ),
    );
  }
}

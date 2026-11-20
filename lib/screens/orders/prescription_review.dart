import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:nearpill/widgets/np_icon.dart';
import 'package:flutter/services.dart';

import '../../features/orders/prescription_source.dart';

class PrescriptionReview extends StatefulWidget {
  const PrescriptionReview({
    super.key,
    required this.repository,
    required this.pharmacy,
    required this.medicine,
    this.pharmacyName = 'the pharmacy',
    this.onStatus,
  });

  final PrescriptionSource repository;
  final int pharmacy, medicine;
  final String pharmacyName;

  /// Reports 'none', 'pending', 'approved', 'rejected' or 'expired' once the review status is known.
  final ValueChanged<String>? onStatus;

  @override
  State<PrescriptionReview> createState() => _PrescriptionReviewState();
}

class _PrescriptionReviewState extends State<PrescriptionReview> {
  late Future<({int account, String? status, String? reason})?> _review;
  bool _sending = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _review = _load();
  }

  Future<({int account, String? status, String? reason})?> _load() async {
    final account = await widget.repository.currentAccountId();
    if (account == null) return null;
    try {
      final status = await widget.repository.prescriptionStatus(
        account,
        widget.pharmacy,
        widget.medicine,
      );
      widget.onStatus?.call(status.status ?? 'none');
      return (account: account, status: status.status, reason: status.reason);
    } on DioException catch (error) {
      if (error.response?.statusCode == 404) return null;
      rethrow;
    }
  }

  void _refresh() {
    setState(() {
      _review = _load();
    });
  }

  Future<void> _send(int account) async {
    if (_sending) return;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Send your prescription'),
        content: const Text(
          'Choose a clear photo of your prescription (JPG, PNG or HEIC). Large photos are resized automatically. The selected pharmacy can view it for up to 24 hours and will approve or reject it. Bring this same prescription when you pick up your order.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Choose photo'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    setState(() {
      _sending = true;
      _error = null;
    });
    try {
      const picker = MethodChannel('nearpill/prescription_photo');
      final photo = await picker.invokeMapMethod<String, dynamic>('pick');
      if (photo == null || !mounted) return;
      await widget.repository.submitPrescription(
        account,
        widget.pharmacy,
        widget.medicine,
        photo['mimeType'] as String,
        base64Encode(photo['bytes'] as Uint8List),
      );
      if (mounted) _refresh();
    } on PlatformException catch (error) {
      if (mounted) {
        setState(() => _error = error.message ?? 'Could not open the photo.');
      }
    } on DioException catch (error) {
      final response = error.response?.data;
      if (mounted) {
        setState(() {
          _error = response is Map && response['error'] is String
              ? response['error'] as String
              : 'Could not send the photo. Try again.';
          _review = _load();
        });
      }
    } catch (_) {
      if (mounted) {
        setState(() => _error = 'Could not send the photo. Try again.');
      }
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) => FutureBuilder(
    future: _review,
    builder: (context, snapshot) {
      if (snapshot.connectionState != ConnectionState.done) {
        return const Padding(
          padding: EdgeInsets.symmetric(vertical: 8),
          child: Text('Checking prescription status…'),
        );
      }
      if (snapshot.hasError) {
        return TextButton(
          onPressed: _refresh,
          child: const Text('Retry prescription status'),
        );
      }
      final review = snapshot.data;
      if (review == null) return const SizedBox.shrink();
      final status = review.status ?? 'none';
      final canUpload = defaultTargetPlatform == TargetPlatform.android;
      final (Color tone, Color soft, Color border, NpIconData icon) = switch (status) {
        'approved' => (const Color(0xFF2E7D32), const Color(0xFFE8F5E9), const Color(0xFFA5D6A7), NpIcons.check_circle),
        'pending' => (const Color(0xFF1565C0), const Color(0xFFE3F2FD), const Color(0xFF90CAF9), NpIcons.hourglass_top),
        'rejected' => (const Color(0xFFC62828), const Color(0xFFFFEBEE), const Color(0xFFEF9A9A), NpIcons.cancel),
        _ => (const Color(0xFF8D5A00), const Color(0xFFFFF8E1), const Color(0xFFFFE082), NpIcons.warning_amber_rounded),
      };
      final title = switch (status) {
        'approved' => 'Approved by ${widget.pharmacyName}',
        'pending' => 'Waiting for the pharmacy to review your prescription.',
        'rejected' => 'Pharmacy rejected your prescription',
        'expired' => 'Your prescription review expired',
        _ => 'Prescription not yet uploaded',
      };
      final detail = switch (status) {
        'approved' =>
          'Prescription approved. You can place your order. Bring this prescription when you pick it up.',
        'pending' => 'The pharmacist is verifying your prescription details.',
        'rejected' => review.reason == null
            ? 'Please upload another one.'
            : null,
        'expired' => 'Please upload your prescription again.',
        _ =>
          'Upload your prescription so ${widget.pharmacyName} can approve it before you place the order.',
      };
      Widget step(String label, int number, bool done, bool active, {Color? color}) {
        final c = color ?? (done || active ? const Color(0xFF2E7D32) : Colors.grey);
        return Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            CircleAvatar(
              radius: 10,
              backgroundColor: done || active ? c : Colors.grey.shade200,
              child: done
                  ? const NpIcon(NpIcons.check, size: 12, color: Colors.white)
                  : Text(
                      color != null && !active ? '!' : '$number',
                      style: TextStyle(
                        fontSize: 10,
                        fontWeight: FontWeight.bold,
                        color: active ? Colors.white : Colors.grey.shade600,
                      ),
                    ),
            ),
            const SizedBox(width: 4),
            Text(
              label,
              style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: c),
            ),
          ],
        );
      }
      final steps = Container(
        padding: const EdgeInsets.all(10),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: Colors.grey.shade300),
        ),
        child: Wrap(
          spacing: 10,
          runSpacing: 6,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            switch (status) {
              'pending' || 'approved' => step('Uploaded', 1, true, false),
              'rejected' => step('Re-upload', 1, false, true, color: const Color(0xFFC62828)),
              _ => step('Upload', 1, false, true),
            },
            switch (status) {
              'approved' => step('Approved', 2, true, false),
              'pending' => step('Reviewing', 2, false, true),
              _ => step('Review', 2, false, false),
            },
            step(status == 'approved' ? 'Ready to order' : 'Order', 3, false, status == 'approved'),
          ],
        ),
      );
      return Padding(
        padding: const EdgeInsets.only(top: 8),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            steps,
            const SizedBox(height: 10),
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: soft,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: border, width: status == 'rejected' ? 2 : 1),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      NpIcon(icon, color: tone, size: 22),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          title,
                          style: TextStyle(fontWeight: FontWeight.bold, color: tone, fontSize: 14),
                        ),
                      ),
                    ],
                  ),
                  if (status == 'rejected' && review.reason != null) ...[
                    const SizedBox(height: 8),
                    Container(
                      width: double.infinity,
                      padding: const EdgeInsets.all(10),
                      decoration: BoxDecoration(
                        color: Colors.white,
                        borderRadius: BorderRadius.circular(8),
                        border: Border.all(color: border),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'PHARMACIST NOTE',
                            style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: tone),
                          ),
                          const SizedBox(height: 2),
                          Text(
                            '${review.reason}. Please upload another one.',
                            style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13),
                          ),
                        ],
                      ),
                    ),
                  ],
                  if (detail != null) ...[
                    const SizedBox(height: 6),
                    Text(detail, style: const TextStyle(fontSize: 13)),
                  ],
                  if (status == 'pending') ...[
                    const SizedBox(height: 8),
                    OutlinedButton(
                      onPressed: _refresh,
                      child: const Text('Check review status'),
                    ),
                  ],
                  if (status != 'pending' && status != 'approved' && canUpload) ...[
                    const SizedBox(height: 10),
                    FilledButton.icon(
                      style: FilledButton.styleFrom(
                        backgroundColor: status == 'rejected' ? const Color(0xFFC62828) : const Color(0xFF2E7D32),
                        minimumSize: const Size.fromHeight(46),
                      ),
                      onPressed: _sending ? null : () => _send(review.account),
                      icon: const NpIcon(NpIcons.photo_camera_outlined, size: 18),
                      label: Text(
                        _sending
                            ? 'Sending…'
                            : status == 'rejected'
                            ? 'Upload another prescription'
                            : 'Upload prescription',
                      ),
                    ),
                  ],
                  if (_error != null && status != 'pending' && status != 'approved')
                    Padding(
                      padding: const EdgeInsets.only(top: 6),
                      child: Text(_error!),
                    ),
                ],
              ),
            ),
          ],
        ),
      );
    },
  );
}

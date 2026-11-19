import 'dart:typed_data';

import 'pickup.dart';

/// Builds the downloadable receipt as a small text PDF on the phone (nothing is stored on the server).
/// The website builds the same receipt (web/src/features/customer/receiptPdf.ts). The standard PDF fonts cannot
/// draw the peso sign, so amounts read "PHP 130.00" in the PDF.
class ReceiptFacts {
  const ReceiptFacts({
    required this.reference,
    required this.storeName,
    required this.customerName,
    this.customerPhone = '',
    required this.placedOn,
    required this.items,
    required this.totalCentavos,
    required this.balanceDue,
    this.pickupDate,
    this.pickupWindow,
  });

  final String reference;
  final String storeName;
  final String customerName;
  final String customerPhone;
  final String placedOn;
  final List<dynamic> items;
  final int totalCentavos;
  final int balanceDue;
  final String? pickupDate;
  final String? pickupWindow;
}

class _Line {
  const _Line(this.text, {this.size = 10, this.bold = false, this.x = 50, this.gap});
  final String text;
  final double size;
  final bool bold;
  final double x;

  /// A line with a gap ends its row; lines before it share the same baseline.
  final double? gap;
}

String _php(int centavos) =>
    'PHP ${centavos ~/ 100}.${(centavos % 100).toString().padLeft(2, '0')}';

String _latin1(String text) => text.replaceAll(RegExp(r'[^\x20-\x7e\xa0-\xff]'), '?');

String _escape(String text) => _latin1(text)
    .replaceAll(r'\', r'\\')
    .replaceAll('(', r'\(')
    .replaceAll(')', r'\)');

List<String> _wrap(String text, int max) {
  final lines = <String>[];
  var current = '';
  for (final word in _latin1(text).split(RegExp(r'\s+'))) {
    if ('$current $word'.trim().length > max) {
      if (current.isNotEmpty) lines.add(current);
      current = word;
    } else {
      current = '$current $word'.trim();
    }
  }
  if (current.isNotEmpty) lines.add(current);
  return lines.isEmpty ? [''] : lines;
}

List<_Line> _lines(ReceiptFacts facts) {
  final out = <_Line>[
    const _Line('NearPill', size: 22, bold: true, gap: 8),
    const _Line('Pickup receipt', size: 14, gap: 14),
    const _Line('PICKUP CLAIM CODE', size: 9, gap: 2),
    _Line(facts.reference, size: 18, bold: true, gap: 12),
  ];
  void fact(String label, String value) {
    if (value.isEmpty) return;
    final parts = _wrap(value, 62);
    for (var i = 0; i < parts.length; i++) {
      out.add(_Line(i == 0 ? label : '', bold: true));
      out.add(_Line(parts[i], x: 190, gap: 4));
    }
  }

  final pickup = pickupText(facts.pickupDate, facts.pickupWindow);
  fact('Pharmacy', facts.storeName);
  fact('Customer', facts.customerName);
  fact('Phone', facts.customerPhone);
  fact('Ordered on', facts.placedOn);
  fact('Pickup date & time', pickup.isEmpty ? 'No pickup date' : pickup);
  fact('Payment', facts.balanceDue > 0 ? 'Deposit paid' : 'Paid in full');
  if (facts.balanceDue > 0) {
    fact('Paid online', _php((facts.totalCentavos - facts.balanceDue).clamp(0, facts.totalCentavos)));
    fact('Balance due at pickup', _php(facts.balanceDue));
  } else {
    fact('Pay at pickup', '${_php(0)} (nothing to pay)');
  }
  out.add(const _Line('', gap: 8));
  out.addAll(const [
    _Line('Item', bold: true),
    _Line('Price', bold: true, x: 330),
    _Line('Qty', bold: true, x: 410),
    _Line('Amount', bold: true, x: 465, gap: 4),
  ]);
  for (final raw in facts.items) {
    if (raw is! Map) continue;
    final quantity = int.tryParse('${raw['quantity']}') ?? 0;
    final unit = int.tryParse('${raw['priceCentavos']}') ?? 0;
    final sellingUnit = raw['sellingUnit']?.toString();
    final name =
        '${raw['name'] ?? 'Medicine'}${sellingUnit != null && sellingUnit.isNotEmpty ? ' ($sellingUnit)' : ''}';
    final parts = _wrap(name, 44);
    for (var i = 0; i < parts.length; i++) {
      if (i == 0) {
        out.addAll([
          _Line(parts[i]),
          _Line(_php(unit), x: 330),
          _Line('$quantity', x: 410),
          _Line(_php(unit * quantity), x: 465, gap: 2),
        ]);
      } else {
        out.add(_Line(parts[i], gap: 2));
      }
    }
  }
  out.addAll([
    const _Line('', gap: 4),
    const _Line('Total', size: 12, bold: true),
    _Line(_php(facts.totalCentavos), size: 12, bold: true, x: 465, gap: 12),
  ]);
  out.addAll(const [
    _Line('Show this receipt and a valid ID to the pharmacy staff when you pick up your order.', size: 9, gap: 4),
    _Line('Capstone test payment, no real money was charged.', size: 9),
  ]);
  return out;
}

String receiptFileName(String reference) =>
    'NearPill-receipt-${reference.replaceAll(RegExp(r'[^A-Za-z0-9._-]'), '')}.pdf';

Uint8List buildReceiptPdf(ReceiptFacts facts) {
  final ops = <String>[];
  var rowY = 790.0;
  for (final line in _lines(facts)) {
    if (line.text.isNotEmpty) {
      ops.add(
        'BT /${line.bold ? 'F2' : 'F1'} ${line.size} Tf ${line.x} $rowY Td (${_escape(line.text)}) Tj ET',
      );
    }
    if (line.gap != null) rowY -= line.size + 4 + line.gap!;
  }
  final content = ops.join('\n');
  final objects = <String>[
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    '<< /Length ${content.length} >>\nstream\n$content\nendstream',
  ];
  final pdf = StringBuffer('%PDF-1.4\n');
  final offsets = <int>[];
  for (var i = 0; i < objects.length; i++) {
    offsets.add(pdf.length);
    pdf.write('${i + 1} 0 obj\n${objects[i]}\nendobj\n');
  }
  final xref = pdf.length;
  pdf.write('xref\n0 ${objects.length + 1}\n0000000000 65535 f \n');
  for (final offset in offsets) {
    pdf.write('${offset.toString().padLeft(10, '0')} 00000 n \n');
  }
  pdf.write(
    'trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n$xref\n%%EOF',
  );
  return Uint8List.fromList(pdf.toString().codeUnits.map((c) => c & 0xff).toList());
}

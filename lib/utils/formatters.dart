import 'package:flutter/services.dart';

const emailErrorText = 'Enter a valid email address.';
const passwordRuleText = 'Use at least 10 characters with a letter and a number.';

// Same rules as the server's sign-up email check.
final _emailPattern = RegExp(
  r"^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$",
  caseSensitive: false,
);

String? validateEmailAddress(String? value) {
  final email = value?.trim() ?? '';
  final local = email.split('@').first;
  final ok =
      email.length <= 254 &&
      local.length <= 64 &&
      !local.startsWith('.') &&
      !local.endsWith('.') &&
      !local.contains('..') &&
      _emailPattern.hasMatch(email);
  return ok ? null : emailErrorText;
}

const _commonPasswords = {
  'password', 'password1', 'password12', 'password123', 'password1234',
  'password12345', 'passw0rd123', 'qwerty123', 'qwertyuiop', 'qwerty12345',
  '1234567890', '12345678910', '123456789a', 'abc1234567', 'abcd123456',
  'iloveyou123', 'welcome123', 'welcome1234', 'admin12345', 'letmein1234',
  'monkey12345', 'dragon12345', 'football123', 'baseball123', 'superman123',
  'princess123', 'sunshine123', 'nearpill123', 'nearpill1234', 'philippines1',
  'cebu123456', 'changeme123', 'default1234', 'test123456', 'testing1234',
};

/// New passwords: same rules as the server (10-128 characters, a letter, a
/// number, not common, not your name or email).
String? validateNewPassword(String? value, String email, String name) {
  final password = value ?? '';
  if (password.length > 128) return 'Use at most 128 characters.';
  if (password.length < 10 ||
      !RegExp(r'\p{L}', unicode: true).hasMatch(password) ||
      !RegExp(r'\p{N}', unicode: true).hasMatch(password)) {
    return passwordRuleText;
  }
  if (_commonPasswords.contains(password.toLowerCase())) {
    return 'Choose a less common password.';
  }
  final lower = password.trim().toLowerCase();
  final address = email.trim().toLowerCase();
  final local = address.split('@').first;
  final person = name.trim().toLowerCase();
  if (lower == address ||
      (local.length >= 6 && lower == local) ||
      (person.length >= 6 && lower == person)) {
    return 'Do not use your name or email as your password.';
  }
  return null;
}

class DateTextFormatter extends TextInputFormatter {
  @override
  TextEditingValue formatEditUpdate(
    TextEditingValue oldValue,
    TextEditingValue newValue,
  ) {
    if (!RegExp(r'^[0-9/]*$').hasMatch(newValue.text)) return oldValue;
    String text = newValue.text.replaceAll('/', '');
    if (text.length > 8) return oldValue;

    // Deleting character
    if (newValue.text.length < oldValue.text.length) {
      return newValue;
    }

    // Month validation
    if (text.isNotEmpty) {
      if (int.parse(text[0]) > 1) text = '0${text[0]}';
    }
    if (text.length >= 2) {
      int month = int.parse(text.substring(0, 2));
      if (month > 12) text = text[0];
      if (month == 0) text = '01';
    }

    // Day validation
    if (text.length >= 3) {
      if (int.parse(text[2]) > 3) text = '${text.substring(0, 2)}0${text[2]}';
    }
    if (text.length >= 4) {
      int day = int.parse(text.substring(2, 4));
      if (day > 31) text = text.substring(0, 3);
      if (day == 0) text = '${text.substring(0, 2)}01';
    }

    // Formatting
    String newString = '';
    for (int i = 0; i < text.length; i++) {
      if (i == 2 || i == 4) newString += '/';
      newString += text[i];
    }

    return TextEditingValue(
      text: newString,
      selection: TextSelection.collapsed(offset: newString.length),
    );
  }
}

String? validateBirthdate(String? val) {
  final date = val?.trim() ?? '';
  if (date.isEmpty) return 'Enter your birthdate';
  if (!RegExp(r'^\d{2}/\d{2}/\d{4}$').hasMatch(date)) return 'Use MM/DD/YYYY';

  final parts = date.split('/');
  final month = int.parse(parts[0]);
  final day = int.parse(parts[1]);
  final year = int.parse(parts[2]);
  if (year < 1955) return 'Year must be 1955 or later';

  final birthdate = DateTime(year, month, day);
  if (birthdate.month != month || birthdate.day != day) {
    return 'Invalid birthdate';
  }
  final now = DateTime.now();
  if (birthdate.isAfter(DateTime(now.year - 18, now.month, now.day))) {
    return 'You must be at least 18 years old';
  }
  return null;
}

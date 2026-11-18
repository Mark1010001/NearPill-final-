class UserModel {
  const UserModel({
    this.id,
    required this.fullName,
    required this.email,
    this.phone,
    this.birthDate,
    this.xenditTestCheckout = false,
    this.xenditTestDeposit = false,
  });

  final int? id;
  final String fullName;
  final String email;
  final String? phone;
  final String? birthDate;
  final bool xenditTestCheckout;
  final bool xenditTestDeposit;

  factory UserModel.fromJson(Map<String, dynamic> json) {
    return UserModel(
      id: json['id'] != null ? int.tryParse(json['id'].toString()) : null,
      fullName: json['fullName']?.toString() ?? '',
      email: json['email']?.toString() ?? '',
      phone: json['phone']?.toString(),
      birthDate: json['birthDate']?.toString(),
      xenditTestCheckout: json['xenditTestCheckout'] == true,
      xenditTestDeposit: json['xenditTestDeposit'] == true,
    );
  }

  Map<String, dynamic> toJson() => {
    'id': id,
    'fullName': fullName,
    'email': email,
    if (phone != null) 'phone': phone,
    if (birthDate != null) 'birthDate': birthDate,
  };
}

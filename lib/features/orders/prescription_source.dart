/// What the prescription upload card needs, so the screen does not depend on
/// the data layer. OrderRepository implements it.
abstract interface class PrescriptionSource {
  Future<int?> currentAccountId();

  Future<({String? status, String? reason})> prescriptionStatus(
    int account,
    int pharmacy,
    int medicine,
  );

  Future<void> submitPrescription(
    int account,
    int pharmacy,
    int medicine,
    String mimeType,
    String photo,
  );
}

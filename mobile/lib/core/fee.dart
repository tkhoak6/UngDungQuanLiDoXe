/// Công thức phí — 1-1 api-contract §8.
/// phút<=grace → 1h; ngược lại ceil(phút/60); giờ>=dayThreshold → giá ngày;
/// total = max(0, fee - discount); vé tháng còn hiệu lực → 0.
class FeeResult {
  const FeeResult({
    required this.minutes,
    required this.hours,
    required this.usedDaily,
    required this.base,
    required this.total,
  });

  final int minutes;
  final int hours;
  final bool usedDaily;
  final int base;
  final int total;
}

FeeResult computeFee({
  required DateTime checkIn,
  required DateTime checkOut,
  required int hourlyRate,
  required int dailyRate,
  int graceMinutes = 30,
  int dayThresholdHours = 12,
  bool hasValidPass = false,
  int discount = 0,
}) {
  final minutes = checkOut.difference(checkIn).inMinutes;
  if (hasValidPass) {
    return FeeResult(
      minutes: minutes,
      hours: 0,
      usedDaily: false,
      base: 0,
      total: 0,
    );
  }
  final int hours;
  if (minutes <= graceMinutes) {
    hours = 1;
  } else {
    hours = (minutes / 60).ceil();
  }
  final usedDaily = hours >= dayThresholdHours;
  final base = usedDaily ? dailyRate : hours * hourlyRate;
  final total = (base - discount).clamp(0, 1 << 62);
  return FeeResult(
    minutes: minutes,
    hours: hours,
    usedDaily: usedDaily,
    base: base,
    total: total,
  );
}

/// Giá vé tháng — cùng công thức staff §e: gói 12 tháng giảm 10%.
int passPrice({required int pricePerDay, required int months}) {
  final monthly = pricePerDay * 30;
  final raw = monthly * months;
  if (months == 12) return (raw * 0.9).round();
  return raw;
}

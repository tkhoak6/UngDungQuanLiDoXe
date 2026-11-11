/// Entities Dart — map 1-1 api-contract §1–§14.
/// DB giữ snake_case; model dùng fromMap/toMap thủ công.
class StaffPermissions {
  const StaffPermissions({
    required this.checkin,
    required this.passSale,
    required this.reportSelf,
    required this.profileSelf,
    required this.reservation,
  });

  final int checkin;
  final int passSale;
  final int reportSelf;
  final int profileSelf;
  final int reservation;

  static const defaults = StaffPermissions(
    checkin: 1,
    passSale: 1,
    reportSelf: 1,
    profileSelf: 1,
    reservation: 1,
  );

  static int _flag(dynamic v, int fallback) {
    if (v == null) return fallback;
    if (v is bool) return v ? 1 : 0;
    if (v is num) return v == 0 ? 0 : 1;
    return fallback;
  }

  factory StaffPermissions.fromMap(Map<String, dynamic> m) {
    return StaffPermissions(
      checkin: _flag(m['checkin'], 1),
      passSale: _flag(m['pass_sale'], 1),
      reportSelf: _flag(m['report_self'], 1),
      profileSelf: _flag(m['profile_self'], 1),
      reservation: _flag(m['reservation'], 1),
    );
  }
}

/// resolvePerm(user,key) copy api-contract §11: admin bypass, NULL → 1.
int resolvePerm({
  required String roleName,
  required StaffPermissions perms,
  required String key,
}) {
  if (roleName == 'admin') return 1;
  switch (key) {
    case 'checkin':
      return perms.checkin;
    case 'pass_sale':
      return perms.passSale;
    case 'report_self':
      return perms.reportSelf;
    case 'profile_self':
      return perms.profileSelf;
    case 'reservation':
      return perms.reservation;
    default:
      return 0;
  }
}

class AppUser {
  const AppUser({
    required this.id,
    required this.username,
    required this.fullName,
    required this.phone,
    required this.address,
    required this.startDate,
    required this.roleId,
    required this.roleName,
    required this.permissions,
    required this.isActive,
  });

  final int id;
  final String username;
  final String fullName;
  final String? phone;
  final String? address;
  final String? startDate;
  final int roleId;
  final String roleName;
  final StaffPermissions permissions;
  final int isActive;

  factory AppUser.fromMap(Map<String, dynamic> m, StaffPermissions perms) {
    return AppUser(
      id: m['id'] as int,
      username: m['username'] as String,
      fullName: (m['full_name'] as String?) ?? '',
      phone: m['phone'] as String?,
      address: m['address'] as String?,
      startDate: m['start_date'] as String?,
      roleId: m['role_id'] as int,
      roleName: (m['role_name'] as String?) ?? 'customer',
      permissions: perms,
      isActive: (m['is_active'] as int?) ?? 1,
    );
  }
}

class ParkingZone {
  const ParkingZone({
    required this.id,
    required this.code,
    required this.name,
    required this.vehicleTypeAllowed,
    required this.capacity,
    required this.pricePerHour,
    required this.pricePerDay,
    required this.isActive,
  });

  final int id;
  final String code;
  final String name;
  final String vehicleTypeAllowed;
  final int capacity;
  final int pricePerHour;
  final int pricePerDay;
  final int isActive;

  factory ParkingZone.fromMap(Map<String, dynamic> m) => ParkingZone(
        id: m['id'] as int,
        code: m['code'] as String,
        name: m['name'] as String,
        vehicleTypeAllowed: m['vehicle_type_allowed'] as String,
        capacity: m['capacity'] as int,
        pricePerHour: m['price_per_hour'] as int,
        pricePerDay: m['price_per_day'] as int,
        isActive: m['is_active'] as int,
      );
}

class ZoneAvailability {
  const ZoneAvailability({
    required this.zoneId,
    required this.zoneCode,
    required this.freeSpots,
    required this.occupiedSpots,
    required this.maintenanceSpots,
    required this.capacity,
  });

  final int zoneId;
  final String zoneCode;
  final int freeSpots;
  final int occupiedSpots;
  final int maintenanceSpots;
  final int capacity;

  factory ZoneAvailability.fromMap(Map<String, dynamic> m) =>
      ZoneAvailability(
        zoneId: m['zone_id'] as int,
        zoneCode: m['zone_code'] as String,
        freeSpots: m['free_spots'] as int,
        occupiedSpots: m['occupied_spots'] as int,
        maintenanceSpots: m['maintenance_spots'] as int,
        capacity: m['capacity'] as int,
      );
}

class SpotCell {
  const SpotCell({
    required this.spotId,
    required this.zoneId,
    required this.zoneCode,
    required this.spotNumber,
    required this.status,
    required this.occupyingPlate,
  });

  final int spotId;
  final int zoneId;
  final String zoneCode;
  final String spotNumber;
  final String status;
  final String? occupyingPlate;

  factory SpotCell.fromMap(Map<String, dynamic> m) => SpotCell(
        spotId: m['spot_id'] as int,
        zoneId: m['zone_id'] as int,
        zoneCode: m['zone_code'] as String,
        spotNumber: m['spot_number'] as String,
        status: m['status'] as String,
        occupyingPlate: m['occupying_plate'] as String?,
      );
}

class VehicleRow {
  const VehicleRow({
    required this.id,
    required this.licensePlate,
    required this.vehicleType,
    required this.tripCount,
    required this.totalPaid,
    required this.parked,
  });

  final int id;
  final String licensePlate;
  final String vehicleType;
  final int tripCount;
  final int totalPaid;
  final bool parked;
}

class SessionRow {
  const SessionRow({
    required this.id,
    required this.ticketCode,
    required this.licensePlate,
    required this.zoneCode,
    required this.checkInAt,
    required this.checkOutAt,
    required this.totalFee,
    required this.isMonthly,
    required this.status,
    required this.hourlyRate,
    required this.dailyRate,
    this.qrText,
  });

  final int id;
  final String ticketCode;
  final String licensePlate;
  final String zoneCode;
  final String checkInAt;
  final String? checkOutAt;
  final int? totalFee;
  final bool isMonthly;
  final String status;
  final int hourlyRate;
  final int dailyRate;

  /// Chuỗi QR text ký lúc check-in (null = chưa ký — fallback text-only).
  final String? qrText;
}

class PassRow {
  const PassRow({
    required this.id,
    required this.passCode,
    required this.licensePlate,
    required this.zoneCode,
    required this.startDate,
    required this.endDate,
    required this.price,
    required this.status,
  });

  final int id;
  final String passCode;
  final String licensePlate;
  final String zoneCode;
  final String startDate;
  final String endDate;
  final int price;
  final String status;
}

class ReservationRow {
  const ReservationRow({
    required this.id,
    required this.code,
    required this.zoneCode,
    required this.licensePlate,
    required this.date,
    required this.startTime,
    required this.endTime,
    required this.status,
    required this.expiresAt,
  });

  final int id;
  final String code;
  final String zoneCode;
  final String licensePlate;
  final String date;
  final String startTime;
  final String endTime;
  final String status;
  final String expiresAt;
}

class ShiftRow {
  const ShiftRow({
    required this.id,
    required this.code,
    required this.name,
    required this.startTime,
    required this.endTime,
  });

  final int id;
  final String code;
  final String name;
  final String startTime;
  final String endTime;

  factory ShiftRow.fromMap(Map<String, dynamic> m) => ShiftRow(
        id: m['id'] as int,
        code: m['code'] as String,
        name: m['name'] as String,
        startTime: m['start_time'] as String,
        endTime: m['end_time'] as String,
      );
}

class AttendanceRow {
  const AttendanceRow({
    required this.id,
    required this.shiftName,
    required this.workDate,
    required this.checkInAt,
    required this.checkOutAt,
    required this.status,
  });

  final int id;
  final String shiftName;
  final String workDate;
  final String? checkInAt;
  final String? checkOutAt;
  final String status;
}

class ParkingSettings {
  const ParkingSettings({
    required this.feeGraceMinutes,
    required this.feeDayThresholdHours,
  });

  final int feeGraceMinutes;
  final int feeDayThresholdHours;

  static const defaults =
      ParkingSettings(feeGraceMinutes: 30, feeDayThresholdHours: 12);
}

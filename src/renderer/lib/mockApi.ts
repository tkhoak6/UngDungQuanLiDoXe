// Mock backend — used when Electron preload (window.api) is not present
// (browser dev via `vite`, or backend IPC not yet implemented).
// Shapes mirror seed.sql so UI can develop against realistic data.

import type { RendererApi, ApiResult, RegisterInput, AuthUser } from './api';
import { removeMyPassRequest, saveMyPassRequest } from './api';
import type {
  ActivityListInput,
  ActivityRow,
  Attendance,
  AttendanceCheckInInput,
  AttendanceCheckOutInput,
  AttendanceListInput,
  CustomerPassRequestInput,
  CustomerReservationsInput,
  CustomerReservationRow,
  CustomerReserveInput,
  CustomerSessionsInput,
  CustomerSessionRow,
  CustomerVehicle,
  FeePreview,
  MonthlyPass,
  ParkingSession,
  ParkingZone,
  PassConfirmInput,
  Reservation,
  RevenueDaily,
  SessionsDaily,
  Shift,
  SpotMapCell,
  StaffPermissionKey,
  StaffPermissions,
  StaffProfileUpdateInput,
  StaffSelfProfile,
  UserDTO,
  ZoneAvailability,
  ActivityListInput,
  ActivityRow,
} from '../types';
import { STAFF_DEFAULTS } from '../types';
import type {
  AppConfigSetInput,
  BackupNowOutput,
  NotifyDeepLink,
  NotifyEvent,
  ParkingSettings,
  RestoreFromFileOutput,
  TxListInput,
  TxRow,
} from '../types';
import { PERM_META } from './perms';
import { todayLocal } from './format';
import { dispatchNotifyDeepLink } from './notify';

const FULL_PERMS: StaffPermissions = { ...STAFF_DEFAULTS };

// FE-020 S4 mock guard (mirror BE-014 `requirePerm`): admin → pass;
// staff thiếu flag → 403 Việt kèm suffix để adapter strip (test được toast).
function mockRequirePerm(userId: number | null, key: StaffPermissionKey): string | null {
  const me = users.find((u) => u.id === userId) ?? null;
  if (!me || me.role_name === 'admin') return null;
  if ((me.perms?.[key] ?? 1) === 1) return null;
  return `Tài khoản của bạn không có quyền ${PERM_META[key].label} — liên hệ quản lý (NO_PERMISSION:${key})`;
}

const delay = (ms = 450): Promise<void> => new Promise((r) => setTimeout(r, ms));

// FE-014: cộng N tháng vào YYYY-MM-DD (kẹp ngày cuối tháng, mirror BE-009 endDate).
function addMonths(yyyyMmDd: string, months: number): string {
  const [y, m, d] = yyyyMmDd.split('-').map(Number);
  const total = (m - 1) + months;
  const ny = y + Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const lastDay = new Date(ny, nm, 0).getDate();
  const nd = Math.min(d, lastDay);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${ny}-${p(nm)}-${p(nd)}`;
}

const zones: ParkingZone[] = [
  { id: 1, code: 'A', name: 'Khu A — Ô tô', vehicle_type_allowed: 'car', capacity: 40, price_per_hour: 20000, price_per_day: 150000, is_active: 1, created_at: '2026-10-01 08:00:00', updated_at: '2026-10-01 08:00:00' },
  { id: 2, code: 'B', name: 'Khu B — Xe máy', vehicle_type_allowed: 'motorbike', capacity: 120, price_per_hour: 5000, price_per_day: 40000, is_active: 1, created_at: '2026-10-01 08:00:00', updated_at: '2026-10-01 08:00:00' },
  { id: 3, code: 'C', name: 'Khu C — Hỗn hợp', vehicle_type_allowed: 'both', capacity: 60, price_per_hour: 10000, price_per_day: 80000, is_active: 1, created_at: '2026-10-01 08:00:00', updated_at: '2026-10-01 08:00:00' },
];

let zoneSeq = 4;
let ticketSeq = 1042;

const sessions: ParkingSession[] = [
  {
    id: 1, ticket_code: 'T-20261016-0001', vehicle_id: 1, spot_id: 3, zone_id: 1,
    monthly_pass_id: null, check_in_at: '2026-10-16 08:12:00', check_out_at: null,
    status: 'parked', hourly_rate_applied: 20000, daily_rate_applied: 150000,
    total_fee: null, discount_amount: 0, created_by: 1, closed_by: null,
    created_at: '2026-10-16 08:12:00', updated_at: '2026-10-16 08:12:00',
  },
];

const plates: Record<number, string> = { 1: '51H-12345' };

const passes: MonthlyPass[] = [
  {
    id: 1, pass_code: 'MT-2026-0001', vehicle_id: 2, zone_id: 2,
    customer_name: 'Nguyễn Văn An', customer_phone: '0901234567',
    start_date: '2026-10-01', end_date: '2026-10-20', price: 300000,
    status: 'active', created_by: 1, created_at: '2026-10-01 09:00:00', updated_at: '2026-10-01 09:00:00',
  },
  {
    id: 2, pass_code: 'MT-2026-0002', vehicle_id: 3, zone_id: null,
    customer_name: 'Trần Thị Bình', customer_phone: '0912345678',
    start_date: '2026-09-01', end_date: '2026-09-30', price: 300000,
    status: 'expired', created_by: 1, created_at: '2026-09-01 09:00:00', updated_at: '2026-09-01 09:00:00',
  },
];

const passPlates: Record<string, string> = { 'MT-2026-0001': '59A1-67890', 'MT-2026-0002': '51G-11223' };

// Seed accounts mirror seed.sql: admin + 2 staff (one locked).
// FE-017 S1: S1 profile fields (address/start_date/notes) — phone unique demo.
// FE-020 S4: permissions NULL (= full cũ) + perms resolved full.
const users: UserDTO[] = [
  { id: 1, username: 'admin', full_name: 'Quản trị viên', phone: '0900000001', address: 'Quầy BãiXe — Tầng 1', start_date: '2024-01-15', notes: 'Tài khoản quản lý chính.', permissions: null, perms: { ...FULL_PERMS }, role_id: 1, role_name: 'admin', is_active: 1, created_at: '2026-10-01 08:00:00', updated_at: '2026-10-01 08:00:00' },
  { id: 2, username: 'staff01', full_name: 'Nhân viên ca sáng', phone: '0901234001', address: '12 Lê Lợi, Q.1', start_date: '2024-06-01', notes: null, permissions: null, perms: { ...FULL_PERMS }, role_id: 2, role_name: 'staff', is_active: 1, created_at: '2026-10-02 08:00:00', updated_at: '2026-10-02 08:00:00' },
  { id: 3, username: 'staff02', full_name: 'Nhân viên ca chiều', phone: null, address: null, start_date: null, notes: null, permissions: null, perms: { ...FULL_PERMS }, role_id: 2, role_name: 'staff', is_active: 0, created_at: '2026-10-03 08:00:00', updated_at: '2026-10-10 17:00:00' },
];

let userSeq = 4;

// Seed activity rows (BE-006 UNION shape): 3 actions + deleted-account row
// (nulls) + unknown-closer check_out + monthly-session check_in.
const activitySeed: ActivityRow[] = [
  { at: '2026-10-16 08:12:00', user_id: 2, username: 'staff01', full_name: 'Nhân viên ca sáng', action: 'check_in', ticket_code: 'T-20261016-0042', license_plate: '51H-12345', zone_code: 'A', zone_name: 'Khu A — Ô tô', amount: null, note: 'A — Khu A — Ô tô' },
  { at: '2026-10-16 08:05:00', user_id: 1, username: 'admin', full_name: 'Quản trị viên', action: 'check_out', ticket_code: 'T-20261016-0031', license_plate: '59E1-24680', zone_code: 'B', zone_name: 'Khu B — Xe máy', amount: 60000, payment_method: 'cash', note: 'B — Khu B — Xe máy · Tiền mặt' },
  { at: '2026-10-16 07:50:00', user_id: 2, username: 'staff01', full_name: 'Nhân viên ca sáng', action: 'pass_sale', ticket_code: 'MT-2026-0003', license_plate: '51G-11223', zone_code: 'C', zone_name: 'Khu C — Hỗn hợp', amount: 300000, payment_method: 'transfer', note: 'C — Khu C — Hỗn hợp · Chuyển khoản' },
  { at: '2026-10-15 17:20:00', user_id: 3, username: 'staff02', full_name: 'Nhân viên ca chiều', action: 'check_in', ticket_code: 'T-20261015-0038', license_plate: '51H-99999', zone_code: 'A', zone_name: 'Khu A — Ô tô', amount: null, is_monthly_session: 1, note: 'A — Khu A — Ô tô' },
  { at: '2026-10-15 12:04:00', user_id: null, username: null, full_name: null, action: 'check_in', ticket_code: 'T-20261015-0021', license_plate: '59A1-67890', zone_code: 'C', zone_name: 'Khu C — Hỗn hợp', amount: null, note: 'C — Khu C — Hỗn hợp' },
  { at: '2026-10-14 18:40:00', user_id: 1, username: 'admin', full_name: 'Quản trị viên', action: 'check_out', ticket_code: 'T-20261014-0017', license_plate: '51H-12345', zone_code: 'A', zone_name: 'Khu A — Ô tô', amount: 45000, payment_method: 'card', note: 'A — Khu A — Ô tô · Thẻ' },
  { at: '2026-10-14 09:30:00', user_id: null, username: null, full_name: null, action: 'check_out', ticket_code: 'T-20261014-0009', license_plate: '60B4-55555', zone_code: 'B', zone_name: 'Khu B — Xe máy', amount: 15000, payment_method: 'cash', note: 'B — Khu B — Xe máy · Tiền mặt' },
  { at: '2026-10-13 10:15:00', user_id: 2, username: 'staff01', full_name: 'Nhân viên ca sáng', action: 'pass_sale', ticket_code: 'MT-2026-0004', license_plate: '51F-77777', zone_code: null, zone_name: null, amount: 300000, payment_method: 'e_wallet', note: 'Toàn bãi · Ví điện tử' },
];

function availability(): ZoneAvailability[] {
  return zones.map((z, i) => {
    const occupied = [34, 96, 12][i] ?? 0;
    return {
      zone_id: z.id, zone_code: z.code, zone_name: z.name,
      vehicle_type_allowed: z.vehicle_type_allowed, capacity: z.capacity,
      is_active: z.is_active, free_spots: z.capacity - occupied,
      occupied_spots: occupied, maintenance_spots: i === 0 ? 2 : 0,
    };
  });
}

export function mockPassPlates(): Record<string, string> {
  return { ...passPlates };
}

export function mockSessionPlates(): Record<number, string> {
  return { ...plates };
}

// FE-012: mock customer self-registration (mirrors BE-007 `auth:register`).
// Keyed by phone (= username). '0912345678' is pre-taken to demo 409.
const customerAccounts: Array<{ phone: string; password: string; userId: number; fullName: string }> = [
  { phone: '0912345678', password: '123456', userId: 101, fullName: 'Trần Thị Bình' },
];

// FE-013: which customer is "logged in" for mine-only mocks (myProfile /
// updateProfile / customer:*). Set on mock customer login/register.
let currentCustomerPhone: string | null = null;

// FE-019 S3: which staff/admin is "logged in" for mine-only attendance mocks
// (attendance:today/check-in/check-out ép me.id — mirror BE-013; UI KHÔNG
// gửi staff_id). Set on mock staff/admin login, default staff01 (id 2) để
// browser dev không login vẫn thấy dữ liệu demo.
let currentStaffId: number | null = 2;

function customerProfile(phone: string): UserDTO {
  const acc = customerAccounts.find((c) => c.phone === phone);
  if (!acc) throw new Error('mock: unknown customer');
  return {
    id: acc.userId,
    username: acc.phone,
    full_name: acc.fullName,
    phone: acc.phone,
    address: null,
    start_date: null,
    permissions: null,
    perms: { ...FULL_PERMS },
    role_id: 4,
    role_name: 'customer',
    is_active: 1,
    created_at: '2026-10-13 10:00:00',
    updated_at: '2026-10-16 10:00:00',
  };
}

// FE-013: seed vehicles + sessions for the pre-taken demo account
// '0912345678' (link qua owner_phone = SĐT, spec §0.1). Newly registered
// accounts start empty → empty-state path.
const customerVehicleSeeds: Array<CustomerVehicle & { phone: string }> = [
  { id: 901, license_plate: '51H-12345', vehicle_type: 'car', owner_name: 'Trần Thị Bình', owner_phone: '0912345678', session_count: 5, total_spent: 195000, is_parked: 1, created_at: '2026-10-01 09:00:00', updated_at: '2026-10-21 08:12:00', phone: '0912345678' },
  { id: 902, license_plate: '59A1-67890', vehicle_type: 'motorbike', owner_name: 'Trần Thị Bình', owner_phone: '0912345678', session_count: 2, total_spent: 30000, is_parked: 0, created_at: '2026-10-05 09:00:00', updated_at: '2026-10-19 17:30:00', phone: '0912345678' },
];

const customerSessionSeeds: Array<CustomerSessionRow & { phone: string }> = [
  { ticket_code: 'T-20261021-0007', license_plate: '51H-12345', zone_code: 'A', zone_name: 'Khu A — Ô tô', check_in_at: '2026-10-21 08:12:00', check_out_at: null, total_fee: null, monthly_pass_id: null, is_monthly: 0, payment_method: null, phone: '0912345678' },
  { ticket_code: 'T-20261020-0006', license_plate: '51H-12345', zone_code: 'A', zone_name: 'Khu A — Ô tô', check_in_at: '2026-10-20 08:05:00', check_out_at: '2026-10-20 18:40:00', total_fee: 85000, monthly_pass_id: null, is_monthly: 0, payment_method: 'cash', phone: '0912345678' },
  { ticket_code: 'T-20261019-0005', license_plate: '59A1-67890', zone_code: 'B', zone_name: 'Khu B — Xe máy', check_in_at: '2026-10-19 09:00:00', check_out_at: '2026-10-19 17:30:00', total_fee: 15000, monthly_pass_id: null, is_monthly: 0, payment_method: 'cash', phone: '0912345678' },
  { ticket_code: 'T-20261018-0004', license_plate: '51H-12345', zone_code: 'C', zone_name: 'Khu C — Hỗn hợp', check_in_at: '2026-10-18 07:50:00', check_out_at: '2026-10-18 20:10:00', total_fee: 0, monthly_pass_id: 7, is_monthly: 1, payment_method: null, phone: '0912345678' },
  { ticket_code: 'T-20261017-0003', license_plate: '51H-12345', zone_code: 'A', zone_name: 'Khu A — Ô tô', check_in_at: '2026-10-17 08:00:00', check_out_at: '2026-10-17 12:00:00', total_fee: 60000, monthly_pass_id: null, is_monthly: 0, payment_method: 'card', phone: '0912345678' },
  { ticket_code: 'T-20261015-0002', license_plate: '59A1-67890', zone_code: 'B', zone_name: 'Khu B — Xe máy', check_in_at: '2026-10-15 09:30:00', check_out_at: '2026-10-15 16:00:00', total_fee: 15000, monthly_pass_id: null, is_monthly: 0, payment_method: 'cash', phone: '0912345678' },
  { ticket_code: 'T-20261013-0001', license_plate: '51H-12345', zone_code: 'A', zone_name: 'Khu A — Ô tô', check_in_at: '2026-10-13 10:15:00', check_out_at: '2026-10-13 19:45:00', total_fee: 50000, monthly_pass_id: null, is_monthly: 0, payment_method: 'transfer', phone: '0912345678' },
];

// FE-016 mock P4 (nối BE-011 `customer:reserve*`, cập nhật BE-019 24/24 + qua đêm).
// Quota ≤ 2 pending/customer (mirror backend COUNT), mã R-YYYYMMDD-XXXX,
// expires_at = start + 20p. Check-in bằng mã consume pending → completed.
const reservations: Reservation[] = [];
let reservationSeq = 1;

function toMinutes(hhMm: string): number {
  const [h, m] = hhMm.split(':').map(Number);
  return h * 60 + m;
}

function reservationRow(r: Reservation): CustomerReservationRow {
  const zone = zones.find((z) => z.id === r.zone_id);
  return {
    ...r,
    zone_code: zone?.code ?? null,
    zone_name: zone?.name ?? null,
    spot_number: null, // mock giữ theo khu (spot_id null) — backend thật auto-pick ô
  };
}

// FE-019 S3 mock (nối BE-013 `shifts/*` + `attendance:*`): ca + chấm công.
// Mirror backend: auto ca theo giờ tường, work_date = ngày bắt đầu ca
// (ca đêm + t < end → hôm qua), UNIQUE(user,shift,work_date), status late
// khi trễ >10p, chốt ca treo gần nhất ("chốt bù"), staff ép me.id qua
// currentStaffId (UI KHÔNG gửi staff_id), revenue mock = 0 (mock không có
// payments — variance demo = closing − opening).
const shifts: Shift[] = [
  { id: 1, code: 'MORNING', name: 'Ca sáng', start_time: '06:00', end_time: '14:00', is_active: 1, created_at: '2026-10-01 08:00:00', updated_at: '2026-10-01 08:00:00' },
  { id: 2, code: 'AFTERNOON', name: 'Ca chiều', start_time: '14:00', end_time: '22:00', is_active: 1, created_at: '2026-10-01 08:00:00', updated_at: '2026-10-01 08:00:00' },
  { id: 3, code: 'NIGHT', name: 'Ca đêm', start_time: '22:00', end_time: '06:00', is_active: 1, created_at: '2026-10-01 08:00:00', updated_at: '2026-10-01 08:00:00' },
];

function mockShiftToMin(hhMm: string): number {
  const [h, m] = hhMm.split(':').map(Number);
  return h * 60 + m;
}

function mockShiftDate(base: string, delta: number): string {
  const d = new Date(`${base}T00:00:00`);
  d.setDate(d.getDate() + delta);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function mockNowHHMM(): string {
  const d = new Date();
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

function mockNowStamp(): string {
  const d = new Date();
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// Ca hiện tại theo giờ tường từ bảng shifts đang mở (mirror resolveCurrentShift).
function mockResolveShift(t: string): Shift {
  const open = shifts.filter((s) => s.is_active === 1);
  const hit = open.find((s) => {
    const a = mockShiftToMin(s.start_time);
    const b = mockShiftToMin(s.end_time);
    return a <= b ? t >= s.start_time && t < s.end_time : t >= s.start_time || t < s.end_time;
  });
  return hit ?? shifts[0];
}

// work_date = ngày bắt đầu ca (ca đêm + t < end → hôm qua).
function mockWorkDate(shift: Shift, today: string, t: string): string {
  if (mockShiftToMin(shift.end_time) < mockShiftToMin(shift.start_time) && t < shift.end_time) {
    return mockShiftDate(today, -1);
  }
  return today;
}

// Phút từ start_time đến giờ bấm (xuyên nửa đêm) — mirror BE-013.
function mockLateMinutes(shift: Shift, checkInAt: string): number {
  const t = checkInAt.slice(11, 16);
  return (mockShiftToMin(t) - mockShiftToMin(shift.start_time) + 1440) % 1440;
}

function mockCovers(s: Shift, tMin: number): boolean {
  const a = mockShiftToMin(s.start_time);
  const b = mockShiftToMin(s.end_time);
  return a <= b ? tMin >= a && tMin < b : tMin >= a || tMin < b;
}

// Overlap 2 khoảng tròn 1440p (mirror BE-013 Warning không chặn).
function mockShiftsOverlap(a: Shift, b: Shift): boolean {
  return mockCovers(a, mockShiftToMin(b.start_time)) || mockCovers(b, mockShiftToMin(a.start_time));
}

let attendanceSeq = 100;

// FE-021 M1/M2 mock seeds (mirror BE-015 `reports:transactions` + app-config).
// Deterministic — sinh 1 lần lúc load module (~180 rows Oct 2026).
function zoneIdOf(code: string | null): number {
  if (code === 'A') return 1;
  if (code === 'B') return 2;
  return 3;
}

const txSeed: TxRow[] = (() => {
  const rows: TxRow[] = [];
  const methods = ['cash', 'transfer', 'card', 'e_wallet'] as const;
  const plates = ['51H-12345', '59A1-67890', '51G-11223', '60B4-55555', '51F-77777'];
  const zonesM: Array<{ code: string; name: string }> = [
    { code: 'A', name: 'Khu A — Ô tô' },
    { code: 'B', name: 'Khu B — Xe máy' },
    { code: 'C', name: 'Khu C — Hỗn hợp' },
  ];
  let id = 5000;
  for (let day = 1; day <= 24; day += 1) {
    const dd = `2026-10-${String(day).padStart(2, '0')}`;
    const n = 5 + ((day * 7) % 4); // 5–8 rows/ngày
    for (let i = 0; i < n; i += 1) {
      const z = zonesM[(day + i) % 3];
      const isMonthly = (day + i) % 5 === 0;
      const isAdjust = (day + i) % 11 === 0;
      const amount = isAdjust ? -((day * 137 + i * 53) % 20000 + 5000)
        : isMonthly ? 300000
        : z.code === 'A' ? 20000 * (1 + ((day + i) % 4)) : 5000 * (1 + ((day + i) % 3));
      rows.push({
        paid_at: `${dd} ${String(7 + ((day + i) % 12)).padStart(2, '0')}:${String((i * 17) % 60).padStart(2, '0')}:00`,
        payment_id: id++,
        kind: isAdjust ? 'adjust' : isMonthly ? 'monthly' : 'casual',
        ticket_code: isMonthly ? `MT-2026-${String(100 + ((day + i) % 9)).padStart(4, '0')}` : `T-202610${String(day).padStart(2, '0')}-${String(i + 1).padStart(4, '0')}`,
        license_plate: plates[(day + i) % plates.length],
        zone_code: z.code,
        zone_name: z.name,
        received_by_name: (day + i) % 7 === 0 ? null : (i % 2 === 0 ? 'Nhân viên ca sáng' : 'Quản trị viên'),
        received_by_username: (day + i) % 7 === 0 ? null : (i % 2 === 0 ? 'staff01' : 'admin'),
        payment_method: isMonthly && i % 3 === 0 ? null : methods[(day + i) % 4],
        amount,
        note: isAdjust ? 'điều chỉnh giảm trừ ca sáng' : (z.code === 'A' ? 'A — Khu A — Ô tô' : `${z.code} — ${z.name}`),
      });
    }
  }
  return rows;
})();

let mockSettings: ParkingSettings = {
  lot_name: 'Bãi giữ xe Ngã Tư',
  address: '12 Lê Lợi, Q.1',
  phone: '0901234567',
  logo_data_url: null,
  fee_grace_minutes: 30,
  fee_day_threshold_hours: 12,
  pb_url: 'https://mqaue7.bot-keep.xyz', // BE-016 default (browser dev vẫn local-only)
  pb_parking_lot: null, // BE-017: null = chưa cấu hình = local-only
  updated_at: '2026-10-24T08:00:00Z',
};

const attendance: Attendance[] = (() => {
  const today = todayLocal();
  const yd = mockShiftDate(today, -1);
  return [
    {
      id: attendanceSeq++, user_id: 2, shift_id: 2, work_date: yd,
      check_in_at: `${yd} 13:58:00`, check_out_at: `${yd} 22:03:00`,
      opening_cash: 1000000, closing_cash: 1320000,
      handover_note: 'Bàn giao két đủ, ca tối kiểm kê.', status: 'present',
      created_at: `${yd} 13:58:00`, updated_at: `${yd} 22:03:00`,
    },
    {
      // Ca đêm qua còn treo → banner "chốt bù" khi mở màn (trừ khi đang
      // đúng ca đêm đó, lúc ấy row này là ca hiện tại "Đang trực").
      id: attendanceSeq++, user_id: 2, shift_id: 3, work_date: yd,
      check_in_at: `${yd} 22:12:00`, check_out_at: null,
      opening_cash: 1320000, closing_cash: null,
      handover_note: null, status: 'late',
      created_at: `${yd} 22:12:00`, updated_at: `${yd} 22:12:00`,
    },
    {
      id: attendanceSeq++, user_id: 1, shift_id: 1, work_date: yd,
      check_in_at: `${yd} 06:02:00`, check_out_at: `${yd} 14:00:00`,
      opening_cash: 800000, closing_cash: 950000,
      handover_note: null, status: 'present',
      created_at: `${yd} 06:02:00`, updated_at: `${yd} 14:00:00`,
    },
  ];
})();

function mockAttendanceRow(a: Attendance): {
  shift_code: Shift['code'];
  shift_name: string;
  shift_start: string;
  shift_end: string;
  username: string | null;
  full_name: string | null;
} & Attendance {
  const shift = shifts.find((s) => s.id === a.shift_id) ?? shifts[0];
  const user = users.find((u) => u.id === a.user_id);
  return {
    ...a,
    shift_code: shift.code,
    shift_name: shift.name,
    shift_start: shift.start_time,
    shift_end: shift.end_time,
    username: user?.username ?? null,
    full_name: user?.full_name ?? null,
  };
}

export const mockApi: RendererApi = {
  async login(username: string, password: string): Promise<ApiResult<AuthUser>> {
    await delay(600);
    if (username.trim().length < 3 || password.length === 0) {
      return { ok: false, error: 'Sai tài khoản hoặc mật khẩu' };
    }
    if (username === 'locked') return { ok: false, error: 'Tài khoản bị khóa — liên hệ Admin.' };
    // Customer login by phone (username = SĐT, BE-007).
    const customer = customerAccounts.find((c) => c.phone === username.trim());
    if (customer) {
      if (password !== customer.password) return { ok: false, error: 'Sai tài khoản hoặc mật khẩu' };
      currentCustomerPhone = customer.phone;
      return { ok: true, data: { userId: customer.userId, fullName: customer.fullName, role: 'customer', perms: { ...FULL_PERMS } } };
    }
    // Seed accounts: admin/123456 → admin, staff/123456 → staff (matches seed.sql).
    // FE-019: track "me" cho attendance mocks mine-only (mirror BE-013 ép me.id).
    if (username === 'admin') {
      if (password !== '123456') return { ok: false, error: 'Sai tài khoản hoặc mật khẩu' };
      currentStaffId = 1;
      return { ok: true, data: { userId: 1, fullName: 'Quản trị viên', role: 'admin', perms: { ...FULL_PERMS } } };
    }
    if (password !== '123456') return { ok: false, error: 'Sai tài khoản hoặc mật khẩu' };
    currentStaffId = 2;
    // FE-020 S4: trả perms đã resolve của staff (mock login theo id 2 — sau khi
    // admin sửa quyền qua updateUser mock, login lại thấy flags mới).
    const staff = users.find((u) => u.id === 2);
    return { ok: true, data: { userId: 2, fullName: 'Nhân viên ca sáng', role: 'staff', perms: { ...(staff?.perms ?? FULL_PERMS) } } };
  },

  // FE-012 mock `auth:register`: duplicate phone → 409-style message
  // (matches BE-007 "đã được đăng ký — vui lòng đăng nhập"), else create.
  async register(input: RegisterInput): Promise<ApiResult<{ userId: number; fullName: string }>> {
    await delay(600);
    const phone = input.phone.trim();
    const name = input.full_name.trim();
    if (!/^0\d{9}$/.test(phone)) return { ok: false, error: 'Số điện thoại không hợp lệ.' };
    if (name.length < 2) return { ok: false, error: 'Họ tên là bắt buộc.' };
    if (input.password.length < 6) return { ok: false, error: 'Mật khẩu tối thiểu 6 ký tự.' };
    if (customerAccounts.some((c) => c.phone === phone)) {
      return { ok: false, error: 'SĐT đã được đăng ký — vui lòng đăng nhập' };
    }
    const account = { phone, password: input.password, userId: userSeq++, fullName: name };
    customerAccounts.push(account);
    currentCustomerPhone = phone;
    return { ok: true, data: { userId: account.userId, fullName: account.fullName } };
  },

  async listZones(): Promise<ApiResult<ParkingZone[]>> {
    await delay();
    return { ok: true, data: [...zones] };
  },

  async createZone(input): Promise<ApiResult<ParkingZone>> {
    await delay();
    const zone: ParkingZone = { ...input, id: zoneSeq++, created_at: '2026-10-16 10:00:00', updated_at: '2026-10-16 10:00:00' };
    zones.push(zone);
    return { ok: true, data: zone };
  },

  async updateZone(id, patch): Promise<ApiResult<ParkingZone>> {
    await delay(300);
    const idx = zones.findIndex((z) => z.id === id);
    if (idx === -1) return { ok: false, error: 'Không tìm thấy khu vực' };
    zones[idx] = { ...zones[idx], ...patch } as ParkingZone;
    return { ok: true, data: zones[idx] };
  },

  async deleteZone(id): Promise<ApiResult<void>> {
    await delay(300);
    const idx = zones.findIndex((z) => z.id === id);
    if (idx === -1) return { ok: false, error: 'Không tìm thấy khu vực' };
    zones.splice(idx, 1);
    return { ok: true, data: undefined };
  },

  async zoneAvailability(): Promise<ApiResult<ZoneAvailability[]>> {
    await delay();
    return { ok: true, data: availability() };
  },

  async spotMap(zoneId): Promise<ApiResult<SpotMapCell[]>> {
    await delay(350);
    const zone = zones.find((z) => z.id === zoneId);
    if (!zone) return { ok: false, error: 'Không tìm thấy khu vực' };
    const av = availability().find((a) => a.zone_id === zoneId);
    const occupied = av?.occupied_spots ?? 0;
    const cells: SpotMapCell[] = Array.from({ length: Math.min(zone.capacity, 84) }, (_, i) => {
      const n = i + 1;
      // FE-016: 1 ô demo 'reserved' (Đang giữ) ngay sau dãy occupied để QA
      // thấy badge Warning — tách hẳn maintenance (ô cuối dãy).
      const demoReserved = i === occupied && occupied + 1 < zone.capacity;
      return {
        spot_id: zoneId * 1000 + n,
        zone_id: zoneId,
        zone_code: zone.code,
        spot_number: `${zone.code}-${String(n).padStart(2, '0')}`,
        status: i < occupied ? 'occupied' : demoReserved ? 'reserved' : i >= zone.capacity - (av?.maintenance_spots ?? 0) && (av?.maintenance_spots ?? 0) > 0 ? 'maintenance' : 'available',
        occupying_plate: i < occupied ? (i % 3 === 0 ? `51H-${String(10000 + i)}` : null) : null,
      };
    });
    return { ok: true, data: cells };
  },

  async checkIn(input): Promise<ApiResult<ParkingSession>> {
    await delay(500);
    // FE-020 S4: guard checkin (+ reservation khi kèm mã giữ chỗ) — mirror BE-014.
    const denied = mockRequirePerm(currentStaffId, 'checkin');
    if (denied) return { ok: false, error: denied };
    // FE-016 P4: check-in bằng mã giữ chỗ — consume pending → completed
    // (mirror BE-011). Mã sai / hết hiệu lực → lỗi inline cho staff.
    const resCode = (input.reservation_code ?? '').trim().toUpperCase();
    if (resCode) {
      const deniedRes = mockRequirePerm(currentStaffId, 'reservation');
      if (deniedRes) return { ok: false, error: deniedRes };
      const rIdx = reservations.findIndex((r) => r.code === resCode);
      if (rIdx === -1) return { ok: false, error: `Mã đặt chỗ ${resCode} không đúng — kiểm tra lại mã R-…` };
      const r = reservations[rIdx];
      if (r.status !== 'pending') return { ok: false, error: `Mã đặt chỗ ${resCode} không còn hiệu lực (đã dùng/hết hạn/đã hủy)` };
      if (r.zone_id !== input.zone_id) return { ok: false, error: `Mã ${resCode} giữ ở khu khác — chọn đúng khu giữ chỗ` };
      reservations.splice(rIdx, 1, { ...r, status: 'completed' });
    }
    const dup = sessions.find((s) => s.status === 'parked' && plates[s.vehicle_id] === input.license_plate);
    if (dup) return { ok: false, error: `Biển số đã check-in lúc ${dup.check_in_at.slice(11, 16)} tại khu ${dup.zone_id}` };
    const zone = zones.find((z) => z.id === input.zone_id);
    if (!zone) return { ok: false, error: 'Khu vực không hợp lệ' };
    const code = `T-20261016-${String(ticketSeq++).padStart(4, '0')}`;
    const session: ParkingSession = {
      id: sessions.length + 1, ticket_code: code, vehicle_id: Date.now() % 100000,
      spot_id: input.spot_id ?? null, zone_id: input.zone_id, monthly_pass_id: null,
      check_in_at: '2026-10-16 10:30:00', check_out_at: null, status: 'parked',
      hourly_rate_applied: zone.price_per_hour, daily_rate_applied: zone.price_per_day,
      total_fee: null, discount_amount: 0, created_by: 1, closed_by: null,
      created_at: '2026-10-16 10:30:00', updated_at: '2026-10-16 10:30:00',
    };
    sessions.push(session);
    plates[session.vehicle_id] = input.license_plate;
    return { ok: true, data: session };
  },

  async findParked(ticketOrPlate): Promise<ApiResult<ParkingSession[]>> {
    await delay(300);
    const q = ticketOrPlate.trim().toUpperCase();
    if (!q) return { ok: true, data: [] };
    return {
      ok: true,
      data: sessions.filter((s) => s.status === 'parked' && (s.ticket_code.toUpperCase().includes(q) || (plates[s.vehicle_id] ?? '').toUpperCase().includes(q))),
    };
  },

  async parkedSessions(): Promise<ApiResult<ParkingSession[]>> {
    await delay(300);
    return { ok: true, data: sessions.filter((s) => s.status === 'parked') };
  },

  async checkOut(input): Promise<ApiResult<{ session: ParkingSession; amount: number }>> {
    await delay(600);
    // FE-020 S4: guard checkin (mirror BE-014 sessions:check-out → checkin).
    const denied = mockRequirePerm(currentStaffId, 'checkin');
    if (denied) return { ok: false, error: denied };
    const s = sessions.find((x) => x.ticket_code === input.ticket_code && x.status === 'parked');
    if (!s) return { ok: false, error: 'Không tìm thấy xe đang đỗ' };
    const amount = Math.max(0, s.hourly_rate_applied * 3 - (input.discount_amount ?? 0));
    const done: ParkingSession = { ...s, status: 'completed', check_out_at: '2026-10-16 13:45:00', total_fee: amount, discount_amount: input.discount_amount ?? 0 };
    sessions.splice(sessions.indexOf(s), 1, done);
    return { ok: true, data: { session: done, amount } };
  },

  async listPasses(): Promise<ApiResult<MonthlyPass[]>> {
    await delay();
    // FE-020 S4: guard pass_sale (mirror BE-014 passes:list → pass_sale).
    const denied = mockRequirePerm(currentStaffId, 'pass_sale');
    if (denied) return { ok: false, error: denied };
    return { ok: true, data: [...passes] };
  },

  async createPass(input): Promise<ApiResult<MonthlyPass>> {
    await delay(500);
    const deniedCreate = mockRequirePerm(currentStaffId, 'pass_sale');
    if (deniedCreate) return { ok: false, error: deniedCreate };
    const dup = passes.find((p) => p.status === 'active' && passPlates[p.pass_code] === input.license_plate.toUpperCase());
    if (dup) return { ok: false, error: `Biển số này đã có vé hiệu lực đến ${dup.end_date.split('-').reverse().join('/')}` };
    if (dup) return { ok: false, error: `Biển số này đã có vé hiệu lực đến ${dup.end_date.split('-').reverse().join('/')}` };
    const months = input.months;
    const base = 300000 * months;
    const price = months === 12 ? Math.round(base * 0.9) : base;
    const pass: MonthlyPass = {
      id: passes.length + 1, pass_code: `MT-2026-${String(100 + passes.length).padStart(4, '0')}`,
      vehicle_id: Date.now() % 100000, zone_id: input.zone_id,
      customer_name: input.customer_name, customer_phone: input.customer_phone,
      start_date: input.start_date, end_date: input.start_date, price,
      status: 'active', created_by: 1, created_at: '2026-10-16 10:00:00', updated_at: '2026-10-16 10:00:00',
    };
    passes.push(pass);
    passPlates[pass.pass_code] = input.license_plate.toUpperCase();
    return { ok: true, data: pass };
  },

  async renewPass(passCode, months): Promise<ApiResult<MonthlyPass>> {
    await delay(500);
    const deniedRenew = mockRequirePerm(currentStaffId, 'pass_sale');
    if (deniedRenew) return { ok: false, error: deniedRenew };
    const p = passes.find((x) => x.pass_code === passCode);
    if (!p) return { ok: false, error: 'Không tìm thấy vé' };
    const renewed: MonthlyPass = { ...p, status: 'active', price: 300000 * months, end_date: p.end_date };
    passes.splice(passes.indexOf(p), 1, renewed);
    return { ok: true, data: renewed };
  },

  async cancelPass(passCode): Promise<ApiResult<void>> {
    await delay(300);
    const p = passes.find((x) => x.pass_code === passCode);
    if (!p) return { ok: false, error: 'Không tìm thấy vé' };
    passes.splice(passes.indexOf(p), 1, { ...p, status: 'cancelled' });
    // Customer hủy đăng ký pending của mình → dọn store badge (mirror adapter).
    removeMyPassRequest(passCode);
    return { ok: true, data: undefined };
  },

  async revenue(from, to): Promise<ApiResult<{ daily: RevenueDaily[]; sessions: SessionsDaily[] }>> {
    await delay();
    void from; void to;
    const daily: RevenueDaily[] = [
      { day: `${todayLocal()}`, payment_method: 'cash', tx_count: 42, revenue: 2350000 },
      { day: `${todayLocal()}`, payment_method: 'transfer', tx_count: 18, revenue: 1850000 },
    ];
    const sessionsDaily: SessionsDaily[] = [
      { day: todayLocal(), zone_id: 1, entries: 34, exits: 28, still_parked: 6 },
      { day: todayLocal(), zone_id: 2, entries: 96, exits: 88, still_parked: 8 },
    ];
    return { ok: true, data: { daily, sessions: sessionsDaily } };
  },

  async dashboard() {
    await delay();
    // FE-020 S4: guard report_self (mirror BE-014 reports:dashboard → report_self).
    const deniedDash = mockRequirePerm(currentStaffId, 'report_self');
    if (deniedDash) return { ok: false, error: deniedDash };
    const av = availability();
    const occupied = av.reduce((s, z) => s + z.occupied_spots, 0);
    const today = todayLocal();
    const expiring = passes.filter((p) => {
      if (p.status !== 'active') return false;
      const d = Math.round((new Date(p.end_date).getTime() - new Date(today).getTime()) / 86400000);
      return d >= 0 && d <= 7;
    });
    return {
      ok: true,
      data: { availability: av, active_sessions: occupied, revenue_today: 4200000, passes_expiring_soon: [...expiring] },
    };
  },

  async previewFee(ticketCode, discountAmount = 0): Promise<ApiResult<FeePreview>> {
    await delay(300);
    // FE-020 S4: guard checkin (mirror BE-014 preview-fee → checkin).
    const denied = mockRequirePerm(currentStaffId, 'checkin');
    if (denied) return { ok: false, error: denied };
    const s = sessions.find((x) => x.ticket_code === ticketCode);
    if (!s) return { ok: false, error: 'Không tìm thấy vé' };
    const nowMs = new Date('2026-10-16T13:45:00').getTime();
    const inMs = new Date(s.check_in_at.replace(' ', 'T')).getTime();
    const minutes = Math.max(0, Math.round((nowMs - inMs) / 60000));
    const billed = minutes <= 30 ? 1 : Math.ceil(minutes / 60);
    const daily = billed >= 12;
    const gross = s.monthly_pass_id !== null ? 0 : daily ? s.daily_rate_applied : billed * s.hourly_rate_applied;
    return {
      ok: true,
      data: {
        ticket_code: s.ticket_code, check_in_at: s.check_in_at, check_out_at: '2026-10-16 13:45:00',
        minutes, billed_hours: billed, applied_daily_rate: daily,
        day_count: daily ? Math.max(1, Math.ceil(minutes / 1440)) : 0,
        hourly_rate: s.hourly_rate_applied, daily_rate: s.daily_rate_applied,
        gross_fee: gross, discount_amount: discountAmount,
        total_fee: Math.max(0, gross - discountAmount),
        uses_monthly_pass: s.monthly_pass_id !== null, pass_code: null,
      },
    };
  },

  async logout(): Promise<ApiResult<void>> {
    await delay(150);
    return { ok: true, data: undefined };
  },

  async listUsers(): Promise<ApiResult<UserDTO[]>> {
    await delay();
    return { ok: true, data: [...users] };
  },

  async createUser(input): Promise<ApiResult<UserDTO>> {
    await delay(500);
    if (users.some((u) => u.username.toLowerCase() === input.username.trim().toLowerCase())) {
      return { ok: false, error: 'Tên đăng nhập đã tồn tại.' };
    }
    const user: UserDTO = {
      id: userSeq++,
      username: input.username.trim(),
      full_name: input.full_name.trim(),
      phone: null,
      address: null,
      start_date: null,
      notes: null,
      permissions: null,
      perms: { ...FULL_PERMS },
      role_id: input.role === 'admin' ? 1 : 2,
      role_name: input.role,
      is_active: 1,
      created_at: '2026-10-16 10:00:00',
      updated_at: '2026-10-16 10:00:00',
    };
    users.push(user);
    return { ok: true, data: user };
  },

  async toggleUserActive(id, isActive): Promise<ApiResult<UserDTO>> {
    await delay(300);
    const idx = users.findIndex((u) => u.id === id);
    if (idx === -1) return { ok: false, error: 'Không tìm thấy tài khoản' };
    users[idx] = { ...users[idx], is_active: isActive, updated_at: '2026-10-16 10:00:00' };
    return { ok: true, data: users[idx] };
  },

  async updateUser(id, patch): Promise<ApiResult<UserDTO>> {
    await delay(300);
    const idx = users.findIndex((u) => u.id === id);
    if (idx === -1) return { ok: false, error: 'Không tìm thấy tài khoản' };
    const next = { ...users[idx] };
    if (patch.username !== undefined) {
      const name = patch.username.trim();
      if (name.length < 3) return { ok: false, error: 'Tên đăng nhập tối thiểu 3 ký tự.' };
      if (users.some((u) => u.id !== id && u.username.toLowerCase() === name.toLowerCase())) {
        return { ok: false, error: 'Tên đăng nhập đã tồn tại.' };
      }
      next.username = name;
    }
    if (patch.full_name !== undefined) {
      const full = patch.full_name.trim();
      if (!full) return { ok: false, error: 'Họ tên là bắt buộc.' };
      if (full.length > 100) return { ok: false, error: 'Họ tên tối đa 100 ký tự.' };
      next.full_name = full;
    }
    if (patch.new_password !== undefined && patch.new_password.length > 0) {
      if (patch.new_password.length < 6) return { ok: false, error: 'Mật khẩu tối thiểu 6 ký tự.' };
      // Mock has no password_hash column — accept and drop (login uses fixed seeds).
    }
    // FE-017 S1 (mirror BE-012 admin patch): phone/address/start_date/notes.
    if (patch.phone !== undefined) {
      const raw = (patch.phone ?? '').trim();
      if (raw === '') {
        next.phone = null;
      } else {
        if (!/^0\d{9}$/.test(raw)) {
          return { ok: false, error: 'Số điện thoại chưa đúng — 10 số, bắt đầu bằng 0.', fields: { phone: 'Số điện thoại chưa đúng — 10 số, bắt đầu bằng 0.' } };
        }
        if (users.some((u) => u.id !== id && (u.phone ?? '') === raw)) {
          return { ok: false, error: 'SĐT đã được dùng.', fields: { phone: 'SĐT đã được dùng.' } };
        }
        next.phone = raw;
      }
    }
    if (patch.address !== undefined) {
      const raw = (patch.address ?? '').trim();
      if (raw === '') {
        next.address = null;
      } else {
        if (raw.length > 255) {
          return { ok: false, error: 'Địa chỉ tối đa 255 ký tự.', fields: { address: 'Địa chỉ tối đa 255 ký tự.' } };
        }
        next.address = raw;
      }
    }
    if (patch.start_date !== undefined) {
      const raw = (patch.start_date ?? '').trim();
      if (raw === '') {
        next.start_date = null;
      } else {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || raw > todayLocal()) {
          return { ok: false, error: 'Ngày vào làm không thể là tương lai.', fields: { start_date: 'Ngày vào làm không thể là tương lai.' } };
        }
        next.start_date = raw;
      }
    }
    if (patch.notes !== undefined) {
      const raw = (patch.notes ?? '').trim();
      if (raw === '') {
        next.notes = null;
      } else {
        if (raw.length > 500) {
          return { ok: false, error: 'Ghi chú tối đa 500 ký tự.', fields: { notes: 'Ghi chú tối đa 500 ký tự.' } };
        }
        next.notes = raw;
      }
    }
    // FE-020 S4 (mirror BE-014 `users:update` permissions patch): whitelist
    // 5 keys, giá trị 0/1/boolean; null/rỗng → reset NULL (= full);
    // target admin → bỏ qua, không lưu (admin luôn full).
    if (patch.permissions !== undefined) {
      if (next.role_name === 'admin') {
        // bỏ qua im lặng — admin luôn full quyền
      } else {
        const raw = patch.permissions;
        if (raw === null || (typeof raw === 'string' && raw.trim() === '')) {
          next.permissions = null;
          next.perms = { ...FULL_PERMS };
        } else {
          let obj: Partial<Record<string, unknown>>;
          if (typeof raw === 'string') {
            try {
              obj = JSON.parse(raw) as Partial<Record<string, unknown>>;
            } catch {
              return { ok: false, error: 'Quyền hạn không hợp lệ.', fields: { permissions: 'Quyền hạn không hợp lệ.' } };
            }
          } else {
            obj = raw as Partial<Record<string, unknown>>;
          }
          const nextPerms: StaffPermissions = { ...(next.perms ?? FULL_PERMS) };
          for (const [k, v] of Object.entries(obj)) {
            if (k !== 'checkin' && k !== 'pass_sale' && k !== 'report_self' && k !== 'profile_self' && k !== 'reservation') continue; // key lạ → bỏ qua
            if (v === 1 || v === true || v === '1') nextPerms[k] = 1;
            else if (v === 0 || v === false || v === '0') nextPerms[k] = 0;
            else return { ok: false, error: `Quyền ${k} phải là Bật hoặc Tắt.`, fields: { permissions: `Quyền ${k} phải là Bật hoặc Tắt.` } };
          }
          next.permissions = JSON.stringify(nextPerms);
          next.perms = nextPerms;
        }
      }
    }
    next.updated_at = '2026-10-16 10:00:00';
    users[idx] = next;
    return { ok: true, data: users[idx] };
  },

  // FE-017 S1 mock users:profile* (mine-only — staff = staff01 id 2).
  // KHÔNG bao giờ trả notes (mirror BE-012 strip).
  async staffProfile(): Promise<ApiResult<StaffSelfProfile>> {
    await delay(200);
    const me = users.find((u) => u.id === 2) ?? users[1];
    if (!me) return { ok: false, error: 'Chưa đăng nhập' };
    const { notes: _notes, ...rest } = me;
    void _notes;
    return {
      ok: true,
      data: {
        id: rest.id, username: rest.username, full_name: rest.full_name,
        phone: rest.phone, address: rest.address, start_date: rest.start_date,
        role_name: rest.role_name, is_active: rest.is_active, created_at: rest.created_at,
      },
    };
  },

  async updateStaffProfile(patch: StaffProfileUpdateInput): Promise<ApiResult<StaffSelfProfile>> {
    await delay(300);
    // FE-020 S4: guard profile_self (mirror BE-014 users:profile:update → profile_self).
    const denied = mockRequirePerm(2, 'profile_self');
    if (denied) return { ok: false, error: denied };
    const idx = users.findIndex((u) => u.id === 2);
    if (idx === -1) return { ok: false, error: 'Chưa đăng nhập' };
    const phoneRaw = patch.phone !== undefined ? (patch.phone ?? '').trim() : undefined;
    const addrRaw = patch.address !== undefined ? (patch.address ?? '').trim() : undefined;
    if ((phoneRaw === undefined || phoneRaw === (users[idx].phone ?? '')) && (addrRaw === undefined || addrRaw === (users[idx].address ?? ''))) {
      return { ok: false, error: 'Không có gì để cập nhật' };
    }
    if (phoneRaw !== undefined) {
      if (phoneRaw === '') {
        users[idx] = { ...users[idx], phone: null };
      } else {
        if (!/^0\d{9}$/.test(phoneRaw)) {
          return { ok: false, error: 'Số điện thoại chưa đúng — 10 số, bắt đầu bằng 0.', fields: { phone: 'Số điện thoại chưa đúng — 10 số, bắt đầu bằng 0.' } };
        }
        if (users.some((u) => u.id !== 2 && (u.phone ?? '') === phoneRaw)) {
          return { ok: false, error: 'SĐT đã được dùng.', fields: { phone: 'SĐT đã được dùng.' } };
        }
        users[idx] = { ...users[idx], phone: phoneRaw };
      }
    }
    if (addrRaw !== undefined) {
      if (addrRaw === '') {
        users[idx] = { ...users[idx], address: null };
      } else {
        if (addrRaw.length > 255) {
          return { ok: false, error: 'Địa chỉ tối đa 255 ký tự.', fields: { address: 'Địa chỉ tối đa 255 ký tự.' } };
        }
        users[idx] = { ...users[idx], address: addrRaw };
      }
    }
    // notes/start_date gửi kèm cũng bị bỏ qua (mirror BE-012) — mock chỉ nhận 2 field type.
    users[idx] = { ...users[idx], updated_at: '2026-10-24 10:00:00' };
    const me = users[idx];
    return {
      ok: true,
      data: {
        id: me.id, username: me.username, full_name: me.full_name,
        phone: me.phone, address: me.address, start_date: me.start_date,
        role_name: me.role_name, is_active: me.is_active, created_at: me.created_at,
      },
    };
  },

  async currentUser() {
    await delay(150);
    return { ok: true, data: null };
  },

  // FE-020 S4 mock `auth:me` raw (kèm perms) — mirror toUserDTO backend.
  // Dùng currentStaffId làm "me" (browser dev không có session thật).
  async meFull(): Promise<ApiResult<UserDTO>> {
    await delay(150);
    const me = users.find((u) => u.id === (currentStaffId ?? 2));
    if (!me) return { ok: false, error: 'Chưa đăng nhập' };
    return { ok: true, data: { ...me, perms: { ...me.perms } } };
  },

  // FE-013 mock P1: raw profile incl. read-only phone (mirrors auth:me).
  async myProfile(): Promise<ApiResult<UserDTO>> {
    await delay(200);
    if (!currentCustomerPhone) return { ok: false, error: 'Chưa đăng nhập' };
    return { ok: true, data: customerProfile(currentCustomerPhone) };
  },

  // FE-013 mock P1: self-update (mirrors BE-008 users:update self path) —
  // SĐT immutable, đổi pass bắt buộc current_password đúng (sai → field error
  // errors.current_password như backend ValidationError).
  async updateProfile(id, patch): Promise<ApiResult<UserDTO>> {
    await delay(400);
    const acc = customerAccounts.find((c) => c.userId === id);
    if (!acc) return { ok: false, error: 'Không tìm thấy tài khoản' };
    if (patch.full_name !== undefined) {
      const name = patch.full_name.trim();
      if (!name) return { ok: false, error: 'Họ tên là bắt buộc', fields: { full_name: 'Họ tên là bắt buộc' } };
    }
    if (patch.new_password !== undefined && patch.new_password !== '') {
      if (patch.new_password.length < 6) {
        return { ok: false, error: 'Mật khẩu phải ≥6 ký tự.', fields: { new_password: 'Mật khẩu phải ≥6 ký tự.' } };
      }
      if ((patch.current_password ?? '') !== acc.password) {
        return { ok: false, error: 'Mật khẩu hiện tại chưa đúng.', fields: { current_password: 'Mật khẩu hiện tại chưa đúng.' } };
      }
      if (patch.new_password === acc.password) {
        return { ok: false, error: 'Mật khẩu mới phải khác mật khẩu hiện tại.', fields: { new_password: 'Mật khẩu mới phải khác mật khẩu hiện tại.' } };
      }
    }
    if (patch.full_name !== undefined && patch.full_name.trim()) acc.fullName = patch.full_name.trim();
    if (patch.new_password) acc.password = patch.new_password;
    return { ok: true, data: customerProfile(acc.phone) };
  },

  // FE-014 mock P3 (nối BE-009 `customer:pass-request` + `passes:confirm`):
  // đăng ký trước — trả tiền tại quầy. Vé mới luôn 'pending' (KHÔNG miễn phí
  // check-in — mock check-out không đọc pass nên mặc định đúng).
  async requestPass(input: CustomerPassRequestInput): Promise<ApiResult<MonthlyPass>> {
    await delay(500);
    if (!currentCustomerPhone) return { ok: false, error: 'Chưa đăng nhập' };
    const acc = customerAccounts.find((c) => c.phone === currentCustomerPhone);
    if (!acc) return { ok: false, error: 'Chưa đăng nhập' };
    const vehicle = customerVehicleSeeds.find((v) => v.id === input.vehicle_id && v.phone === currentCustomerPhone);
    if (!vehicle) return { ok: false, error: 'Xe không thuộc tài khoản của bạn — vui lòng ra quầy' };
    const zoneId = input.zone_id ?? null;
    let zone: ParkingZone | undefined;
    if (zoneId !== null) {
      zone = zones.find((z) => z.id === zoneId);
      if (!zone || zone.is_active !== 1) return { ok: false, error: 'Khu vực không hợp lệ' };
      if (zone.vehicle_type_allowed !== 'both' && zone.vehicle_type_allowed !== vehicle.vehicle_type) {
        return { ok: false, error: `Khu ${zone.code} không nhận loại xe này.` };
      }
    }
    const months = input.package_months;
    if (months !== 1 && months !== 3 && months !== 6 && months !== 12) {
      return { ok: false, error: 'Gói vé không hợp lệ' };
    }
    const start = input.start_date ?? todayLocal();
    const end = addMonths(start, months);
    // Chống trùng vé pending/active overlap cùng xe + scope zone (mirror BE-009).
    const clash = passes.find((p) => {
      if (p.vehicle_id !== vehicle.id || (p.status !== 'pending' && p.status !== 'active')) return false;
      if (!(p.end_date >= start && p.start_date <= end)) return false;
      if (p.zone_id === null || zoneId === null || p.zone_id === zoneId) return true;
      return false;
    });
    if (clash) return { ok: false, error: `Xe này đã có vé ${clash.pass_code} còn hiệu lực/chờ xác nhận` };
    // Giá = công thức staff: zone → price_per_day×30, all-zone → 300k, 12T −10%.
    const base = zone ? zone.price_per_day * 30 : 300000;
    const price = months === 12 ? Math.round(base * months * 0.9) : base * months;
    const pass: MonthlyPass = {
      id: 1000 + passes.length,
      pass_code: `MT-2026-${String(300 + passes.length).padStart(4, '0')}`,
      vehicle_id: vehicle.id,
      zone_id: zoneId,
      customer_name: acc.fullName,
      customer_phone: acc.phone,
      start_date: start,
      end_date: end,
      price,
      status: 'pending',
      created_by: acc.userId,
      created_at: '2026-10-22 10:00:00',
      updated_at: '2026-10-22 10:00:00',
    };
    passes.push(pass);
    passPlates[pass.pass_code] = vehicle.license_plate;
    saveMyPassRequest(pass);
    return { ok: true, data: pass };
  },

  // FE-014 mock `passes:confirm` (staff duyệt pending): approve → active
  // (+ thu tiền tại quầy, mock không persist payment — cùng quy ước BE-009
  // chỉ trả pass), reject → cancelled (reason echo ở message gọi).
  async confirmPass(input: PassConfirmInput): Promise<ApiResult<MonthlyPass>> {
    await delay(400);
    // FE-020 S4: guard pass_sale (mirror BE-014 passes:confirm → pass_sale).
    const deniedConfirm = mockRequirePerm(currentStaffId, 'pass_sale');
    if (deniedConfirm) return { ok: false, error: deniedConfirm };
    const idx = passes.findIndex((p) => p.pass_code === input.pass_code);
    if (idx === -1) return { ok: false, error: 'Không tìm thấy vé' };
    const p = passes[idx];
    if (p.status !== 'pending') return { ok: false, error: `Vé ${p.pass_code} không ở trạng thái chờ xác nhận` };
    const next: MonthlyPass = {
      ...p,
      status: input.action === 'approve' ? 'active' : 'cancelled',
      updated_at: '2026-10-22 10:00:00',
    };
    passes.splice(idx, 1, next);
    removeMyPassRequest(p.pass_code);
    return { ok: true, data: next };
  },

  // FE-014 mock: vé pending của chính mình (badge "Chờ xác nhận").
  async myPendingPasses(): Promise<ApiResult<MonthlyPass[]>> {
    await delay(200);
    if (!currentCustomerPhone) return { ok: false, error: 'Chưa đăng nhập' };
    return {
      ok: true,
      data: passes.filter((p) => p.customer_phone === currentCustomerPhone && p.status === 'pending'),
    };
  },
  // FE-013 mock P2: vehicles by owner_phone = my phone (BE-008 shape).
  async customerVehicles() {
    await delay(350);
    if (!currentCustomerPhone) return { ok: false, error: 'Chưa đăng nhập' };
    const vehicles = customerVehicleSeeds
      .filter((v) => v.phone === currentCustomerPhone)
      .map(({ phone: _phone, ...v }) => v);
    return { ok: true, data: { vehicles, total_spent: vehicles.reduce((s, v) => s + v.total_spent, 0) } };
  },

  // FE-013 mock P2: session history mine-only (BE-008 shape: filter
  // from/to/search + limit/offset/total + total_spent completed-only).
  async customerSessions(input: CustomerSessionsInput) {
    await delay(350);
    if (!currentCustomerPhone) return { ok: false, error: 'Chưa đăng nhập' };
    const q = (input.search ?? '').trim().toUpperCase();
    const filtered = customerSessionSeeds.filter((r) => {
      if (r.phone !== currentCustomerPhone) return false;
      const day = r.check_in_at.slice(0, 10);
      if (input.from && day < input.from) return false;
      if (input.to && day > input.to) return false;
      if (q && !(r.ticket_code.toUpperCase().includes(q) || r.license_plate.toUpperCase().includes(q))) return false;
      return true;
    });
    const limit = Math.min(input.limit ?? 20, 100);
    const offset = input.offset ?? 0;
    const rows = filtered.slice(offset, offset + limit).map(({ phone: _phone, ...r }) => r);
    const total_spent = filtered.reduce((s, r) => s + (r.check_out_at !== null ? (r.total_fee ?? 0) : 0), 0);
    return { ok: true, data: { rows, total: filtered.length, total_spent } };
  },

  // FE-016 mock P4: giữ chỗ trong ngày (mirror BE-011 validation).
  async reserve(input: CustomerReserveInput): Promise<ApiResult<Reservation>> {
    await delay(500);
    if (!currentCustomerPhone) return { ok: false, error: 'Chưa đăng nhập' };
    const plate = (input.license_plate ?? '').trim().toUpperCase();
    if (plate.length < 4) {
      return { ok: false, error: 'Biển số chưa đúng — VD: 51H-12345.', fields: { license_plate: 'Biển số chưa đúng — VD: 51H-12345.' } };
    }
    const zone = zones.find((z) => z.id === input.zone_id);
    if (!zone || zone.is_active !== 1) return { ok: false, error: 'Khu vực không hợp lệ' };
    const pending = reservations.filter((r) => r.customer_phone === currentCustomerPhone && r.status === 'pending');
    if (pending.length >= 2) return { ok: false, error: 'Bạn đã có 2 chỗ đang giữ.' };
    const av = availability().find((a) => a.zone_id === input.zone_id);
    const heldHere = pending.filter((r) => r.zone_id === input.zone_id).length;
    if ((av?.free_spots ?? 0) - heldHere <= 0) {
      return { ok: false, error: `Khu ${zone.code} vừa hết chỗ giữ — chọn khu khác.` };
    }
    const start = input.start_time ?? input.time_from ?? '';
    const end = input.end_time ?? input.time_to ?? '';
    if (!/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end)) {
      return { ok: false, error: 'Vui lòng chọn giờ bắt đầu và kết thúc.' };
    }
    if (start === end) {
      return { ok: false, error: 'Giờ kết thúc phải sau giờ bắt đầu.' };
    }
    // 24/24 (BE-019): mọi giờ đều được, end <= start = qua đêm.
    const rawDur = toMinutes(end) - toMinutes(start);
    const dur = rawDur > 0 ? rawDur : rawDur + 24 * 60;
    if (dur < 15 || dur > 240) {
      return { ok: false, error: 'Mỗi lượt giữ chỗ từ 15 phút đến 4 giờ.' };
    }
    const day = todayLocal();
    const code = `R-${day.replace(/-/g, '')}-${String(reservationSeq++).padStart(4, '0')}`;
    // expires_at = giờ kết thúc + 20p, tự tràn ngày khi qua đêm (mirror BE-019).
    const exp = new Date(`${day}T${start}:00`);
    exp.setMinutes(exp.getMinutes() + (rawDur > 0 ? rawDur : rawDur + 24 * 60) + 20);
    const p = (n: number): string => String(n).padStart(2, '0');
    const expDay = `${exp.getFullYear()}-${p(exp.getMonth() + 1)}-${p(exp.getDate())}`;
    const row: Reservation = {
      id: 2000 + reservations.length,
      code,
      user_id: customerAccounts.find((c) => c.phone === currentCustomerPhone)?.userId ?? 0,
      vehicle_id: null,
      license_plate: plate,
      customer_phone: currentCustomerPhone,
      zone_id: input.zone_id,
      spot_id: null,
      date: day,
      start_time: start,
      end_time: end,
      status: 'pending',
      expires_at: `${expDay} ${p(exp.getHours())}:${p(exp.getMinutes())}:00`,
      created_at: `${day} 10:00:00`,
      updated_at: `${day} 10:00:00`,
    };
    reservations.push(row);
    return { ok: true, data: row };
  },

  async myReservations(input: CustomerReservationsInput) {
    await delay(250);
    if (!currentCustomerPhone) return { ok: false, error: 'Chưa đăng nhập' };
    const filtered = reservations
      .filter((r) => r.customer_phone === currentCustomerPhone && (!input.status || r.status === input.status))
      .sort((a, b) => (a.start_time < b.start_time ? -1 : a.start_time > b.start_time ? 1 : 0));
    const limit = Math.min(input.limit ?? 20, 100);
    const offset = input.offset ?? 0;
    return { ok: true, data: { rows: filtered.slice(offset, offset + limit).map(reservationRow), total: filtered.length } };
  },

  async cancelReservation(code: string) {
    await delay(300);
    if (!currentCustomerPhone) return { ok: false, error: 'Chưa đăng nhập' };
    const idx = reservations.findIndex((r) => r.code === code && r.customer_phone === currentCustomerPhone);
    if (idx === -1) return { ok: false, error: 'Không tìm thấy vé giữ chỗ' };
    if (reservations[idx].status !== 'pending') return { ok: false, error: 'Vé giữ chỗ này không còn hiệu lực' };
    reservations.splice(idx, 1, { ...reservations[idx], status: 'cancelled' });
    return { ok: true, data: reservations[idx] };
  },

  // FE-019 S3 mock 6 IPC ca + chấm công (mirror BE-013 — xem comment
  // khối shifts/attendance phía trên). Pages KHÔNG gửi staff_id — mock ép
  // me = currentStaffId (set lúc mock login), listAttendance tôn trọng
  // staff_id param (staff truyền userId của mình, admin truyền filter).
  async listShifts() {
    await delay(200);
    return { ok: true, data: [...shifts] };
  },

  async updateShift(id, patch) {
    await delay(300);
    const idx = shifts.findIndex((s) => s.id === id);
    if (idx === -1) return { ok: false, error: 'Không tìm thấy ca' };
    if (patch.start_time !== undefined && !/^\d{2}:\d{2}$/.test(patch.start_time)) {
      return { ok: false, error: 'Giờ bắt đầu chưa đúng (HH:mm).' };
    }
    if (patch.end_time !== undefined && !/^\d{2}:\d{2}$/.test(patch.end_time)) {
      return { ok: false, error: 'Giờ kết thúc chưa đúng (HH:mm).' };
    }
    const next: Shift = {
      ...shifts[idx],
      ...(patch.name !== undefined ? { name: patch.name.trim() || shifts[idx].name } : {}),
      ...(patch.start_time !== undefined ? { start_time: patch.start_time } : {}),
      ...(patch.end_time !== undefined ? { end_time: patch.end_time } : {}),
      ...(patch.is_active !== undefined ? { is_active: patch.is_active } : {}),
      updated_at: mockNowStamp(),
    };
    if (next.start_time === next.end_time) return { ok: false, error: 'Giờ bắt đầu phải khác giờ kết thúc.' };
    shifts[idx] = next;
    // Overlap Warning backend trả trong message (ApiResult không có kênh
    // message) — page tự tính Warning client-side, mock chỉ lưu.
    return { ok: true, data: next };
  },

  async attendanceToday() {
    await delay(250);
    const me = currentStaffId ?? 2;
    const today = todayLocal();
    const t = mockNowHHMM();
    const shift = mockResolveShift(t);
    const workDate = mockWorkDate(shift, today, t);
    const mine = attendance.filter((a) => a.user_id === me);
    const current = mine.find((a) => a.shift_id === shift.id && a.work_date === workDate) ?? null;
    const pending = mine
      .filter((a) => a.check_out_at === null && a.id !== current?.id)
      .sort((x, y) => (x.work_date < y.work_date ? -1 : x.work_date > y.work_date ? 1 : x.id - y.id))[0] ?? null;
    return { ok: true, data: { shift, work_date: workDate, attendance: current, pending_close: pending } };
  },

  async checkInShift(input: AttendanceCheckInInput) {
    await delay(400);
    const me = currentStaffId ?? 2; // ép me — staff_id gửi kèm bị bỏ qua
    const shift = (input.shift_id !== undefined ? shifts.find((s) => s.id === input.shift_id) : undefined)
      ?? (input.shift_code ? shifts.find((s) => s.code === input.shift_code) : undefined)
      ?? mockResolveShift(mockNowHHMM());
    if (!shift) return { ok: false, error: 'Không tìm thấy ca' };
    if (shift.is_active !== 1) return { ok: false, error: `Ca ${shift.name} đã tắt — không xếp ca mới` };
    const wd = mockWorkDate(shift, todayLocal(), mockNowHHMM());
    if (attendance.some((a) => a.user_id === me && a.shift_id === shift.id && a.work_date === wd)) {
      return { ok: false, error: 'Bạn đã vào ca này.' };
    }
    const cash = input.opening_cash ?? 0;
    if (!Number.isInteger(cash) || cash < 0) return { ok: false, error: 'Tiền đầu ca phải là số nguyên ≥ 0.' };
    const stamp = mockNowStamp();
    const row: Attendance = {
      id: attendanceSeq++, user_id: me, shift_id: shift.id, work_date: wd,
      check_in_at: stamp, check_out_at: null,
      opening_cash: cash, closing_cash: null, handover_note: null,
      status: mockLateMinutes(shift, stamp) > 10 ? 'late' : 'present',
      created_at: stamp, updated_at: stamp,
    };
    attendance.push(row);
    return { ok: true, data: row };
  },

  async checkOutShift(input: AttendanceCheckOutInput) {
    await delay(400);
    const me = currentStaffId ?? 2; // ép me — staff_id gửi kèm bị bỏ qua
    const open = attendance
      .filter((a) => a.user_id === me && a.check_out_at === null)
      .sort((x, y) => (x.work_date < y.work_date ? -1 : x.work_date > y.work_date ? 1 : x.id - y.id));
    const row = open[0];
    if (!row) return { ok: false, error: 'Bạn chưa vào ca — bấm "Vào ca" trước' };
    const stamp = mockNowStamp();
    if (stamp <= (row.check_in_at ?? '')) return { ok: false, error: 'Vừa bấm vào ca — thử lại sau ít giây' };
    const closing = input.closing_cash ?? null;
    if (closing !== null && (!Number.isInteger(closing) || closing < 0)) {
      return { ok: false, error: 'Tiền cuối ca phải là số nguyên ≥ 0.' };
    }
    const rawNote = input.handover_note;
    if (rawNote !== undefined && rawNote !== null && rawNote.trim().length > 500) {
      return { ok: false, error: 'Ghi chú bàn giao tối đa 500 ký tự.' };
    }
    row.check_out_at = stamp;
    row.closing_cash = closing;
    if (rawNote !== undefined) row.handover_note = rawNote === null || rawNote.trim() === '' ? null : rawNote.trim();
    row.updated_at = stamp;
    // Mock không có payments → revenue = 0, variance = closing − opening.
    const revenue = 0;
    const variance = closing === null ? null : closing - row.opening_cash - revenue;
    return { ok: true, data: { attendance: { ...row }, revenue_in_shift: revenue, variance } };
  },

  async listAttendance(input: AttendanceListInput) {
    await delay(350);
    if (input.from && !/^\d{4}-\d{2}-\d{2}$/.test(input.from)) return { ok: false, error: 'Ngày bắt đầu chưa đúng.' };
    if (input.to && !/^\d{4}-\d{2}-\d{2}$/.test(input.to)) return { ok: false, error: 'Ngày kết thúc chưa đúng.' };
    if (input.from && input.to && input.from > input.to) return { ok: false, error: 'Khoảng ngày chưa đúng.' };
    const filtered = attendance.filter((a) => {
      if (input.staff_id !== undefined && a.user_id !== input.staff_id) return false;
      if (input.from && a.work_date < input.from) return false;
      if (input.to && a.work_date > input.to) return false;
      return true;
    });
    const sorted = [...filtered].sort((a, b) =>
      (a.work_date > b.work_date ? -1 : a.work_date < b.work_date ? 1 : b.id - a.id));
    const limit = Math.min(input.limit ?? 50, 200);
    const offset = input.offset ?? 0;
    return { ok: true, data: { rows: sorted.slice(offset, offset + limit).map(mockAttendanceRow), total: sorted.length } };
  },

  async recentActivity(limit): Promise<ApiResult<Array<{ id: number; text: string; at: string }>>> {
    await delay(300);
    const rows = [
      { id: 1, text: 'Check-in 51H-12345 tại Khu A', at: '2026-10-16 08:12:00' },
      { id: 2, text: 'Thu phí 60.000 ₫ — vé T-20261016-0031', at: '2026-10-16 08:05:00' },
      { id: 3, text: 'Gia hạn vé MT-2026-0001 (+1 tháng)', at: '2026-10-16 07:50:00' },
      { id: 4, text: 'Check-out 59A1-67890 tại Khu B', at: '2026-10-16 07:32:00' },
    ];
    return { ok: true, data: rows.slice(0, limit) };
  },

  // Mock `activity:list` — mirrors BE-006 UNION shape (check_in / check_out /
  // pass_sale), server-side filter + sort at DESC + limit/offset + total.
  async listActivity(input: ActivityListInput): Promise<ApiResult<{ rows: ActivityRow[]; total: number }>> {
    await delay(350);
    // FE-020 S4: guard report_self (mirror BE-014 activity:list → report_self).
    const deniedAct = mockRequirePerm(currentStaffId, 'report_self');
    if (deniedAct) return { ok: false, error: deniedAct };
    const q = (input.search ?? '').trim().toUpperCase();
    const filtered = activitySeed.filter((r) => {
      if (input.staff_id !== undefined && r.user_id !== input.staff_id) return false;
      const day = r.at.slice(0, 10);
      if (input.from && day < input.from) return false;
      if (input.to && day > input.to) return false;
      if (input.action && r.action !== input.action) return false;
      if (q && !((r.ticket_code ?? '').toUpperCase().includes(q) || (r.license_plate ?? '').toUpperCase().includes(q))) return false;
      return true;
    });
    // Backend ORDER BY at DESC — no sort param in the contract (V1).
    // FE-018 S2: trần 5000 (trần xuất DS-007 §5) để tab Hiệu suất aggregate
    // client-side trên cùng 1 request (backend thật có thể giới hạn thấp hơn —
    // component hiển thị note khi total > rows trả về).
    const sorted = [...filtered].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
    const limit = Math.min(input.limit ?? 20, 5000);
    const offset = input.offset ?? 0;
    return { ok: true, data: { rows: sorted.slice(offset, offset + limit), total: sorted.length } };
  },

  // FE-021 M1 mock `reports:transactions` (mirror BE-015): deterministic seed
  // ~180 rows across Oct 2026 (casual/monthly/adjust × zones A/B/C × 4
  // methods × staff/admin), filter ngày/zone/kind/method/search + ORDER BY
  // paid_at DESC + limit default 50/max 200 + summary SUM/COUNT cùng filter.
  async listTransactions(input: TxListInput) {
    await delay(350);
    const deniedTx = mockRequirePerm(currentStaffId, 'report_self');
    if (deniedTx) return { ok: false, error: deniedTx };
    if (input.from && input.to && input.from > input.to) {
      return { ok: false, error: 'Ngày bắt đầu phải ≤ ngày kết thúc.' };
    }
    const q = (input.search ?? '').trim().toUpperCase();
    const zoneIds = input.zone_ids ?? [];
    const filtered = txSeed.filter((r) => {
      const day = r.paid_at.slice(0, 10);
      if (input.from && day < input.from) return false;
      if (input.to && day > input.to) return false;
      if (zoneIds.length > 0 && !zoneIds.includes(zoneIdOf(r.zone_code))) return false;
      if (input.kind && r.kind !== input.kind) return false;
      if (input.payment_method && r.payment_method !== input.payment_method) return false;
      if (q && !((r.ticket_code ?? '').toUpperCase().includes(q) || (r.license_plate ?? '').toUpperCase().includes(q))) return false;
      return true;
    });
    const sorted = [...filtered].sort((a, b) =>
      (a.paid_at < b.paid_at ? 1 : a.paid_at > b.paid_at ? -1 : b.payment_id - a.payment_id));
    const limit = Math.min(input.limit ?? 50, 200);
    const offset = input.offset ?? 0;
    const revenue = filtered.reduce((s, r) => s + r.amount, 0);
    return {
      ok: true,
      data: {
        rows: sorted.slice(offset, offset + limit),
        total: sorted.length,
        summary: { revenue, tx_count: sorted.length, avg: sorted.length === 0 ? 0 : revenue / sorted.length },
      },
    };
  },

  // FE-021 M2 mock `app-config:get/set` (mirror BE-015): settings JSON cạnh DB
  // → mock giữ trong memory + validate như backend (INVALID_PHONE /
  // LOGO_TOO_LARGE / INVALID_FEE_RULE + cross-rule threshold×60 > grace).
  async getAppConfig() {
    await delay(200);
    return { ok: true, data: { ...mockSettings } };
  },

  async setAppConfig(patch: AppConfigSetInput['patch']) {
    await delay(300);
    const next: ParkingSettings = { ...mockSettings };
    if (patch.lot_name !== undefined) {
      const name = patch.lot_name.trim();
      if (!name || name.length > 100) {
        return { ok: false, error: 'Tên bãi 1–100 ký tự.', fields: { lot_name: 'Tên bãi 1–100 ký tự.' } };
      }
      next.lot_name = name;
    }
    if (patch.address !== undefined) {
      const raw = (patch.address ?? '').trim();
      if (raw.length > 255) {
        return { ok: false, error: 'Địa chỉ tối đa 255 ký tự.', fields: { address: 'Địa chỉ tối đa 255 ký tự.' } };
      }
      next.address = raw === '' ? null : raw;
    }
    if (patch.phone !== undefined) {
      const raw = (patch.phone ?? '').trim();
      if (raw !== '' && !/^0\d{9}$/.test(raw)) {
        return { ok: false, error: 'Số điện thoại chưa đúng — VD 0901234567.', fields: { phone: 'Số điện thoại chưa đúng — VD 0901234567.' } };
      }
      next.phone = raw === '' ? null : raw;
    }
    if (patch.logo_data_url !== undefined) {
      const raw = patch.logo_data_url;
      if (raw !== null) {
        const okType = raw.startsWith('data:image/png;') || raw.startsWith('data:image/jpeg;');
        if (!okType) return { ok: false, error: 'Logo chỉ nhận PNG/JPG.' };
        if (raw.length > 512 * 1024) {
          return { ok: false, error: 'Logo quá 512KB — nén ảnh trước khi tải lên.', fields: { logo_data_url: 'Logo quá 512KB.' } };
        }
      }
      next.logo_data_url = raw;
    }
    if (patch.fee_grace_minutes !== undefined) {
      const g = patch.fee_grace_minutes;
      if (!Number.isInteger(g) || g < 0 || g > 120) {
        return { ok: false, error: 'Miễn/tối thiểu 0–120 phút.', fields: { fee_grace_minutes: 'Miễn/tối thiểu 0–120 phút.' } };
      }
      next.fee_grace_minutes = g;
    }
    if (patch.fee_day_threshold_hours !== undefined) {
      const t = patch.fee_day_threshold_hours;
      if (!Number.isInteger(t) || t < 1 || t > 24) {
        return { ok: false, error: 'Ngưỡng ngày 1–24 giờ.', fields: { fee_day_threshold_hours: 'Ngưỡng ngày 1–24 giờ.' } };
      }
      next.fee_day_threshold_hours = t;
    }
    if (next.fee_day_threshold_hours * 60 <= next.fee_grace_minutes) {
      return { ok: false, error: 'Ngưỡng ngày phải lớn hơn thời gian tối thiểu.' };
    }
    // FE-022 mock `pb_url`/`pb_parking_lot` (mirror BE-016/BE-017 validate):
    // URL http(s) + host có dấu chấm, ≤500 ký tự, strip trailing slash,
    // rỗng/null → local-only; lot ID [A-Za-z0-9_-]{1,100}, rỗng/null → null.
    if (patch.pb_url !== undefined) {
      if (patch.pb_url === null) {
        next.pb_url = null;
      } else {
        const t = patch.pb_url.trim().replace(/\/+$/, '');
        if (!t) {
          next.pb_url = null;
        } else if (t.length > 500 || !/^https?:\/\/.+\..+/.test(t)) {
          return { ok: false, error: 'Địa chỉ máy chủ phải bắt đầu bằng http(s)://.', fields: { pb_url: 'Địa chỉ máy chủ phải bắt đầu bằng http(s)://.' } };
        } else {
          next.pb_url = t;
        }
      }
    }
    if (patch.pb_parking_lot !== undefined) {
      if (patch.pb_parking_lot === null) {
        next.pb_parking_lot = null;
      } else {
        const t = patch.pb_parking_lot.trim();
        if (!t) {
          next.pb_parking_lot = null;
        } else if (t.length > 100 || !/^[A-Za-z0-9_-]+$/.test(t)) {
          return { ok: false, error: 'Mã bãi chỉ gồm chữ/số/gạch (tối đa 100 ký tự).', fields: { pb_parking_lot: 'Mã bãi chỉ gồm chữ/số/gạch (tối đa 100 ký tự).' } };
        } else {
          next.pb_parking_lot = t;
        }
      }
    }
    next.updated_at = mockNowStamp().replace(' ', 'T') + 'Z';
    mockSettings = next;
    return { ok: true, data: { ...next } };
  },

  // FE-022 mock `pb:status` + `pb:test` (mirror BE-016/BE-017).
  // Browser dev không ping được server thật → status luôn local-only
  // (online:false); test chỉ validate định dạng URL, không lưu.
  async pbStatus() {
    await delay(200);
    return {
      ok: true,
      data: {
        online: false,
        mode: 'local-first' as const,
        pb_url: mockSettings.pb_url ?? '',
        latency_ms: null,
        parking_lot: mockSettings.pb_parking_lot,
      },
    };
  },

  async testPbConnection(url?: string) {
    await delay(600);
    const target = (url ?? mockSettings.pb_url ?? '').trim().replace(/\/+$/, '');
    if (!target || target.length > 500 || !/^https?:\/\/.+\..+/.test(target)) {
      return { ok: true, data: { reachable: false, pb_url: target, latency_ms: null } };
    }
    return { ok: true, data: { reachable: true, pb_url: target, latency_ms: 180 } };
  },

  // FE-021 M3 mock `backup:now` (mirror BE-015): trả path + size giả
  // (browser dev không có file thật — backend thật mở save-dialog ở main).
  async backupNow() {
    await delay(800);
    const stamp = mockNowStamp().replace(/[-: ]/g, '').slice(0, 12);
    const out: BackupNowOutput = {
      path: `parking-${stamp}.db`,
      size_bytes: 245760,
      backed_up_at: mockNowStamp(),
    };
    return { ok: true, data: out };
  },

  // FE-021 M3 mock `restore:from-file` (mirror BE-015): chặn khi còn xe đỗ
  // (HAS_PARKED_VEHICLES, guard qua sessions parked) → needRestart: true.
  // Browser dev không có file thật — backend thật mở open-dialog ở main.
  async restoreFromFile() {
    await delay(800);
    if (sessions.some((s) => s.status === 'parked')) {
      return { ok: false, error: 'Còn xe đang đỗ — check-out hết trước khi khôi phục.' };
    }
    const out: RestoreFromFileOutput = {
      backup_path: `parking-pre-restore-${Date.now()}.db`,
      restored_at: mockNowStamp(),
      needRestart: true,
    };
    return { ok: true, data: out };
  },

  // FE-025 mock `notify:test` (mirror BE-021): dry-run trả 4 item demo
  // (E1 vé MT-2026-0001 D-3, E2 mã giữ chỗ demo, E3 khu A đầy, E4 ca treo);
  // có `sample` → dispatch CustomEvent deep-link để bản web/vite QA
  // điều hướng + highlight như click Toast thật trong Electron.
  async testNotify(sample?: NotifyEvent) {
    await delay(400);
    const fired = [
      { event: 'E1' as const, title: 'Vé tháng sắp hết hạn', entity: 'MT-2026-0001', mode: 'toast' as const },
      { event: 'E2' as const, title: 'Sắp tới giờ giữ chỗ', entity: 'R-20261024-0001', mode: 'toast' as const },
      { event: 'E3' as const, title: 'Khu A vừa đầy', entity: 'A', mode: 'toast' as const },
      { event: 'E4' as const, title: 'Bạn chưa chốt ca Ca chiều', entity: '101', mode: 'toast' as const },
    ];
    if (sample) {
      const link: NotifyDeepLink =
        sample === 'E1' ? { event: 'E1', tab: 'passes', pass_code: 'MT-2026-0001' }
        : sample === 'E2' ? { event: 'E2', tab: 'reservations', code: 'R-20261024-0001' }
        : sample === 'E3' ? { event: 'E3', tab: 'map', zone_code: 'A' }
        : { event: 'E4', tab: 'attendance', attendance_id: 101 };
      dispatchNotifyDeepLink(link);
      return { ok: true, data: { quiet: false, fired: fired.filter((f) => f.event === sample), deferred: [] } };
    }
    return { ok: true, data: { quiet: false, fired, deferred: [] } };
  },
};

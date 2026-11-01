-- ============================================================================
-- Parking Management — SQLite schema (Electron + better-sqlite3, file: parking.db)
-- ----------------------------------------------------------------------------
-- Conventions:
--   * PK: INTEGER PRIMARY KEY AUTOINCREMENT
--   * Datetime: TEXT in ISO8601 UTC ("YYYY-MM-DD HH:MM:SS"), default datetime('now')
--   * Money: INTEGER in VND (no decimals — avoids REAL rounding errors)
--   * Booleans: INTEGER 0/1 with CHECK
--   * Enable FK enforcement on every connection: PRAGMA foreign_keys = ON;
--   * WAL mode recommended for Electron: PRAGMA journal_mode = WAL;
--   * Version history (gộp trực tiếp vào schema cho DB mới; DB cũ chạy migration
--     tương ứng trong specs/migration-*.sql):
--     - v001: schema gốc (roles admin/staff/guest, users chưa có phone).
--     - v002 (migration-002-customer): roles CHECK + 'customer' (+ role row id=4),
--       users.phone TEXT + UNIQUE INDEX idx_users_phone (NULL distinct).
--     - v003 (migration-003-pass-pending): monthly_passes.status CHECK
--       + 'pending' (P3 customer tự đăng ký → pending, staff thu tiền → active).
--     - v004 (migration-004-reservations): bảng mới `reservations` (P4 đặt chỗ
--       trong ngày, khung 1–4h, mã R-YYYYMMDD-####, status
--       pending/active/completed/cancelled/expired).
--     - v005 (migration-005-staff-profile): users + 3 cột NULLABLE `address`,
--       `start_date` (YYYY-MM-DD), `notes` (hồ sơ NV S1 staff-area.md;
--       tương thích ngược, không backfill; phone đã có từ v002).
--     - v006 (migration-006-shifts): 2 bảng mới `shifts` (3 ca seed
--       MORNING 06:00–14:00 / AFTERNOON 14:00–22:00 / NIGHT 22:00–06:00+1,
--       work_date = ngày bắt đầu ca) + `attendance` (1 NV × 1 ca × 1 ngày
--       1 row, gộp chấm công + tiền đầu/cuối + bàn giao, đối soát lệch
--       Warning không chặn; staff-area.md S3).
--     - v007 (migration-007-permissions): users + 1 cột NULLABLE
--       `permissions` TEXT (JSON 5 flags S4 staff-area.md:
--       checkin/pass_sale/report_self/profile_self/reservation, 0|1;
--       NULL = full staff cũ, tương thích ngược, không backfill).
-- ============================================================================

PRAGMA foreign_keys = ON;

-- ----------------------------------------------------------------------------
-- 1. roles — admin / staff / guest (read-only) / customer (tự đăng ký bằng SĐT)
--    v002: CHECK thêm 'customer'. DB mới nhận sẵn role row id=4 bên dưới;
--    DB cũ lấy qua specs/migration-002-customer.sql (STEP 1 + STEP 2).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS roles (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL UNIQUE CHECK (name IN ('admin', 'staff', 'guest', 'customer')),
  description TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- v002: role tham chiếu cho users customer trên DB mới (fresh install).
-- Id 4 cố định để khớp quy ước seed 1/2/3; chạy lại không trùng (DO NOTHING).
-- App resolve role_id bằng name ('customer'), không hardcode id.
INSERT INTO roles (id, name, description) VALUES
  (4, 'customer', 'Tự đăng ký bằng SĐT: username = SĐT, đăng nhập như user thường')
ON CONFLICT DO NOTHING;

-- ----------------------------------------------------------------------------
-- 2. users — nhân sự hệ thống + khách tự đăng ký. Guest KHÔNG cần row (read-only).
--    v002: + phone (khách bắt buộc duy nhất ở tầng app; staff/admin cũ NULL được).
--    v005: + address/start_date/notes NULLABLE (hồ sơ NV S1; staff cũ NULL được,
--      UI hiện "—"; format/limit validate ở app, DB giữ TEXT thuần).
--    v007: + permissions TEXT NULL (JSON 5 flags S4: checkin/pass_sale/
--      report_self/profile_self/reservation 0|1; NULL = full staff cũ;
--      parse + whitelist + normalize ở app, DB giữ TEXT thuần).
--    Quy ước customer: username = SĐT (login-by-username hiện có, không sửa login),
--    full_name = họ tên, role_id -> roles('customer').
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE CHECK (length(username) >= 3),
  password_hash TEXT NOT NULL, -- bcrypt hash. NEVER plaintext.
  full_name     TEXT NOT NULL DEFAULT '',
  phone         TEXT, -- v002: SĐT (UNIQUE qua idx_users_phone; NULL cho staff/admin cũ)
  address       TEXT, -- v005 S1: địa chỉ, optional, max 255 ở app
  start_date    TEXT, -- v005 S1: ngày vào làm 'YYYY-MM-DD', optional, <= today ở app
  notes         TEXT, -- v005 S1: ghi chú nội bộ, optional, max 500 ở app, admin-only
  permissions   TEXT, -- v007 S4: JSON 5 flags per-user, NULL = full staff cũ
  role_id       INTEGER NOT NULL REFERENCES roles(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  is_active     INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ----------------------------------------------------------------------------
-- 3. parking_zones — khu vực đỗ xe (full config: sức chứa, loại xe, giá, on/off)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS parking_zones (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  code                 TEXT NOT NULL UNIQUE CHECK (length(code) <= 10), -- vd: 'A','B','C'
  name                 TEXT NOT NULL,                                   -- vd: 'Khu A - O to'
  vehicle_type_allowed TEXT NOT NULL CHECK (vehicle_type_allowed IN ('car', 'motorbike', 'both')),
  capacity             INTEGER NOT NULL CHECK (capacity > 0 AND capacity <= 2000), -- max 2000 theo spec UI (stepper)
  price_per_hour       INTEGER NOT NULL CHECK (price_per_hour >= 0),    -- VND
  price_per_day        INTEGER NOT NULL CHECK (price_per_day >= 0),     -- VND (áp khi >= 12h hoặc qua ngày, do app quyết)
  is_active            INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ----------------------------------------------------------------------------
-- 4. parking_spots — chỗ đỗ vật lý trong zone. Cặp (zone_id, spot_number) duy nhất.
--    status do app cập nhật khi check-in/out; KHÔNG dùng trigger ẩn.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS parking_spots (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  zone_id     INTEGER NOT NULL REFERENCES parking_zones(id) ON DELETE CASCADE ON UPDATE CASCADE,
  spot_number TEXT NOT NULL, -- vd: 'A-01'. Unique theo zone để dễ đánh lại số.
  status      TEXT NOT NULL DEFAULT 'available'
              CHECK (status IN ('available', 'occupied', 'reserved', 'maintenance')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (zone_id, spot_number)
);

-- ----------------------------------------------------------------------------
-- 5. vehicles — xe đã từng gửi (nhận diện bằng biển số). Không xóa cứng (lịch sử).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vehicles (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  license_plate TEXT NOT NULL UNIQUE CHECK (length(license_plate) >= 2), -- chuẩn hóa UPPERCASE ở app
  vehicle_type  TEXT NOT NULL CHECK (vehicle_type IN ('car', 'motorbike')),
  owner_name    TEXT NOT NULL DEFAULT '',
  owner_phone   TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ----------------------------------------------------------------------------
-- 6. monthly_passes — vé tháng gắn với 1 xe (+ zone cố định hoặc mọi zone).
--    v003: status CHECK thêm 'pending' (P3: khách tự đăng ký → pending;
--    staff xác nhận khi thu tiền tại quầy → active, hoặc → cancelled).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS monthly_passes (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  pass_code    TEXT NOT NULL UNIQUE, -- vd: 'MT-2026-0001', app tự sinh
  vehicle_id   INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  zone_id      INTEGER NULL REFERENCES parking_zones(id) ON DELETE SET NULL ON UPDATE CASCADE, -- NULL = mọi zone
  customer_name  TEXT NOT NULL CHECK (length(customer_name) >= 1),
  customer_phone TEXT NOT NULL DEFAULT '',
  start_date   TEXT NOT NULL, -- ISO8601 ngày bắt đầu (YYYY-MM-DD)
  end_date     TEXT NOT NULL, -- ISO8601 ngày kết thúc
  price        INTEGER NOT NULL CHECK (price >= 0), -- VND
  status       TEXT NOT NULL DEFAULT 'active'
               CHECK (status IN ('pending', 'active', 'expired', 'cancelled', 'suspended')),
  created_by   INTEGER NULL REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (end_date > start_date)
);

-- ----------------------------------------------------------------------------
-- 7. parking_sessions — vé/lượt gửi (check-in tạo row 'parked', check-out chốt phí).
--    Xe dùng vé tháng còn hiệu lực => total_fee = 0, monthly_pass_id trỏ sang pass.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS parking_sessions (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_code          TEXT NOT NULL UNIQUE, -- vd: 'T-20261016-0001', app tự sinh
  vehicle_id           INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  spot_id              INTEGER NULL REFERENCES parking_spots(id) ON DELETE SET NULL ON UPDATE CASCADE,
  zone_id              INTEGER NOT NULL REFERENCES parking_zones(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  monthly_pass_id      INTEGER NULL REFERENCES monthly_passes(id) ON DELETE SET NULL ON UPDATE CASCADE,
  check_in_at          TEXT NOT NULL DEFAULT (datetime('now')),
  check_out_at         TEXT NULL,
  status               TEXT NOT NULL DEFAULT 'parked'
                       CHECK (status IN ('parked', 'completed', 'cancelled')),
  hourly_rate_applied  INTEGER NOT NULL CHECK (hourly_rate_applied >= 0), -- snapshot giá zone tại check-in
  daily_rate_applied   INTEGER NOT NULL CHECK (daily_rate_applied >= 0),  -- snapshot giá zone tại check-in
  total_fee            INTEGER NULL CHECK (total_fee IS NULL OR total_fee >= 0), -- chốt khi check-out
  discount_amount      INTEGER NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  created_by           INTEGER NULL REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
  closed_by            INTEGER NULL REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (check_out_at IS NULL OR check_out_at > check_in_at),
  CHECK (status != 'parked' OR check_out_at IS NULL) -- xe đang đỗ thì chưa có giờ ra
);

-- ----------------------------------------------------------------------------
-- 8. payments — giao dịch thu phí (append-only: KHÔNG update/delete từ app).
--    Một session hoặc một vé tháng phải được trỏ tới (ít nhất 1 trong 2 NOT NULL).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payments (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id      INTEGER NULL REFERENCES parking_sessions(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  monthly_pass_id INTEGER NULL REFERENCES monthly_passes(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  amount          INTEGER NOT NULL CHECK (amount >= 0), -- VND thực thu
  payment_method  TEXT NOT NULL DEFAULT 'cash'
                  CHECK (payment_method IN ('cash', 'transfer', 'card', 'e_wallet')),
  paid_at         TEXT NOT NULL DEFAULT (datetime('now')),
  received_by     INTEGER NULL REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
  note            TEXT NOT NULL DEFAULT '',
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (session_id IS NOT NULL OR monthly_pass_id IS NOT NULL)
);

-- ----------------------------------------------------------------------------
-- 9. reservations — đặt chỗ trước của khách (P4 customer-area, V1 tối thiểu).
--    v004: bảng mới từ specs/migration-004-reservations.sql (DB cũ chạy file đó).
--    * Chỉ giữ chỗ trong ngày (date = today, backend ép); khung 1–4h, bãi
--      06:00–22:00 (CHECK DB). Quá ~20p không check-in → sweep job đánh expired.
--    * vehicle_id NULLABLE: đặt theo SĐT + biển số text khi xe chưa có trong
--      hệ thống; lúc check-in staff upsert vehicle rồi link sau.
--    * Quota ≤ 2 pending|active/customer: backend COUNT trước INSERT
--      (SQLite cấm subquery trong CHECK) — index idx_res_user_status_date.
--    * Luồng status: pending (giữ chỗ ≡ spec 'held') ──check-in──▶ active
--      ──dùng xong──▶ completed; quá expires_at ──sweep──▶ expired;
--      khách/staff hủy ──▶ cancelled.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reservations (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  code           TEXT NOT NULL UNIQUE
                 CHECK (code GLOB 'R-[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9]'),
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  vehicle_id     INTEGER NULL REFERENCES vehicles(id) ON DELETE SET NULL ON UPDATE CASCADE,
  license_plate  TEXT NOT NULL DEFAULT '',
  customer_phone TEXT NOT NULL DEFAULT '',
  zone_id        INTEGER NOT NULL REFERENCES parking_zones(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  spot_id        INTEGER NULL REFERENCES parking_spots(id) ON DELETE SET NULL ON UPDATE CASCADE,
  date           TEXT NOT NULL
                 CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  start_time     TEXT NOT NULL
                 CHECK (start_time GLOB '[0-9][0-9]:[0-9][0-9]'),
  end_time       TEXT NOT NULL
                 CHECK (end_time GLOB '[0-9][0-9]:[0-9][0-9]'),
  status         TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'active', 'completed', 'cancelled', 'expired')),
  expires_at     TEXT NOT NULL,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (end_time > start_time),
  CHECK (start_time >= '06:00' AND end_time <= '22:00'),
  CHECK (
    (strftime('%s', '2000-01-01 ' || end_time || ':00')
     - strftime('%s', '2000-01-01 ' || start_time || ':00'))
    BETWEEN 3600 AND 14400
  )
);

-- ============================================================================
-- INDEXES — phủ query patterns chính (join FK, filter status, báo cáo theo ngày)
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_users_role        ON users(role_id);
CREATE INDEX IF NOT EXISTS idx_users_active      ON users(is_active);
-- v002: SĐT duy nhất (NULL distinct: staff/admin cũ NULL được; customer bắt buộc ở app).
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone ON users(phone);

CREATE INDEX IF NOT EXISTS idx_zones_active      ON parking_zones(is_active);

CREATE INDEX IF NOT EXISTS idx_spots_zone        ON parking_spots(zone_id);
CREATE INDEX IF NOT EXISTS idx_spots_zone_status ON parking_spots(zone_id, status);

CREATE INDEX IF NOT EXISTS idx_vehicles_plate    ON vehicles(license_plate);
CREATE INDEX IF NOT EXISTS idx_vehicles_type     ON vehicles(vehicle_type);

CREATE INDEX IF NOT EXISTS idx_pass_vehicle      ON monthly_passes(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_pass_status       ON monthly_passes(status);
CREATE INDEX IF NOT EXISTS idx_pass_dates        ON monthly_passes(start_date, end_date);

CREATE INDEX IF NOT EXISTS idx_sessions_vehicle ON parking_sessions(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_sessions_zone    ON parking_sessions(zone_id);
CREATE INDEX IF NOT EXISTS idx_sessions_spot    ON parking_sessions(spot_id);
CREATE INDEX IF NOT EXISTS idx_sessions_status  ON parking_sessions(status);
CREATE INDEX IF NOT EXISTS idx_sessions_checkin ON parking_sessions(check_in_at);
CREATE INDEX IF NOT EXISTS idx_sessions_active  ON parking_sessions(status, check_in_at);
CREATE INDEX IF NOT EXISTS idx_sessions_ticket  ON parking_sessions(ticket_code);

CREATE INDEX IF NOT EXISTS idx_payments_session  ON payments(session_id);
CREATE INDEX IF NOT EXISTS idx_payments_pass     ON payments(monthly_pass_id);
CREATE INDEX IF NOT EXISTS idx_payments_paid_at  ON payments(paid_at);
CREATE INDEX IF NOT EXISTS idx_payments_method   ON payments(payment_method);

-- v004: quota/expired-sweep/capacity/link-xe cho reservations
-- (code UNIQUE đã có autoindex — đủ cho lookup check-in theo mã).
CREATE INDEX IF NOT EXISTS idx_res_user_status_date ON reservations(user_id, status, date);
CREATE INDEX IF NOT EXISTS idx_res_zone_date_status ON reservations(zone_id, date, status);
CREATE INDEX IF NOT EXISTS idx_res_status_expires   ON reservations(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_res_vehicle          ON reservations(vehicle_id);

-- ----------------------------------------------------------------------------
-- 10. shifts — định nghĩa ca (giờ cấu hình được, admin sửa qua shifts:update).
--     v006: bảng mới từ specs/migration-006-shifts.sql (DB cũ chạy file đó).
--     * end < start = ca qua ngày (chỉ NIGHT 22:00–06:00); DB chỉ ép start != end.
--     * Seed 3 ca (WHERE NOT EXISTS theo code — admin sửa giờ không bị ghi đè).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS shifts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  code        TEXT NOT NULL UNIQUE CHECK (code IN ('MORNING', 'AFTERNOON', 'NIGHT')),
  name        TEXT NOT NULL CHECK (length(name) >= 1),
  start_time  TEXT NOT NULL CHECK (start_time GLOB '[0-9][0-9]:[0-9][0-9]'),
  end_time    TEXT NOT NULL CHECK (end_time GLOB '[0-9][0-9]:[0-9][0-9]'),
  is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (start_time != end_time)
);

INSERT INTO shifts (code, name, start_time, end_time)
  SELECT 'MORNING', 'Ca sáng', '06:00', '14:00'
  WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE code = 'MORNING');

INSERT INTO shifts (code, name, start_time, end_time)
  SELECT 'AFTERNOON', 'Ca chiều', '14:00', '22:00'
  WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE code = 'AFTERNOON');

INSERT INTO shifts (code, name, start_time, end_time)
  SELECT 'NIGHT', 'Ca đêm', '22:00', '06:00'
  WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE code = 'NIGHT');

-- ----------------------------------------------------------------------------
-- 11. attendance — 1 row = 1 NV × 1 ca × 1 work_date (V1 gộp chấm công +
--     tiền đầu/cuối + bàn giao; KHÔNG bảng handover riêng).
--     v006: bảng mới từ specs/migration-006-shifts.sql (DB cũ chạy file đó).
--     * work_date = NGÀY BẮT ĐẦU CA ('YYYY-MM-DD'); ca đêm 22:00 24/10 →
--       06:00 25/10 vẫn work_date = '2026-10-24' (check_out_at được sang
--       ngày sau, chỉ ép check_out > check_in). Báo cáo GROUP BY work_date.
--     * opening_cash NOT NULL DEFAULT 0 (tránh NULL khi đối soát),
--       closing_cash NULL = chưa chốt; status present/late/missing
--       (default present, app quyết present/late, sweep/admin đánh missing).
--     * UNIQUE(user_id, shift_id, work_date): check-in trùng ca/ngày →
--       SQLITE_CONSTRAINT_UNIQUE → app map ALREADY_CHECKED_IN.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS attendance (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  shift_id      INTEGER NOT NULL REFERENCES shifts(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  work_date     TEXT NOT NULL CHECK (work_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  check_in_at   TEXT NULL,
  check_out_at  TEXT NULL,
  opening_cash  INTEGER NOT NULL DEFAULT 0 CHECK (opening_cash >= 0),
  closing_cash  INTEGER NULL CHECK (closing_cash IS NULL OR closing_cash >= 0),
  handover_note TEXT NULL,
  status        TEXT NOT NULL DEFAULT 'present'
                CHECK (status IN ('present', 'late', 'missing')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, shift_id, work_date),
  CHECK (check_out_at IS NULL OR check_in_at IS NULL OR check_out_at > check_in_at)
);

CREATE INDEX IF NOT EXISTS idx_att_user_date  ON attendance(user_id, work_date);
CREATE INDEX IF NOT EXISTS idx_att_date       ON attendance(work_date);
CREATE INDEX IF NOT EXISTS idx_att_shift_date ON attendance(shift_id, work_date);

-- ============================================================================
-- TRIGGERS — tự động bump updated_at (SQLite không có ON UPDATE now())
-- An toàn vì PRAGMA recursive_triggers mặc định OFF (better-sqlite3 giữ default này):
-- UPDATE bên trong trigger KHÔNG kích hoạt lại chính nó, không loop vô hạn.
-- ============================================================================
CREATE TRIGGER IF NOT EXISTS trg_users_updated
AFTER UPDATE ON users
BEGIN
  UPDATE users SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_zones_updated
AFTER UPDATE ON parking_zones
BEGIN
  UPDATE parking_zones SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_spots_updated
AFTER UPDATE ON parking_spots
BEGIN
  UPDATE parking_spots SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_vehicles_updated
AFTER UPDATE ON vehicles
BEGIN
  UPDATE vehicles SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_passes_updated
AFTER UPDATE ON monthly_passes
BEGIN
  UPDATE monthly_passes SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_sessions_updated
AFTER UPDATE ON parking_sessions
BEGIN
  UPDATE parking_sessions SET updated_at = datetime('now') WHERE id = NEW.id;
END;

-- v004: bump updated_at cho reservations (recursive_triggers OFF → an toàn).
CREATE TRIGGER IF NOT EXISTS trg_reservations_updated
AFTER UPDATE ON reservations
BEGIN
  UPDATE reservations SET updated_at = datetime('now') WHERE id = NEW.id;
END;

-- v006: bump updated_at cho shifts + attendance (recursive_triggers OFF → an toàn).
CREATE TRIGGER IF NOT EXISTS trg_shifts_updated
AFTER UPDATE ON shifts
BEGIN
  UPDATE shifts SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_attendance_updated
AFTER UPDATE ON attendance
BEGIN
  UPDATE attendance SET updated_at = datetime('now') WHERE id = NEW.id;
END;

-- ============================================================================
-- VIEWS — tiện cho màn hình Khách (chỗ trống) và Báo cáo doanh thu
-- ============================================================================

-- Chỗ trống theo zone (guest view + màn hình check-in)
CREATE VIEW IF NOT EXISTS v_zone_availability AS
SELECT
  z.id            AS zone_id,
  z.code          AS zone_code,
  z.name          AS zone_name,
  z.vehicle_type_allowed,
  z.capacity,
  z.is_active,
  COUNT(s.id) FILTER (WHERE s.status = 'available')   AS free_spots,
  COUNT(s.id) FILTER (WHERE s.status = 'occupied')    AS occupied_spots,
  COUNT(s.id) FILTER (WHERE s.status = 'maintenance') AS maintenance_spots
FROM parking_zones z
LEFT JOIN parking_spots s ON s.zone_id = z.id
GROUP BY z.id;

-- Doanh thu theo ngày (nguồn cho báo cáo; paid_at là thời điểm thực thu)
CREATE VIEW IF NOT EXISTS v_revenue_daily AS
SELECT
  date(paid_at)          AS day,
  payment_method,
  COUNT(*)               AS tx_count,
  SUM(amount)            AS revenue
FROM payments
GROUP BY date(paid_at), payment_method;

-- Lượt vào/ra theo ngày + zone (bảng báo cáo: Ngày | Lượt vào | Lượt ra | ...)
CREATE VIEW IF NOT EXISTS v_sessions_daily AS
SELECT
  date(check_in_at)      AS day,
  zone_id,
  COUNT(*)               AS entries,
  COUNT(check_out_at)    AS exits,
  SUM(CASE WHEN status = 'parked' THEN 1 ELSE 0 END) AS still_parked
FROM parking_sessions
GROUP BY date(check_in_at), zone_id;

-- Sơ đồ chỗ real-time cho Guest view: mỗi spot + biển số xe đang đỗ (nếu có)
CREATE VIEW IF NOT EXISTS v_spot_map AS
SELECT
  s.id            AS spot_id,
  s.zone_id,
  z.code          AS zone_code,
  s.spot_number,
  s.status,
  v.license_plate AS occupying_plate -- NULL khi spot trống
FROM parking_spots s
JOIN parking_zones z ON z.id = s.zone_id
LEFT JOIN parking_sessions ps
  ON ps.spot_id = s.id AND ps.status = 'parked'
LEFT JOIN vehicles v ON v.id = ps.vehicle_id;

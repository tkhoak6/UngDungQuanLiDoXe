-- ============================================================================
-- Migration 004 — bảng reservations (P4 customer-area: đặt chỗ trước, V1)
-- File: specs/migration-004-reservations.sql
-- ----------------------------------------------------------------------------
-- Mục tiêu:
--   1. Tạo bảng mới `reservations` (giữ chỗ trong ngày, khung 1–4h, mã R-…).
--      KHÔNG sửa bảng cũ, KHÔNG seed, KHÔNG đụng dữ liệu hiện có.
--   2. Quy ước status theo HỢP ĐỒNG Leader: pending/active/completed/
--      cancelled/expired (ánh xạ spec P4: pending ≡ 'held' đang giữ chỗ,
--      active = đã check-in từ mã đặt, completed ≡ đã dùng xong).
--
-- QUYẾT ĐỊNH vehicle (Leader yêu cầu ghi rõ):
--   * `vehicle_id` NULLABLE + `license_plate TEXT NOT NULL` + `customer_phone`
--     snapshot (tái dùng pattern monthly_passes.customer_name/phone).
--   * Lý do: khách được đặt trước khi xe tồn tại trong hệ thống (đặt theo SĐT
--     + biển số gõ tay, app UPPERCASE). Khi check-in, staff upsert vehicle
--     rồi UPDATE reservations.vehicle_id (link sau).
--   * Ràng buộc app (KHÔNG CHECK DB): nếu vehicle_id NOT NULL thì license_plate
--     phải khớp vehicles.license_plate (backend verify lúc link).
--
-- QUOTA + TỰ HỦY (Leader yêu cầu ghi rõ — thực thi ở BACKEND, DB chỉ index):
--   * Quota ≤ 2 pending|active / customer: backend COUNT(*) WHERE user_id=?
--     AND status IN ('pending','active') AND date=? trước INSERT (race nhỏ ở
--     Electron single-writer chấp nhận được; KHÔNG dùng CHECK subquery —
--     SQLite cấm subquery trong CHECK).
--   * Tự hủy quá ~20p không đến: backend job/sweep khi mở app + check lúc
--     check-in: UPDATE … SET status='expired' WHERE status='pending'
--     AND expires_at < datetime('now'); đồng thời trả spot giữ về 'available'.
--   * DB phục vụ 2 query trên bằng idx_res_user_status_date,
--     idx_res_zone_date_status, idx_res_status_expires (xem STEP 1).
--
-- CÁCH CHẠY (dành cho @node-developer — migration runner):
--   * DB mới (chưa có bảng reservations): KHÔNG chạy file này — bootstrap
--     schema.sql (đã gộp sẵn v004) như cũ.
--   * DB đã có dữ liệu: backup file parking.db trước (copy ->
--     parking.db.bak-004), rồi db.exec() nguyên file. Không cần strip block
--     như DB-002 (toàn bộ DDL đã IF NOT EXISTS).
--
--   Runner mẫu (copy vào migration runner, tái dùng phong cách DB-002/003):
--     const sql = fs.readFileSync('specs/migration-004-reservations.sql', 'utf8');
--     db.exec(sql);
--     const bad = db.pragma('foreign_key_check');
--     if (bad.length > 0) throw new Error('FK violation sau migration 004');
--
-- IDEMPOTENT: chạy N lần không lỗi — CREATE TABLE / INDEX / TRIGGER đều có
--   IF NOT EXISTS, không rebuild, không copy dữ liệu.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- STEP 0 — backup (LÀM TAY TRƯỚC KHI CHẠY, không phải câu SQL):
--   copy parking.db -> parking.db.bak-004
--   Lý do: tuy migration chỉ ADD (rủi ro thấp) nhưng giữ 1 bản file-level
--   để rollback 1 lệnh khi có sự cố (giống DB-002/003).
-- ----------------------------------------------------------------------------

PRAGMA foreign_keys = OFF;

BEGIN IMMEDIATE;

-- ----------------------------------------------------------------------------
-- STEP 1 — tạo bảng reservations + index + trigger (1 transaction duy nhất).
--   * date: TEXT 'YYYY-MM-DD' (= today ở V1, backend ép; DB chỉ check format).
--   * start_time/end_time: TEXT 'HH:mm' zero-padded (so sánh chuỗi đúng thứ tự).
--   * expires_at: TEXT ISO8601 'YYYY-MM-DD HH:MM:SS' = start + ~20p (app tính).
--   * Khung giờ bãi V1: 06:00–22:00 (CHECK DB; đổi giờ hoạt động thì rebuild
--     CHECK như pattern DB-003 — KHÔNG ALTER lén).
--   * Duration 1–4h: CHECK bằng strftime diff (giây) BETWEEN 3600 AND 14400.
--   * user_id RESTRICT (giữ lịch sử đối soát, không CASCADE mất vết);
--     vehicle_id/spot_id SET NULL khi xe/spot bị xóa (giữ row + biển số text).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reservations (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  code           TEXT NOT NULL UNIQUE
                 CHECK (code GLOB 'R-[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9]'),
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  vehicle_id     INTEGER NULL REFERENCES vehicles(id) ON DELETE SET NULL ON UPDATE CASCADE,
  license_plate  TEXT NOT NULL DEFAULT '', -- biển số gõ tay (app UPPERCASE); đối soát khi chưa có vehicle
  customer_phone TEXT NOT NULL DEFAULT '', -- snapshot SĐT lúc đặt (pattern monthly_passes)
  zone_id        INTEGER NOT NULL REFERENCES parking_zones(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  spot_id        INTEGER NULL REFERENCES parking_spots(id) ON DELETE SET NULL ON UPDATE CASCADE,
  date           TEXT NOT NULL -- 'YYYY-MM-DD' (= today ở V1)
                 CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  start_time     TEXT NOT NULL -- 'HH:mm'
                 CHECK (start_time GLOB '[0-9][0-9]:[0-9][0-9]'),
  end_time       TEXT NOT NULL -- 'HH:mm'
                 CHECK (end_time GLOB '[0-9][0-9]:[0-9][0-9]'),
  status         TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'active', 'completed', 'cancelled', 'expired')),
  expires_at     TEXT NOT NULL, -- ISO8601 = start + ~20p (app tính, sweep job dùng)
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

-- Quota query: COUNT pending/active của 1 customer trong ngày.
CREATE INDEX IF NOT EXISTS idx_res_user_status_date
  ON reservations(user_id, status, date);

-- Capacity/expiry sweep theo khu + ngày.
CREATE INDEX IF NOT EXISTS idx_res_zone_date_status
  ON reservations(zone_id, date, status);

-- Job tự hủy: pending quá expires_at (không đến sau ~20p).
CREATE INDEX IF NOT EXISTS idx_res_status_expires
  ON reservations(status, expires_at);

-- Link xe lúc check-in + tra cứu theo xe.
CREATE INDEX IF NOT EXISTS idx_res_vehicle ON reservations(vehicle_id);

-- (code đã UNIQUE → có autoindex, đủ cho lookup `WHERE code = ?` lúc check-in.)

-- Trigger bump updated_at (giống schema.sql; recursive_triggers OFF nên an toàn).
CREATE TRIGGER IF NOT EXISTS trg_reservations_updated
AFTER UPDATE ON reservations
BEGIN
  UPDATE reservations SET updated_at = datetime('now') WHERE id = NEW.id;
END;

COMMIT;

PRAGMA foreign_keys = ON;

-- ============================================================================
-- ROLLBACK (làm tay, theo thứ tự; ưu tiên restore file parking.db.bak-004):
--   1. DROP TRIGGER IF EXISTS trg_reservations_updated;
--   2. DROP TABLE IF EXISTS reservations;  -- kéo theo drop 4 index trên
--   3. PRAGMA foreign_key_check; trống (bảng mới chưa bị bảng khác trỏ tới).
-- Dữ liệu mất: toàn bộ đặt chỗ (chấp nhận được — V1 giữ chỗ miễn phí, chưa
-- thu tiền; KHÔNG rollback nếu đã có session check-in từ reservation mà chưa
-- đối soát xong — kiểm tra thủ công trước).
-- ============================================================================

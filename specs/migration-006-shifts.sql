-- ============================================================================
-- Migration 006 — ca làm việc + chấm công/bàn giao (SQLite + better-sqlite3)
-- File: specs/migration-006-shifts.sql
-- ----------------------------------------------------------------------------
-- Mục tiêu (staff-area.md S3.1–S3.2 + HỢP ĐỒNG Leader DB-006):
--   1. Bảng mới `shifts`: định nghĩa ca (code UNIQUE MORNING/AFTERNOON/NIGHT,
--      name, start_time/end_time 'HH:MM', is_active) + seed 3 ca mặc định.
--   2. Bảng mới `attendance`: 1 row = 1 lượt trực của 1 NV trong 1 ca 1 ngày
--      (gộp chấm công + tiền đầu/cuối + note bàn giao; KHÔNG bảng handover riêng
--      ở V1). UNIQUE(user_id, shift_id, work_date).
--   3. KHÔNG sửa bảng cũ, KHÔNG seed ngoài 3 ca mặc định.
--
-- QUY ƯỚC CA ĐÊM QUA NGÀY (chốt 1 cách, nhất quán toàn app):
--   * `shifts.end_time < shifts.start_time`  =>  ca qua ngày (hiện chỉ NIGHT
--     22:00–06:00). Mọi ca khác end > start (trong ngày).
--   * `attendance.work_date` = NGÀY BẮT ĐẦU CA (ngày chứa giờ vào/start_time),
--     format 'YYYY-MM-DD'. VD: trực NIGHT bắt đầu 22:00 ngày 24/10, ra ca
--     06:00 ngày 25/10  =>  work_date = '2026-10-24'.
--   * Hệ quả: `check_in_at` thuộc work_date; `check_out_at` ĐƯỢC PHÉP sang
--     ngày hôm sau (chỉ ép check_out_at > check_in_at, KHÔNG ép cùng ngày).
--   * App xác định "ca hiện tại" theo giờ tường: 00:00–06:00  =>  NIGHT của
--     work_date = hôm qua (yesterday); 06:00–14:00 => MORNING today;
--     14:00–22:00 => AFTERNOON today; 22:00–24:00 => NIGHT today.
--     Mọi báo cáo GROUP BY work_date (không GROUP BY date(check_in_at)).
--   * Đối soát lệch tiền: Warning, KHÔNG chặn chốt ca (S3.3: app tính
--     closing - opening - revenue_trong_ca, hiển thị "khớp/lệch ±X₫").
--
-- CÁCH CHẠY (dành cho @node-developer — migration runner):
--   * DB mới (chưa có bảng nào): KHÔNG chạy file này — bootstrap schema.sql
--     (đã gộp sẵn v006) + seed.sql như cũ.
--   * DB đã có dữ liệu: backup file parking.db trước (copy ->
--     parking.db.bak-006), rồi db.exec() NGUYÊN file (mọi câu đều
--     IF NOT EXISTS / OR IGNORE nên idempotent, không cần strip như 002/005
--     vì KHÔNG có ALTER TABLE ADD COLUMN).
--
--   Runner mẫu (copy vào migration runner):
--     db.exec(fs.readFileSync('specs/migration-006-shifts.sql', 'utf8'));
--     const bad = db.pragma('foreign_key_check');
--     if (bad.length > 0) throw new Error('FK violation sau migration 006');
--     // Smoke: 3 ca seed đủ
--     const n = db.prepare(`SELECT COUNT(*) AS c FROM shifts`).get().c;
--     if (n < 3) throw new Error('Thiếu seed shifts sau migration 006');
--
-- IDEMPOTENT: chạy N lần không lỗi (CREATE TABLE/INDEX/TRIGGER đều
--   IF NOT EXISTS; seed shifts dùng INSERT ... WHERE NOT EXISTS theo code).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- STEP 0 — backup (LÀM TAY TRƯỚC KHI CHẠY, không phải câu SQL):
--   copy parking.db -> parking.db.bak-006
--   Lý do: dù migration chỉ CREATE TABLE mới (không rebuild, không copy dữ
--   liệu — rủi ro thấp) nhưng giữ 1 bản file-level để rollback 1 lệnh khi có
--   sự cố (giống DB-002/003/004/005).
-- ----------------------------------------------------------------------------

PRAGMA foreign_keys = ON;

-- ----------------------------------------------------------------------------
-- STEP 1 — bảng `shifts` (định nghĩa ca, giờ cấu hình được).
--   * code UNIQUE: 'MORNING' | 'AFTERNOON' | 'NIGHT' (app resolve shift_id
--     bằng code, không hardcode id — giống pattern roles/customer ở v002).
--   * start_time/end_time 'HH:MM' (TEXT + GLOB, không ép kiểu giờ ở DB).
--     Ca đêm cho phép end < start (= qua ngày, xem quy ước trên);
--     DB chỉ ép start != end, overlap/giờ hợp lệ do app validate
--     (Warning không chặn — staff-area.md S3.3).
--   * is_active 0/1: tắt = không xếp ca mới, row attendance cũ giữ nguyên.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS shifts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  code        TEXT NOT NULL UNIQUE CHECK (code IN ('MORNING', 'AFTERNOON', 'NIGHT')),
  name        TEXT NOT NULL CHECK (length(name) >= 1),          -- 'Ca sáng' ...
  start_time  TEXT NOT NULL CHECK (start_time GLOB '[0-9][0-9]:[0-9][0-9]'),
  end_time    TEXT NOT NULL CHECK (end_time GLOB '[0-9][0-9]:[0-9][0-9]'),
  is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (start_time != end_time)
);

-- ----------------------------------------------------------------------------
-- STEP 2 — seed 3 ca mặc định (dữ liệu tham chiếu, KHÔNG phải seed test).
-- WHERE NOT EXISTS theo code => chạy lại không trùng, admin sửa giờ sau đó
-- không bị ghi đè (chỉ INSERT khi thiếu code, không UPDATE).
-- ----------------------------------------------------------------------------
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
-- STEP 3 — bảng `attendance` (1 row = 1 NV × 1 ca × 1 work_date).
--   * user_id  -> users(id) RESTRICT: còn chấm công thì không xóa user
--     (giữ lịch sử đối soát; xóa user phải chốt/xử lý attendance trước).
--   * shift_id -> shifts(id) RESTRICT: còn lượt trực thì không xóa định
--     nghĩa ca (tắt ca dùng is_active = 0 thay vì xóa).
--   * work_date 'YYYY-MM-DD' = NGÀY BẮT ĐẦU CA (quy ước ca đêm ở header).
--   * check_in_at/check_out_at ISO8601 UTC ('YYYY-MM-DD HH:MM:SS');
--     NULL check_out = đang trực; ép check_out > check_in khi cả 2 non-NULL.
--   * opening_cash NOT NULL DEFAULT 0 (tránh NULL trong phép trừ đối soát;
--     prefill từ closing_cash ca trước ở app); closing_cash NULL = chưa chốt.
--     Cả 2 CHECK >= 0, đơn vị VND nguyên (quy ước repo: INTEGER VND).
--   * handover_note TEXT NULL (max 500 ở app, DB giữ TEXT thuần như notes v005).
--   * status: 'present' (đúng giờ) | 'late' (trễ) | 'missing' (vắng/không
--     check-in). Default 'present'; app quyết present/late theo giờ vào
--     thực tế vs start_time (+ grace, VD 10p — config ở app, không ép ở DB);
--     'missing' do sweep/admin đánh khi quá ca không có check-in.
--   * UNIQUE(user_id, shift_id, work_date): 1 NV 1 ca 1 ngày 1 row;
--     check-in 2 lần cùng ca/ngày => SQLITE_CONSTRAINT_UNIQUE -> app map
--     sang ALREADY_CHECKED_IN (staff-area.md S3.4).
--   * LỆNH Leader "nullable" vs spec S3.2 "opening NOT NULL DEFAULT 0":
--     chốt theo spec S3.2 (opening NOT NULL DEFAULT 0, closing NULL được)
--     để phép đối soát (closing - opening - revenue) không vướng NULL;
--     app vẫn được phép bỏ trống opening (= 0 két rỗng).
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

-- ----------------------------------------------------------------------------
-- STEP 4 — indexes (phủ query patterns S3: ca của tôi theo user/date,
-- báo cáo theo ngày, lookup theo ca).
--   * UNIQUE(user_id, shift_id, work_date) đã có autoindex — đủ cho chặn
--     check-in trùng + lookup điểm theo 3 cột.
--   * idx_att_user_date: "Ca của tôi" (WHERE user_id = ? AND work_date
--     BETWEEN ? AND ? ORDER BY work_date) + attendance:today (user + date).
--   * idx_att_date: báo cáo admin theo ngày + banner "quên chốt ca hôm qua"
--     (WHERE work_date = ? AND check_out_at IS NULL).
--   * idx_att_shift_date: đối soát/lịch theo ca (WHERE shift_id = ? AND
--     work_date BETWEEN ? AND ?).
--   * KHÔNG index handover_note (free-text, không filter) và cash
--     (không có query WHERE theo tiền) — tránh over-indexing bảng hot-write.
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_att_user_date  ON attendance(user_id, work_date);
CREATE INDEX IF NOT EXISTS idx_att_date       ON attendance(work_date);
CREATE INDEX IF NOT EXISTS idx_att_shift_date ON attendance(shift_id, work_date);

-- ----------------------------------------------------------------------------
-- STEP 5 — triggers bump updated_at (giống pattern schema.sql;
-- PRAGMA recursive_triggers mặc định OFF nên UPDATE trong trigger không
-- kích hoạt lại chính nó — an toàn, không loop).
-- ----------------------------------------------------------------------------
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
-- ROLLBACK (làm tay, theo thứ tự; ưu tiên restore file parking.db.bak-006):
--   1. DROP TRIGGER IF EXISTS trg_attendance_updated;
--   2. DROP TRIGGER IF EXISTS trg_shifts_updated;
--   3. DROP TABLE IF EXISTS attendance;   -- mất toàn bộ chấm công/bàn giao
--   4. DROP TABLE IF EXISTS shifts;       -- mất định nghĩa ca + giờ đã sửa
--   5. PRAGMA foreign_key_check; trống.
-- Dữ liệu mất: toàn bộ rows attendance + mọi chỉnh giờ ca của admin
--   (users/sessions/payments giữ nguyên — migration không đụng bảng cũ).
-- Quay lại: restore parking.db.bak-006 là đủ (không cần chạy SQL ngược khi
--   còn file backup).
-- ============================================================================

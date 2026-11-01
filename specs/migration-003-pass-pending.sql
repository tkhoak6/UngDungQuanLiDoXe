-- ============================================================================
-- Migration 003 — customer pass "pending" (SQLite + better-sqlite3)
-- File: specs/migration-003-pass-pending.sql
-- ----------------------------------------------------------------------------
-- Mục tiêu:
--   1. monthly_passes.status CHECK thêm 'pending' (giữ
--      active/expired/cancelled/suspended). P3 customer-area: khách tự đăng ký
--      vé → 'pending', staff thu tiền tại quầy → 'active', hoặc 'cancelled'.
--   2. KHÔNG thêm cột/bảng, KHÔNG seed, KHÔNG đụng bảng khác.
--
-- CÁCH CHẠY (dành cho @node-developer — migration runner):
--   * DB mới (chưa có bảng monthly_passes): KHÔNG chạy file này — bootstrap
--     schema.sql (đã gộp sẵn v003) như cũ.
--   * DB đã có dữ liệu: backup file parking.db trước (copy ->
--     parking.db.bak-003), rồi chạy runner JS ở dưới. Toàn bộ STEP 1 nằm
--     trong 1 transaction (lỗi -> ROLLBACK, bảng cũ nguyên vẹn).
--
--   Runner mẫu (copy vào migration runner, tái dùng phong cách DB-002):
--     const sql = fs.readFileSync('specs/migration-003-pass-pending.sql', 'utf8');
--     const ddl = db.prepare(
--       `SELECT sql AS s FROM sqlite_master WHERE type = 'table' AND name = 'monthly_passes'`
--     ).get()?.s ?? '';
--     // Detect idempotent: CHECK đã có 'pending' thì skip (DB mới bootstrap v003
--     // hoặc migration đã chạy rồi).
--     if (ddl.includes("'pending'")) { console.log('migration-003: skip (pending OK)'); }
--     else { db.exec(sql); }
--     const bad = db.pragma('foreign_key_check');
--     if (bad.length > 0) throw new Error('FK violation sau migration 003');
--
-- IDEMPOTENT 2 lớp:
--   (a) Runner detect 'pending' trong sqlite_master thì skip (lớp chính).
--   (b) File SQL tự thân chạy lại an toàn: DROP TABLE IF EXISTS staging +
--       rebuild cùng CHECK + copy giữ nguyên id → chạy N lần không lỗi,
--       dữ liệu cũ (active/expired/...) giữ nguyên.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- STEP 0 — backup (LÀM TAY TRƯỚC KHI CHẠY, không phải câu SQL):
--   copy parking.db -> parking.db.bak-003
--   Lý do: SQLite ALTER không sửa được CHECK; rebuild bảng monthly_passes thay
--   thế toàn bộ table nên file-level backup là lớp an toàn ngoài transaction
--   bên dưới.
-- ----------------------------------------------------------------------------

PRAGMA foreign_keys = OFF;

BEGIN IMMEDIATE;

-- ----------------------------------------------------------------------------
-- STEP 1 — rebuild monthly_passes với CHECK mở rộng
--   ('pending','active','expired','cancelled','suspended').
-- SQLite không ALTER được CHECK nên dùng pattern tạo-bảng-mới + copy + rename
-- (giống DB-002 STEP 1).
-- An toàn: 1 transaction duy nhất; copy giữ nguyên id (FK parking_sessions.
-- monthly_pass_id + payments.monthly_pass_id không đổi); dọn bảng tạm
-- monthly_passes_new còn sót từ lần chạy gián đoạn trước.
-- LƯU Ý khác DB-002: monthly_passes CÓ index/trigger phụ thuộc nên bắt buộc
-- tạo lại sau rename (DROP TABLE cũ kéo theo drop index + trigger của nó):
--   * INDEX: idx_pass_vehicle, idx_pass_status, idx_pass_dates
--   * TRIGGER: trg_passes_updated (bump updated_at)
-- ----------------------------------------------------------------------------
DROP TABLE IF EXISTS monthly_passes_new;

CREATE TABLE monthly_passes_new (
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

INSERT INTO monthly_passes_new
  (id, pass_code, vehicle_id, zone_id, customer_name, customer_phone,
   start_date, end_date, price, status, created_by, created_at, updated_at)
  SELECT id, pass_code, vehicle_id, zone_id, customer_name, customer_phone,
         start_date, end_date, price, status, created_by, created_at, updated_at
    FROM monthly_passes;

DROP TABLE monthly_passes;

ALTER TABLE monthly_passes_new RENAME TO monthly_passes;

-- Tạo lại index phủ query patterns (giống schema.sql v003).
CREATE INDEX IF NOT EXISTS idx_pass_vehicle ON monthly_passes(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_pass_status  ON monthly_passes(status);
CREATE INDEX IF NOT EXISTS idx_pass_dates   ON monthly_passes(start_date, end_date);

-- Tạo lại trigger bump updated_at (giống schema.sql).
-- PRAGMA recursive_triggers mặc định OFF nên không loop vô hạn.
CREATE TRIGGER IF NOT EXISTS trg_passes_updated
AFTER UPDATE ON monthly_passes
BEGIN
  UPDATE monthly_passes SET updated_at = datetime('now') WHERE id = NEW.id;
END;

COMMIT;

PRAGMA foreign_keys = ON;

-- ============================================================================
-- ROLLBACK (làm tay, theo thứ tự; ưu tiên restore file parking.db.bak-003):
--   1. PRAGMA foreign_keys = OFF;
--   2. Rebuild monthly_passes ngược về CHECK
--      ('active','expired','cancelled','suspended') bằng đúng pattern STEP 1
--      (tạo monthly_passes_new với CHECK cũ + copy + rename + tạo lại 3 index
--      + trigger trg_passes_updated) trong 1 transaction.
--      LƯU Ý: nếu đã tồn tại row status='pending', phải xử lý trước
--      (UPDATE về 'cancelled' hoặc DELETE theo quyết định nghiệp vụ + xác nhận
--      user — KHÔNG rollback mù gây mất đăng ký chờ của khách).
--   3. PRAGMA foreign_keys = ON; + kiểm tra PRAGMA foreign_key_check; trống.
-- Dữ liệu mất: mọi pass status='pending' sẽ phải chuyển/xóa thủ công ở bước 2.
-- ============================================================================

-- ============================================================================
-- Migration 002 — customer self-registration (SQLite + better-sqlite3)
-- File: specs/migration-002-customer.sql
-- ----------------------------------------------------------------------------
-- Mục tiêu:
--   1. roles.name CHECK thêm 'customer' (giữ admin/staff/guest).
--   2. users thêm cột phone TEXT + UNIQUE INDEX idx_users_phone (NULL distinct,
--      staff/admin cũ NULL được; SQLite cấm ADD COLUMN kèm UNIQUE nên tách 2 câu).
--   3. Đảm bảo tồn tại role row 'customer' (dữ liệu tham chiếu, KHÔNG phải seed test).
--
-- CÁCH CHẠY (dành cho @node-developer — migration runner):
--   * DB mới (chưa có bảng roles): KHÔNG chạy file này — bootstrap schema.sql
--     (đã gộp sẵn v002) + seed.sql như cũ.
--   * DB đã có dữ liệu: backup file parking.db trước (copy ->
--     parking.db.bak-002), rồi chạy runner JS ở dưới. KHÔNG db.exec() nguyên
--     file khi chưa strip STEP 3 (lý do: SQLite không có ADD COLUMN IF NOT EXISTS).
--
--   Runner mẫu (copy vào migration runner, KHÔNG chạy tay từng câu):
--     const sql = fs.readFileSync('specs/migration-002-customer.sql', 'utf8');
--     const hasPhone = db.prepare(
--       `SELECT COUNT(*) AS c FROM pragma_table_info('users') WHERE name = 'phone'`
--     ).get().c > 0;
--     // Neo '\n' để chỉ khớp marker dòng riêng (trong header cũng nhắc tên marker).
--     const B = '\n-- <STEP3-PHONE-BEGIN>', E = '\n-- <STEP3-PHONE-END>';
--     const run = hasPhone ? sql.slice(0, sql.indexOf(B)) + sql.slice(sql.indexOf(E) + E.length) : sql;
--     db.exec(run);
--     const bad = db.pragma('foreign_key_check');
--     if (bad.length > 0) throw new Error('FK violation sau migration 002');
--
-- IDEMPOTENT: chạy N lần không lỗi NẾU runner strip STEP 3 khi phone đã tồn tại
--   (STEP 1 rebuild + STEP 2 INSERT...WHERE NOT EXISTS chạy lại thoải mái).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- STEP 0 — backup (LÀM TAY TRƯỚC KHI CHẠY, không phải câu SQL):
--   copy parking.db -> parking.db.bak-002
--   Lý do: SQLite ALTER không sửa được CHECK; rebuild bảng roles thay thế toàn
--   bộ table nên file-level backup là lớp an toàn ngoài transaction bên dưới.
-- ----------------------------------------------------------------------------

PRAGMA foreign_keys = OFF;

BEGIN IMMEDIATE;

-- ----------------------------------------------------------------------------
-- STEP 1 — rebuild roles với CHECK mở rộng ('admin','staff','guest','customer').
-- SQLite không ALTER được CHECK nên dùng pattern tạo-bảng-mới + copy + rename.
-- An toàn: 1 transaction duy nhất (lỗi -> ROLLBACK, bảng cũ nguyên vẹn),
-- dữ liệu copy giữ nguyên id (FK users.role_id không đổi), dọn bảng tạm
-- roles_new còn sót từ lần chạy gián đoạn trước.
-- roles hiện tại KHÔNG có index/trigger/view phụ thuộc nên không cần tạo lại.
-- ----------------------------------------------------------------------------
DROP TABLE IF EXISTS roles_new;

CREATE TABLE roles_new (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL UNIQUE CHECK (name IN ('admin', 'staff', 'guest', 'customer')),
  description TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO roles_new (id, name, description, created_at)
  SELECT id, name, description, created_at FROM roles;

DROP TABLE roles;

ALTER TABLE roles_new RENAME TO roles;

-- ----------------------------------------------------------------------------
-- STEP 2 — đảm bảo role row 'customer' (tham chiếu cho users.role_id).
-- WHERE NOT EXISTS => chạy lại không tạo trùng. Id trên DB chuẩn = 4
-- (tiếp sau seed 1/2/3); app PHẢI resolve role_id bằng name, không hardcode id.
-- KHÔNG thêm user customer mẫu — khách tự đăng ký qua app.
-- ----------------------------------------------------------------------------
INSERT INTO roles (name, description)
  SELECT 'customer', 'Tự đăng ký bằng SĐT: username = SĐT, đăng nhập như user thường'
  WHERE NOT EXISTS (SELECT 1 FROM roles WHERE name = 'customer');

COMMIT;

PRAGMA foreign_keys = ON;

-- <STEP3-PHONE-BEGIN>
-- ----------------------------------------------------------------------------
-- STEP 3 — users.phone (khách bắt buộc có SĐT duy nhất ở tầng app;
-- staff/admin cũ phone NULL được). SQLite CẤM ADD COLUMN kèm UNIQUE nên tách
-- làm 2 câu: cột plain TEXT + CREATE UNIQUE INDEX riêng. UNIQUE index coi các
-- NULL là phân biệt (nhiều NULL cùng tồn tại OK) và phục vụ lookup theo SĐT.
-- RUNNER BẮT BUỘC strip block này nếu phone đã tồn tại (xem header).
-- ----------------------------------------------------------------------------
ALTER TABLE users ADD COLUMN phone TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone ON users(phone);
-- <STEP3-PHONE-END>

-- ============================================================================
-- ROLLBACK (làm tay, theo thứ tự; ưu tiên restore file parking.db.bak-002):
--   1. PRAGMA foreign_keys = OFF;
--   2. DELETE FROM users WHERE role_id IN (SELECT id FROM roles WHERE name = 'customer');
--   3. DELETE FROM roles WHERE name = 'customer';
--   4. Rebuild roles ngược về CHECK ('admin','staff','guest') bằng đúng pattern
--      STEP 1 (tạo roles_new với CHECK cũ + copy + rename) trong 1 transaction.
--   5. ALTER TABLE users DROP COLUMN phone;  -- cần SQLite >= 3.35
--      (better-sqlite3 >= 8 đã bundle SQLite mới hơn, đủ điều kiện).
--   6. PRAGMA foreign_keys = ON; + kiểm tra PRAGMA foreign_key_check; trống.
-- Dữ liệu mất: mọi user customer + SĐT staff đã nhập (phone) sẽ mất theo.
-- ============================================================================

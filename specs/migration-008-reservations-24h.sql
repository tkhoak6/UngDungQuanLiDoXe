-- ============================================================================
-- Migration 008 — reservations 24/24 + qua đêm (nối BE-019)
-- File: specs/migration-008-reservations-24h.sql
-- ----------------------------------------------------------------------------
-- Mục tiêu: nới 3 CHECK trong `reservations` (migration-004 + schema.sql v004)
--   đang CHẶN đặt qua đêm / ngoài khung 06:00–22:00 / lượt 15–59p, theo đúng
--   đề xuất trong `specs/backend-summary.md` §BE-019:
--     1. `CHECK (end_time > start_time)` — chặn end <= start (qua đêm).
--        → thay bằng `CHECK (end_time != start_time)` (chỉ chặn end == start;
--        end < start = qua đêm sang hôm sau, `+24h`, app tính).
--     2. `CHECK (start_time >= '06:00' AND end_time <= '22:00')` — chặn ngoài khung.
--        → BỎ hẳn (bãi giữ chỗ 24/24).
--     3. `CHECK (diff_cung_ngay BETWEEN 3600 AND 14400)` — duration cùng ngày
--        1–4h, chặn qua đêm + chặn 15–59p (mới: 15p–4h).
--        → thay bằng duration qua đêm:
--        `CASE WHEN end>start THEN diff ELSE diff+86400 END BETWEEN 900 AND 14400`
--        (15p = 900s, 4h = 14400s).
--   KHÔNG thêm/bớt cột, KHÔNG đổi FK/nullable/default, KHÔNG seed, KHÔNG đụng
--   bảng khác. Giữ nguyên dữ liệu + 4 index + trigger `trg_reservations_updated`.
--
-- Tương thích dữ liệu cũ: mọi row hợp lệ cũ (cùng ngày, 06–22, 1–4h) đều thỏa
--   CHECK mới (diff 3600–14400 ⊂ 900–14400; end>start ⇒ end!=start) nên COPY
--   trong STEP 1 không bao giờ rớt CHECK. Không cần backfill/chuyển đổi.
--
-- CÁCH CHẠY (dành cho @node-developer — migration runner, pattern DB-003/007):
--   * DB mới (bootstrap schema.sql đã gộp v008): KHÔNG chạy file này — runner
--     detect CHECK mới đã có thì skip (xem snippet dưới), không backup.
--   * DB đã có dữ liệu (CHECK cũ): checkpoint WAL + copy file parking.db ->
--     parking.db.bak-008, rồi db.exec() nguyên file. Toàn bộ STEP 1 nằm trong
--     1 transaction (lỗi -> ROLLBACK, bảng cũ nguyên vẹn).
--
--   Runner mẫu (copy vào openDatabase(), sau runMigration007):
--     const ddl = db.prepare(
--       `SELECT sql AS s FROM sqlite_master WHERE type = 'table' AND name = 'reservations'`
--     ).get()?.s ?? '';
--     // Detect idempotent: CHECK mới chứa 'BETWEEN 900 AND 14400' thì skip
--     // (DB mới bootstrap v008 hoặc migration đã chạy rồi).
--     if (ddl.includes('BETWEEN 900 AND 14400')) { /* skip, không backup */ }
--     else {
--       db.pragma('wal_checkpoint(TRUNCATE)');
--       fs.copyFileSync(dbPath, dbPath + '.bak-008');
--       db.exec(fs.readFileSync('specs/migration-008-reservations-24h.sql', 'utf8'));
--     }
--     const bad = db.pragma('foreign_key_check');
--     if (bad.length > 0) throw new Error('FK violation sau migration 008');
--
-- IDEMPOTENT 2 lớp (giống DB-003):
--   (a) Runner detect 'BETWEEN 900 AND 14400' trong sqlite_master thì skip.
--   (b) File SQL tự thân chạy lại an toàn: DROP TABLE IF EXISTS staging +
--       rebuild cùng CHECK mới + copy giữ nguyên id → chạy N lần không lỗi,
--       dữ liệu (cũ + qua đêm đã đặt) giữ nguyên.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- STEP 0 — backup (LÀM TAY / RUNNER TRƯỚC KHI CHẠY, không phải câu SQL):
--   copy parking.db -> parking.db.bak-008
--   Lý do: SQLite ALTER không sửa được CHECK; rebuild bảng reservations thay
--   thế toàn bộ table nên file-level backup là lớp an toàn ngoài transaction
--   bên dưới (giống DB-003/007).
-- ----------------------------------------------------------------------------

PRAGMA foreign_keys = OFF;

BEGIN IMMEDIATE;

-- ----------------------------------------------------------------------------
-- STEP 1 — rebuild reservations với CHECK 24/24 + qua đêm
--   (pattern tạo-bảng-mới + copy + rename, giống DB-003 STEP 1).
-- An toàn: 1 transaction duy nhất; copy giữ nguyên id (FK parking_sessions /
--   payments không trỏ tới reservations nên không đổi, nhưng giữ id vẫn đúng
--   cho code/ticket đối soát); dọn bảng tạm reservations_new còn sót từ lần
--   chạy gián đoạn trước.
-- LƯU Ý giống DB-003: reservations CÓ index/trigger phụ thuộc nên bắt buộc
-- tạo lại sau rename (DROP TABLE cũ kéo theo drop index + trigger của nó):
--   * INDEX: idx_res_user_status_date, idx_res_zone_date_status,
--     idx_res_status_expires, idx_res_vehicle (4 index v004, giữ nguyên định
--     nghĩa — quota/sweep/capacity/link-xe không đổi).
--   * TRIGGER: trg_reservations_updated (bump updated_at).
-- ----------------------------------------------------------------------------
DROP TABLE IF EXISTS reservations_new;

CREATE TABLE reservations_new (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  code           TEXT NOT NULL UNIQUE
                 CHECK (code GLOB 'R-[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9]'),
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  vehicle_id     INTEGER NULL REFERENCES vehicles(id) ON DELETE SET NULL ON UPDATE CASCADE,
  license_plate  TEXT NOT NULL DEFAULT '', -- biển số gõ tay (app UPPERCASE); đối soát khi chưa có vehicle
  customer_phone TEXT NOT NULL DEFAULT '', -- snapshot SĐT lúc đặt (pattern monthly_passes)
  zone_id        INTEGER NOT NULL REFERENCES parking_zones(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  spot_id        INTEGER NULL REFERENCES parking_spots(id) ON DELETE SET NULL ON UPDATE CASCADE,
  date           TEXT NOT NULL -- 'YYYY-MM-DD' (= NGÀY BẮT ĐẦU giữ chỗ, backend ép = today;
                 -- end <= start = qua đêm, tự tràn sang hôm sau ở app)
                 CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  start_time     TEXT NOT NULL -- 'HH:mm' zero-padded, mọi giờ 24/24 (KHÔNG giới hạn khung)
                 CHECK (start_time GLOB '[0-9][0-9]:[0-9][0-9]'),
  end_time       TEXT NOT NULL -- 'HH:mm'; end <= start = qua đêm (hôm sau)
                 CHECK (end_time GLOB '[0-9][0-9]:[0-9][0-9]'),
  status         TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'active', 'completed', 'cancelled', 'expired')),
  expires_at     TEXT NOT NULL, -- ISO8601 = giờ KẾT THÚC + ~20p (datetime đầy đủ, tự tràn
                 -- ngày khi qua đêm — app tính, sweep job dùng; v008 đổi từ start+20p)
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
  -- v008: chỉ chặn end == start (app báo "Giờ kết thúc phải sau giờ bắt đầu.");
  -- end < start = qua đêm hợp lệ.
  CHECK (end_time != start_time),
  -- v008: duration qua đêm — cùng ngày diff thẳng, qua đêm diff + 86400s;
  -- 15p (900s) đến 4h (14400s), app báo "Mỗi lượt giữ chỗ từ 15 phút đến 4 giờ."
  CHECK (
    CASE WHEN end_time > start_time
      THEN (strftime('%s', '2000-01-01 ' || end_time || ':00')
            - strftime('%s', '2000-01-01 ' || start_time || ':00'))
      ELSE (strftime('%s', '2000-01-01 ' || end_time || ':00')
            - strftime('%s', '2000-01-01 ' || start_time || ':00') + 86400)
    END BETWEEN 900 AND 14400
  )
);

INSERT INTO reservations_new
  (id, code, user_id, vehicle_id, license_plate, customer_phone,
   zone_id, spot_id, date, start_time, end_time, status,
   expires_at, created_at, updated_at)
  SELECT id, code, user_id, vehicle_id, license_plate, customer_phone,
         zone_id, spot_id, date, start_time, end_time, status,
         expires_at, created_at, updated_at
    FROM reservations;

DROP TABLE reservations;

ALTER TABLE reservations_new RENAME TO reservations;

-- Tạo lại 4 index phủ query patterns (giữ nguyên định nghĩa v004).
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

-- Tạo lại trigger bump updated_at (giống schema.sql).
-- PRAGMA recursive_triggers mặc định OFF nên không loop vô hạn.
CREATE TRIGGER IF NOT EXISTS trg_reservations_updated
AFTER UPDATE ON reservations
BEGIN
  UPDATE reservations SET updated_at = datetime('now') WHERE id = NEW.id;
END;

COMMIT;

PRAGMA foreign_keys = ON;

-- ============================================================================
-- ROLLBACK (làm tay, theo thứ tự; ưu tiên restore file parking.db.bak-008):
--   Cách 1 (khuyên dùng): đóng app → copy parking.db.bak-008 đè parking.db
--     → mở app lại (runner detect CHECK cũ → không tự migrate ngược).
--   Cách 2 (rebuild ngược, khi đã có dữ liệu mới cần giữ): PRAGMA
--     foreign_keys = OFF; rebuild reservations về 3 CHECK v004 bằng đúng
--     pattern STEP 1 (tạo reservations_new với CHECK cũ + copy + rename +
--     tạo lại 4 index + trigger) trong 1 transaction; PRAGMA foreign_keys = ON;
--     + kiểm tra PRAGMA foreign_key_check; trống.
--     LƯU Ý: nếu đã tồn tại row qua đêm (end <= start), ngoài khung 06–22,
--     hoặc duration < 1h, COPY sẽ rớt CHECK cũ → phải xử lý trước (UPDATE về
--     khung hợp lệ hoặc DELETE theo quyết định nghiệp vụ + xác nhận user —
--     KHÔNG rollback mù gây mất chỗ đã giữ của khách).
-- Dữ liệu mất (cách 2): mọi lượt qua đêm / ngoài khung / 15–59p sẽ phải
--   chuyển/xóa thủ công ở bước xử lý trước.
-- ============================================================================

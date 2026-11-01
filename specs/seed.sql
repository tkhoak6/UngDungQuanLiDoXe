-- ============================================================================
-- Parking Management — seed tối thiểu (chạy SAU schema.sql trên DB trống)
--   sqlite3 parking.db < specs/schema.sql
--   sqlite3 parking.db < specs/seed.sql
-- ----------------------------------------------------------------------------
-- LƯU Ý BẢO MẬT: password_hash dưới đây là PLACEHOLDER, không phải hash thật.
-- TODO(bcrypt): khi @node-developer làm auth, thay bằng bcrypt.hash(password, 10).
-- ============================================================================

PRAGMA foreign_keys = ON;

-- 1. Roles (id cố định 1/2/3 để app tham chiếu ROLE_ADMIN=1, ROLE_STAFF=2)
INSERT INTO roles (id, name, description) VALUES
  (1, 'admin', 'Toàn quyền: cấu hình khu vực/giá, quản lý user, báo cáo'),
  (2, 'staff', 'Check-in/out, thu phí, bán vé tháng'),
  (3, 'guest', 'Xem chỗ trống (read-only, không cần login)')
ON CONFLICT(id) DO NOTHING;

-- 2. Users — 1 admin + 1 staff mẫu
-- password_hash = placeholder. Mật khẩu gốc dự kiến: admin → 'Admin@123', staff → 'Staff@123'
-- TODO(bcrypt): UPDATE users SET password_hash = <bcrypt hash> trước khi bàn giao.
INSERT INTO users (username, password_hash, full_name, role_id, is_active) VALUES
  ('admin', '$2b$10$PLACEHOLDER_REPLACE_WITH_BCRYPT_ADMIN', 'Quản trị viên', 1, 1),
  ('staff01', '$2b$10$PLACEHOLDER_REPLACE_WITH_BCRYPT_STAFF', 'Nhân viên 01', 2, 1)
ON CONFLICT(username) DO NOTHING;

-- 3. Zones mẫu: A ô-tô / B xe-máy / C hỗn hợp (giá VND)
INSERT INTO parking_zones (code, name, vehicle_type_allowed, capacity, price_per_hour, price_per_day, is_active) VALUES
  ('A', 'Khu A - O to',  'car',       50,  20000, 150000, 1),
  ('B', 'Khu B - Xe may', 'motorbike', 100, 5000,  40000,  1),
  ('C', 'Khu C - Hon hop', 'both',     30,  10000, 80000,  1)
ON CONFLICT(code) DO NOTHING;

-- 4. Spots mẫu (subset minh họa; app/prod chèn đủ theo capacity của zone)
-- Zone A (id=1): A-01..A-10 | Zone B (id=2): B-01..B-10 | Zone C (id=3): C-01..C-06
INSERT INTO parking_spots (zone_id, spot_number, status) VALUES
  (1, 'A-01', 'available'), (1, 'A-02', 'available'), (1, 'A-03', 'available'),
  (1, 'A-04', 'available'), (1, 'A-05', 'available'), (1, 'A-06', 'available'),
  (1, 'A-07', 'available'), (1, 'A-08', 'maintenance'), (1, 'A-09', 'available'),
  (1, 'A-10', 'available'),
  (2, 'B-01', 'available'), (2, 'B-02', 'available'), (2, 'B-03', 'available'),
  (2, 'B-04', 'available'), (2, 'B-05', 'available'), (2, 'B-06', 'available'),
  (2, 'B-07', 'available'), (2, 'B-08', 'available'), (2, 'B-09', 'available'),
  (2, 'B-10', 'available'),
  (3, 'C-01', 'available'), (3, 'C-02', 'available'), (3, 'C-03', 'available'),
  (3, 'C-04', 'reserved'),  (3, 'C-05', 'available'), (3, 'C-06', 'available')
ON CONFLICT(zone_id, spot_number) DO NOTHING;

-- 5. Vehicles mẫu
INSERT INTO vehicles (license_plate, vehicle_type, owner_name, owner_phone) VALUES
  ('51H-12345', 'car',       'Nguyen Van A', '0901111111'),
  ('59X1-67890', 'motorbike', 'Tran Thi B',   '0902222222')
ON CONFLICT(license_plate) DO NOTHING;

-- 6. Monthly pass mẫu — xe máy 59X1-67890, áp mọi zone, hiệu lực 2026-10-01 → 2026-10-31
INSERT INTO monthly_passes
  (pass_code, vehicle_id, zone_id, customer_name, customer_phone, start_date, end_date, price, status, created_by)
SELECT 'MT-2026-0001', v.id, NULL, 'Tran Thi B', '0902222222',
       '2026-10-01', '2026-10-31', 300000, 'active', u.id
FROM vehicles v, users u
WHERE v.license_plate = '59X1-67890' AND u.username = 'admin'
ON CONFLICT(pass_code) DO NOTHING;

-- 7. Demo: 1 session đã hoàn tất + payment (để test báo cáo doanh thu).
-- Xe 51H-12345 gửi ô A-01 ngày 2026-10-15, 3 giờ x 20.000 = 60.000 VND tiền mặt.
INSERT INTO parking_sessions
  (ticket_code, vehicle_id, spot_id, zone_id, monthly_pass_id,
   check_in_at, check_out_at, status,
   hourly_rate_applied, daily_rate_applied, total_fee, discount_amount,
   created_by, closed_by)
SELECT 'T-20261015-0001', v.id, s.id, z.id, NULL,
       '2026-10-15 08:00:00', '2026-10-15 11:00:00', 'completed',
       z.price_per_hour, z.price_per_day, 60000, 0,
       u.id, u.id
FROM vehicles v, parking_spots s, parking_zones z, users u
WHERE v.license_plate = '51H-12345'
  AND s.spot_number = 'A-01' AND s.zone_id = z.id AND z.code = 'A'
  AND u.username = 'staff01'
ON CONFLICT(ticket_code) DO NOTHING;

INSERT INTO payments (session_id, monthly_pass_id, amount, payment_method, paid_at, received_by, note)
SELECT ps.id, NULL, ps.total_fee, 'cash', ps.check_out_at, u.id, 'Seed demo: ve luot o to'
FROM parking_sessions ps, users u
WHERE ps.ticket_code = 'T-20261015-0001' AND u.username = 'staff01'
  AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.session_id = ps.id);

// SQLite bootstrap: open parking.db, enforce FK + WAL, run schema/seed on first launch.
// Schema source of truth: specs/schema.sql + specs/seed.sql (owned by @database).
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';

export type AppDb = Database.Database;

const SCHEMA_FILE = 'schema.sql';
const SEED_FILE = 'seed.sql';

function specsDir(): string {
  // dev (tsc -> dist/main/db.js): <root>/specs ; packaged: resources/specs
  const candidates = [
    path.join(process.cwd(), 'specs'),
    path.join(__dirname, '..', '..', 'specs'),
    path.join(process.resourcesPath ?? '', 'specs'),
  ];
  for (const c of candidates) {
    if (c && fs.existsSync(path.join(c, SCHEMA_FILE))) return c;
  }
  throw new Error('specs/schema.sql not found — cannot bootstrap database');
}

function needsSchema(db: AppDb): boolean {
  const row = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='roles'`).get();
  return row === undefined;
}

const MIGRATION_002_FILE = 'migration-002-customer.sql';
const MIGRATION_002_BACKUP_SUFFIX = '.bak-002';

function needsMigration002(db: AppDb): boolean {
  // phone column present?
  const phoneCol = db
    .prepare(`SELECT COUNT(*) AS c FROM pragma_table_info('users') WHERE name = 'phone'`)
    .get() as { c: number };
  if (phoneCol.c === 0) return true;
  // roles CHECK accepts 'customer'?
  const rolesSql = db
    .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'roles'`)
    .get() as { sql: string } | undefined;
  if (!rolesSql || !rolesSql.sql.includes('customer')) return true;
  // customer role row exists?
  const roleRow = db.prepare(`SELECT id FROM roles WHERE name = 'customer'`).get() as
    | { id: number }
    | undefined;
  return roleRow === undefined;
}

const MIGRATION_003_FILE = 'migration-003-pass-pending.sql';
const MIGRATION_003_BACKUP_SUFFIX = '.bak-003';

function needsMigration003(db: AppDb): boolean {
  // Bảng chưa có (DB lỗi nửa chừng) → bootstrap/schema lo, không migrate ở đây.
  const tbl = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'monthly_passes'`)
    .get() as { name: string } | undefined;
  if (!tbl) return false;
  // Idempotent: CHECK đã có 'pending' (DB mới bootstrap v003 hoặc đã migrate) → skip.
  const ddl = db
    .prepare(`SELECT sql AS s FROM sqlite_master WHERE type = 'table' AND name = 'monthly_passes'`)
    .get() as { s: string } | undefined;
  return !ddl || !ddl.s.includes("'pending'");
}

const MIGRATION_004_FILE = 'migration-004-reservations.sql';
const MIGRATION_004_BACKUP_SUFFIX = '.bak-004';

const MIGRATION_005_FILE = 'migration-005-staff-profile.sql';
const MIGRATION_005_BACKUP_SUFFIX = '.bak-005';

const MIGRATION_006_FILE = 'migration-006-shifts.sql';
const MIGRATION_006_BACKUP_SUFFIX = '.bak-006';

const MIGRATION_007_FILE = 'migration-007-permissions.sql';
const MIGRATION_007_BACKUP_SUFFIX = '.bak-007';

const MIGRATION_008_FILE = 'migration-008-reservations-24h.sql';
const MIGRATION_008_BACKUP_SUFFIX = '.bak-008';

function needsMigration008(db: AppDb): boolean {
  // DB mới (bootstrap schema.sql đã gộp v008) có CHECK mới → skip.
  // DB cũ CHECK cũ (1–4h cùng ngày, khung 06–22) → migrate.
  // Bảng chưa có (DB rất cũ) → false, để runMigration004 lo tạo trước.
  const row = db
    .prepare(`SELECT sql AS s FROM sqlite_master WHERE type = 'table' AND name = 'reservations'`)
    .get() as { s: string } | undefined;
  const ddl = row?.s ?? '';
  if (!ddl) return false;
  return !ddl.includes('BETWEEN 900 AND 14400');
}

function needsMigration007(db: AppDb): boolean {
  // DB mới (bootstrap schema.sql đã gộp v007) có sẵn cột → skip.
  // DB cũ thiếu cột → migrate (strip block đã có nếu migrate dở).
  const cols = db.prepare(`SELECT name FROM pragma_table_info('users')`).all() as Array<{ name: string }>;
  return !cols.some((c) => c.name === 'permissions');
}

function needsMigration006(db: AppDb): boolean {
  // DB mới (bootstrap schema.sql đã gộp v006) có đủ 2 bảng → skip.
  // DB cũ thiếu ≥1 bảng → migrate (file SQL toàn IF NOT EXISTS nên chạy
  // nguyên file, không cần strip như 002/005).
  const shifts = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'shifts'`)
    .get() as { name: string } | undefined;
  if (!shifts) return true;
  const att = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'attendance'`)
    .get() as { name: string } | undefined;
  return !att;
}

function needsMigration005(db: AppDb): boolean {
  // DB mới (bootstrap schema.sql đã gộp v005) có đủ 3 cột → skip.
  // DB cũ thiếu ≥1 cột → migrate phần còn thiếu (strip block đã có).
  const cols = db.prepare(`SELECT name FROM pragma_table_info('users')`).all() as Array<{ name: string }>;
  const names = new Set(cols.map((c) => c.name));
  return !(names.has('address') && names.has('start_date') && names.has('notes'));
}

function needsMigration004(db: AppDb): boolean {
  // Bảng chưa có (DB cũ) → migrate. DB mới bootstrap schema.sql đã gộp v004
  // (CREATE TABLE reservations + 4 index + trigger) nên skip.
  const tbl = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'reservations'`)
    .get() as { name: string } | undefined;
  return !tbl;
}

/**
 * Migration 008 — reservations 24/24 + qua đêm (specs/migration-008-reservations-24h.sql).
 * Chỉ chạy cho DB đã tồn tại (DB mới dùng schema.sql đã gộp v008).
 * Idempotent 2 lớp: runner detect CHECK mới ('BETWEEN 900 AND 14400') thì skip
 * (lớp chính); file SQL tự thân DROP IF EXISTS staging + rebuild cùng CHECK mới
 * + copy giữ id nên chạy N lần không lỗi (lớp phụ).
 * Backup file-level `.bak-008` trước khi chạy. Sau exec: foreign_key_check.
 */
function runMigration008(db: AppDb, dbFilePath: string): void {
  if (!needsMigration008(db)) return;

  const dirSpecs = specsDir();
  const migPath = path.join(dirSpecs, MIGRATION_008_FILE);
  if (!fs.existsSync(migPath)) {
    throw new Error(`${MIGRATION_008_FILE} not found — cannot migrate existing database`);
  }

  db.pragma('wal_checkpoint(TRUNCATE)');
  fs.copyFileSync(dbFilePath, `${dbFilePath}${MIGRATION_008_BACKUP_SUFFIX}`);

  const sql = fs.readFileSync(migPath, 'utf8');
  db.exec(sql);
  const bad = db.pragma('foreign_key_check');
  if (Array.isArray(bad) && bad.length > 0) throw new Error('FK violation sau migration 008');
}
/**
 * Migration 007 — phân quyền chi tiết S4 (specs/migration-007-permissions.sql).
 * Chỉ chạy cho DB đã tồn tại (DB mới dùng schema.sql đã gộp v007).
 * Idempotent 2 lớp: runner detect thiếu cột permissions thì chạy (lớp chính);
 * file SQL strip block của cột đã tồn tại nên DB migrate dở vẫn chạy tiếp
 * đúng phần còn thiếu (lớp phụ — SQLite không có ADD COLUMN IF NOT EXISTS).
 * Backup file-level `.bak-007` trước khi chạy. Sau exec: foreign_key_check.
 */
function runMigration007(db: AppDb, dbFilePath: string): void {
  if (!needsMigration007(db)) return;

  const dirSpecs = specsDir();
  const migPath = path.join(dirSpecs, MIGRATION_007_FILE);
  if (!fs.existsSync(migPath)) {
    throw new Error(`${MIGRATION_007_FILE} not found — cannot migrate existing database`);
  }

  db.pragma('wal_checkpoint(TRUNCATE)');
  fs.copyFileSync(dbFilePath, `${dbFilePath}${MIGRATION_007_BACKUP_SUFFIX}`);

  const sql = fs.readFileSync(migPath, 'utf8');
  const cols = new Set(
    (db.prepare(`SELECT name FROM pragma_table_info('users')`).all() as Array<{ name: string }>).map((r) => r.name),
  );
  // Neo '\n' để chỉ khớp marker dòng riêng (trong header cũng nhắc tên marker).
  const strip = (s: string, b: string, e: string): string => {
    const B = '\n-- <' + b + '>';
    const E = '\n-- <' + e + '>';
    const i = s.indexOf(B);
    const j = s.indexOf(E);
    return i < 0 || j < 0 ? s : s.slice(0, i) + s.slice(j + E.length);
  };
  let run = sql;
  if (cols.has('permissions')) run = strip(run, 'STEP1-PERMISSIONS-BEGIN', 'STEP1-PERMISSIONS-END');
  db.exec(run);
  const bad = db.pragma('foreign_key_check');
  if (Array.isArray(bad) && bad.length > 0) throw new Error('FK violation sau migration 007');
}
/**
 * Migration 006 — ca làm việc + chấm công S3 (specs/migration-006-shifts.sql).
 * Chỉ chạy cho DB đã tồn tại (DB mới dùng schema.sql đã gộp v006).
 * Idempotent 2 lớp: runner detect thiếu bảng shifts/attendance thì chạy
 * (lớp chính); file SQL tự thân toàn IF NOT EXISTS / WHERE NOT EXISTS nên
 * chạy lại N lần không lỗi (lớp phụ). Backup file-level `.bak-006` trước
 * khi chạy. Sau exec: foreign_key_check + smoke đủ 3 ca seed.
 */
function runMigration006(db: AppDb, dbFilePath: string): void {
  if (!needsMigration006(db)) return;

  const dirSpecs = specsDir();
  const migPath = path.join(dirSpecs, MIGRATION_006_FILE);
  if (!fs.existsSync(migPath)) {
    throw new Error(`${MIGRATION_006_FILE} not found — cannot migrate existing database`);
  }

  db.pragma('wal_checkpoint(TRUNCATE)');
  fs.copyFileSync(dbFilePath, `${dbFilePath}${MIGRATION_006_BACKUP_SUFFIX}`);

  const sql = fs.readFileSync(migPath, 'utf8');
  db.exec(sql);
  const bad = db.pragma('foreign_key_check');
  if (Array.isArray(bad) && bad.length > 0) throw new Error('FK violation sau migration 006');
  const n = (db.prepare(`SELECT COUNT(*) AS c FROM shifts`).get() as { c: number }).c;
  if (n < 3) throw new Error('Thiếu seed shifts sau migration 006');
}
/**
 * Migration 005 — hồ sơ chi tiết NV S1 (specs/migration-005-staff-profile.sql).
 * Chỉ chạy cho DB đã tồn tại (DB mới dùng schema.sql đã gộp v005).
 * Idempotent 2 lớp: runner detect đủ 3 cột thì skip (lớp chính);
 * file SQL strip block của cột đã tồn tại nên DB migrate dở (có cột này
 * thiếu cột kia) vẫn chạy tiếp đúng phần còn thiếu (lớp phụ — SQLite không
 * có ADD COLUMN IF NOT EXISTS). Backup file-level `.bak-005` trước khi chạy.
 */
function runMigration005(db: AppDb, dbFilePath: string): void {
  if (!needsMigration005(db)) return;

  const dirSpecs = specsDir();
  const migPath = path.join(dirSpecs, MIGRATION_005_FILE);
  if (!fs.existsSync(migPath)) {
    throw new Error(`${MIGRATION_005_FILE} not found — cannot migrate existing database`);
  }

  db.pragma('wal_checkpoint(TRUNCATE)');
  fs.copyFileSync(dbFilePath, `${dbFilePath}${MIGRATION_005_BACKUP_SUFFIX}`);

  const sql = fs.readFileSync(migPath, 'utf8');
  const cols = new Set(
    (db.prepare(`SELECT name FROM pragma_table_info('users')`).all() as Array<{ name: string }>).map((r) => r.name),
  );
  // Neo '\n' để chỉ khớp marker dòng riêng (trong header cũng nhắc tên marker).
  const strip = (s: string, b: string, e: string): string => {
    const B = '\n-- <' + b + '>';
    const E = '\n-- <' + e + '>';
    const i = s.indexOf(B);
    const j = s.indexOf(E);
    return i < 0 || j < 0 ? s : s.slice(0, i) + s.slice(j + E.length);
  };
  let run = sql;
  if (cols.has('address')) run = strip(run, 'STEP1-ADDRESS-BEGIN', 'STEP1-ADDRESS-END');
  if (cols.has('start_date')) run = strip(run, 'STEP1-STARTDATE-BEGIN', 'STEP1-STARTDATE-END');
  if (cols.has('notes')) run = strip(run, 'STEP1-NOTES-BEGIN', 'STEP1-NOTES-END');
  db.exec(run);
  const bad = db.pragma('foreign_key_check');
  if (Array.isArray(bad) && bad.length > 0) throw new Error('FK violation sau migration 005');
}
/**
 * Migration 004 — đặt chỗ P4 (specs/migration-004-reservations.sql).
 * Chỉ chạy cho DB đã tồn tại (DB mới dùng schema.sql đã gộp v004).
 * Idempotent 2 lớp: runner detect bảng reservations thì skip (lớp chính);
 * file SQL tự thân toàn IF NOT EXISTS nên chạy lại N lần không lỗi (lớp phụ).
 * Backup file-level `.bak-004` trước khi chạy.
 */
function runMigration004(db: AppDb, dbFilePath: string): void {
  if (!needsMigration004(db)) return;

  const dirSpecs = specsDir();
  const migPath = path.join(dirSpecs, MIGRATION_004_FILE);
  if (!fs.existsSync(migPath)) {
    throw new Error(`${MIGRATION_004_FILE} not found — cannot migrate existing database`);
  }

  db.pragma('wal_checkpoint(TRUNCATE)');
  fs.copyFileSync(dbFilePath, `${dbFilePath}${MIGRATION_004_BACKUP_SUFFIX}`);

  const sql = fs.readFileSync(migPath, 'utf8');
  db.exec(sql);
  const bad = db.pragma('foreign_key_check');
  if (Array.isArray(bad) && bad.length > 0) throw new Error('FK violation sau migration 004');
}
/**
 * Migration 003 — customer pass "pending" (specs/migration-003-pass-pending.sql).
 * Chỉ chạy cho DB đã tồn tại (DB mới dùng schema.sql đã gộp v003).
 * Idempotent 2 lớp: runner detect 'pending' trong sqlite_master thì skip (lớp
 * chính); file SQL tự thân rebuild cùng CHECK + copy giữ id nên chạy N lần
 * không lỗi (lớp phụ). Backup file-level `.bak-003` trước khi chạy.
 */
function runMigration003(db: AppDb, dbFilePath: string): void {
  if (!needsMigration003(db)) return;

  const dirSpecs = specsDir();
  const migPath = path.join(dirSpecs, MIGRATION_003_FILE);
  if (!fs.existsSync(migPath)) {
    throw new Error(`${MIGRATION_003_FILE} not found — cannot migrate existing database`);
  }

  // Checkpoint WAL trước để file copy đủ dữ liệu (giống migration-002).
  db.pragma('wal_checkpoint(TRUNCATE)');
  fs.copyFileSync(dbFilePath, `${dbFilePath}${MIGRATION_003_BACKUP_SUFFIX}`);

  const sql = fs.readFileSync(migPath, 'utf8');
  db.exec(sql);
  const bad = db.pragma('foreign_key_check');
  if (Array.isArray(bad) && bad.length > 0) throw new Error('FK violation sau migration 003');
}
/**
 * Migration 002 — customer self-registration (specs/migration-002-customer.sql).
 * Chỉ chạy cho DB đã tồn tại (DB mới dùng schema.sql đã gộp v002).
 * Idempotent: chạy N lần an toàn (STEP 1 rebuild + STEP 2 INSERT...WHERE NOT
 * EXISTS chạy lại thoải mái; STEP 3 strip khi phone đã tồn tại vì SQLite
 * không có ADD COLUMN IF NOT EXISTS).
 */
function runMigration002(db: AppDb, dbFilePath: string): void {
  if (!needsMigration002(db)) return;

  const dirSpecs = specsDir();
  const migPath = path.join(dirSpecs, MIGRATION_002_FILE);
  if (!fs.existsSync(migPath)) {
    throw new Error(`${MIGRATION_002_FILE} not found — cannot migrate existing database`);
  }

  // File-level backup trước khi chạy (SQLite ALTER không sửa được CHECK nên
  // STEP 1 rebuild toàn bộ bảng roles). Checkpoint WAL trước để file copy đủ dữ liệu.
  db.pragma('wal_checkpoint(TRUNCATE)');
  fs.copyFileSync(dbFilePath, `${dbFilePath}${MIGRATION_002_BACKUP_SUFFIX}`);

  const sql = fs.readFileSync(migPath, 'utf8');
  const hasPhone =
    (db.prepare(`SELECT COUNT(*) AS c FROM pragma_table_info('users') WHERE name = 'phone'`).get() as { c: number }).c > 0;
  // Neo '\n' để chỉ khớp marker dòng riêng (trong file header cũng nhắc tên marker).
  const B = '\n-- <STEP3-PHONE-BEGIN>';
  const E = '\n-- <STEP3-PHONE-END>';
  const run = hasPhone ? sql.slice(0, sql.indexOf(B)) + sql.slice(sql.indexOf(E) + E.length) : sql;
  db.exec(run);
  const bad = db.pragma('foreign_key_check');
  if (Array.isArray(bad) && bad.length > 0) throw new Error('FK violation sau migration 002');
}

function seedBcryptPlaceholders(db: AppDb): void {
  // seed.sql ships PLACEHOLDER hashes — replace with real bcrypt hashes once.
  const placeholders = db
    .prepare(`SELECT id, username FROM users WHERE password_hash LIKE '$2b$10$PLACEHOLDER%'`)
    .all() as Array<{ id: number; username: string }>;
  const defaults: Record<string, string> = { admin: 'Admin@123', staff01: 'Staff@123' };
  const update = db.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`);
  for (const u of placeholders) {
    const plain = defaults[u.username] ?? 'ChangeMe@123';
    update.run(bcrypt.hashSync(plain, 10), u.id);
  }
}

export function openDatabase(dbFilePath: string): AppDb {
  const dir = path.dirname(dbFilePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const db: AppDb = new Database(dbFilePath);
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');

  if (needsSchema(db)) {
    const dirSpecs = specsDir();
    const schema = fs.readFileSync(path.join(dirSpecs, SCHEMA_FILE), 'utf8');
    const seed = fs.readFileSync(path.join(dirSpecs, SEED_FILE), 'utf8');
    db.exec(schema);
    db.exec(seed);
    seedBcryptPlaceholders(db);
  } else {
    // Cheap safety: pragmas every connection + backfill any leftover placeholder.
    // DB cũ: chạy migration 002 → 003 → 004 idempotent (mới + cũ đều OK).
    runMigration002(db, dbFilePath);
    runMigration003(db, dbFilePath);
    runMigration004(db, dbFilePath);
    runMigration005(db, dbFilePath);
    runMigration006(db, dbFilePath);
    runMigration007(db, dbFilePath);
    runMigration008(db, dbFilePath);
    seedBcryptPlaceholders(db);
  }
  // RV-001 note 5: startup sweep — vé quá hạn active → expired để `passes:list
  // {status:'active'}` và UI không hiện vé hết hạn. Billing date-check
  // (findValidPass/preview) giữ nguyên, không đụng.
  sweepExpiredPasses(db);
  // P4 (BE-011): startup sweep — pending quá expires_at → expired + spot giữ
  // về 'available' (cùng transaction trong sweepExpiredReservations).
  sweepExpiredReservations(db);
  return db;
}

/** Flip stale `active` passes to `expired`. Idempotent; safe to run on every open. */
function sweepExpiredPasses(db: AppDb): void {
  db.prepare(
    `UPDATE monthly_passes SET status = 'expired' WHERE status = 'active' AND end_date < date('now')`,
  ).run();
}

/**
 * P4 sweep (BE-011, BE-019 24/24): `pending` quá `expires_at` (= giờ kết thúc + 20p,
 * datetime đầy đủ, qua đêm tràn ngày) → `expired`, đồng thời trả spot đã giữ
 * (`reserved` của chính row đó) về `available` trong CÙNG 1 transaction.
 * Idempotent; gọi khi mở app + trước mỗi check-in. Guard `status = 'reserved'`
 * lúc trả spot để không đụng ô đã được consume (reserved → occupied lúc
 * check-in bằng mã) hay tái sử dụng. KHÔNG giới hạn khung giờ — sweep thuần
 * theo `expires_at` nên đúng cả đặt qua đêm.
 */
export function sweepExpiredReservations(db: AppDb): number {
  const tx = db.transaction(() => {
    const stale = db
      .prepare(`SELECT id, spot_id FROM reservations WHERE status = 'pending' AND expires_at < datetime('now')`)
      .all() as Array<{ id: number; spot_id: number | null }>;
    if (stale.length === 0) return 0;
    const mark = db.prepare(`UPDATE reservations SET status = 'expired' WHERE id = ?`);
    const free = db.prepare(`UPDATE parking_spots SET status = 'available' WHERE id = ? AND status = 'reserved'`);
    for (const r of stale) {
      mark.run(r.id);
      if (r.spot_id !== null) free.run(r.spot_id);
    }
    return stale.length;
  });
  return tx();
}

/** Default DB location: <userData>/parking.db in packaged app, ./data/parking.db in dev. */
export function defaultDbPath(userDataPath?: string): string {
  if (userDataPath) return path.join(userDataPath, 'parking.db');
  return path.join(process.cwd(), 'data', 'parking.db');
}

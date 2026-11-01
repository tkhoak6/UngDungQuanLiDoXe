// File-level backup/restore helpers (spec ./specs/management-area.md §M3.2).
// Copy DB sau WAL checkpoint; restore validate header SQLite + integrity +
// FK + bảng bắt buộc, auto-backup DB hiện tại trước khi chép đè, yêu cầu
// restart (needRestart). KHÔNG bảng audit_log ở V1 (P2).
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import type { AppDb } from './db';

const SQLITE_MAGIC = 'SQLite format 3\0';

const REQUIRED_TABLES = [
  'roles',
  'users',
  'parking_zones',
  'parking_spots',
  'vehicles',
  'monthly_passes',
  'parking_sessions',
  'payments',
];

/** 'YYYYMMDD-HHmm' for backup file names (local time, readable for quầy staff). */
export function stampShort(d = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

/** 'YYYYMMDD-HHmmss' for pre-restore backup (unique even on rapid retries). */
export function stampLong(d = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${stampShort(d)}${p(d.getSeconds())}`;
}

export function dbFilePath(db: AppDb): string {
  const name = (db as unknown as { name?: unknown }).name;
  if (typeof name !== 'string' || !name || name === ':memory:') {
    throw new Error('Không xác định được đường dẫn DB');
  }
  return name;
}

/** WAL checkpoint với retry (DB_BUSY lúc đang check-out → đợi 2s, tối đa 3 lần). */
export function checkpointWithRetry(db: AppDb, attempts = 3): void {
  let last: unknown = null;
  for (let i = 0; i < attempts; i++) {
    try {
      db.pragma('wal_checkpoint(TRUNCATE)');
      return;
    } catch (e) {
      last = e;
      const msg = e instanceof Error ? e.message : String(e);
      if (!/busy|locked/i.test(msg) || i === attempts - 1) throw e;
      const end = Date.now() + 2000;
      while (Date.now() < end) {
        // busy-wait 2s (main process sync — chấp nhận được cho thao tác admin hiếm)
      }
    }
  }
  throw last instanceof Error ? last : new Error('DB đang bận (DB_BUSY) — thử lại sau.');
}

export function isSqliteFile(p: string): boolean {
  try {
    const fd = fs.openSync(p, 'r');
    try {
      const buf = Buffer.alloc(16);
      const n = fs.readSync(fd, buf, 0, 16, 0);
      if (n < 16) return false;
      return buf.toString('binary') === SQLITE_MAGIC;
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return false;
  }
}

export interface RestoreValidation {
  tableNames: string[];
  sourceUserVersion: number;
}

/**
 * Validate file restore: header SQLite + integrity_check + foreign_key_check
 * + bảng bắt buộc. Throw Error message chứa mã để handler map:
 * NOT_SQLITE | INTEGRITY_FAIL | SCHEMA_MISMATCH.
 */
export function validateRestoreFile(sourcePath: string, currentUserVersion: number): RestoreValidation {
  if (!isSqliteFile(sourcePath)) {
    throw new Error('File không phải SQLite (NOT_SQLITE) — chọn file .db sao lưu từ app.');
  }
  let src: Database.Database | null = null;
  try {
    src = new Database(sourcePath, { readonly: true, fileMustExist: true });
    const integ = src.pragma('integrity_check') as Array<{ integrity_check: string }>;
    if (!integ || integ.length === 0 || integ.some((r) => r.integrity_check !== 'ok')) {
      throw new Error('File backup hỏng (INTEGRITY_FAIL) — dùng bản pre-restore hoặc bản cũ hơn.');
    }
    const bad = src.pragma('foreign_key_check') as unknown[];
    if (Array.isArray(bad) && bad.length > 0) {
      throw new Error('File backup lỗi liên kết (INTEGRITY_FAIL) — dùng bản khác.');
    }
    const tables = (src.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as Array<{ name: string }>).map(
      (r) => r.name,
    );
    const missing = REQUIRED_TABLES.filter((t) => !tables.includes(t));
    if (missing.length > 0) {
      throw new Error(`File thiếu bảng bắt buộc (${missing.join(', ')}) (SCHEMA_MISMATCH) — file từ phiên bản app khác.`);
    }
    const uv = src.pragma('user_version', { simple: true }) as number;
    if (typeof uv === 'number' && uv !== 0 && uv !== currentUserVersion) {
      throw new Error(`File từ phiên bản app khác (SCHEMA_MISMATCH, user_version ${uv} vs ${currentUserVersion}) — cập nhật app trước.`);
    }
    return { tableNames: tables, sourceUserVersion: typeof uv === 'number' ? uv : 0 };
  } finally {
    try {
      src?.close();
    } catch {
      // ignore close errors on a file we only read
    }
  }
}

function autoLog(dir: string, line: string): void {
  try {
    fs.appendFileSync(path.join(dir, 'backup-auto.log'), `${new Date().toISOString()} ${line}\n`, 'utf8');
  } catch {
    // logging never breaks the operation
  }
}

/**
 * Daily job 03:00 (main-process): copy DB → parking-YYYYMMDD-HHmm.db, giữ 7
 * bản gần nhất, xóa bản cũ. Gọi 1 lần lúc khởi động; tự tick mỗi 60s.
 * Mọi lỗi nuốt + ghi backup-auto.log (không crash app quầy).
 */
export function startDailyBackupJob(db: AppDb): void {
  let lastRunDay = '';
  const tick = (): void => {
    try {
      const now = new Date();
      const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      const day = now.toISOString().slice(0, 10);
      if (hhmm !== '03:00' || lastRunDay === day) return;
      lastRunDay = day;
      const dbPath = dbFilePath(db);
      const dir = path.dirname(dbPath);
      checkpointWithRetry(db);
      const dest = path.join(dir, `parking-${stampShort(now)}.db`);
      fs.copyFileSync(dbPath, dest);
      // Giữ 7 bản auto gần nhất (không đụng pre-restore / backup tay tên khác).
      const autos = fs
        .readdirSync(dir)
        .filter((f) => /^parking-\d{8}-\d{4}\.db$/.test(f))
        .sort();
      while (autos.length > 7) {
        const old = autos.shift() as string;
        try {
          fs.unlinkSync(path.join(dir, old));
        } catch {
          // ignore
        }
      }
      autoLog(dir, `auto-backup ok ${path.basename(dest)}`);
    } catch (e) {
      try {
        const dir = path.dirname(dbFilePath(db));
        autoLog(dir, `auto-backup fail ${e instanceof Error ? e.message : String(e)}`);
      } catch {
        // ignore
      }
    }
  };
  const timer = setInterval(tick, 60_000);
  if (typeof (timer as unknown as { unref?: unknown }).unref === 'function') {
    (timer as unknown as { unref: () => void }).unref();
  }
}

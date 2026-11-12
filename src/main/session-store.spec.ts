// BE-023 session-store spec: issue/consume/rotate/revoke/guard — pure Node
// (không cần better-sqlite3; db chỉ dùng để suy đường dẫn file).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, beforeEach } from 'vitest';
import type { AppDb } from './db';
import {
  consumeRememberToken,
  issueRememberToken,
  isResumeBlocked,
  loadRememberSessions,
  noteResumeFailure,
  resetResumeGuardForTest,
  revokeRememberToken,
  sessionsPathForDb,
  REMEMBER_TTL_MS,
  RESUME_BLOCK_MS,
} from './session-store';

function fakeDb(): { db: AppDb; dir: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'be023-'));
  const db = { name: path.join(dir, 'parking.db') } as unknown as AppDb;
  return { db, dir };
}

describe('session-store (BE-023)', () => {
  beforeEach(() => {
    resetResumeGuardForTest();
  });

  it('issue → file cạnh DB, chỉ lưu hash (không lộ raw token)', () => {
    const { db, dir } = fakeDb();
    const { token, expires_at_ms } = issueRememberToken(db, 7);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(expires_at_ms).toBeGreaterThan(Date.now() + REMEMBER_TTL_MS - 60_000);
    expect(sessionsPathForDb(db)).toBe(path.join(dir, 'sessions.json'));
    const file = fs.readFileSync(path.join(dir, 'sessions.json'), 'utf8');
    expect(file).not.toContain(token);
    const rows = loadRememberSessions(db);
    expect(rows).toHaveLength(1);
    expect(rows[0].user_id).toBe(7);
    expect(rows[0].token_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('consume đúng → ok + single-use (lần 2 fail = đã xoay vòng)', () => {
    const { db } = fakeDb();
    const { token } = issueRememberToken(db, 3);
    const first = consumeRememberToken(db, token);
    expect(first).toEqual({ ok: true, user_id: 3 });
    expect(consumeRememberToken(db, token)).toEqual({ ok: false });
    expect(loadRememberSessions(db)).toHaveLength(0);
  });

  it('token lạ → fail, không đụng session người khác', () => {
    const { db } = fakeDb();
    const { token } = issueRememberToken(db, 3);
    expect(consumeRememberToken(db, 'wrong-token')).toEqual({ ok: false });
    expect(consumeRememberToken(db, token)).toEqual({ ok: true, user_id: 3 });
  });

  it('hết hạn → fail + tự dọn dòng', () => {
    const { db } = fakeDb();
    const now = Date.now();
    const { token } = issueRememberToken(db, 3, now);
    const r = consumeRememberToken(db, token, now + REMEMBER_TTL_MS + 1000);
    expect(r).toEqual({ ok: false });
    expect(loadRememberSessions(db)).toHaveLength(0);
  });

  it('revoke xóa đúng token; revoke token lạ → false', () => {
    const { db } = fakeDb();
    const a = issueRememberToken(db, 3);
    issueRememberToken(db, 3);
    expect(revokeRememberToken(db, 'nope')).toBe(false);
    expect(revokeRememberToken(db, a.token)).toBe(true);
    expect(loadRememberSessions(db)).toHaveLength(1);
    expect(consumeRememberToken(db, a.token)).toEqual({ ok: false });
  });

  it('trần 5 token/user — issue thứ 6 drop cũ nhất', () => {
    const { db } = fakeDb();
    const tokens: string[] = [];
    for (let i = 0; i < 7; i++) tokens.push(issueRememberToken(db, 9).token);
    const rows = loadRememberSessions(db);
    expect(rows).toHaveLength(5);
    // 2 token đầu (cũ nhất) đã bị drop.
    expect(consumeRememberToken(db, tokens[0])).toEqual({ ok: false });
    expect(consumeRememberToken(db, tokens[1])).toEqual({ ok: false });
    expect(consumeRememberToken(db, tokens[6])).toEqual({ ok: true, user_id: 9 });
  });

  it('guard: sai 5 lần → block 60s; reset mở lại', () => {
    const now = Date.now();
    expect(isResumeBlocked(now)).toBe(false);
    for (let i = 0; i < 5; i++) noteResumeFailure(now);
    expect(isResumeBlocked(now)).toBe(true);
    expect(isResumeBlocked(now + RESUME_BLOCK_MS + 1)).toBe(false);
    resetResumeGuardForTest();
    expect(isResumeBlocked(now)).toBe(false);
  });

  it('file hỏng → [] (quarantine .corrupt, không throw)', () => {
    const { db, dir } = fakeDb();
    fs.writeFileSync(path.join(dir, 'sessions.json'), 'not-json{{{');
    expect(loadRememberSessions(db)).toEqual([]);
    const leftovers = fs.readdirSync(dir).filter((f) => f.startsWith('sessions.json.corrupt-'));
    expect(leftovers).toHaveLength(1);
  });
});

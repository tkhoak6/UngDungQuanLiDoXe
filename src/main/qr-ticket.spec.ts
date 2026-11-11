// BE-018: unit test pure sign/verify vé QR (qr-anpr.md §1.2). Đối soát
// DB status (completed → fail) nằm ở IPC tickets:verify-qr, cover bằng code
// review (handler check `status !== 'parked'` → ALREADY_USED).
import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  checkInToEpochMin,
  epochMinToCheckIn,
  normalizePlateForQr,
  signTicket,
  verifyQrSignature,
} from './qr-ticket';

const KEY = crypto.randomBytes(32).toString('base64');
const ARGS = { ticketCode: 'T-20261111-0001', licensePlate: '51H-123.45', checkInAt: '2026-11-11 08:00:00', keyB64: KEY };

describe('qr-ticket', () => {
  it('ký → verify OK, payload khớp, QR gọn < 220 ký tự', () => {
    const qr = signTicket(ARGS);
    expect(qr.length).toBeLessThan(220);
    const sig = qr.split('.')[4];
    expect(sig).toHaveLength(43);
    expect(sig).not.toContain('=');
    const v = verifyQrSignature(qr, KEY);
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.payload.ticketCode).toBe('T-20261111-0001');
      expect(v.payload.plateNorm).toBe('51H12345');
      expect(v.payload.epochMin).toBe(checkInToEpochMin('2026-11-11 08:00:00'));
    }
  });

  it('sửa 1 ký tự biển số → INVALID_SIGNATURE', () => {
    const qr = signTicket(ARGS).replace('51H12345', '51H12346');
    const v = verifyQrSignature(qr, KEY);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe('INVALID_SIGNATURE');
  });

  it('sửa 1 ký tự chữ ký → fail', () => {
    const qr = signTicket(ARGS);
    const tampered = qr.slice(0, -1) + (qr.endsWith('A') ? 'B' : 'A');
    expect(verifyQrSignature(tampered, KEY).ok).toBe(false);
  });

  it('sai key → fail (chống giả)', () => {
    const qr = signTicket(ARGS);
    const other = crypto.randomBytes(32).toString('base64');
    const v = verifyQrSignature(qr, other);
    expect(v.ok).toBe(false);
  });

  it('version lạ → UNSUPPORTED_VERSION', () => {
    const qr = 'P2.' + signTicket(ARGS).split('.').slice(1).join('.');
    const v = verifyQrSignature(qr, KEY);
    expect(v).toEqual({ ok: false, reason: 'UNSUPPORTED_VERSION' });
  });

  it('normalize bỏ -/./space + uppercase; epoch round-trip', () => {
    expect(normalizePlateForQr('51h-123.45')).toBe('51H12345');
    const ts = checkInToEpochMin('2026-11-11 08:00:00');
    expect(epochMinToCheckIn(ts)).toBe('2026-11-11 08:00:00');
  });
});

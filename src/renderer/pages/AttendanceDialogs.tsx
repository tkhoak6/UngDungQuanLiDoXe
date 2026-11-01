import type { JSX } from 'react';
import { Alert, Button, Dialog } from '../components/ui';
import { fmtSigned } from '../lib/attendance';
import { formatDateShort, formatVND } from '../lib/format';

function fmtSigned(n: number): string {
  const sign = n > 0 ? '+' : n < 0 ? '−' : '';
  return `${sign}${formatVND(Math.abs(n))}`;
}

interface CheckInProps {
  inCash: string;
  onInCash: (v: string) => void;
  lastClosing: number | null;
  saving: boolean;
  error: string;
  onClose: () => void;
  onSubmit: () => void;
}

// FE-019 S3 dialog "Vào ca": nhập tiền đầu ca (trống = két rỗng 0₫),
// prefill note két bàn giao từ ca trước gần nhất đã chốt.
export function CheckInDialog(props: CheckInProps): JSX.Element {
  const { inCash, onInCash, lastClosing, saving, error, onClose, onSubmit } = props;
  const trim = inCash.trim();
  const bad = trim !== '' && (!/^\d+$/.test(trim) || Number(trim) > 9007199254740991);
  return (
    <Dialog title="Vào ca" onClose={onClose}>
      <div className="field">
        <label htmlFor="att-opening">Tiền đầu ca (₫)</label>
        <input
          id="att-opening"
          className="input mono"
          inputMode="numeric"
          placeholder="Trống = két rỗng (0₫)"
          value={inCash}
          aria-invalid={bad}
          onChange={(e) => onInCash(e.target.value)}
        />
        {bad
          ? <span className="field-error">Tiền đầu ca phải là số nguyên ≥ 0.</span>
          : <span className="field-hint">{lastClosing === null ? 'Két rỗng = 0₫.' : `Két bàn giao: ${formatVND(lastClosing)}.`}</span>}
      </div>
      {error !== '' && (
        <div style={{ marginTop: 8 }}>
          <Alert tone="danger">{error}</Alert>
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
        <Button variant="neutral" onClick={onClose}>Hủy</Button>
        <Button variant="primary" disabled={bad || saving} onClick={onSubmit}>
          {saving ? 'Đang ghi nhận…' : 'Xác nhận vào ca'}
        </Button>
      </div>
    </Dialog>
  );
}

interface CheckOutProps {
  outCash: string;
  onOutCash: (v: string) => void;
  outNote: string;
  onOutNote: (v: string) => void;
  openingCash: number; // tiền đầu ca của row sắp chốt (ca hiện tại hoặc ca treo)
  isBackfill: boolean; // true = đang "chốt bù" ca treo hôm qua
  pendingWorkDate: string;
  saving: boolean;
  error: string;
  onClose: () => void;
  onSubmit: () => void;
}

// FE-019 S3 dialog "Ra ca" / "Chốt bù": nhập tiền cuối ca (trống = chốt
// giờ ra, tiền NULL — admin đối soát sau) + note bàn giao ≤500. Tạm tính
// cuối−đầu live; đối soát trừ thu trong ca hiển thị sau khi chốt (Warning
// khi lệch, không chặn).
export function CheckOutDialog(props: CheckOutProps): JSX.Element {
  const {
    outCash, onOutCash, outNote, onOutNote, openingCash,
    isBackfill, pendingWorkDate, saving, error, onClose, onSubmit,
  } = props;
  const trim = outCash.trim();
  const cashBad = trim !== '' && !/^\d+$/.test(trim);
  const noteLong = outNote.trim().length > 500;
  return (
    <Dialog title={isBackfill ? 'Chốt bù ca treo' : 'Ra ca'} onClose={onClose}>
      {isBackfill && (
        <p className="field-hint" style={{ marginTop: 0 }}>
          Đang chốt ca treo ngày {formatDateShort(pendingWorkDate)} (tiền đầu ca {formatVND(openingCash)}).
        </p>
      )}
      <div className="field">
        <label htmlFor="att-closing">Tiền cuối ca (₫)</label>
        <input
          id="att-closing"
          className="input mono"
          inputMode="numeric"
          placeholder="Để trống = chốt giờ ra, tiền NULL"
          value={outCash}
          aria-invalid={cashBad}
          onChange={(e) => onOutCash(e.target.value)}
        />
        {cashBad
          ? <span className="field-error">Tiền cuối ca phải là số nguyên ≥ 0.</span>
          : <span className="field-hint">
            Tạm tính (cuối − đầu): {trim === '' ? '—' : fmtSigned(Number(trim) - openingCash)}
            {' '}· chưa trừ thu trong ca — đối soát cuối sau khi chốt.
          </span>}
      </div>
      <div className="field">
        <label htmlFor="att-note">Ghi chú bàn giao</label>
        <textarea
          id="att-note"
          className="textarea"
          rows={3}
          placeholder="Bàn giao cho ca sau… (trống = không có)"
          value={outNote}
          aria-describedby="att-note-count"
          onChange={(e) => onOutNote(e.target.value)}
        />
        <span id="att-note-count" className={noteLong ? 'field-error' : 'field-hint'} aria-live="off">
          {outNote.trim().length}/500{noteLong ? ' — Ghi chú tối đa 500 ký tự.' : ''}
        </span>
      </div>
      {error !== '' && (
        <div style={{ marginTop: 8 }}>
          <Alert tone="danger">{error}</Alert>
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
        <Button variant="neutral" onClick={onClose}>Hủy</Button>
        <Button variant="primary" disabled={cashBad || noteLong || saving} onClick={onSubmit}>
          {saving ? 'Đang chốt…' : 'Xác nhận ra ca'}
        </Button>
      </div>
    </Dialog>
  );
}

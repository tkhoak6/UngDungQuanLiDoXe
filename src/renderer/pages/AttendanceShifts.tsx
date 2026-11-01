import { useCallback, useEffect, useState, type JSX } from 'react';
import { Pencil } from 'lucide-react';
import { Alert, Badge, Button, Dialog, RetryPanel, SkeletonRows, Toasts, type ToastItem } from '../components/ui';
import { callApi } from '../lib/api';
import { mockApi } from '../lib/mockApi';
import { useAuth } from '../store/auth';
import type { Shift } from '../types';

function toMin(hhMm: string): number {
  const [h, m] = hhMm.split(':').map(Number);
  return h * 60 + m;
}

function covers(s: Pick<Shift, 'start_time' | 'end_time'>, t: number): boolean {
  const a = toMin(s.start_time);
  const b = toMin(s.end_time);
  return a <= b ? t >= a && t < b : t >= a || t < b;
}

// Overlap 2 khoảng tròn 1440p (mirror BE-013 — Warning không chặn).
function shiftsOverlap(a: Pick<Shift, 'start_time' | 'end_time'>, b: Pick<Shift, 'start_time' | 'end_time'>): boolean {
  return covers(a, toMin(b.start_time)) || covers(b, toMin(a.start_time));
}

let toastSeq = 500;

// FE-019 S3 tab "Định nghĩa ca" (admin-only): table 3 ca + edit giờ
// start/end inline dialog. Overlap → Warning, KHÔNG chặn (S3.3).
export function AttendanceShifts(): JSX.Element {
  const { logout } = useAuth();
  const [status, setStatus] = useState<'loading' | 'error' | 'ready'>('loading');
  const [error, setError] = useState('');
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [editing, setEditing] = useState<Shift | null>(null);
  const [name, setName] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [active, setActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const pushToast = useCallback((tone: ToastItem['tone'], text: string) => {
    const id = toastSeq++;
    setToasts((t) => [...t, { id, tone, text }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);

  const load = useCallback(async () => {
    setStatus('loading');
    const res = await callApi((a) => a.listShifts(), () => mockApi.listShifts());
    if (!res.ok || !res.data) {
      setError(res.error ?? 'Không tải được định nghĩa ca');
      setStatus('error');
      return;
    }
    setShifts(res.data);
    setStatus('ready');
  }, []);

  useEffect(() => { void load(); }, [load]);

  function openEdit(s: Shift): void {
    setEditing(s);
    setName(s.name);
    setStart(s.start_time);
    setEnd(s.end_time);
    setActive(s.is_active === 1);
    setSaveError('');
  }

  const timeBad = !/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end);
  const sameTime = !timeBad && start === end;
  const nameEmpty = name.trim() === '';
  const clash = editing !== null && !timeBad && !sameTime && active
    ? shifts.find((s) => s.id !== editing.id && s.is_active === 1 && shiftsOverlap({ start_time: start, end_time: end }, s)) ?? null
    : null;
  const canSave = !saving && editing !== null && !timeBad && !sameTime && !nameEmpty;

  async function handleSave(): Promise<void> {
    if (!canSave || !editing) return;
    setSaving(true);
    setSaveError('');
    const clashName = clash?.name ?? null;
    const res = await callApi(
      (a) => a.updateShift(editing.id, { name: name.trim(), start_time: start, end_time: end, is_active: active ? 1 : 0 }),
      () => mockApi.updateShift(editing.id, { name: name.trim(), start_time: start, end_time: end, is_active: active ? 1 : 0 }),
    );
    setSaving(false);
    if (!res.ok || !res.data) {
      setSaveError(res.error ?? 'Cập nhật ca thất bại');
      return;
    }
    const saved = res.data;
    setShifts((prev) => prev.map((s) => (s.id === saved.id ? saved : s)));
    setEditing(null);
    pushToast('success', clashName !== null
      ? `Đã cập nhật ${saved.name} ${saved.start_time}–${saved.end_time} — lưu ý: khung giờ trùng với ${clashName}.`
      : `Đã cập nhật ${saved.name} ${saved.start_time}–${saved.end_time}.`);
  }

  if (status === 'loading') {
    return <div className="card" aria-busy="true" aria-label="Đang tải định nghĩa ca"><SkeletonRows rows={3} /></div>;
  }

  if (status === 'error') {
    return (
      <div className="card">
        {/FORBIDDEN/i.test(error)
          ? (
            <>
              <Alert tone="danger">Phiên của bạn không còn quyền — đăng nhập lại.</Alert>
              <div style={{ marginTop: 12 }}>
                <Button variant="neutral" onClick={logout}>Đăng nhập lại</Button>
              </div>
            </>
          )
          : <RetryPanel message={error} onRetry={() => void load()} />}
      </div>
    );
  }

  return (
    <div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Ca</th>
              <th scope="col">Giờ</th>
              <th scope="col">Trạng thái</th>
              <th scope="col"><span className="sr-only">Hành động</span></th>
            </tr>
          </thead>
          <tbody>
            {shifts.map((s) => {
              const overnight = toMin(s.end_time) < toMin(s.start_time);
              return (
                <tr key={s.id}>
                  <td style={{ fontWeight: 600 }}>{s.name}</td>
                  <td className="mono">{s.start_time}–{s.end_time}{overnight ? ' (qua ngày)' : ''}</td>
                  <td>
                    {s.is_active === 1
                      ? <Badge tone="success">Đang mở</Badge>
                      : <Badge tone="muted">Đã tắt</Badge>}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-neutral btn-sm"
                      title={`Sửa ${s.name}`}
                      aria-label={`Sửa ${s.name}`}
                      onClick={() => openEdit(s)}
                    >
                      <Pencil size={16} strokeWidth={2} aria-hidden="true" /> Sửa
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="field-hint" style={{ marginTop: 8 }}>
        Ca tắt không xếp ca mới, lịch sử giữ nguyên. Ca đêm cho phép giờ kết thúc &lt; giờ bắt đầu (= qua ngày).
      </p>

      {editing !== null && (
        <Dialog title={`Sửa ${editing.name}`} onClose={() => setEditing(null)}>
          <div className="field">
            <label htmlFor="shift-name">Tên ca</label>
            <input
              id="shift-name"
              className="input"
              value={name}
              maxLength={50}
              aria-invalid={nameEmpty}
              onChange={(e) => setName(e.target.value)}
            />
            {nameEmpty && <span className="field-error">Tên ca là bắt buộc.</span>}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="field">
              <label htmlFor="shift-start">Bắt đầu (HH:mm)</label>
              <input
                id="shift-start"
                className="input mono"
                type="time"
                value={start}
                aria-invalid={timeBad || sameTime}
                onChange={(e) => setStart(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="shift-end">Kết thúc (HH:mm)</label>
              <input
                id="shift-end"
                className="input mono"
                type="time"
                value={end}
                aria-invalid={timeBad || sameTime}
                onChange={(e) => setEnd(e.target.value)}
              />
            </div>
          </div>
          {timeBad && <span className="field-error">Giờ chưa đúng định dạng HH:mm.</span>}
          {sameTime && <span className="field-error">Giờ bắt đầu phải khác giờ kết thúc.</span>}
          {!timeBad && !sameTime && toMin(end) < toMin(start) && (
            <p className="field-hint">Giờ kết thúc &lt; giờ bắt đầu = ca qua ngày (vd 22:00–06:00).</p>
          )}
          {clash !== null && (
            <div style={{ marginTop: 8 }}>
              <Alert tone="warning">
                Khung giờ trùng với {clash.name} ({clash.start_time}–{clash.end_time}) — vẫn lưu được, không chặn.
              </Alert>
            </div>
          )}
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12, fontSize: 14 }}>
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            Mở ca này (tắt = không xếp ca mới)
          </label>
          {saveError !== '' && (
            <div style={{ marginTop: 8 }}>
              <Alert tone="danger">{saveError}</Alert>
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
            <Button variant="neutral" onClick={() => setEditing(null)}>Hủy</Button>
            <Button variant="primary" disabled={!canSave} onClick={() => void handleSave()}>
              {saving ? 'Đang lưu…' : 'Lưu'}
            </Button>
          </div>
        </Dialog>
      )}
      <Toasts items={toasts} />
    </div>
  );
}

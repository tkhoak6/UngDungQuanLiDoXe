import { useCallback, useEffect, useMemo, useState, type JSX } from 'react';
import { CalendarClock } from 'lucide-react';
import { Alert, Badge, Button, RetryPanel, SkeletonRows, Toasts, type ToastItem } from '../components/ui';
import { callApi } from '../lib/api';
import { mockApi } from '../lib/mockApi';
import { attendanceShiftDate, elapsedHM, fmtHM, fmtSigned, isForbiddenError } from '../lib/attendance';
import { formatDateShort, formatVND, todayLocal } from '../lib/format';
import { useAuth } from '../store/auth';
import type { AttendanceRow, AttendanceTodayOutput, UserDTO } from '../types';
import { AttendanceShifts } from './AttendanceShifts';
import { AttendanceTable, type AttendanceRange } from './AttendanceTable';
import { CheckInDialog, CheckOutDialog } from './AttendanceDialogs';

type Status = 'loading' | 'error' | 'ready';

let toastSeq = 600;

// FE-019 S3 màn "Chấm công" (staff-area.md S3, nối BE-013): nav riêng
// (CalendarClock, staff+admin), thẻ ca hiện tại + banner "chốt bù" + table
// 7 ngày; admin thêm staff-filter + tab Định nghĩa ca. KHÔNG gửi staff_id
// ở check-in/out — backend ép me.id. Warning đối soát hiện, không chặn.
export function AttendancePage(): JSX.Element {
  const { role, userId, logout } = useAuth();
  const isAdmin = role === 'admin';
  const [tab, setTab] = useState<'mine' | 'shifts'>('mine');

  const [today, setToday] = useState<AttendanceTodayOutput | null>(null);
  const [todayStatus, setTodayStatus] = useState<Status>('loading');
  const [todayError, setTodayError] = useState('');

  const [rows, setRows] = useState<AttendanceRow[]>([]);
  const [total, setTotal] = useState(0);
  const [listStatus, setListStatus] = useState<Status>('loading');
  const [listError, setListError] = useState('');
  const [forbidden, setForbidden] = useState(false);
  const [staffUsers, setStaffUsers] = useState<UserDTO[]>([]);
  const [staffFilter, setStaffFilter] = useState<'all' | number>('all');
  const [range, setRange] = useState<AttendanceRange>('7d');
  const [from, setFrom] = useState(attendanceShiftDate(todayLocal(), -6));
  const [to, setTo] = useState(todayLocal());

  const [dialog, setDialog] = useState<null | 'in' | 'out'>(null);
  const [inCash, setInCash] = useState('');
  const [outCash, setOutCash] = useState('');
  const [outNote, setOutNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [dialogError, setDialogError] = useState('');
  const [result, setResult] = useState<{ revenue: number; variance: number | null } | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [, setTick] = useState(0);

  const pushToast = useCallback((tone: ToastItem['tone'], text: string) => {
    const id = toastSeq++;
    setToasts((t) => [...t, { id, tone, text }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);

  // Live "Đang trực Xh Ym" — tick 60s, không chatter SR (text ngoài aria-live).
  useEffect(() => {
    const t = window.setInterval(() => setTick((v) => v + 1), 60000);
    return () => window.clearInterval(t);
  }, []);

  const applyRange = useCallback((r: AttendanceRange) => {
    setRange(r);
    const t = todayLocal();
    if (r === 'today') {
      setFrom(t);
      setTo(t);
    } else if (r === '7d') {
      setFrom(attendanceShiftDate(t, -6));
      setTo(t);
    } else if (r === '30d') {
      setFrom(attendanceShiftDate(t, -29));
      setTo(t);
    }
  }, []);

  const loadToday = useCallback(async () => {
    if (role !== 'admin' && role !== 'staff') return;
    setTodayStatus('loading');
    const res = await callApi((a) => a.attendanceToday(), () => mockApi.attendanceToday());
    if (!res.ok || !res.data) {
      setTodayError(res.error ?? 'Không tải được ca hiện tại');
      setTodayStatus('error');
      return;
    }
    setToday(res.data);
    setTodayStatus('ready');
  }, [role]);

  useEffect(() => { void loadToday(); }, [loadToday]);

  // Admin-only staff list cho filter NV (staff bị ép mine_only, không render).
  useEffect(() => {
    if (role !== 'admin') return;
    let cancelled = false;
    void callApi((a) => a.listUsers(), () => mockApi.listUsers()).then((res) => {
      if (!cancelled && res.ok && res.data) setStaffUsers(res.data);
    });
    return () => {
      cancelled = true;
    };
  }, [role]);

  const loadList = useCallback(async () => {
    if (role !== 'admin' && role !== 'staff') return;
    setListStatus('loading');
    setForbidden(false);
    const input = {
      from: from || undefined,
      to: to || undefined,
      // Staff ép mine_only: backend force me.id (mock mirror qua login).
      staff_id: role === 'staff' ? (userId ?? -1) : staffFilter === 'all' ? undefined : staffFilter,
      limit: 200,
      offset: 0,
    };
    const res = await callApi((a) => a.listAttendance(input), () => mockApi.listAttendance(input));
    if (!res.ok || !res.data) {
      const msg = res.error ?? 'Không tải được bảng chấm công';
      if (isForbiddenError(msg)) setForbidden(true);
      setListError(msg);
      setListStatus('error');
      return;
    }
    setRows(res.data.rows);
    setTotal(res.data.total);
    setListStatus('ready');
  }, [role, userId, staffFilter, from, to]);

  useEffect(() => { void loadList(); }, [loadList]);

  // Prefill két bàn giao: closing ca gần nhất đã chốt của chính mình.
  const lastClosing = useMemo(() => {
    const mine = rows.filter((r) => r.user_id === userId && r.closing_cash !== null);
    if (mine.length === 0) return null;
    return mine.reduce((a, b) => (a.work_date > b.work_date || (a.work_date === b.work_date && a.id > b.id) ? a : b)).closing_cash;
  }, [rows, userId]);

  const current = today?.attendance ?? null;
  const currentOpen = current !== null && current.check_out_at === null;
  const pending = today?.pending_close ?? null;
  const pendingShiftName = pending === null
    ? ''
    : (rows.find((r) => r.shift_id === pending.shift_id)?.shift_name
      ?? (pending.shift_id === today?.shift.id ? today.shift.name : 'ca treo'));
  // Row sắp chốt = ca đang mở, ngược lại là ca treo (chốt bù).
  const checkoutBase = currentOpen && current !== null ? current : pending;

  function openCheckIn(): void {
    setInCash('');
    setDialogError('');
    setDialog('in');
  }

  function openCheckOut(): void {
    setOutCash('');
    setOutNote('');
    setDialogError('');
    setDialog('out');
  }

  async function handleCheckIn(): Promise<void> {
    if (saving) return;
    const trim = inCash.trim();
    if (trim !== '' && (!/^\d+$/.test(trim) || Number(trim) > 9007199254740991)) return;
    setSaving(true);
    setDialogError('');
    // KHÔNG gửi shift_id/shift_code (auto theo giờ tường) và KHÔNG gửi
    // staff_id (staff ép me.id — UI này không có luồng chấm hộ).
    const payload = { opening_cash: trim === '' ? 0 : Number(trim) };
    const res = await callApi((a) => a.checkInShift(payload), () => mockApi.checkInShift(payload));
    setSaving(false);
    if (!res.ok || !res.data) {
      setDialogError(res.error ?? 'Vào ca thất bại');
      return;
    }
    setDialog(null);
    pushToast('success', `Đã vào ca — chúc ca trực suôn sẻ.${res.data.status === 'late' ? ' (ghi nhận trễ giờ)' : ''}`);
    void loadToday();
    void loadList();
  }

  async function handleCheckOut(): Promise<void> {
    if (saving) return;
    const trim = outCash.trim();
    if ((trim !== '' && !/^\d+$/.test(trim)) || outNote.trim().length > 500) return;
    setSaving(true);
    setDialogError('');
    const payload = {
      closing_cash: trim === '' ? null : Number(trim),
      handover_note: outNote.trim() === '' ? undefined : outNote.trim(),
    };
    const res = await callApi((a) => a.checkOutShift(payload), () => mockApi.checkOutShift(payload));
    setSaving(false);
    if (!res.ok || !res.data) {
      setDialogError(res.error ?? 'Ra ca thất bại');
      return;
    }
    setDialog(null);
    setResult({ revenue: res.data.revenue_in_shift, variance: res.data.variance });
    pushToast('success', 'Đã chốt ca.');
    void loadToday();
    void loadList();
  }

  if (role !== 'admin' && role !== 'staff') {
    return (
      <div className="card">
        <Alert tone="danger">Bạn không có quyền truy cập trang này.</Alert>
        <div style={{ marginTop: 12 }}>
          <Button variant="neutral" onClick={logout}>Đăng nhập lại</Button>
        </div>
      </div>
    );
  }

  return (
    <div>
      {isAdmin && (
        <div
          className="tabs"
          role="tablist"
          aria-label="Chế độ xem chấm công"
          onKeyDown={(e) => {
            if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
            e.preventDefault();
            setTab((t) => (t === 'mine' ? 'shifts' : 'mine'));
          }}
        >
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'mine'}
            tabIndex={tab === 'mine' ? 0 : -1}
            className="tab"
            onClick={() => setTab('mine')}
          >
            Chấm công
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'shifts'}
            tabIndex={tab === 'shifts' ? 0 : -1}
            className="tab"
            onClick={() => setTab('shifts')}
          >
            Định nghĩa ca
          </button>
        </div>
      )}

      {!(isAdmin && tab === 'shifts') && (
      <>
      {pending !== null && (
        <div style={{ marginBottom: 12 }}>
          <Alert tone="warning">
            Bạn chưa chốt {pendingShiftName} ngày {formatDateShort(pending.work_date)} — bấm “Chốt bù” để chốt ca treo này.
            <span style={{ display: 'inline-block', marginLeft: 12 }}>
              <Button variant="neutral" onClick={openCheckOut}>Chốt bù</Button>
            </span>
          </Alert>
        </div>
      )}

      {result !== null && (
        <div style={{ marginBottom: 12 }}>
          {result.variance === null ? (
            <Alert tone="warning">
              Đã chốt ca — chưa nhập tiền cuối ca, admin đối soát sau.
            </Alert>
          ) : result.variance === 0 ? (
            <Alert tone="success">
              Đã chốt ca — thu trong ca {formatVND(result.revenue)} · đối soát khớp.
            </Alert>
          ) : (
            <Alert tone="warning">
              Đã chốt ca — thu trong ca {formatVND(result.revenue)} · đối soát lệch {fmtSigned(result.variance)} (thực − đầu ca − thu trong ca).
              Đã ghi nhận, không chặn — admin đối soát sau.
            </Alert>
          )}
        </div>
      )}

      {todayStatus === 'loading' && (
        <div className="card" aria-busy="true" aria-label="Đang tải ca hiện tại"><SkeletonRows rows={3} /></div>
      )}
      {todayStatus === 'error' && (
        <div className="card" style={{ marginBottom: 12 }}>
          <RetryPanel message={todayError} onRetry={() => void loadToday()} />
        </div>
      )}
      {todayStatus === 'ready' && today !== null && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <CalendarClock size={20} strokeWidth={2} aria-hidden="true" style={{ color: 'var(--color-text-60)' }} />
            <strong style={{ fontSize: 16 }}>
              {today.shift.name} · <span className="mono">{today.shift.start_time}–{today.shift.end_time}</span>
            </strong>
            <span className="field-hint">ngày {formatDateShort(today.work_date)}</span>
            <span style={{ flex: 1 }} />
            {current === null && <Badge tone="muted">Chưa vào ca</Badge>}
            {currentOpen && current !== null && (
              <span aria-live="polite">
                <Badge tone="primary">Đang trực {elapsedHM(current.check_in_at ?? '')}</Badge>
              </span>
            )}
            {current !== null && !currentOpen && <Badge tone="success">Đã chốt ca</Badge>}
          </div>
          {currentOpen && current !== null && (
            <p style={{ margin: '8px 0 0', fontSize: 14 }}>
              Vào lúc <span className="mono">{fmtHM(current.check_in_at)}</span>
              {' '}· Tiền đầu ca <span className="mono">{formatVND(current.opening_cash)}</span>
              {current.status === 'late' && (
                <> · <Badge tone="warning">Trễ giờ</Badge></>
              )}
            </p>
          )}
          {current !== null && !currentOpen && (
            <p style={{ margin: '8px 0 0', fontSize: 14 }}>
              {fmtHM(current.check_in_at)} → {fmtHM(current.check_out_at)}
              {' '}· Đầu ca <span className="mono">{formatVND(current.opening_cash)}</span>
              {' '}· Cuối ca <span className="mono">{current.closing_cash === null ? '—' : formatVND(current.closing_cash)}</span>
            </p>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            {current === null && (
              <Button variant="primary" onClick={openCheckIn}>Vào ca</Button>
            )}
            {currentOpen && (
              <Button variant="primary" onClick={openCheckOut}>Ra ca</Button>
            )}
            {current !== null && !currentOpen && (
              <Button variant="neutral" disabled>Đã chốt ca</Button>
            )}
          </div>
        </div>
      )}

      <AttendanceTable
        isAdmin={isAdmin}
        staffUsers={staffUsers}
        staffFilter={staffFilter}
        onStaffFilter={(v) => setStaffFilter(v)}
        range={range}
        onRange={applyRange}
        from={from}
        to={to}
        onFrom={setFrom}
        onTo={setTo}
        listStatus={listStatus}
        listError={listError}
        forbidden={forbidden}
        onRetry={() => void loadList()}
        onLogout={logout}
        rows={rows}
        total={total}
      />
      </>
      )}

      {isAdmin && tab === 'shifts' && (
        <div role="tabpanel" aria-label="Định nghĩa ca">
          <AttendanceShifts />
        </div>
      )}

      {dialog === 'in' && (
        <CheckInDialog
          inCash={inCash}
          onInCash={setInCash}
          lastClosing={lastClosing}
          saving={saving}
          error={dialogError}
          onClose={() => setDialog(null)}
          onSubmit={() => void handleCheckIn()}
        />
      )}

      {dialog === 'out' && checkoutBase !== null && (
        <CheckOutDialog
          outCash={outCash}
          onOutCash={setOutCash}
          outNote={outNote}
          onOutNote={setOutNote}
          openingCash={checkoutBase.opening_cash}
          isBackfill={!currentOpen}
          pendingWorkDate={pending?.work_date ?? ''}
          saving={saving}
          error={dialogError}
          onClose={() => setDialog(null)}
          onSubmit={() => void handleCheckOut()}
        />
      )}
      <Toasts items={toasts} />
    </div>
  );
}

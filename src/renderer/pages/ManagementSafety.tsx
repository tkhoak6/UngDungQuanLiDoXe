// Management M3 — An toàn & Sao lưu: sao lưu ngay + khôi phục (ghi đè) +
// nhật ký hệ thống (reuse activity:list). Spec ./specs/management-area.md §M3
// (nối BE-015 `backup:now` + `restore:from-file`). V1 không có audit_log (P2).

import { useCallback, useEffect, useState, type JSX } from 'react';
import { Alert, Badge, Button, Dialog, EmptyState, RetryPanel, SkeletonRows, Toasts, type ToastItem } from '../components/ui';
import { callApi } from '../lib/api';
import { mockApi } from '../lib/mockApi';
import { formatDateTime, formatVND } from '../lib/format';
import { LAST_BACKUP_KEY, readSettingsCache } from '../lib/management';
import { useAuth } from '../store/auth';
import type { ActivityRow } from '../types';

type Status = 'loading' | 'error' | 'ready';

let toastSeq = 700;

function readLastBackup(): string | null {
  try {
    return localStorage.getItem(LAST_BACKUP_KEY);
  } catch {
    return null;
  }
}

function writeLastBackup(note: string): void {
  try {
    localStorage.setItem(LAST_BACKUP_KEY, note);
  } catch {
    // non-fatal
  }
}

export function ManagementSafety(): JSX.Element {
  const { logout } = useAuth();
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState('');
  const [lastBackup, setLastBackup] = useState<string | null>(null);
  const [backing, setBacking] = useState(false);
  // Khôi phục
  const [fileName, setFileName] = useState('');
  const [fileSize, setFileSize] = useState(0);
  const [ackOverwrite, setAckOverwrite] = useState(false);
  const [confirmName, setConfirmName] = useState('');
  const [lotName, setLotName] = useState('');
  const [parkedCount, setParkedCount] = useState(0);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [needRestart, setNeedRestart] = useState<string | null>(null);
  // Nhật ký hệ thống
  const [logs, setLogs] = useState<ActivityRow[]>([]);
  const [logsTotal, setLogsTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const pushToast = useCallback((tone: ToastItem['tone'], text: string) => {
    const id = toastSeq++;
    setToasts((t) => [...t, { id, tone, text }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);

  const load = useCallback(async () => {
    setStatus('loading');
    setLastBackup(readLastBackup());
    const cached = readSettingsCache();
    setLotName(cached.lot_name);
    const [dRes, lRes] = await Promise.all([
      callApi((a) => a.dashboard(), () => mockApi.dashboard()),
      callApi(
        (a) => a.listActivity({ limit: 20, offset: (page - 1) * 20 }),
        () => mockApi.listActivity({ limit: 20, offset: (page - 1) * 20 }),
      ),
    ]);
    if (!dRes.ok) {
      if (/FORBIDDEN/i.test(dRes.error ?? '')) {
        setError('FORBIDDEN');
        setStatus('error');
        return;
      }
    }
    if (dRes.ok && dRes.data) setParkedCount(dRes.data.active_sessions);
    if (!lRes.ok || !lRes.data) {
      setError(lRes.error ?? 'Lỗi tải nhật ký hệ thống');
      setStatus('error');
      return;
    }
    setLogs(lRes.data.rows);
    setLogsTotal(lRes.data.total);
    setStatus('ready');
  }, [page]);

  useEffect(() => { void load(); }, [load]);

  async function handleBackup(): Promise<void> {
    setBacking(true);
    const res = await callApi((a) => a.backupNow(), () => mockApi.backupNow());
    setBacking(false);
    if (!res.ok || !res.data) {
      pushToast('danger', `Sao lưu thất bại: ${res.error ?? 'không ghi được — kiểm tra dung lượng/quyền.'}`);
      return;
    }
    const note = `${res.data.path} · ${formatDateTime(res.data.backed_up_at)}`;
    writeLastBackup(note);
    setLastBackup(note);
    pushToast('success', `Sao lưu xong: ${res.data.path}`);
  }

  function handlePickFile(file: File | undefined): void {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.db')) {
      pushToast('danger', 'File khôi phục phải có đuôi .db.');
      return;
    }
    setFileName(file.name);
    setFileSize(file.size);
  }

  async function handleRestore(): Promise<void> {
    // Backend thật mở open-dialog ở main (không nhận binary từ renderer);
    // metadata file chọn ở trên chỉ để đối soát trước khi xác nhận.
    setRestoring(true);
    const res = await callApi((a) => a.restoreFromFile(), () => mockApi.restoreFromFile());
    setRestoring(false);
    setConfirmOpen(false);
    if (!res.ok || !res.data) {
      const msg = res.error ?? 'Khôi phục thất bại';
      if (/xe đang đỗ|HAS_PARKED/i.test(msg)) {
        pushToast('danger', 'Còn xe đang đỗ — check-out hết trước khi khôi phục.');
      } else if (/NOT_SQLITE|INTEGRITY/i.test(msg)) {
        pushToast('danger', 'File backup hỏng — dùng bản pre-restore hoặc bản cũ hơn.');
      } else if (/SCHEMA_MISMATCH/i.test(msg)) {
        pushToast('danger', 'File từ phiên bản app khác — cập nhật app trước.');
      } else {
        pushToast('danger', `Khôi phục thất bại: ${msg}`);
      }
      return;
    }
    writeLastBackup(`pre-restore: ${res.data.backup_path}`);
    setNeedRestart(`Đã khôi phục (auto-backup: ${res.data.backup_path}). Khởi động lại app để mở DB mới.`);
  }

  const confirmReady = fileName !== '' && ackOverwrite && confirmName.trim() === lotName.trim() && lotName.trim() !== '';
  const blockedByParked = parkedCount > 0;

  // Màn hình chặn sau restore thành công (spec M3.4: restart-required).
  if (needRestart !== null) {
    return (
      <div className="card" role="alert" style={{ maxWidth: 560, margin: '48px auto', textAlign: 'center' }}>
        <h2>Đã khôi phục — cần khởi động lại</h2>
        <p style={{ fontSize: 14 }}>{needRestart}</p>
        <Button onClick={() => window.location.reload()}>Khởi động lại ngay</Button>
      </div>
    );
  }

  if (status === 'loading') {
    return <div className="card" aria-busy="true" aria-label="Đang tải an toàn và sao lưu"><SkeletonRows rows={8} /></div>;
  }
  if (status === 'error') {
    if (error === 'FORBIDDEN') {
      return (
        <div className="card">
          <Alert tone="danger">Phiên của bạn không còn quyền — đăng nhập lại.</Alert>
          <div style={{ marginTop: 12 }}>
            <Button variant="neutral" onClick={logout}>Đăng nhập lại</Button>
          </div>
        </div>
      );
    }
    return <div className="card"><RetryPanel message={error} onRetry={() => void load()} /></div>;
  }

  return (
    <div style={{ maxWidth: 720, display: 'flex', flexDirection: 'column', gap: 16 }}>
      {lastBackup === null && (
        <div className="alert alert-warning" role="status">
          Chưa có bản sao lưu nào — Sao lưu ngay trước khi tiếp tục.
        </div>
      )}

      <section className="card" aria-labelledby="safe-backup">
        <h3 id="safe-backup" style={{ margin: '0 0 8px', fontSize: 16 }}>Sao lưu dữ liệu</h3>
        <p className="mono" style={{ fontSize: 14, margin: '0 0 8px' }}>
          {lastBackup === null ? 'Chưa sao lưu lần nào' : `Lần sao lưu cuối: ${lastBackup}`}
        </p>
        <div style={{ marginBottom: 12 }}>
          <Badge tone={lastBackup === null ? 'warning' : 'success'}>
            {lastBackup === null ? 'Chưa sao lưu lần nào' : 'Tự động hằng ngày 03:00'}
          </Badge>
        </div>
        <Button disabled={backing} aria-busy={backing} onClick={() => void handleBackup()}>
          {backing ? 'Đang sao lưu…' : 'Sao lưu ngay (.db)'}
        </Button>
        <p style={{ fontSize: 12, color: 'var(--color-text-60)' }}>
          File .db chứa toàn bộ vé, vé tháng, ca trực. Lưu ra USB/ổ rời.
        </p>
      </section>

      <section className="card" aria-labelledby="safe-restore" style={{ border: '1px solid var(--color-danger)', background: 'rgba(220,38,38,0.04)' }}>
        <h3 id="safe-restore" style={{ margin: '0 0 8px', fontSize: 16 }}>Khôi phục dữ liệu</h3>
        <div className="field">
          <label htmlFor="restore-file">File backup (.db)</label>
          <input
            id="restore-file"
            type="file"
            accept=".db"
            aria-describedby="restore-warn"
            onChange={(e) => handlePickFile(e.target.files?.[0])}
          />
          {fileName !== '' && (
            <span className="field-hint mono">{fileName} · {(fileSize / 1024).toFixed(0)} KB</span>
          )}
        </div>
        <p id="restore-warn" style={{ fontSize: 14, fontWeight: 600 }}>
          Khôi phục sẽ GHI ĐÈ toàn bộ dữ liệu hiện tại. Tiếp tục chỉ khi đã sao lưu.
        </p>
        {blockedByParked && (
          <Alert tone="danger">
            Còn {parkedCount} xe đang đỗ — check-out hết trước khi khôi phục (không có ngoại lệ).
          </Alert>
        )}
        <div className="field">
          <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 14 }}>
            <input
              type="checkbox"
              checked={ackOverwrite}
              onChange={(e) => setAckOverwrite(e.target.checked)}
            />
            Tôi hiểu khôi phục sẽ GHI ĐÈ toàn bộ dữ liệu hiện tại
          </label>
        </div>
        <div className="field">
          <label htmlFor="restore-confirm">Gõ tên bãi để xác nhận (<span className="mono">{lotName}</span>)</label>
          <input
            id="restore-confirm"
            className="input"
            value={confirmName}
            placeholder={lotName}
            onChange={(e) => setConfirmName(e.target.value)}
            aria-describedby="restore-confirm-hint"
          />
          <span id="restore-confirm-hint" className="field-hint">Phải khớp chính xác, phân biệt hoa/thường.</span>
        </div>
        <button
          className="btn btn-danger"
          disabled={!confirmReady || blockedByParked}
          title={blockedByParked ? 'Còn xe đang đỗ' : !confirmReady ? 'Hoàn tất xác nhận để khôi phục' : undefined}
          onClick={() => setConfirmOpen(true)}
        >
          Khôi phục
        </button>
      </section>

      <section className="card" aria-labelledby="safe-logs">
        <h3 id="safe-logs" style={{ margin: '0 0 8px', fontSize: 16 }}>Nhật ký hệ thống</h3>
        {logsTotal === 0 ? (
          <EmptyState title="Chưa có hoạt động nào" hint="Các giao dịch thu phí sẽ hiện ở đây." />
        ) : (
          <>
            <div className="table-wrap">
              <table className="grid">
                <thead>
                  <tr>
                    <th scope="col">Thời gian</th>
                    <th scope="col">Nhân viên</th>
                    <th scope="col">Hành động</th>
                    <th scope="col">Chi tiết / số tiền</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((r, i) => (
                    <tr key={`${r.at}-${r.ticket_code ?? ''}-${i}`}>
                      <td className="mono" style={{ fontSize: 12 }}>{formatDateTime(r.at)}</td>
                      <td>
                        {r.full_name ?? r.username ?? (
                          <span style={{ fontSize: 12, color: 'var(--color-text-60)' }}>— (tài khoản đã xóa)</span>
                        )}
                      </td>
                      <td>
                        <Badge tone={r.action === 'check_in' ? 'primary' : r.action === 'check_out' ? 'success' : 'secondary'}>
                          {r.action === 'check_in' ? 'Check-in' : r.action === 'check_out' ? 'Check-out' : 'Bán vé tháng'}
                        </Badge>
                      </td>
                      <td>
                        <span className="mono" style={{ fontSize: 14 }}>{r.ticket_code ?? '—'}</span>
                        {r.amount !== null && r.amount !== undefined && (
                          <> · <span className="mono" style={{ fontSize: 14 }}>{formatVND(r.amount)}</span></>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="pager" aria-label="Phân trang nhật ký">
              <span className="mono" style={{ fontSize: 12 }}>Hiển thị {(page - 1) * 20 + 1}–{Math.min(page * 20, logsTotal)} / {logsTotal}</span>
              <span className="spacer" />
              <button className="btn btn-neutral btn-sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} aria-label="Trang trước">‹ Trước</button>
              <span className="mono" style={{ fontSize: 12 }} aria-live="polite">Trang {page}/{Math.max(1, Math.ceil(logsTotal / 20))}</span>
              <button className="btn btn-neutral btn-sm" disabled={page * 20 >= logsTotal} onClick={() => setPage((p) => p + 1)} aria-label="Trang sau">Sau ›</button>
            </div>
          </>
        )}
      </section>

      {confirmOpen && (
        <Dialog
          title={restoring ? 'Đang khôi phục…' : 'Xác nhận khôi phục?'}
          onClose={() => { if (!restoring) setConfirmOpen(false); }}
          label="Xác nhận khôi phục dữ liệu"
        >
          {restoring ? (
            <div role="alertdialog" aria-modal="true" aria-label="Đang khôi phục — không tắt app">
              <p style={{ fontSize: 14 }}>Đang khôi phục — <strong>không tắt app</strong>.</p>
              <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={50} aria-label="Tiến trình khôi phục">
                <div className="skeleton" style={{ height: 12 }} />
              </div>
              <p className="mono" style={{ fontSize: 12 }}>50%</p>
            </div>
          ) : (
            <>
              <p style={{ fontSize: 14 }}>
                Nguồn: <span className="mono">{fileName}</span>. Dữ liệu hiện tại sẽ MẤT (auto-backup
                trước ghi đè: <span className="mono">parking-pre-restore-TIMESTAMP.db</span>).
              </p>
              <div className="dialog-foot">
                <button className="btn btn-neutral" onClick={() => setConfirmOpen(false)}>Hủy</button>
                <button className="btn btn-danger" onClick={() => void handleRestore()}>Xác nhận khôi phục</button>
              </div>
            </>
          )}
        </Dialog>
      )}

      <Toasts items={toasts} />
    </div>
  );
}

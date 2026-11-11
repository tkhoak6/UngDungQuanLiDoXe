// Management M2 — Section "Máy chủ PocketBase" (FE-022, nối BE-016/BE-017).
// Ô URL server + ô Parking lot ID (+ copy hướng dẫn lấy id) + nút Kiểm tra
// (pb:test, hiện latency) + badge Trạng thái (Online/Local + lý do).
// Lưu qua app-config (validate URL http(s)); thiếu lot → banner hướng dẫn,
// KHÔNG chặn dùng local. Không hardcode URL — dùng DEFAULT_PB_URL.

import { useEffect, useState, type JSX } from 'react';
import { Alert, Badge, Button, SkeletonRows, Toasts, type ToastItem } from '../components/ui';
import { callApi } from '../lib/api';
import { mockApi } from '../lib/mockApi';
import { DEFAULT_PB_URL } from '../lib/management';
import type { PbStatus, PbTestResult } from '../types';

let toastSeq = 2200;

// Hướng dẫn xin ID bãi — copy cho admin gửi system_admin / tự tra cứu.
const LOT_GUIDE =
  'Mở PocketBase Admin → Collections → parking_lots → mở dòng bãi của bạn → Copy ID (dán vào ô Parking lot ID).';

const LOT_ID_RE = /^[A-Za-z0-9_-]{1,100}$/;
const URL_RE = /^https?:\/\/.+\..+/;

interface Props {
  initialUrl: string | null;
  initialLot: string | null;
  onDirty: () => void;
  notify: (tone: 'success' | 'danger', text: string) => void;
}

export function ManagementConfigServer({ initialUrl, initialLot, onDirty, notify }: Props): JSX.Element {
  const [url, setUrl] = useState(initialUrl ?? DEFAULT_PB_URL);
  const [lot, setLot] = useState(initialLot ?? '');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<PbStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [lastTest, setLastTest] = useState<PbTestResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  function pushToast(tone: ToastItem['tone'], text: string): void {
    const id = toastSeq++;
    setToasts((t) => [...t, { id, tone, text }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }

  useEffect(() => {
    let alive = true;
    void callApi(
      (a) => a.pbStatus(),
      () => mockApi.pbStatus(),
    ).then((res) => {
      if (!alive) return;
      setStatusLoading(false);
      if (res.ok && res.data) setStatus(res.data);
    });
    return () => { alive = false; };
  }, []);

  const urlTrimmed = url.trim().replace(/\/+$/, '');
  const lotTrimmed = lot.trim();
  const urlValid = urlTrimmed === '' || (urlTrimmed.length <= 500 && URL_RE.test(urlTrimmed));
  const lotValid = lotTrimmed === '' || LOT_ID_RE.test(lotTrimmed);
  const formValid = urlValid && lotValid;

  async function handleTest(): Promise<void> {
    if (!urlValid || testing) return;
    setTesting(true);
    setLastTest(null);
    const res = await callApi(
      (a) => a.testPbConnection(urlTrimmed === '' ? undefined : urlTrimmed),
      () => mockApi.testPbConnection(urlTrimmed === '' ? undefined : urlTrimmed),
    );
    setTesting(false);
    if (!res.ok || !res.data) {
      pushToast('danger', res.error ?? 'Kiểm tra kết nối thất bại');
      return;
    }
    setLastTest(res.data);
  }

  async function handleSave(): Promise<void> {
    if (!formValid || saving) return;
    const errs: Record<string, string> = {};
    if (!urlValid) errs.pb_url = 'Địa chỉ máy chủ phải bắt đầu bằng http(s)://.';
    if (!lotValid) errs.pb_parking_lot = 'Mã bãi chỉ gồm chữ/số/gạch dưới/gạch ngang (tối đa 100 ký tự).';
    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) return;
    setSaving(true);
    const res = await callApi(
      (a) => a.setAppConfig({
        pb_url: urlTrimmed === '' ? null : urlTrimmed,
        pb_parking_lot: lotTrimmed === '' ? null : lotTrimmed,
      }),
      () => mockApi.setAppConfig({
        pb_url: urlTrimmed === '' ? null : urlTrimmed,
        pb_parking_lot: lotTrimmed === '' ? null : lotTrimmed,
      }),
    );
    setSaving(false);
    if (!res.ok || !res.data) {
      if (res.fields) setFieldErrors(res.fields);
      notify('danger', res.error ?? 'Lưu cấu hình máy chủ thất bại');
      return;
    }
    // Refresh badge sau khi lưu (BE-017 trả message hướng dẫn khi thiếu —
    // UI tự suy lý do từ data, không cần message).
    setStatus({
      online: false,
      mode: 'local-first',
      pb_url: res.data.pb_url ?? '',
      latency_ms: null,
      parking_lot: res.data.pb_parking_lot,
    });
    setFieldErrors({});
    notify('success', 'Đã lưu cấu hình máy chủ.');
  }

  function handleCopyGuide(): void {
    const done = (): void => pushToast('success', 'Đã copy hướng dẫn lấy ID bãi.');
    try {
      const p = navigator.clipboard?.writeText(LOT_GUIDE);
      if (p && typeof p.then === 'function') {
        p.then(done, () => pushToast('danger', 'Không copy được — xem hướng dẫn bên dưới.'));
        return;
      }
      done();
    } catch {
      pushToast('danger', 'Không copy được — xem hướng dẫn bên dưới.');
    }
  }

  const missingLot = lotTrimmed === '';
  const statusReason = status === null
    ? null
    : status.online
      ? null
      : !status.pb_url
        ? 'Chưa cấu hình URL máy chủ — đang dùng dữ liệu máy này (local-only).'
        : !status.parking_lot
          ? 'Chưa cấu hình mã bãi — đang dùng dữ liệu máy này (local-only).'
          : 'Mất kết nối máy chủ — đang dùng dữ liệu máy này.';

  return (
    <section className="card" aria-labelledby="cfg-server">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <h3 id="cfg-server" style={{ margin: 0, fontSize: 16 }}>Máy chủ PocketBase</h3>
        {statusLoading || status === null
          ? <Badge tone="muted">Đang kiểm tra…</Badge>
          : status.online
            ? <Badge tone="success">Online</Badge>
            : <Badge tone="warning">Local</Badge>}
      </div>
      {statusReason && (
        <p style={{ fontSize: 12, color: 'var(--color-text-60)', margin: '0 0 12px' }}>{statusReason}</p>
      )}

      <div className="field">
        <label htmlFor="srv-url">URL server</label>
        <input
          id="srv-url" className="input mono" inputMode="url" autoComplete="url"
          placeholder={DEFAULT_PB_URL} value={url}
          onChange={(e) => { setUrl(e.target.value); onDirty(); }}
          aria-invalid={Boolean(fieldErrors.pb_url) || !urlValid}
          aria-describedby="srv-url-hint"
        />
        <span id="srv-url-hint" className="field-hint">Để trống = chỉ dùng máy này (local-only). Mặc định: {DEFAULT_PB_URL}</span>
        {(!urlValid || fieldErrors.pb_url) && (
          <span className="field-error">{fieldErrors.pb_url ?? 'Địa chỉ máy chủ phải bắt đầu bằng http(s)://.'}</span>
        )}
      </div>

      <div className="field">
        <label htmlFor="srv-lot">Parking lot ID</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            id="srv-lot" className="input mono" style={{ flex: 1 }} value={lot}
            placeholder="VD: pbc_abc123…" spellCheck={false}
            onChange={(e) => { setLot(e.target.value); onDirty(); }}
            aria-invalid={Boolean(fieldErrors.pb_parking_lot) || !lotValid}
            aria-describedby="srv-lot-hint"
          />
          <button type="button" className="btn btn-neutral btn-sm" onClick={handleCopyGuide}>
            Copy hướng dẫn lấy ID
          </button>
        </div>
        <span id="srv-lot-hint" className="field-hint">{LOT_GUIDE}</span>
        {(!lotValid || fieldErrors.pb_parking_lot) && (
          <span className="field-error">{fieldErrors.pb_parking_lot ?? 'Mã bãi chỉ gồm chữ/số/gạch dưới/gạch ngang (tối đa 100 ký tự).'}</span>
        )}
      </div>

      {missingLot && (
        <Alert tone="warning">
          Chưa nhập mã bãi — app vẫn chạy bình thường bằng dữ liệu máy này (local-only).
          Xin ID bãi từ system_admin rồi dán vào ô trên để bật đồng bộ online.
        </Alert>
      )}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 4 }}>
        <button
          type="button" className="btn btn-neutral" disabled={!urlValid || testing}
          onClick={() => void handleTest()} aria-busy={testing}
        >
          {testing ? 'Đang kiểm tra…' : 'Kiểm tra'}
        </button>
        <Button disabled={!formValid || saving} onClick={() => void handleSave()}>
          {saving ? 'Đang lưu…' : 'Lưu máy chủ'}
        </Button>
        {lastTest && (
          <span style={{ fontSize: 13 }} role="status">
            {lastTest.reachable
              ? <>Kết nối OK · <span className="mono">{lastTest.latency_ms ?? '?'}ms</span></>
              : 'Không kết nối được — kiểm tra địa chỉ/mạng.'}
          </span>
        )}
      </div>

      {statusLoading && (
        <div style={{ marginTop: 12 }} aria-busy="true" aria-label="Đang tải trạng thái máy chủ">
          <SkeletonRows rows={1} />
        </div>
      )}

      <Toasts items={toasts} />
    </section>
  );
}

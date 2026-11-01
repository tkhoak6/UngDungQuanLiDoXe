import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import { CircleUserRound, Eye, EyeOff, KeyRound } from 'lucide-react';
import { Alert, Badge, Button, RetryPanel, SkeletonRows, Toasts, type ToastItem } from '../components/ui';
import { useAuth } from '../store/auth';
import { callApi } from '../lib/api';
import { mockApi } from '../lib/mockApi';
import { formatVND } from '../lib/format';
import type { MonthlyPass } from '../types';

type Status = 'loading' | 'error' | 'ready';

const MIN_NAME_LEN = 2;
const MAX_NAME_LEN = 50;
const MIN_PASSWORD_LEN = 6;

interface ProfilePageProps {
  /** GuestPage dirty-guard: báo tab cha khi form có thay đổi chưa lưu. */
  onDirtyChange?: (dirty: boolean) => void;
}

export function ProfilePage({ onDirtyChange }: ProfilePageProps = {}): JSX.Element {
  const { logout, refreshProfile } = useAuth();
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState('');
  const [forbidden, setForbidden] = useState(false);
  const [userId, setUserId] = useState<number | null>(null);
  const [phone, setPhone] = useState('');
  const [savedName, setSavedName] = useState('');
  // FE-014 (customer P3): vé đang chờ xác nhận — badge, read-only (quản lý
  // đăng ký trong tab "Xe của tôi"). Lỗi ở đây không chặn hồ sơ.
  const [pendingPasses, setPendingPasses] = useState<MonthlyPass[]>([]);

  // Card 1 — họ tên
  const [fullName, setFullName] = useState('');
  const [nameError, setNameError] = useState('');
  const [nameBusy, setNameBusy] = useState(false);
  const [nameTouched, setNameTouched] = useState(false);

  // Card 2 — đổi mật khẩu
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [pwErrors, setPwErrors] = useState<{ current?: string; next?: string; confirm?: string }>({});
  const [pwSummary, setPwSummary] = useState('');
  const [pwBusy, setPwBusy] = useState(false);

  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastSeq = useRef(1);
  const nameAlertRef = useRef<HTMLDivElement>(null);

  const pushToast = useCallback((tone: ToastItem['tone'], text: string): void => {
    const id = toastSeq.current++;
    setToasts((t) => [...t, { id, tone, text }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);

  const dirty = fullName !== savedName || currentPw !== '' || newPw !== '' || confirmPw !== '';
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  const load = useCallback(async (): Promise<void> => {
    setStatus('loading');
    setForbidden(false);
    const res = await callApi((a) => a.myProfile(), () => mockApi.myProfile());
    if (!res.ok) {
      // Backend mine-only guard: customer ép id = me.id, sai id → FORBIDDEN.
      if (/quyền|forbidden|đăng nhập/i.test(res.error ?? '')) setForbidden(true);
      setError(res.error ?? 'Không tải được hồ sơ');
      setStatus('error');
      return;
    }
    const p = res.data;
    if (!p) {
      setError('Không tải được hồ sơ');
      setStatus('error');
      return;
    }
    setUserId(p.id);
    setPhone(p.phone ?? '');
    setSavedName(p.full_name);
    setFullName(p.full_name);
    setNameError('');
    setStatus('ready');
    // Vé pending: best-effort (backend đọc store local) — lỗi thì ẩn card.
    void callApi((a) => a.myPendingPasses(), () => mockApi.myPendingPasses()).then((pp) => {
      if (pp.ok) setPendingPasses(pp.data ?? []);
    });
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function validateName(value: string): string {
    const v = value.trim();
    if (!v) return 'Vui lòng nhập họ và tên.';
    if (v.length < MIN_NAME_LEN) return 'Họ tên phải ≥2 ký tự.';
    if (v.length > MAX_NAME_LEN) return `Họ tên tối đa ${MAX_NAME_LEN} ký tự.`;
    return '';
  }

  async function handleSaveName(): Promise<void> {
    const err = validateName(fullName);
    setNameError(err);
    setNameTouched(true);
    if (err || userId === null) {
      nameAlertRef.current?.focus();
      return;
    }
    setNameBusy(true);
    const res = await callApi(
      (a) => a.updateProfile(userId, { full_name: fullName.trim() }),
      () => mockApi.updateProfile(userId, { full_name: fullName.trim() }),
    );
    setNameBusy(false);
    if (!res.ok) {
      // Field error từ backend (errors.full_name) → inline; còn lại → banner.
      setNameError(res.fields?.full_name ?? res.error ?? 'Lưu thất bại');
      return;
    }
    setSavedName(res.data?.full_name ?? fullName.trim());
    refreshProfile(res.data?.full_name ?? fullName.trim());
    pushToast('success', 'Đã cập nhật họ tên.');
  }

  function validatePassword(): { current?: string; next?: string; confirm?: string } {
    const errs: { current?: string; next?: string; confirm?: string } = {};
    if (!currentPw) errs.current = 'Vui lòng nhập mật khẩu hiện tại.';
    if (!newPw) errs.next = 'Vui lòng nhập mật khẩu mới.';
    else if (newPw.length < MIN_PASSWORD_LEN) errs.next = 'Mật khẩu phải ≥6 ký tự.';
    else if (newPw === currentPw) errs.next = 'Mật khẩu mới phải khác mật khẩu hiện tại.';
    if (!confirmPw) errs.confirm = 'Vui lòng xác nhận mật khẩu mới.';
    else if (confirmPw !== newPw) errs.confirm = 'Mật khẩu xác nhận chưa khớp.';
    return errs;
  }

  async function handleChangePassword(): Promise<void> {
    const errs = validatePassword();
    setPwErrors(errs);
    const count = Object.keys(errs).length;
    if (count > 0) {
      // Không disable cứng CTA (spec §P1.3) — SR nghe banner tổng hợp.
      setPwSummary(`Còn ${count} mục cần sửa.`);
      return;
    }
    setPwSummary('');
    if (userId === null) return;
    setPwBusy(true);
    const res = await callApi(
      (a) => a.updateProfile(userId, { new_password: newPw, current_password: currentPw }),
      () => mockApi.updateProfile(userId, { new_password: newPw, current_password: currentPw }),
    );
    setPwBusy(false);
    if (!res.ok) {
      // Sai pass hiện tại → inline dưới field (không banner chung, §P1.4).
      const mapped: typeof errs = {};
      if (res.fields?.current_password ?? /hiện tại/i.test(res.error ?? '')) {
        mapped.current = res.fields?.current_password ?? res.error ?? 'Mật khẩu hiện tại chưa đúng.';
      }
      if (res.fields?.new_password) mapped.next = res.fields.new_password;
      if (Object.keys(mapped).length > 0) {
        setPwErrors(mapped);
        return;
      }
      if (/quyền|forbidden|đăng nhập/i.test(res.error ?? '')) {
        setForbidden(true);
        setStatus('error');
        setError(res.error ?? 'Phiên hết hạn');
        return;
      }
      setPwSummary(res.error ?? 'Đổi mật khẩu thất bại');
      return;
    }
    setCurrentPw('');
    setNewPw('');
    setConfirmPw('');
    setPwErrors({});
    pushToast('success', 'Đổi mật khẩu thành công — phiên khác đã đăng xuất.');
  }

  if (status === 'loading') {
    return (
      <div className="profile-col" aria-busy="true" aria-label="Đang tải hồ sơ">
        <div className="card"><SkeletonRows rows={3} height={40} /></div>
        <div className="card"><SkeletonRows rows={4} height={40} /></div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="card" style={{ maxWidth: 640 }}>
        {forbidden ? (
          <>
            <Alert tone="danger">Phiên của bạn không còn quyền — đăng nhập lại.</Alert>
            <div style={{ marginTop: 12 }}>
              <Button variant="neutral" onClick={logout}>Đăng nhập lại</Button>
            </div>
          </>
        ) : (
          <RetryPanel message={error} onRetry={() => void load()} />
        )}
      </div>
    );
  }

  return (
    <div className="profile-col">
      {/* Card 1 — Thông tin cá nhân */}
      <section className="card" aria-labelledby="profile-info-title">
        <h2 id="profile-info-title" style={{ margin: '0 0 4px', fontSize: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
          <CircleUserRound size={16} strokeWidth={2} aria-hidden="true" /> Thông tin cá nhân
        </h2>
        <p style={{ margin: '0 0 16px', fontSize: 12, color: 'var(--color-text-60)' }}>
          Hồ sơ của chính bạn — SĐT là tài khoản đăng nhập, không thể tự đổi.
        </p>
        <div className="field">
          <label htmlFor="profile-phone">Số điện thoại</label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              id="profile-phone"
              className="input mono"
              style={{ fontSize: 14 }}
              value={phone}
              readOnly
              aria-readonly="true"
              aria-describedby="profile-phone-desc"
            />
            <Badge tone="muted">Dùng để đăng nhập</Badge>
          </div>
          <span id="profile-phone-desc" className="field-hint">
            Muốn đổi số điện thoại — vui lòng ra quầy (số này liên kết xe của bạn).
          </span>
        </div>
        <div className="field">
          <label htmlFor="profile-name">Họ và tên</label>
          <input
            id="profile-name"
            className="input"
            value={fullName}
            aria-invalid={Boolean(nameError)}
            aria-describedby={nameError ? 'profile-name-desc' : undefined}
            onChange={(e) => {
              setFullName(e.target.value);
              if (nameTouched) setNameError(validateName(e.target.value));
            }}
            onBlur={() => {
              setNameTouched(true);
              setNameError(validateName(fullName));
            }}
          />
          {nameError && (
            <span id="profile-name-desc" className="field-error">{nameError}</span>
          )}
        </div>
        <div ref={nameAlertRef} tabIndex={-1} style={{ outline: 'none' }} />
        <Button onClick={() => void handleSaveName()} disabled={nameBusy || fullName.trim() === savedName} aria-busy={nameBusy}>
          {nameBusy ? 'Đang lưu…' : 'Lưu thay đổi'}
        </Button>
      </section>

      {/* Card 2 — Đổi mật khẩu */}
      <section className="card" aria-labelledby="profile-pw-title" aria-busy={pwBusy}>
        <h2 id="profile-pw-title" style={{ margin: '0 0 4px', fontSize: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
          <KeyRound size={16} strokeWidth={2} aria-hidden="true" /> Đổi mật khẩu
        </h2>
        <p style={{ margin: '0 0 16px', fontSize: 12, color: 'var(--color-text-60)' }}>
          Mật khẩu mới tối thiểu 6 ký tự và phải khác mật khẩu hiện tại.
        </p>
        {pwSummary && (
          <div style={{ marginBottom: 12 }}>
            <Alert tone="danger" role="alert">{pwSummary}</Alert>
          </div>
        )}
        <div className="field">
          <label htmlFor="profile-current">Mật khẩu hiện tại</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              id="profile-current"
              className="input"
              type={showCurrent ? 'text' : 'password'}
              value={currentPw}
              autoComplete="current-password"
              aria-invalid={Boolean(pwErrors.current)}
              aria-describedby={pwErrors.current ? 'profile-current-desc' : undefined}
              onChange={(e) => {
                setCurrentPw(e.target.value);
                setPwErrors((p) => ({ ...p, current: undefined }));
              }}
            />
            <button
              type="button"
              className="btn btn-neutral btn-sm"
              style={{ height: 40 }}
              aria-pressed={showCurrent}
              aria-label={showCurrent ? 'Ẩn mật khẩu hiện tại' : 'Hiện mật khẩu hiện tại'}
              onClick={() => setShowCurrent((v) => !v)}
            >
              {showCurrent ? <EyeOff size={16} strokeWidth={2} aria-hidden="true" /> : <Eye size={16} strokeWidth={2} aria-hidden="true" />}
            </button>
          </div>
          {pwErrors.current && (
            <span id="profile-current-desc" className="field-error">{pwErrors.current}</span>
          )}
        </div>
        <div className="field">
          <label htmlFor="profile-new">Mật khẩu mới</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              id="profile-new"
              className="input"
              type={showNew ? 'text' : 'password'}
              value={newPw}
              autoComplete="new-password"
              aria-invalid={Boolean(pwErrors.next)}
              aria-describedby={pwErrors.next ? 'profile-new-desc' : 'profile-new-hint'}
              onChange={(e) => {
                setNewPw(e.target.value);
                setPwErrors((p) => ({ ...p, next: undefined, confirm: undefined }));
              }}
            />
            <button
              type="button"
              className="btn btn-neutral btn-sm"
              style={{ height: 40 }}
              aria-pressed={showNew}
              aria-label={showNew ? 'Ẩn mật khẩu mới' : 'Hiện mật khẩu mới'}
              onClick={() => setShowNew((v) => !v)}
            >
              {showNew ? <EyeOff size={16} strokeWidth={2} aria-hidden="true" /> : <Eye size={16} strokeWidth={2} aria-hidden="true" />}
            </button>
          </div>
          {pwErrors.next ? (
            <span id="profile-new-desc" className="field-error">{pwErrors.next}</span>
          ) : (
            <span id="profile-new-hint" className="field-hint">Tối thiểu 6 ký tự, khác mật khẩu hiện tại.</span>
          )}
        </div>
        <div className="field">
          <label htmlFor="profile-confirm">Xác nhận mật khẩu mới</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              id="profile-confirm"
              className="input"
              type={showConfirm ? 'text' : 'password'}
              value={confirmPw}
              autoComplete="new-password"
              aria-invalid={Boolean(pwErrors.confirm)}
              aria-describedby={pwErrors.confirm ? 'profile-confirm-desc' : undefined}
              onChange={(e) => {
                setConfirmPw(e.target.value);
                setPwErrors((p) => ({ ...p, confirm: undefined }));
              }}
            />
            <button
              type="button"
              className="btn btn-neutral btn-sm"
              style={{ height: 40 }}
              aria-pressed={showConfirm}
              aria-label={showConfirm ? 'Ẩn xác nhận mật khẩu' : 'Hiện xác nhận mật khẩu'}
              onClick={() => setShowConfirm((v) => !v)}
            >
              {showConfirm ? <EyeOff size={16} strokeWidth={2} aria-hidden="true" /> : <Eye size={16} strokeWidth={2} aria-hidden="true" />}
            </button>
          </div>
          {pwErrors.confirm && (
            <span id="profile-confirm-desc" className="field-error">{pwErrors.confirm}</span>
          )}
        </div>
        <Button variant="neutral" onClick={() => void handleChangePassword()} disabled={pwBusy} aria-busy={pwBusy}>
          {pwBusy ? 'Đang đổi…' : 'Đổi mật khẩu'}
        </Button>
      </section>

      {/* FE-014: Vé tháng đang chờ xác nhận (badge, read-only). */}
      {pendingPasses.length > 0 && (
        <section className="card" aria-labelledby="profile-pending-title">
          <h2 id="profile-pending-title" style={{ margin: '0 0 4px', fontSize: 16 }}>
            Vé tháng đang chờ xác nhận
          </h2>
          <p style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--color-text-60)' }}>
            Mang tiền ra quầy để kích hoạt — quản lý đăng ký trong tab “Xe của tôi”.
          </p>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {pendingPasses.map((p) => (
              <li key={p.pass_code} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
                <span className="mono">{p.pass_code}</span>
                <Badge tone="warning">Chờ xác nhận</Badge>
                <span className="mono" style={{ marginLeft: 'auto' }}>{formatVND(p.price)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Toasts items={toasts} />
    </div>
  );
}

import { useEffect, useRef, useState, type FormEvent, type JSX } from 'react';
import { Eye, EyeOff, TriangleAlert } from 'lucide-react';
import { useAuth, consumeLogoutFlash } from '../store/auth';
import { Button, Alert } from '../components/ui';
import { callApi } from '../lib/api';
import { mockApi } from '../lib/mockApi';

// FE-012 rewrite (spec ./specs/auth-flow.md): 1 card — 2 modes switched by
// text link (no tabs, no role cards). Login keeps IPC `auth:login` untouched;
// register calls `auth:register` then auto-logins via login(phone, password).

type Mode = 'login' | 'register';

const PHONE_RE = /^0\d{9}$/;
const MIN_LOGIN_LEN = 3;
const MIN_NAME_LEN = 2;
const MAX_NAME_LEN = 50;
const MIN_PASSWORD_LEN = 6;

type ServerKind = 'creds' | 'locked' | 'network';

const SERVER_COPY: Record<ServerKind, string> = {
  creds: 'Sai tên đăng nhập hoặc mật khẩu. Vui lòng thử lại.',
  locked: 'Tài khoản đã bị khóa — vui lòng liên hệ Admin.',
  network: 'Không thể kết nối máy chủ. Vui lòng thử lại.',
};

// Map transport/server messages to spec copy without hardcoding backend
// strings — loose keyword match only (spec §3/§4).
function classifyServerError(message: string): ServerKind {
  if (/kh[oó]a|locked|disabled|suspend/i.test(message)) return 'locked';
  if (/k[eê]t n[oô]i|network|ipc|failed|econn|m[aá]y ch[uủ]|th[iì] l[aạ]i|timeout/i.test(message)) return 'network';
  return 'creds';
}

function isPhoneTakenError(message: string): boolean {
  return /đăng k[yý]|t[oô]n t[aạ]i|exists|taken|409/i.test(message);
}

export function LoginPage(): JSX.Element {
  const { loginAs, enterAsGuest } = useAuth();
  const [mode, setMode] = useState<Mode>('login');
  const [announce, setAnnounce] = useState('');

  // ---- login state ----
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [capsOn, setCapsOn] = useState(false);
  const [loginErrors, setLoginErrors] = useState<{ identifier?: string; password?: string }>({});
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginServer, setLoginServer] = useState<ServerKind | null>(null);
  // FE-026 (nối BE-023): "Ghi nhớ đăng nhập" — QUYẾT ĐỊNH default OFF (an toàn:
  // máy quầy dùng chung, tránh phiên cũ tự vào app khi đổi ca).
  const [remember, setRemember] = useState(false);
  // FE-026: flash 1 lần "Đã đăng xuất." sau logout (KHÔNG confirm lúc bấm —
  // quyết định 1 click + toast xác nhận, đăng nhập lại rẻ).
  const [loggedOut, setLoggedOut] = useState(false);

  useEffect(() => {
    if (consumeLogoutFlash()) setLoggedOut(true);
  }, []);

  // ---- register state ----
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [showNewPw, setShowNewPw] = useState(false);
  const [showConfirmPw, setShowConfirmPw] = useState(false);
  const [regCapsOn, setRegCapsOn] = useState(false);
  const [regErrors, setRegErrors] = useState<{ fullName?: string; phone?: string; password?: string; confirm?: string }>({});
  const [regSummary, setRegSummary] = useState<string | null>(null);
  const [phoneTaken, setPhoneTaken] = useState(false);
  const [regServer, setRegServer] = useState<ServerKind | null>(null);
  const [regPhase, setRegPhase] = useState<'idle' | 'registering' | 'logging-in'>('idle');
  const [welcome, setWelcome] = useState<string | null>(null);

  const bannerRef = useRef<HTMLDivElement>(null);
  const loginFirstRef = useRef<HTMLInputElement>(null);
  const registerFirstRef = useRef<HTMLInputElement>(null);

  function switchMode(next: Mode): void {
    setMode(next);
    setLoginServer(null);
    setRegServer(null);
    setRegSummary(null);
    setPhoneTaken(false);
    setWelcome(null);
    setAnnounce(
      next === 'register'
        ? 'Đã chuyển sang form đăng ký tài khoản khách hàng'
        : 'Đã chuyển sang form đăng nhập',
    );
  }

  useEffect(() => {
    if (mode === 'register') registerFirstRef.current?.focus();
    else loginFirstRef.current?.focus();
  }, [mode]);

  useEffect(() => {
    if (loginServer !== null || regServer !== null || regSummary !== null) bannerRef.current?.focus();
  }, [loginServer, regServer, regSummary]);

  function clearLoginField(field: 'identifier' | 'password'): void {
    setLoginErrors((s) => (s[field] === undefined ? s : { ...s, [field]: undefined }));
  }

  function clearRegField(field: 'fullName' | 'phone' | 'password' | 'confirm'): void {
    setRegErrors((s) => (s[field] === undefined ? s : { ...s, [field]: undefined }));
    if (field === 'phone') setPhoneTaken(false);
  }

  async function doLogin(): Promise<void> {
    const id = identifier.trim();
    const idErr = !id
      ? 'Vui lòng nhập tên đăng nhập.'
      : id.length < MIN_LOGIN_LEN
        ? 'Tên đăng nhập phải ≥3 ký tự.'
        : undefined;
    const pwErr = !password ? 'Vui lòng nhập mật khẩu.' : undefined;
    setLoginErrors({ identifier: idErr, password: pwErr });
    if (idErr !== undefined || pwErr !== undefined) return;
    setLoginBusy(true);
    setLoginServer(null);
    setLoggedOut(false);
    const res = await loginAs(id, password, remember);
    setLoginBusy(false);
    if (!res.ok) setLoginServer(classifyServerError(res.error ?? ''));
  }

  async function handleLoginSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    await doLogin();
  }

  function validateRegister(): { fullName?: string; phone?: string; password?: string; confirm?: string } {
    const name = fullName.trim();
    const errs: { fullName?: string; phone?: string; password?: string; confirm?: string } = {};
    if (!name) errs.fullName = 'Vui lòng nhập họ và tên.';
    else if (name.length < MIN_NAME_LEN) errs.fullName = 'Họ tên phải ≥2 ký tự.';
    else if (name.length > MAX_NAME_LEN) errs.fullName = 'Họ tên tối đa 50 ký tự.';
    if (!phone.trim()) errs.phone = 'Vui lòng nhập số điện thoại.';
    else if (!PHONE_RE.test(phone.trim())) errs.phone = 'Số điện thoại phải 10 số, bắt đầu bằng 0 (VD: 0912345678).';
    if (!newPw) errs.password = 'Vui lòng đặt mật khẩu.';
    else if (newPw.length < MIN_PASSWORD_LEN) errs.password = 'Mật khẩu phải ≥6 ký tự.';
    if (!confirmPw) errs.confirm = 'Vui lòng xác nhận mật khẩu.';
    else if (confirmPw !== newPw) errs.confirm = 'Mật khẩu xác nhận chưa khớp.';
    return errs;
  }

  async function doRegister(): Promise<void> {
    const errs = validateRegister();
    setRegErrors(errs);
    const count = Object.values(errs).filter((v) => v !== undefined).length;
    if (count > 0) {
      setRegSummary(`Còn ${count} mục cần sửa — kiểm tra các dòng đỏ.`);
      setRegServer(null);
      return;
    }
    setRegSummary(null);
    setRegServer(null);
    setPhoneTaken(false);
    // Client contract (BE-007): no auto-login server-side — register, then
    // login(phone, password) explicitly so routing follows the server role.
    setRegPhase('registering');
    const reg = await callApi(
      (api) => api.register({ full_name: fullName.trim(), phone: phone.trim(), password: newPw }),
      () => mockApi.register({ full_name: fullName.trim(), phone: phone.trim(), password: newPw }),
    );
    if (!reg.ok) {
      setRegPhase('idle');
      const msg = reg.error ?? '';
      if (isPhoneTakenError(msg)) {
        setRegErrors((s) => ({ ...s, phone: 'Số điện thoại đã được đăng ký — hãy Đăng nhập hoặc dùng số khác.' }));
        setPhoneTaken(true);
      } else {
        // A fresh register can never be "locked" — map it to retryable network.
        const kind = classifyServerError(msg);
        setRegServer(kind === 'locked' ? 'network' : kind);
      }
      return;
    }
    setWelcome(`Đăng ký thành công — chào mừng ${reg.data?.fullName ?? fullName.trim()}!`);
    setRegPhase('logging-in');
    const loginRes = await loginAs(phone.trim(), newPw);
    if (!loginRes.ok) {
      // Rare (account was just created) — surface as retryable, keep session form.
      setRegPhase('idle');
      setRegServer('network');
    }
    // On success App.tsx routes by server role (customer → Sơ đồ).
  }

  async function handleRegisterSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    await doRegister();
  }

  function goToLoginPrefillPhone(): void {
    setIdentifier(phone.trim());
    setPassword('');
    setLoginErrors({});
    switchMode('login');
  }

  const busy = loginBusy || regPhase !== 'idle';
  const bannerKind = mode === 'login' ? loginServer : regServer;

  return (
    <div className="login-wrap">
      <div className="login-brand">
        <h1>Bãi xe thông minh</h1>
        <ul style={{ fontSize: 16, lineHeight: 2, paddingLeft: 20, margin: 0 }}>
          <li>Check-in / check-out trong vài giây</li>
          <li>Tính phí tự động, preview trước thu</li>
          <li>Vé tháng + báo cáo doanh thu</li>
        </ul>
        <div style={{ marginTop: 32, fontSize: 12, opacity: 0.8 }}>v1.0.0 · Electron + SQLite (local-first)</div>
      </div>
      <div className="login-form-col">
        <form
          className="login-card card"
          onSubmit={mode === 'login' ? handleLoginSubmit : handleRegisterSubmit}
          aria-label={mode === 'login' ? 'Đăng nhập' : 'Đăng ký tài khoản khách'}
          aria-busy={busy}
        >
          <h2 style={{ margin: '0 0 4px', fontSize: 20 }}>
            {mode === 'login' ? 'Đăng nhập' : 'Đăng ký tài khoản khách'}
          </h2>
          <p style={{ margin: '0 0 16px', color: 'var(--color-text-60)', fontSize: 14 }}>
            {mode === 'login'
              ? 'Nhập tên đăng nhập và mật khẩu để tiếp tục.'
              : 'Tạo tài khoản để gửi xe nhanh và theo dõi lịch sử.'}
          </p>

          <div aria-live="polite" className="sr-only">{announce}</div>

          {(bannerKind !== null || regSummary !== null) && (
            <div style={{ marginBottom: 12 }} ref={bannerRef} tabIndex={-1}>
              {bannerKind !== null && mode === 'login' && (
                <Alert tone="danger">
                  {SERVER_COPY[bannerKind]}{' '}
                  {bannerKind === 'network' && (
                    <button type="button" className="btn btn-neutral btn-sm" onClick={() => void doLogin()} style={{ marginLeft: 8 }}>
                      Thử lại
                    </button>
                  )}
                </Alert>
              )}
              {bannerKind !== null && mode === 'register' && (
                <Alert tone="danger">
                  {SERVER_COPY[bannerKind]}{' '}
                  {bannerKind === 'network' && (
                    <button type="button" className="btn btn-neutral btn-sm" onClick={() => void doRegister()} style={{ marginLeft: 8 }}>
                      Thử lại
                    </button>
                  )}
                </Alert>
              )}
              {regSummary !== null && mode === 'register' && bannerKind === null && (
                <Alert tone="danger">{regSummary}</Alert>
              )}
            </div>
          )}

          {welcome !== null && mode === 'register' && (
            <div style={{ marginBottom: 12 }}>
              <Alert tone="success">{welcome} Đang đăng nhập…</Alert>
            </div>
          )}

          {loggedOut && mode === 'login' && bannerKind === null && regSummary === null && (
            <div style={{ marginBottom: 12 }}>
              <Alert tone="success">Đã đăng xuất. Hẹn gặp lại!</Alert>
            </div>
          )}

          {mode === 'login' ? (
            <>
              <div className="field">
                <label htmlFor="login-identifier">Tên đăng nhập</label>
                <input
                  id="login-identifier"
                  ref={loginFirstRef}
                  className="input"
                  type="text"
                  value={identifier}
                  onChange={(e) => { setIdentifier(e.target.value); clearLoginField('identifier'); }}
                  autoComplete="username"
                  placeholder="VD: nv_an hoặc 0912345678"
                  aria-invalid={loginErrors.identifier !== undefined}
                  aria-describedby={loginErrors.identifier !== undefined ? 'login-identifier-desc' : 'login-identifier-hint'}
                />
                {loginErrors.identifier !== undefined ? (
                  <span id="login-identifier-desc" className="field-error">{loginErrors.identifier}</span>
                ) : (
                  <span id="login-identifier-hint" className="field-hint">Nhân viên nhập username · Khách hàng nhập số điện thoại</span>
                )}
              </div>
              <div className="field">
                <label htmlFor="login-password">Mật khẩu</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    id="login-password"
                    className="input"
                    type={showPw ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => { setPassword(e.target.value); clearLoginField('password'); }}
                    onKeyUp={(e) => setCapsOn(e.getModifierState?.('CapsLock') ?? false)}
                    autoComplete="current-password"
                    aria-invalid={loginErrors.password !== undefined}
                    aria-describedby={loginErrors.password !== undefined ? 'login-password-desc' : 'pw-hint'}
                  />
                  <button
                    type="button"
                    className="btn btn-neutral"
                    aria-pressed={showPw}
                    onClick={() => setShowPw((v) => !v)}
                    aria-label={showPw ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                  >
                    {showPw ? <EyeOff size={16} strokeWidth={2} aria-hidden="true" /> : <Eye size={16} strokeWidth={2} aria-hidden="true" />}
                  </button>
                </div>
                {capsOn && <span className="field-hint caps-hint"><TriangleAlert size={16} strokeWidth={2} aria-hidden="true" /> Caps-Lock đang bật</span>}
                {loginErrors.password !== undefined ? (
                  <span id="login-password-desc" className="field-error">{loginErrors.password}</span>
                ) : (
                  <span id="pw-hint" className="field-hint">Mật khẩu phân biệt chữ hoa/thường.</span>
                )}
              </div>
              {/* FE-026: Ghi nhớ đăng nhập — default OFF (máy quầy dùng chung).
                  Tick → `auth:login {remember:true}` + cất token; mở app sau
                  tự `auth:resume` (xoay token) vào thẳng app. */}
              <label className="field-hint" style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', margin: '0 0 12px' }}>
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                  aria-label="Ghi nhớ đăng nhập trên máy này"
                />
                Ghi nhớ đăng nhập trên máy này
              </label>
              <Button type="submit" block disabled={loginBusy} aria-busy={loginBusy}>
                {loginBusy ? 'Đang đăng nhập…' : 'Đăng nhập'}
              </Button>
            </>
          ) : (
            <>
              <div className="field">
                <label htmlFor="reg-fullname">Họ và tên <span aria-hidden="true" style={{ color: 'var(--color-danger)' }}>*</span></label>
                <input
                  id="reg-fullname"
                  ref={registerFirstRef}
                  className="input"
                  type="text"
                  value={fullName}
                  onChange={(e) => { setFullName(e.target.value); clearRegField('fullName'); }}
                  onBlur={() => {
                    const n = fullName.trim();
                    if (n && (n.length < MIN_NAME_LEN || n.length > MAX_NAME_LEN)) {
                      setRegErrors((s) => ({ ...s, fullName: n.length < MIN_NAME_LEN ? 'Họ tên phải ≥2 ký tự.' : 'Họ tên tối đa 50 ký tự.' }));
                    }
                  }}
                  autoComplete="name"
                  maxLength={51}
                  aria-invalid={regErrors.fullName !== undefined}
                  aria-describedby={regErrors.fullName !== undefined ? 'reg-fullname-desc' : undefined}
                />
                {regErrors.fullName !== undefined && (
                  <span id="reg-fullname-desc" className="field-error">{regErrors.fullName}</span>
                )}
              </div>
              <div className="field">
                <label htmlFor="reg-phone">Số điện thoại <span aria-hidden="true" style={{ color: 'var(--color-danger)' }}>*</span></label>
                <input
                  id="reg-phone"
                  className="input"
                  type="tel"
                  inputMode="tel"
                  value={phone}
                  onChange={(e) => { setPhone(e.target.value); clearRegField('phone'); }}
                  onBlur={() => {
                    const p = phone.trim();
                    if (p && !PHONE_RE.test(p)) {
                      setRegErrors((s) => ({ ...s, phone: 'Số điện thoại phải 10 số, bắt đầu bằng 0 (VD: 0912345678).' }));
                    }
                  }}
                  autoComplete="tel"
                  placeholder="VD: 0912345678"
                  aria-invalid={regErrors.phone !== undefined}
                  aria-describedby={regErrors.phone !== undefined ? 'reg-phone-desc' : undefined}
                />
                {regErrors.phone !== undefined && (
                  <span id="reg-phone-desc" className="field-error">
                    {regErrors.phone}{' '}
                    {phoneTaken && (
                      <button type="button" className="btn btn-ghost btn-sm" onClick={goToLoginPrefillPhone} style={{ height: 'auto', padding: '0 4px' }}>
                        Đăng nhập ngay
                      </button>
                    )}
                  </span>
                )}
              </div>
              <div className="field">
                <label htmlFor="reg-password">Mật khẩu <span aria-hidden="true" style={{ color: 'var(--color-danger)' }}>*</span></label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    id="reg-password"
                    className="input"
                    type={showNewPw ? 'text' : 'password'}
                    value={newPw}
                    onChange={(e) => { setNewPw(e.target.value); clearRegField('password'); }}
                    onKeyUp={(e) => setRegCapsOn(e.getModifierState?.('CapsLock') ?? false)}
                    autoComplete="new-password"
                    aria-invalid={regErrors.password !== undefined}
                    aria-describedby={regErrors.password !== undefined ? 'reg-password-desc' : 'reg-password-hint'}
                  />
                  <button
                    type="button"
                    className="btn btn-neutral"
                    aria-pressed={showNewPw}
                    onClick={() => setShowNewPw((v) => !v)}
                    aria-label={showNewPw ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                  >
                    {showNewPw ? <EyeOff size={16} strokeWidth={2} aria-hidden="true" /> : <Eye size={16} strokeWidth={2} aria-hidden="true" />}
                  </button>
                </div>
                {regCapsOn && <span className="field-hint caps-hint"><TriangleAlert size={16} strokeWidth={2} aria-hidden="true" /> Caps-Lock đang bật</span>}
                {regErrors.password !== undefined ? (
                  <span id="reg-password-desc" className="field-error">{regErrors.password}</span>
                ) : (
                  <span id="reg-password-hint" className="field-hint">Nên ≥8 ký tự, có số và chữ hoa.</span>
                )}
              </div>
              <div className="field">
                <label htmlFor="reg-confirm">Xác nhận mật khẩu <span aria-hidden="true" style={{ color: 'var(--color-danger)' }}>*</span></label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    id="reg-confirm"
                    className="input"
                    type={showConfirmPw ? 'text' : 'password'}
                    value={confirmPw}
                    onChange={(e) => { setConfirmPw(e.target.value); clearRegField('confirm'); }}
                    autoComplete="new-password"
                    aria-invalid={regErrors.confirm !== undefined}
                    aria-describedby={regErrors.confirm !== undefined ? 'reg-confirm-desc' : undefined}
                  />
                  <button
                    type="button"
                    className="btn btn-neutral"
                    aria-pressed={showConfirmPw}
                    onClick={() => setShowConfirmPw((v) => !v)}
                    aria-label={showConfirmPw ? 'Ẩn mật khẩu xác nhận' : 'Hiện mật khẩu xác nhận'}
                  >
                    {showConfirmPw ? <EyeOff size={16} strokeWidth={2} aria-hidden="true" /> : <Eye size={16} strokeWidth={2} aria-hidden="true" />}
                  </button>
                </div>
                {regErrors.confirm !== undefined && (
                  <span id="reg-confirm-desc" className="field-error">{regErrors.confirm}</span>
                )}
              </div>
              <Button type="submit" block disabled={regPhase !== 'idle'} aria-busy={regPhase !== 'idle'}>
                {regPhase === 'registering' ? 'Đang tạo tài khoản…' : regPhase === 'logging-in' ? 'Đang đăng nhập…' : 'Đăng ký'}
              </Button>
            </>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '16px 0 8px', color: 'var(--color-text-40)', fontSize: 12 }}>
            <span style={{ flex: 1, borderTop: '1px solid var(--color-border)' }} aria-hidden="true" />
            hoặc
            <span style={{ flex: 1, borderTop: '1px solid var(--color-border)' }} aria-hidden="true" />
          </div>

          {mode === 'login' ? (
            <button type="button" className="btn btn-ghost btn-block" onClick={() => switchMode('register')}>
              Chưa có tài khoản?&nbsp;<strong>Đăng ký</strong>
            </button>
          ) : (
            <button type="button" className="btn btn-ghost btn-block" onClick={() => switchMode('login')}>
              Đã có tài khoản?&nbsp;<strong>Đăng nhập</strong>
            </button>
          )}
          <button type="button" className="btn btn-ghost btn-block" onClick={enterAsGuest} style={{ marginTop: 4 }}>
            Vào xem chỗ trống (Khách)
          </button>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--color-text-60)', textAlign: 'center' }}>
            Không cần tài khoản — chỉ xem, không gửi xe.
          </p>
        </form>
      </div>
    </div>
  );
}

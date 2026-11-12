import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { JSX, ReactNode } from 'react';
import type { RoleName } from '../types';
import { STAFF_DEFAULTS } from '../types';
import type { StaffPermissions } from '../types';
import { callApi } from '../lib/api';
import { mockApi } from '../lib/mockApi';

export interface AuthState {
  userId: number | null;
  fullName: string;
  role: RoleName | null;
  // FE-020 S4: resolved perms (login/auth:me trả kèm — nav ẩn theo perms).
  // null = chưa tải (hiển thị như full để tránh nhấp nháy ẩn menu lúc boot).
  perms: StaffPermissions | null;
}

// FE-026 (nối BE-023 remember-me): kho token bền vững cho "Ghi nhớ đăng nhập".
// QUYẾT ĐỊNH LƯU TRỮ: localStorage key `parking:remember-token-v1` (renderer
// Electron không có secure storage API riêng; desktop single-operator local,
// token single-use + xoay vòng mỗi resume + thu hồi khi logout nên rủi ro
// thấp — tương đương cookie httpOnly về mặt thực tế trên máy đơn user).
export const REMEMBER_TOKEN_LS = 'parking:remember-token-v1';
// Cờ flash 1 lần để LoginPage hiện "Đã đăng xuất." sau logout (sessionStorage
// để reload sau đó không hiện lại).
const LOGOUT_FLASH_SS = 'parking:logout-flash-v1';

function readRememberToken(): string | null {
  try {
    const raw = localStorage.getItem(REMEMBER_TOKEN_LS);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { token?: unknown };
    return typeof parsed.token === 'string' && parsed.token.length > 0 ? parsed.token : null;
  } catch {
    return null;
  }
}

function writeRememberToken(token: string): void {
  try {
    localStorage.setItem(REMEMBER_TOKEN_LS, JSON.stringify({ token }));
  } catch {
    // storage full / blocked — non-fatal (coi như không remember)
  }
}

function clearRememberToken(): void {
  try {
    localStorage.removeItem(REMEMBER_TOKEN_LS);
  } catch {
    // non-fatal
  }
}

interface AuthContextValue extends AuthState {
  // FE-026: boot gate — true khi đã xong auth:me/auth:resume (App chờ flag
  // này để không nháy màn Login khi resume thành công).
  ready: boolean;
  loginAs: (username: string, password: string, remember?: boolean) => Promise<{ ok: boolean; error?: string }>;
  enterAsGuest: () => void;
  logout: () => void;
  refreshProfile: (fullName: string) => void;
  // FE-020 S4: đọc lại auth:me sau khi admin sửa quyền (edge: sửa đúng
  // phiên đang login — BE-014). Không bắt đăng nhập lại.
  refreshMe: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const [state, setState] = useState<AuthState>({ userId: null, fullName: '', role: null, perms: null });
  const [ready, setReady] = useState(false);

  const loginAs = useCallback(async (username: string, password: string, remember = false) => {
    const res = await callApi(
      (api) => api.login(username, password, remember),
      () => mockApi.login(username, password, remember),
    );
    if (!res.ok || !res.data) return { ok: false, error: res.error ?? 'Đăng nhập thất bại' };
    // FE-026: chỉ cất token khi user tick remember (backend chỉ trả token khi
    // remember=true). Không remember = flow cũ, kho token không đụng.
    if (remember && res.data.rememberToken) writeRememberToken(res.data.rememberToken);
    setState({ userId: res.data.userId, fullName: res.data.fullName, role: res.data.role, perms: res.data.perms ?? { ...STAFF_DEFAULTS } });
    return { ok: true };
  }, []);

  const enterAsGuest = useCallback(() => {
    setState({ userId: null, fullName: 'Khách', role: 'guest', perms: null });
  }, []);

  // FE-009: after self-edit (users:update on own row), sync the sidebar
  // display name without forcing a re-login.
  const refreshProfile = useCallback((fullName: string) => {
    setState((s) => ({ ...s, fullName }));
  }, []);

  const refreshMe = useCallback(async () => {
    const res = await callApi((api) => api.meFull(), () => mockApi.meFull());
    if (!res.ok || !res.data) return;
    setState((s) => ({
      ...s,
      userId: res.data.id,
      fullName: res.data.full_name,
      role: res.data.role_name,
      perms: res.data.perms ?? { ...STAFF_DEFAULTS },
    }));
  }, []);

  const logout = useCallback(() => {
    // FE-026: 1 click, KHÔNG confirm (quyết định — đăng nhập lại rẻ, confirm
    // chỉ thêm ma sát cho thao tác hàng ngày ở quầy). Thu hồi token
    // remember-me server-side (best-effort) + xóa kho local + về login.
    // Toast xác nhận: LoginPage đọc cờ sessionStorage hiện "Đã đăng xuất."
    const token = readRememberToken();
    clearRememberToken();
    setState({ userId: null, fullName: '', role: null, perms: null });
    try {
      sessionStorage.setItem(LOGOUT_FLASH_SS, '1');
    } catch {
      // non-fatal
    }
    void callApi(
      (api) => api.logout(token ?? undefined),
      () => mockApi.logout(token ?? undefined),
    );
  }, []);

  // A5 + FE-026: boot — (1) rehydrate session memory qua auth:me (flow cũ,
  // giữ nguyên); (2) me null + có token remember → auth:resume (xoay token
  // mới, cất đè). Resume fail → xóa token + màn login bình thường (KHÔNG
  // banner đỏ — boot im lặng, user chỉ thấy form login như chưa remember).
  useEffect(() => {
    let cancelled = false;
    void (async (): Promise<void> => {
      const me = await callApi((api) => api.currentUser(), () => mockApi.currentUser());
      if (cancelled) return;
      if (me.ok && me.data) {
        setState({ userId: me.data.userId, fullName: me.data.fullName, role: me.data.role, perms: me.data.perms ?? { ...STAFF_DEFAULTS } });
        setReady(true);
        return;
      }
      const token = readRememberToken();
      if (token) {
        const resumed = await callApi((api) => api.resume(token), () => mockApi.resume(token));
        if (cancelled) return;
        if (resumed.ok && resumed.data) {
          writeRememberToken(resumed.data.rememberToken);
          setState({ userId: resumed.data.userId, fullName: resumed.data.fullName, role: resumed.data.role, perms: resumed.data.perms ?? { ...STAFF_DEFAULTS } });
          setReady(true);
          return;
        }
        clearRememberToken();
      }
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo(() => ({ ...state, ready, loginAs, enterAsGuest, logout, refreshProfile, refreshMe }), [state, ready, loginAs, enterAsGuest, logout, refreshProfile, refreshMe]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

/** LoginPage đọc 1 lần sau logout để hiện toast "Đã đăng xuất." (rồi xóa cờ). */
export function consumeLogoutFlash(): boolean {
  try {
    if (sessionStorage.getItem(LOGOUT_FLASH_SS) === '1') {
      sessionStorage.removeItem(LOGOUT_FLASH_SS);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

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

interface AuthContextValue extends AuthState {
  loginAs: (username: string, password: string) => Promise<{ ok: boolean; error?: string }>;
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

  const loginAs = useCallback(async (username: string, password: string) => {
    const res = await callApi((api) => api.login(username, password), () => mockApi.login(username, password));
    if (!res.ok || !res.data) return { ok: false, error: res.error ?? 'Đăng nhập thất bại' };
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
    setState({ userId: null, fullName: '', role: null, perms: null });
    // A5: clear the main-process session too (fire-and-forget — renderer
    // state is cleared regardless of IPC outcome).
    void callApi((api) => api.logout(), () => mockApi.logout());
  }, []);

  // A5: rehydrate main-process session on boot (auth:me). No-op in browser
  // mock (returns null) — login screen shows as before.
  useEffect(() => {
    let cancelled = false;
    void callApi((api) => api.currentUser(), () => mockApi.currentUser()).then((res) => {
      if (cancelled || !res.ok || !res.data) return;
      setState({ userId: res.data.userId, fullName: res.data.fullName, role: res.data.role, perms: res.data.perms ?? { ...STAFF_DEFAULTS } });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo(() => ({ ...state, loginAs, enterAsGuest, logout, refreshProfile, refreshMe }), [state, loginAs, enterAsGuest, logout, refreshProfile, refreshMe]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

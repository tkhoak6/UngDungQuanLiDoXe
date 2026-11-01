import { useCallback, useEffect, useState, type JSX } from 'react';
import { Alert, Button, Field, RetryPanel, SkeletonRows, Toasts, type ToastItem } from '../components/ui';
import { callApi } from '../lib/api';
import { mockApi } from '../lib/mockApi';
import { isValidVNPhone } from '../lib/format';
import { useAuth } from '../store/auth';
import type { StaffSelfProfile } from '../types';
import { StaffDrawer } from './StaffDrawer';

type Status = 'loading' | 'error' | 'ready';

let toastSeq = 300;

// FE-017 S1d: "Hồ sơ của tôi" cho staff (+ admin xem chính mình).
// Layout S1b read-only + ẨN section Ghi chú nội bộ (notes không bao giờ trả về).
// Staff chỉ tự sửa phone/address qua users:profile:update; các field khác →
// note "liên hệ quản lý" (V1 không workflow duyệt — spec S1.4).
export function StaffProfilePage(): JSX.Element {
  const { role, userId, logout, perms } = useAuth();
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState('');
  const [forbidden, setForbidden] = useState(false);
  const [profile, setProfile] = useState<StaffSelfProfile | null>(null);
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [phoneDup, setPhoneDup] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const pushToast = useCallback((tone: ToastItem['tone'], text: string) => {
    const id = toastSeq++;
    setToasts((t) => [...t, { id, tone, text }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);

  const load = useCallback(async () => {
    if (role !== 'admin' && role !== 'staff') return;
    setStatus('loading');
    setForbidden(false);
    const res = await callApi((a) => a.staffProfile(), () => mockApi.staffProfile());
    if (!res.ok || !res.data) {
      const msg = res.error ?? 'Không tải được hồ sơ';
      if (/FORBIDDEN/i.test(msg)) {
        setForbidden(true);
        setError(msg);
        setStatus('error');
        return;
      }
      setError(msg);
      setStatus('error');
      return;
    }
    setProfile(res.data);
    setPhone(res.data.phone ?? '');
    setAddress(res.data.address ?? '');
    setPhoneDup(null);
    setStatus('ready');
  }, [role]);

  useEffect(() => { void load(); }, [load]);

  if (role !== 'admin' && role !== 'staff') {
    return (
      <div className="card">
        <Alert tone="danger">Phiên của bạn không còn quyền xem hồ sơ — đăng nhập lại.</Alert>
        <div style={{ marginTop: 12 }}>
          <Button variant="neutral" onClick={logout}>Đăng nhập lại</Button>
        </div>
      </div>
    );
  }

  if (status === 'loading') {
    return <div className="card" aria-busy="true" aria-label="Đang tải hồ sơ"><SkeletonRows rows={4} /></div>;
  }

  if (status === 'error' || !profile) {
    return (
      <div className="card">
        {forbidden ? (
          <div>
            <Alert tone="danger">Phiên của bạn không còn quyền xem hồ sơ — đăng nhập lại.</Alert>
            <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
              <Button variant="neutral" onClick={logout}>Đăng nhập lại</Button>
              <Button variant="neutral" onClick={() => void load()}>Tải lại</Button>
            </div>
          </div>
        ) : (
          <RetryPanel message={error} onRetry={() => void load()} />
        )}
      </div>
    );
  }

  const phoneTrim = phone.trim();
  const phoneIssue = phoneTrim === '' ? null : !isValidVNPhone(phoneTrim) ? 'Số điện thoại chưa đúng — 10 số, bắt đầu bằng 0.' : null;
  const addrTrim = address.trim();
  const addrLong = addrTrim.length > 255;
  const phoneChanged = phoneTrim !== (profile.phone ?? '');
  const addrChanged = addrTrim !== (profile.address ?? '');
  const dirty = phoneChanged || addrChanged;
  // FE-020 S4: staff mất `profile_self` → khóa card tự sửa (xem GET luôn được).
  const canEditProfile = role !== 'staff' || !perms || perms.profile_self === 1;
  const canSave = !saving && dirty && phoneIssue === null && !addrLong && canEditProfile;

  async function handleSave(): Promise<void> {
    if (!canSave) return;
    setSaving(true);
    const patch: { phone?: string | null; address?: string | null } = {};
    if (phoneChanged) patch.phone = phoneTrim === '' ? null : phoneTrim;
    if (addrChanged) patch.address = addrTrim === '' ? null : addrTrim;
    const res = await callApi((a) => a.updateStaffProfile(patch), () => mockApi.updateStaffProfile(patch));
    setSaving(false);
    if (!res.ok || !res.data) {
      const msg = res.error ?? 'Cập nhật hồ sơ thất bại';
      if (/FORBIDDEN/i.test(msg)) {
        setForbidden(true);
        setStatus('error');
        setError(msg);
        pushToast('danger', 'Phiên của bạn không còn quyền — đăng nhập lại.');
        return;
      }
      const fieldPhone = res.fields?.phone ?? '';
      if (/SĐT đã được dùng|UNIQUE.*phone/i.test(`${msg} ${fieldPhone}`)) {
        setPhoneDup('SĐT đã được dùng.');
        return;
      }
      if (res.fields?.phone) { setPhoneDup(res.fields.phone); return; }
      if (res.fields?.address) { pushToast('danger', res.fields.address); return; }
      pushToast('danger', msg);
      return;
    }
    setProfile(res.data);
    setPhone(res.data.phone ?? '');
    setAddress(res.data.address ?? '');
    setPhoneDup(null);
    pushToast('success', 'Đã cập nhật hồ sơ của bạn.');
  }

  return (
    <div>
      <div className="profile-col">
        {/* Read-only hồ sơ (layout drawer S1b, ẩn Ghi chú nội bộ): */}
        <StaffDrawer
          user={profile}
          isSelf={profile.id === userId}
          showNotes={false}
          onClose={() => undefined}
          inline
        />
        <div className="card">
          <h2 style={{ margin: '0 0 4px' }}>Tự cập nhật SĐT / Địa chỉ</h2>
          {!canEditProfile ? (
            <Alert tone="warning">Tài khoản của bạn không có quyền tự cập nhật hồ sơ — liên hệ quản lý.</Alert>
          ) : (
          <>
          <p className="field-hint" style={{ margin: '0 0 12px' }}>
            Bạn chỉ được sửa 2 mục này. Muốn đổi họ tên, tên đăng nhập hoặc ngày vào làm — liên hệ quản lý để cập nhật.
          </p>
          <div className="field">
            <label htmlFor="self-phone">SĐT</label>
            <input
              id="self-phone"
              className="input mono"
              style={{ fontSize: 14 }}
              inputMode="tel"
              placeholder="09… (trống = chưa có)"
              value={phone}
              aria-invalid={Boolean(phoneIssue ?? phoneDup)}
              aria-describedby={phoneIssue ?? phoneDup ? 'self-phone-desc' : undefined}
              onChange={(e) => { setPhone(e.target.value); setPhoneDup(null); }}
            />
            {(phoneDup ?? phoneIssue) && <span id="self-phone-desc" className="field-error">{phoneDup ?? phoneIssue}</span>}
          </div>
          <Field
            label="Địa chỉ"
            value={address}
            placeholder="Trống = chưa có"
            maxLength={256}
            onChange={(e) => setAddress(e.target.value)}
            error={addrLong ? 'Địa chỉ tối đa 255 ký tự.' : undefined}
          />
          <div className="dialog-foot">
            <Button
              onClick={() => { setPhone(profile.phone ?? ''); setAddress(profile.address ?? ''); setPhoneDup(null); }}
              variant="neutral"
              disabled={!dirty || saving}
            >
              Hủy thay đổi
            </Button>
            <Button onClick={() => void handleSave()} disabled={!canSave} aria-busy={saving}>
              {saving ? 'Đang lưu…' : 'Lưu thay đổi'}
            </Button>
          </div>
          </>
          )}
        </div>
      </div>
      <Toasts items={toasts} />
    </div>
  );
}

// Màn "Quản lý" — shell 3 tabs (Báo cáo nâng cao | Cấu hình | An toàn & Sao lưu).
// Spec ./specs/management-area.md §0: admin-only, staff deep-link → Dashboard +
// Danger toast (App.tsx bounce), tab state trong URL query (?tab=) cho deep-link.

import { useState, type JSX } from 'react';
import { Alert, Button, Dialog } from '../components/ui';
import { useAuth } from '../store/auth';
import type { PageKey } from '../layout/AppShell';
import { ManagementReports } from './ManagementReports';
import { ManagementConfig } from './ManagementConfig';
import { ManagementSafety } from './ManagementSafety';

type Tab = 'reports' | 'config' | 'safety';

const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'reports', label: 'Báo cáo nâng cao' },
  { key: 'config', label: 'Cấu hình' },
  { key: 'safety', label: 'An toàn & Sao lưu' },
];

function initialTab(): Tab {
  try {
    const q = new URLSearchParams(window.location.search).get('tab');
    if (q === 'config' || q === 'safety' || q === 'reports') return q;
  } catch {
    // URL không đọc được → default
  }
  return 'reports';
}

interface Props {
  onNavigate: (p: PageKey) => void;
}

export function ManagementPage({ onNavigate }: Props): JSX.Element {
  const { role, logout } = useAuth();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [configDirty, setConfigDirty] = useState(false);
  const [pendingTab, setPendingTab] = useState<Tab | null>(null);

  // Route guard: chỉ admin (staff/guest/customer → App đã bounce, đây là
  // lớp phòng thủ thứ hai, không để màn trắng).
  if (role !== 'admin') {
    return (
      <div className="card">
        <Alert tone="danger">Bạn không có quyền truy cập trang này.</Alert>
        <div style={{ marginTop: 12 }}>
          <Button variant="neutral" onClick={logout}>Đăng nhập lại</Button>
        </div>
      </div>
    );
  }

  function requestTab(next: Tab): void {
    if (next === tab) return;
    // Dirty-guard: rời tab Cấu hình khi chưa lưu → confirm (spec M2.4).
    if (tab === 'config' && configDirty) {
      setPendingTab(next);
      return;
    }
    setTab(next);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('tab', next);
      window.history.replaceState(null, '', url.toString());
    } catch {
      // history không khả dụng — tab vẫn đổi
    }
  }

  return (
    <div>
      <div
        className="tabs"
        role="tablist"
        aria-label="Quản lý"
        onKeyDown={(e) => {
          if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
          e.preventDefault();
          const idx = TABS.findIndex((t) => t.key === tab);
          const next = TABS[(idx + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length];
          requestTab(next.key);
        }}
      >
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            tabIndex={tab === t.key ? 0 : -1}
            className="tab"
            onClick={() => requestTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div role="tabpanel" aria-label={TABS.find((t) => t.key === tab)?.label}>
        {tab === 'reports' && <ManagementReports />}
        {tab === 'config' && <ManagementConfig onGoShifts={() => onNavigate('attendance')} onDirtyChange={setConfigDirty} />}
        {tab === 'safety' && <ManagementSafety />}
      </div>

      {pendingTab !== null && (
        <Dialog title="Bỏ thay đổi chưa lưu?" onClose={() => setPendingTab(null)} label="Bỏ thay đổi cấu hình chưa lưu">
          <p style={{ fontSize: 14 }}>Cấu hình chưa lưu sẽ mất khi chuyển tab.</p>
          <div className="dialog-foot">
            <button className="btn btn-neutral" onClick={() => setPendingTab(null)}>Ở lại</button>
            <Button
              onClick={() => {
                setConfigDirty(false);
                const next = pendingTab;
                setPendingTab(null);
                setTab(next);
              }}
            >
              Rời đi
            </Button>
          </div>
        </Dialog>
      )}
    </div>
  );
}

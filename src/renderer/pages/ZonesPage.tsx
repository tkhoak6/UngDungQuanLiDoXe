import { useCallback, useEffect, useMemo, useState, type JSX } from 'react';
import { Pencil, Lock, LockOpen, Trash2, Plus, ChevronUp, ChevronDown } from 'lucide-react';
import { Badge, Button, Dialog, EmptyState, Field, RetryPanel, SkeletonRows, Toasts, type ToastItem } from '../components/ui';
import { callApi } from '../lib/api';
import { mockApi } from '../lib/mockApi';
import { formatVND } from '../lib/format';
import { occupancyBucket } from '../lib/fee';
import type { ParkingZone, ZoneAvailability, ZoneVehicleAllowed } from '../types';

type Status = 'loading' | 'error' | 'ready';
type SortKey = 'name' | 'capacity' | 'price_per_hour' | 'price_per_day';
type SortDir = 'asc' | 'desc';

interface FormState {
  name: string;
  code: string;
  capacity: string;
  vehicle_type_allowed: ZoneVehicleAllowed;
  price_per_hour: string;
  price_per_day: string;
  is_active: 0 | 1;
}

const EMPTY_FORM: FormState = {
  name: '', code: '', capacity: '40', vehicle_type_allowed: 'car',
  price_per_hour: '20000', price_per_day: '150000', is_active: 1,
};

let toastSeq = 1;

export function ZonesPage(): JSX.Element {
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState('');
  const [zones, setZones] = useState<ParkingZone[]>([]);
  const [avail, setAvail] = useState<ZoneAvailability[]>([]);
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | ZoneVehicleAllowed>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'ok' | 'warning' | 'full'>('all');
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState<10 | 20 | 50>(10);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ParkingZone | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [formErrors, setFormErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [deleteTarget, setDeleteTarget] = useState<ParkingZone | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  // FE-021 M2.1 (spec management-area.md §M2.1): giá inline-edit trong table
  // (mở rộng màn Khu vực, không tab mới). Click giá → input, Enter lưu / Esc hủy.
  const [priceCell, setPriceCell] = useState<{ id: number; field: 'price_per_hour' | 'price_per_day' } | null>(null);
  const [priceDraft, setPriceDraft] = useState('');
  const [priceConfirm, setPriceConfirm] = useState<{ zone: ParkingZone; field: 'price_per_hour' | 'price_per_day'; value: number } | null>(null);

  const pushToast = useCallback((tone: ToastItem['tone'], text: string) => {
    const id = toastSeq++;
    setToasts((t) => [...t, { id, tone, text }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);

  const load = useCallback(async () => {
    setStatus('loading');
    const [zRes, aRes] = await Promise.all([
      callApi((a) => a.listZones(), () => mockApi.listZones()),
      callApi((a) => a.zoneAvailability(), () => mockApi.zoneAvailability()),
    ]);
    if (!zRes.ok) {
      setError(zRes.error ?? 'Lỗi tải danh sách khu vực');
      setStatus('error');
      return;
    }
    setZones(zRes.data ?? []);
    setAvail(aRes.ok ? (aRes.data ?? []) : []);
    setStatus('ready');
  }, []);

  useEffect(() => { void load(); }, [load]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = zones
      .map((z) => ({ zone: z, av: avail.find((a) => a.zone_id === z.id) }))
      .filter(({ zone, av }) => {
        if (q && !`${zone.code} ${zone.name}`.toLowerCase().includes(q)) return false;
        if (typeFilter !== 'all' && zone.vehicle_type_allowed !== typeFilter && zone.vehicle_type_allowed !== 'both') return false;
        if (statusFilter !== 'all' && av) {
          const rate = av.capacity === 0 ? 0 : av.occupied_spots / av.capacity;
          if (occupancyBucket(rate) !== statusFilter) return false;
        }
        return true;
      });
    if (sortKey === null) return filtered;
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      if (sortKey === 'name') return a.zone.name.localeCompare(b.zone.name, 'vi') * dir;
      return (a.zone[sortKey] - b.zone[sortKey]) * dir;
    });
  }, [zones, avail, query, typeFilter, statusFilter, sortKey, sortDir]);

  // Reset to first page whenever the result set changes.
  useEffect(() => { setPage(1); }, [query, typeFilter, statusFilter, perPage, zones.length]);

  function toggleSort(key: SortKey): void {
    if (sortKey !== key) {
      setSortKey(key);
      setSortDir('asc');
    } else {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    }
  }

  function sortProps(key: SortKey): { 'aria-sort': 'ascending' | 'descending' | 'none'; label: string } {
    if (sortKey !== key) return { 'aria-sort': 'none', label: 'Sắp xếp' };
    return sortDir === 'asc'
      ? { 'aria-sort': 'ascending', label: 'Đang tăng dần — nhấn để đảo' }
      : { 'aria-sort': 'descending', label: 'Đang giảm dần — nhấn để đảo' };
  }

  const totalPages = Math.max(1, Math.ceil(rows.length / perPage));
  const safePage = Math.min(page, totalPages);
  const pageRows = rows.slice((safePage - 1) * perPage, safePage * perPage);
  const rangeFrom = rows.length === 0 ? 0 : (safePage - 1) * perPage + 1;
  const rangeTo = Math.min(safePage * perPage, rows.length);

  function openCreate(): void {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormErrors({});
    setFormOpen(true);
  }

  function openEdit(z: ParkingZone): void {
    setEditing(z);
    setForm({
      name: z.name, code: z.code, capacity: String(z.capacity),
      vehicle_type_allowed: z.vehicle_type_allowed,
      price_per_hour: String(z.price_per_hour), price_per_day: String(z.price_per_day),
      is_active: z.is_active,
    });
    setFormErrors({});
    setFormOpen(true);
  }

  function validate(f: FormState): boolean {
    const e: typeof formErrors = {};
    if (!f.name.trim()) e.name = 'Tên khu là bắt buộc';
    if (!f.code.trim()) e.code = 'Mã khu là bắt buộc';
    const cap = Number(f.capacity);
    if (!Number.isFinite(cap) || cap < 1 || cap > 2000) e.capacity = 'Sức chứa 1–2000';
    const ph = Number(f.price_per_hour);
    const pd = Number(f.price_per_day);
    if (!Number.isFinite(ph) || ph <= 0) e.price_per_hour = 'Giá giờ phải > 0';
    if (!Number.isFinite(pd) || pd <= 0) e.price_per_day = 'Giá ngày phải > 0';
    if (Number.isFinite(ph) && Number.isFinite(pd) && pd > ph * 12) {
      e.price_per_day = 'Giá ngày nên ≤ 12× giá giờ';
    }
    setFormErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleSave(): Promise<void> {
    if (!validate(form)) return;
    const payload = {
      code: form.code.trim().toUpperCase(),
      name: form.name.trim(),
      vehicle_type_allowed: form.vehicle_type_allowed,
      capacity: Number(form.capacity),
      price_per_hour: Number(form.price_per_hour),
      price_per_day: Number(form.price_per_day),
      is_active: form.is_active,
    };
    const res = editing
      ? await callApi((a) => a.updateZone(editing.id, payload), () => mockApi.updateZone(editing.id, payload))
      : await callApi((a) => a.createZone(payload), () => mockApi.createZone(payload));
    if (!res.ok) {
      pushToast('danger', res.error ?? 'Lưu thất bại');
      return;
    }
    setFormOpen(false);
    pushToast('success', editing ? 'Đã cập nhật khu vực' : 'Đã tạo khu vực mới');
    void load();
  }

  async function handleToggle(z: ParkingZone): Promise<void> {
    const next = z.is_active === 1 ? 0 : 1;
    const res = await callApi((a) => a.updateZone(z.id, { is_active: next as 0 | 1 }), () => mockApi.updateZone(z.id, { is_active: next as 0 | 1 }));
    if (!res.ok) {
      pushToast('danger', res.error ?? 'Đổi trạng thái thất bại');
      return;
    }
    pushToast('success', next === 1 ? `Đã mở khu ${z.code}` : `Đã khóa khu ${z.code} — xe đang đỗ giữ nguyên`);
    void load();
  }

  async function handleDelete(): Promise<void> {
    if (!deleteTarget) return;
    const res = await callApi((a) => a.deleteZone(deleteTarget.id), () => mockApi.deleteZone(deleteTarget.id));
    if (!res.ok) {
      pushToast('danger', res.error ?? 'Xóa thất bại');
      return;
    }
    setDeleteTarget(null);
    pushToast('success', `Đã xóa khu ${deleteTarget.code}`);
    void load();
  }

  // FE-021 M2.1: lưu giá inline (Enter). Giá ngày < giá giờ → confirm lần 2
  // (Warning, không chặn — spec M2.3). Giá mới áp dụng vé check-in sau lúc lưu.
  function startPriceEdit(z: ParkingZone, field: 'price_per_hour' | 'price_per_day'): void {
    setPriceCell({ id: z.id, field });
    setPriceDraft(String(z[field]));
  }

  async function commitPrice(): Promise<void> {
    if (!priceCell) return;
    const zone = zones.find((z) => z.id === priceCell.id);
    if (!zone) { setPriceCell(null); return; }
    const value = Number(priceDraft);
    if (!Number.isFinite(value) || value <= 0) {
      pushToast('danger', 'Giá giờ/giá ngày phải > 0.');
      return;
    }
    const other = priceCell.field === 'price_per_hour' ? zone.price_per_day : zone.price_per_hour;
    const dayAfter = priceCell.field === 'price_per_day' ? value : other;
    const hourAfter = priceCell.field === 'price_per_hour' ? value : other;
    if (dayAfter < hourAfter) {
      setPriceConfirm({ zone, field: priceCell.field, value });
      return;
    }
    await savePriceInline(zone.id, priceCell.field, value);
  }

  async function savePriceInline(id: number, field: 'price_per_hour' | 'price_per_day', value: number): Promise<void> {
    const res = await callApi((a) => a.updateZone(id, { [field]: value }), () => mockApi.updateZone(id, { [field]: value }));
    setPriceConfirm(null);
    setPriceCell(null);
    if (!res.ok || !res.data) {
      pushToast('danger', res.error ?? 'Lưu giá thất bại');
      return;
    }
    pushToast('success', `Đã cập nhật giá khu ${res.data.code} — áp dụng vé mới từ bây giờ.`);
    void load();
  }

  if (status === 'loading') {
    return <div className="card" aria-busy="true" aria-label="Đang tải khu vực"><SkeletonRows rows={8} /></div>;
  }
  if (status === 'error') return <div className="card"><RetryPanel message={error} onRetry={() => void load()} /></div>;

  const deleteGuard = deleteTarget ? (avail.find((a) => a.zone_id === deleteTarget.id)?.occupied_spots ?? 0) : 0;
  const formValid = Object.keys(formErrors).length === 0 && form.name.trim() !== '' && form.code.trim() !== '';

  return (
    <div>
      <div className="toolbar" role="search">
        <input id="global-search" className="input search-input" aria-label="Tìm khu vực" placeholder="Tìm theo tên / mã…  ( / )" value={query} onChange={(e) => setQuery(e.target.value)} />
        <select className="select" style={{ width: 160 }} aria-label="Lọc loại xe" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as typeof typeFilter)}>
          <option value="all">Tất cả loại xe</option>
          <option value="car">Ô tô</option>
          <option value="motorbike">Xe máy</option>
        </select>
        <select className="select" style={{ width: 160 }} aria-label="Lọc trạng thái" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}>
          <option value="all">Mọi trạng thái</option>
          <option value="ok">Còn chỗ</option>
          <option value="warning">Sắp hết</option>
          <option value="full">Đã đầy</option>
        </select>
        <span className="spacer" />
        <button className="btn btn-primary" onClick={openCreate}><Plus size={16} strokeWidth={2} aria-hidden="true" /> Thêm khu vực</button>
      </div>

      {rows.length === 0 ? (
        <div className="card">
          <EmptyState
            title="Không tìm thấy khu vực"
            hint="Thử từ khóa khác hoặc xóa bộ lọc đang áp dụng."
            action={<button className="btn btn-neutral" onClick={() => { setQuery(''); setTypeFilter('all'); setStatusFilter('all'); }}>Xóa bộ lọc</button>}
          />
        </div>
      ) : (
        <div className="table-wrap">
          <table className="grid">
            <thead>
              <tr>
                {(([
                  ['name', 'Tên khu'],
                  ['capacity', 'Sức chứa'],
                ] as Array<[SortKey, string]>).map(([key, label]) => {
                  const sp = sortProps(key);
                  return (
                    <th key={key} scope="col" aria-sort={sp['aria-sort']}>
                      <button type="button" className="th-sort" aria-label={`${label} — ${sp.label}`} onClick={() => toggleSort(key)}>
                        {label}{sortKey === key ? (sortDir === 'asc' ? <ChevronUp size={14} strokeWidth={2} aria-hidden="true" /> : <ChevronDown size={14} strokeWidth={2} aria-hidden="true" />) : null}
                      </button>
                    </th>
                  );
                }))}
                <th scope="col">Loại xe</th>
                {(([
                  ['price_per_hour', 'Giá giờ'],
                  ['price_per_day', 'Giá ngày'],
                ] as Array<[SortKey, string]>).map(([key, label]) => {
                  const sp = sortProps(key);
                  return (
                    <th key={key} scope="col" aria-sort={sp['aria-sort']}>
                      <button type="button" className="th-sort" aria-label={`${label} — ${sp.label}`} onClick={() => toggleSort(key)}>
                        {label}{sortKey === key ? (sortDir === 'asc' ? <ChevronUp size={14} strokeWidth={2} aria-hidden="true" /> : <ChevronDown size={14} strokeWidth={2} aria-hidden="true" />) : null}
                      </button>
                    </th>
                  );
                }))}
                <th scope="col">Trạng thái</th>
                <th scope="col"><span className="sr-only">Hành động</span></th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map(({ zone, av }) => {
                const rate = av && av.capacity > 0 ? av.occupied_spots / av.capacity : 0;
                const bucket = occupancyBucket(rate);
                return (
                  <tr key={zone.id}>
                    <td><strong style={{ fontSize: 16 }}>{zone.name}</strong> <span className="mono" style={{ color: 'var(--color-text-60)', fontSize: 12 }}>{zone.code}</span></td>
                    <td className="mono">{zone.capacity}</td>
                    <td>
                      {zone.vehicle_type_allowed === 'car' ? <Badge tone="primary">Ô tô</Badge>
                        : zone.vehicle_type_allowed === 'motorbike' ? <Badge tone="secondary">Xe máy</Badge>
                        : <Badge tone="muted">Hỗn hợp</Badge>}
                    </td>
                    {(['price_per_hour', 'price_per_day'] as const).map((field) => (
                      <td className="mono" key={field}>
                        {priceCell?.id === zone.id && priceCell.field === field ? (
                          <input
                            className="input input-mono"
                            style={{ width: 130 }}
                            inputMode="decimal"
                            // eslint-disable-next-line jsx-a11y/no-autofocus
                            autoFocus
                            aria-label={`${field === 'price_per_hour' ? 'Giá giờ' : 'Giá ngày'} khu ${zone.code} (VND)`}
                            value={priceDraft}
                            onChange={(e) => setPriceDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') void commitPrice();
                              if (e.key === 'Escape') setPriceCell(null);
                            }}
                            onBlur={() => setPriceCell(null)}
                          />
                        ) : (
                          <button
                            type="button"
                            className="th-sort mono"
                            title="Bấm để sửa nhanh (Enter lưu · Esc hủy)"
                            aria-label={`Sửa ${field === 'price_per_hour' ? 'giá giờ' : 'giá ngày'} khu ${zone.code}, hiện tại ${formatVND(zone[field])}`}
                            onClick={() => startPriceEdit(zone, field)}
                          >
                            {formatVND(zone[field])}
                          </button>
                        )}
                      </td>
                    ))}
                    <td>
                      {zone.is_active === 0 ? <Badge tone="muted">Bảo trì</Badge>
                        : bucket === 'full' ? <Badge tone="danger">Đã đầy</Badge>
                        : bucket === 'warning' ? <Badge tone="warning">Sắp hết</Badge>
                        : <Badge tone="success">Hoạt động</Badge>}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button className="icon-btn" title="Sửa" aria-label={`Sửa khu ${zone.code}`} onClick={() => openEdit(zone)}><Pencil size={16} strokeWidth={2} aria-hidden="true" /></button>
                      <button className="icon-btn" title={zone.is_active === 1 ? 'Khóa' : 'Mở'} aria-label={`${zone.is_active === 1 ? 'Khóa' : 'Mở'} khu ${zone.code}`} onClick={() => void handleToggle(zone)}>{zone.is_active === 1 ? <Lock size={16} strokeWidth={2} aria-hidden="true" /> : <LockOpen size={16} strokeWidth={2} aria-hidden="true" />}</button>
                      <button className="icon-btn" title="Xóa" aria-label={`Xóa khu ${zone.code}`} onClick={() => setDeleteTarget(zone)}><Trash2 size={16} strokeWidth={2} aria-hidden="true" /></button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {rows.length > 0 && (
        <div className="pager" aria-label="Phân trang">
          <span className="mono" style={{ fontSize: 12 }}>Hiển thị {rangeFrom}–{rangeTo} / {rows.length} khu</span>
          <span className="spacer" />
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 14 }}>
            Số dòng
            <select className="select" style={{ width: 90, height: 32 }} aria-label="Số dòng mỗi trang" value={perPage} onChange={(e) => setPerPage(Number(e.target.value) as 10 | 20 | 50)}>
              <option value={10}>10</option>
              <option value={20}>20</option>
              <option value={50}>50</option>
            </select>
          </label>
          <button className="btn btn-neutral btn-sm" disabled={safePage <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} aria-label="Trang trước">‹ Trước</button>
          <span className="mono" style={{ fontSize: 12 }} aria-live="polite">Trang {safePage}/{totalPages}</span>
          <button className="btn btn-neutral btn-sm" disabled={safePage >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))} aria-label="Trang sau">Sau ›</button>
        </div>
      )}

      {formOpen && (
        <Dialog title={editing ? `Sửa khu ${editing.code}` : 'Thêm khu vực mới'} onClose={() => setFormOpen(false)}>
          <Field label="Tên khu *" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} error={formErrors.name} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Mã khu *" value={form.code} mono onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))} error={formErrors.code} />
            <div className="field">
              <label htmlFor="field-cap">Sức chứa *</label>
              <input id="field-cap" className="input" inputMode="numeric" type="number" min={1} max={2000} value={form.capacity} onChange={(e) => setForm((f) => ({ ...f, capacity: e.target.value }))} aria-invalid={Boolean(formErrors.capacity)} />
              {formErrors.capacity && <span className="field-error">{formErrors.capacity}</span>}
            </div>
          </div>
          <div className="field">
            <label id="vt-label">Loại xe *</label>
            <div className="seg" role="group" aria-labelledby="vt-label">
              {(['car', 'motorbike', 'both'] as const).map((v) => (
                <button key={v} type="button" aria-pressed={form.vehicle_type_allowed === v} onClick={() => setForm((f) => ({ ...f, vehicle_type_allowed: v }))}>
                  {v === 'car' ? 'Ô tô' : v === 'motorbike' ? 'Xe máy' : 'Hỗn hợp'}
                </button>
              ))}
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Giá giờ (VND) *" inputMode="numeric" value={form.price_per_hour} onChange={(e) => setForm((f) => ({ ...f, price_per_hour: e.target.value }))} error={formErrors.price_per_hour} />
            <Field label="Giá ngày (VND) *" inputMode="numeric" value={form.price_per_day} onChange={(e) => setForm((f) => ({ ...f, price_per_day: e.target.value }))} error={formErrors.price_per_day} hint="Giá ngày nên ≤ 12× giá giờ" />
          </div>
          <div className="field">
            <label htmlFor="zone-status">Trạng thái</label>
            <select
              id="zone-status"
              className="select"
              value={form.is_active}
              onChange={(e) => setForm((f) => ({ ...f, is_active: Number(e.target.value) as 0 | 1 }))}
              aria-describedby="zone-status-hint"
            >
              <option value={1}>Hoạt động — nhận xe mới</option>
              <option value={0}>Bảo trì — tạm dừng nhận xe</option>
            </select>
            <span id="zone-status-hint" className="field-hint">Xe đang đỗ giữ nguyên khi chuyển sang Bảo trì.</span>
          </div>
          <div className="dialog-foot">
            <button className="btn btn-neutral" onClick={() => setFormOpen(false)}>Hủy</button>
            <Button onClick={() => void handleSave()} disabled={!formValid}>Lưu</Button>
          </div>
        </Dialog>
      )}

      {priceConfirm && (
        <Dialog title={`Giá ngày thấp hơn giá giờ (khu ${priceConfirm.zone.code})?`} onClose={() => setPriceConfirm(null)} label="Xác nhận giá ngày khuyến mãi">
          <p style={{ fontSize: 14 }}>
            Giá ngày <strong className="mono">{formatVND(priceConfirm.value)}</strong> thấp hơn giá giờ — xác nhận?
          </p>
          <div className="dialog-foot">
            <button className="btn btn-neutral" onClick={() => setPriceConfirm(null)}>Hủy</button>
            <Button onClick={() => void savePriceInline(priceConfirm.zone.id, priceConfirm.field, priceConfirm.value)}>Xác nhận</Button>
          </div>
        </Dialog>
      )}

      {deleteTarget && (
        <Dialog title={`Xóa khu ${deleteTarget.code}?`} onClose={() => setDeleteTarget(null)} label="Xác nhận xóa khu vực">
          {deleteGuard > 0 ? (
            <Alert tone="warning">Còn {deleteGuard} xe đang đỗ — chuyển xe trước khi xóa.</Alert>
          ) : (
            <p style={{ fontSize: 14 }}>Hành động này không thể hoàn tác. Lịch sử vé đã chốt được giữ lại.</p>
          )}
          <div className="dialog-foot" aria-describedby="del-guard">
            <span id="del-guard" className="sr-only">{deleteGuard > 0 ? `Còn ${deleteGuard} xe đang đỗ` : 'Khu trống, có thể xóa'}</span>
            <button className="btn btn-neutral" onClick={() => setDeleteTarget(null)}>Hủy</button>
            <button className="btn btn-danger" disabled={deleteGuard > 0} onClick={() => void handleDelete()}>Xóa khu vực</button>
          </div>
        </Dialog>
      )}

      <Toasts items={toasts} />
    </div>
  );
}

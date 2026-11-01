// Management M1 export helpers — Excel detail (loop offset, cap 10.000) +
// PDF summary (print window + ≤500 dòng phụ lục). Spec management-area.md §M1.2.

import { callApi } from './api';
import { mockApi } from './mockApi';
import { formatDateTime, formatVND } from './format';
import { TX_KIND_LABEL, downloadXls } from './management';
import type { PaymentMethod, TxKind, TxRow } from '../types';

export const METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: 'Tiền mặt', transfer: 'Chuyển khoản', card: 'Thẻ', e_wallet: 'Ví điện tử',
};

export interface TxFilter {
  from: string;
  to: string;
  zone_ids?: number[];
  kind?: TxKind;
  payment_method?: PaymentMethod;
  search?: string;
}

/** Excel: loop offset (chunk 200) tới hết, cap 10.000 dòng/file (spec M1.2). */
export async function exportTransactionsXls(
  filter: TxFilter,
  onProgress: (pct: number) => void,
): Promise<{ ok: boolean; filename?: string; count?: number; error?: string }> {
  const all: TxRow[] = [];
  const CAP = 10000;
  const CHUNK = 200;
  let offset = 0;
  let total = 0;
  onProgress(5);
  for (;;) {
    const res = await callApi(
      (a) => a.listTransactions({ ...filter, limit: CHUNK, offset }),
      () => mockApi.listTransactions({ ...filter, limit: CHUNK, offset }),
    );
    if (!res.ok || !res.data) return { ok: false, error: res.error ?? 'Xuất thất bại' };
    total = res.data.total;
    all.push(...res.data.rows);
    offset += res.data.rows.length;
    onProgress(Math.min(95, Math.round((offset / Math.max(1, total)) * 100)));
    if (offset >= total || offset >= CAP || res.data.rows.length === 0) break;
  }
  const head = ['Thời gian', 'Mã GD', 'Loại', 'Khu vực', 'Biển số', 'Thu ngân', 'Phương thức', 'Số tiền (VND)', 'Ghi chú'];
  const body = all.map((r) => [
    formatDateTime(r.paid_at),
    `GD-${String(r.payment_id).padStart(6, '0')}`,
    TX_KIND_LABEL[r.kind],
    [r.zone_code, r.zone_name].filter(Boolean).join(' — '),
    (r.license_plate ?? '').toUpperCase(),
    r.received_by_name ?? '(đã xóa)',
    r.payment_method ? METHOD_LABEL[r.payment_method] : '',
    String(Math.round(r.amount)),
    r.note ?? '',
  ]);
  const stamp = filter.to.replaceAll('-', '');
  const filename = `bao_cao_chi_tiet_${stamp}.xls`;
  downloadXls(filename, `Chi tiết ${filter.from} → ${filter.to} (${all.length}/${total} dòng)`, head, body);
  onProgress(100);
  return { ok: true, filename, count: all.length };
}

export interface SummaryKpi {
  revenue: number;
  entries: number;
  avg: number;
}

/** PDF = bản in tổng hợp + phụ lục tối đa 500 dòng (spec M1.2). */
export function openSummaryPrint(
  filter: TxFilter,
  summary: SummaryKpi,
  detail: TxRow[],
  total: number,
): { ok: boolean; error?: string } {
  const slice = detail.slice(0, 500);
  const w = window.open('', '_blank', 'width=900,height=700');
  if (!w) return { ok: false, error: 'Trình duyệt chặn cửa sổ in — cho phép popup để xuất PDF.' };
  const rowsHtml = slice.map((r) => `<tr><td>${formatDateTime(r.paid_at)}</td><td>GD-${String(r.payment_id).padStart(6, '0')}</td><td>${TX_KIND_LABEL[r.kind]}</td><td>${(r.license_plate ?? '').toUpperCase()}</td><td style="text-align:right">${formatVND(r.amount)}</td></tr>`).join('');
  w.document.write(`<html><head><meta charset="utf-8"><title>Báo cáo tổng hợp ${filter.from} → ${filter.to}</title></head><body style="font-family:sans-serif"><h2>Báo cáo ${filter.from} → ${filter.to}</h2><p>Tổng doanh thu: <b>${formatVND(summary.revenue)}</b> · Tổng lượt: <b>${summary.entries}</b> · Trung bình/lượt: <b>${formatVND(summary.avg)}</b></p><table border="1" cellpadding="4" cellspacing="0"><tr><th>Thời gian</th><th>Mã GD</th><th>Loại</th><th>Biển số</th><th>Số tiền</th></tr>${rowsHtml}</table><p>Phụ lục ${slice.length}/${total} dòng — xem file Excel để đủ ${total} dòng.</p><script>window.print()<\/script></body></html>`);
  w.document.close();
  return { ok: true };
}

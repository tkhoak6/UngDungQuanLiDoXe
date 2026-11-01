import { useEffect, useRef } from 'react';
import type { ButtonHTMLAttributes, InputHTMLAttributes, JSX, ReactNode } from 'react';

/* shadcn-style minimal primitives bound to DESIGN.md tokens. */

type BadgeTone = 'success' | 'primary' | 'secondary' | 'warning' | 'danger' | 'muted';

export function Badge({ tone, children }: { tone: BadgeTone; children: ReactNode }): JSX.Element {
  return (
    <span className={`badge badge-${tone}`}>
      <span className="dot" aria-hidden="true" />
      {children}
    </span>
  );
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'neutral' | 'danger' | 'ghost';
  block?: boolean;
}

export function Button({ variant = 'primary', block = false, className = '', ...rest }: ButtonProps): JSX.Element {
  return <button className={`btn btn-${variant}${block ? ' btn-block' : ''} ${className}`} {...rest} />;
}

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
  error?: string;
  mono?: boolean;
}

export function Field({ label, hint, error, mono = false, id, ...rest }: FieldProps): JSX.Element {
  const fieldId = id ?? `field-${label}`;
  return (
    <div className="field">
      <label htmlFor={fieldId}>{label}</label>
      <input id={fieldId} className={`input${mono ? ' input-mono' : ''}`} aria-invalid={Boolean(error)} aria-describedby={hint ?? error ? `${fieldId}-desc` : undefined} {...rest} />
      {(hint ?? error) && (
        <span id={`${fieldId}-desc`} className={error ? 'field-error' : 'field-hint'}>
          {error ?? hint}
        </span>
      )}
    </div>
  );
}

export function Alert({ tone, children, role }: { tone: 'danger' | 'warning' | 'success'; children: ReactNode; role?: string }): JSX.Element {
  return (
    <div className={`alert alert-${tone}`} role={role ?? (tone === 'danger' ? 'alert' : 'status')}>
      {children}
    </div>
  );
}

export function SkeletonRows({ rows = 4, height = 20 }: { rows?: number; height?: number }): JSX.Element {
  return (
    <div aria-busy="true" aria-label="Đang tải">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton" style={{ height, marginBottom: 8 }} />
      ))}
    </div>
  );
}

export function EmptyState({ title, hint, action }: { title: string; hint: string; action?: ReactNode }): JSX.Element {
  return (
    <div className="empty">
      <h3>{title}</h3>
      <p>{hint}</p>
      {action}
    </div>
  );
}

export function RetryPanel({ message, onRetry }: { message: string; onRetry: () => void }): JSX.Element {
  return (
    <div className="empty" role="alert">
      <h3>Không tải được dữ liệu</h3>
      <p>{message}</p>
      <Button variant="neutral" onClick={onRetry}>Tải lại</Button>
    </div>
  );
}

export function Dialog({ title, children, onClose, wide = false, label }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean; label?: string }): JSX.Element {
  const panelRef = useRef<HTMLDivElement>(null);
  const prevFocus = useRef<Element | null>(null);
  // FE-010: onClose is an inline closure at call sites (new identity every
  // render). Keep it in a ref so the mount effect below runs ONCE — otherwise
  // the effect re-runs on every keystroke and panel.focus() steals focus from
  // the input being typed in (dialog feels "frozen").
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    prevFocus.current = document.activeElement;
    panelRef.current?.focus();
    // Scroll-lock nền khi dialog mở (spec ui-fixes-001 §C2.5).
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        closeRef.current();
        return;
      }
      // Focus trap: keep Tab cycling inside the panel (spec §5 / parking-app.md cross-screen).
      if (e.key === 'Tab') {
        const panel = panelRef.current;
        if (!panel) return;
        const focusables = panel.querySelectorAll<HTMLElement>(
          'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
        );
        if (focusables.length === 0) {
          e.preventDefault();
          return;
        }
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return (): void => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      if (prevFocus.current instanceof HTMLElement) prevFocus.current.focus();
    };
  }, []);

  return (
    <div className="dialog-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={panelRef} className={`dialog${wide ? ' dialog-wide' : ''}`} role="dialog" aria-label={label ?? title} aria-modal="true" tabIndex={-1}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

export interface ToastItem {
  id: number;
  tone: 'success' | 'danger';
  text: string;
}

export function Toasts({ items }: { items: ToastItem[] }): JSX.Element {
  return (
    <div className="toasts" aria-live="polite">
      {items.slice(-3).map((t) => (
        <div key={t.id} className="toast" role={t.tone === 'danger' ? 'alert' : 'status'}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

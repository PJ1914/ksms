import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ApiError } from './api';

/** Loads data and re-loads on demand; errors are shown, never swallowed. */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const run = useCallback(load, deps);
  const reload = useCallback(() => {
    setLoading(true);
    setError(null);
    run()
      .then(setData)
      .catch((e: unknown) => setError(errorText(e)))
      .finally(() => setLoading(false));
  }, [run]);
  useEffect(reload, [reload]);
  return { data, error, loading, reload, setData };
}

export function errorText(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  return e instanceof Error ? e.message : 'Something went wrong';
}

export function Alert({ kind, children }: { kind: 'error' | 'ok' | 'warn'; children: ReactNode }) {
  if (!children) return null;
  return (
    <div className={`alert ${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      {children}
    </div>
  );
}

export function Badge({ value }: { value: string | null | undefined }) {
  if (!value) return <span className="badge b-muted">—</span>;
  return <span className={`badge b-${value}`}>{value.replace(/_/g, ' ')}</span>;
}

export function Loading({ loading, error }: { loading: boolean; error: string | null }) {
  if (error) return <Alert kind="error">{error}</Alert>;
  if (loading) return <p className="muted">Loading…</p>;
  return null;
}

export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

/**
 * A confirmation that collects a reason (kept in the audit log). For destructive actions the admin
 * must also type the shop name (ADMIN_PANEL.md section 6 UX rules).
 */
export function ReasonDialog({
  title,
  description,
  confirmLabel,
  danger,
  typeToConfirm,
  extra,
  onConfirm,
  onClose,
}: {
  title: string;
  description?: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  typeToConfirm?: string;
  extra?: ReactNode;
  onConfirm: (reason: string) => Promise<unknown>;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ok = reason.trim().length >= 3 && (!typeToConfirm || typed.trim() === typeToConfirm);
  return (
    <Modal title={title} onClose={onClose}>
      {description && <p className="muted">{description}</p>}
      <Alert kind="error">{error}</Alert>
      {extra}
      <label>
        Reason (kept in the audit log)
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
      </label>
      {typeToConfirm && (
        <label>
          Type <b>{typeToConfirm}</b> to confirm
          <input value={typed} onChange={(e) => setTyped(e.target.value)} />
        </label>
      )}
      <div className="actions">
        <button onClick={onClose}>Cancel</button>
        <button
          className={danger ? 'danger' : 'primary'}
          disabled={!ok || busy}
          onClick={() => {
            setBusy(true);
            setError(null);
            onConfirm(reason.trim())
              .then(onClose)
              .catch((e: unknown) => setError(errorText(e)))
              .finally(() => setBusy(false));
          }}
        >
          {busy ? 'Working…' : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

export function Stat({ label, value, to }: { label: string; value: ReactNode; to?: string }) {
  const body = (
    <div className="stat">
      <div className="label">{label}</div>
      <div className="value num">{value}</div>
    </div>
  );
  return to ? <a href={to}>{body}</a> : body;
}

/** Simple inline icons (no icon font, no external requests). */
export const Icon = {
  home: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />
    </svg>
  ),
  shop: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 9l2-5h14l2 5M4 9h16v11H4zM9 20v-6h6v6" />
    </svg>
  ),
  ticket: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 5h16v4a3 3 0 0 0 0 6v4H4v-4a3 3 0 0 0 0-6z" />
    </svg>
  ),
  plan: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 4h16v16H4zM8 9h8M8 13h8M8 17h5" />
    </svg>
  ),
  money: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 6h18v12H3zM12 9v6M9 12h6" />
    </svg>
  ),
  people: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5M16 4.5a3.5 3.5 0 0 1 0 7M18 14.8c1.9.8 3.1 2.6 3.5 5.2" />
    </svg>
  ),
  log: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M6 3h9l4 4v14H6zM9 12h7M9 16h7M9 8h3" />
    </svg>
  ),
  phone: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M5 3h4l2 5-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 5a2 2 0 0 1 2-2z" />
    </svg>
  ),
  menu: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      width="22"
      height="22"
    >
      <path d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  ),
};

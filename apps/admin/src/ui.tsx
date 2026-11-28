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

export type Tone = 'green' | 'blue' | 'amber' | 'red' | 'violet' | 'grey';

/** A number tile with a coloured icon; pass `to` to make the whole tile a link. */
export function Stat({
  label,
  value,
  to,
  icon,
  tone = 'grey',
  hint,
}: {
  label: string;
  value: ReactNode;
  to?: string;
  icon?: ReactNode;
  tone?: Tone;
  hint?: string;
}) {
  const body = (
    <div className="stat">
      {icon && <div className={`icon tone-${tone}`}>{icon}</div>}
      <div>
        <div className="label">{label}</div>
        <div className="value num">{value}</div>
        {hint && <div className="hint">{hint}</div>}
      </div>
    </div>
  );
  return to ? <a href={to}>{body}</a> : body;
}

/** Page title with an optional one-line description and actions on the right. */
export function PageHead({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {children && <div className="row">{children}</div>}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

/** Initials on a colour that stays the same for the same name, like a CRM contact picture. */
export function Avatar({
  name,
  size,
  round,
}: {
  name: string;
  size?: 'sm' | 'lg';
  round?: boolean;
}) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0])
      .join('') || '?';
  return (
    <span
      className={`av ${size ?? ''} ${round ? 'round' : ''}`}
      style={{ ['--h' as string]: h }}
      aria-hidden="true"
    >
      {initials}
    </span>
  );
}

/** A small line chart with a soft fill under it. Values are only compared to each other. */
export function Sparkline({ values }: { values: number[] }) {
  const pts = values.length > 1 ? values : [0, ...values, 0];
  const max = Math.max(1, ...pts);
  const step = 300 / (pts.length - 1);
  const xy = pts.map((v, i) => [i * step, 80 - (v / max) * 70] as const);
  const line = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const last = xy.at(-1)!;
  return (
    <svg className="spark" viewBox="0 0 300 90" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id="spark-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--primary)" stopOpacity="0.45" />
          <stop offset="1" stopColor="var(--primary)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line} L300 90 L0 90 Z`} fill="url(#spark-fill)" />
      <path
        d={line}
        fill="none"
        stroke="var(--primary)"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={last[0]} cy={last[1]} r="4.5" fill="var(--primary)" />
    </svg>
  );
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
  lock: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3" />
    </svg>
  ),
  clock: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  ),
  check: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12.5l2.7 2.7L16 9.5" />
    </svg>
  ),
  alert: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 3l10 18H2zM12 10v4.5M12 17.6v.1" />
    </svg>
  ),
  trend: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 17l6-6 4 4 8-9M15 6h6v6" />
    </svg>
  ),
  spark: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z" />
    </svg>
  ),
  headset: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 14v-2a8 8 0 0 1 16 0v2M4 14h3v5H5a1 1 0 0 1-1-1zM20 14h-3v5h2a1 1 0 0 0 1-1zM17 19c0 1.5-2 2-5 2" />
    </svg>
  ),
  search: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </svg>
  ),
  sun: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  ),
  moon: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z" />
    </svg>
  ),
  user: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c.9-4 4-6 8-6s7.1 2 8 6" />
    </svg>
  ),
  shield: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" />
      <path d="M8.5 12l2.5 2.5 4.5-5" />
    </svg>
  ),
};

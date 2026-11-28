import { useState } from 'react';
import { api, dateTime, request, type Role } from '../api';
import { Alert, Badge, errorText, Loading, useLoad } from '../ui';

interface TicketRow {
  id: string;
  label: string;
  shopName: string | null;
  organizationId: string;
  category: string;
  priority: string;
  status: string;
  subject: string;
  lastMessageAt: string;
}

const STATUSES = ['OPEN', 'IN_PROGRESS', 'WAITING_CUSTOMER', 'RESOLVED', 'CLOSED'];
const CANNED = [
  'Thanks for reaching out. We are looking into this and will update you shortly.',
  'Please update the app to the latest version and try again.',
  'Your payment is received and your subscription is extended. Please sign in again.',
  'Could you share the exact steps so we can reproduce this?',
];

export function Tickets({ params }: { params: URLSearchParams }) {
  const [status, setStatus] = useState(params.get('status') ?? '');
  const [category, setCategory] = useState(params.get('category') ?? '');
  const [assignee, setAssignee] = useState(params.get('assignee') ?? '');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<TicketRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const path = (c?: string | null) => {
    const p = new URLSearchParams();
    if (status) p.set('status', status);
    if (category) p.set('category', category);
    if (assignee) p.set('assignee', assignee);
    if (q.trim()) p.set('q', q.trim());
    if (c) p.set('cursor', c);
    return `/tickets?${p.toString()}`;
  };
  const { error, loading } = useLoad(async () => {
    const r = await request<TicketRow[]>('GET', path());
    setRows(r.data);
    setCursor(r.meta?.nextCursor ?? null);
  }, [status, category, assignee, q]);

  return (
    <>
      <h1>Support tickets</h1>
      <div className="filters">
        <input
          placeholder="Subject or T-000123"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search"
        />
        <select
          value={assignee}
          onChange={(e) => setAssignee(e.target.value)}
          aria-label="Assignee"
        >
          <option value="">Everyone</option>
          <option value="me">Mine</option>
          <option value="unassigned">Unassigned</option>
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="">Any status</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.replace(/_/g, ' ')}
            </option>
          ))}
        </select>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          aria-label="Category"
        >
          <option value="">Any category</option>
          {['BILLING', 'BUG', 'HOW_TO', 'CALLBACK', 'OTHER'].map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </div>
      <Loading loading={loading && rows.length === 0} error={error} />
      <div className="card" style={{ padding: 0 }}>
        <table className="cards">
          <thead>
            <tr>
              <th>Ticket</th>
              <th>Shop</th>
              <th>Subject</th>
              <th>Status</th>
              <th>Priority</th>
              <th>Last activity</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr
                key={t.id}
                className="click"
                onClick={() => (location.hash = `#/tickets/${t.id}`)}
              >
                <td data-label="Ticket" className="num">
                  {t.label}
                  {t.category === 'CALLBACK' && (
                    <div>
                      <span className="badge b-URGENT">Call back</span>
                    </div>
                  )}
                </td>
                <td data-label="Shop">{t.shopName ?? '—'}</td>
                <td data-label="Subject">{t.subject}</td>
                <td data-label="Status">
                  <Badge value={t.status} />
                </td>
                <td data-label="Priority">
                  <Badge value={t.priority} />
                </td>
                <td data-label="Last activity">{dateTime(t.lastMessageAt)}</td>
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  No tickets.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {cursor && (
        <button
          onClick={() =>
            void request<TicketRow[]>('GET', path(cursor)).then((r) => {
              setRows((x) => [...x, ...r.data]);
              setCursor(r.meta?.nextCursor ?? null);
            })
          }
        >
          Load more
        </button>
      )}
    </>
  );
}

interface TicketDetailData {
  id: string;
  label: string;
  status: string;
  priority: string;
  category: string;
  subject: string;
  assignedAdminId: string | null;
  callbackPhone: string | null;
  callbackWindow: string | null;
  appVersion: string | null;
  deviceInfo: string | null;
  lastCorrelationId: string | null;
  createdAt: string;
  shop: { id: string; name: string; lockStatus: string } | null;
  createdBy: { fullName: string; phone: string } | null;
  messages: {
    id: string;
    senderType: string;
    body: string;
    internalNote: boolean;
    createdAt: string;
  }[];
}

export function TicketDetail({ id, adminId, role }: { id: string; adminId: string; role: Role }) {
  const { data, error, loading, reload } = useLoad(
    () => api.get<TicketDetailData>(`/tickets/${id}`),
    [id],
  );
  // Only ADMIN may list admins; SUPPORT can still assign to themselves or unassign.
  const admins = useLoad(
    () =>
      role === 'ADMIN'
        ? api.get<{ id: string; fullName: string; isActive: boolean }[]>('/admins')
        : Promise.resolve([]),
    [role],
  );
  const [body, setBody] = useState('');
  const [internal, setInternal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!data) return <Loading loading={loading} error={error} />;

  const act = (fn: () => Promise<unknown>) => {
    setBusy(true);
    setErr(null);
    fn()
      .then(reload)
      .catch((e: unknown) => setErr(errorText(e)))
      .finally(() => setBusy(false));
  };

  return (
    <>
      <p className="small">
        <a href="#/tickets">← Tickets</a>
      </p>
      <div className="spread">
        <div>
          <h1 style={{ marginBottom: 4 }}>
            {data.label} · {data.subject}
          </h1>
          <div className="row">
            <Badge value={data.status} />
            <Badge value={data.priority} />
            <span className="muted">{data.category}</span>
          </div>
        </div>
        <div className="row">
          <select
            value={data.status}
            onChange={(e) =>
              act(() => api.post(`/tickets/${id}/status`, { status: e.target.value }))
            }
            aria-label="Status"
            disabled={busy}
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
          <select
            value={data.priority}
            onChange={(e) =>
              act(() => api.post(`/tickets/${id}/status`, { priority: e.target.value }))
            }
            aria-label="Priority"
            disabled={busy}
          >
            {['LOW', 'NORMAL', 'HIGH', 'URGENT'].map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
          <select
            value={data.assignedAdminId ?? ''}
            onChange={(e) =>
              act(() => api.post(`/tickets/${id}/assign`, { adminId: e.target.value || null }))
            }
            aria-label="Assignee"
            disabled={busy}
          >
            <option value="">Unassigned</option>
            <option value={adminId}>Me</option>
            {(admins.data ?? [])
              .filter((a) => a.isActive && a.id !== adminId)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.fullName}
                </option>
              ))}
          </select>
        </div>
      </div>
      <Alert kind="error">{err}</Alert>

      <div className="card">
        <dl className="kv">
          <dt>Shop</dt>
          <dd>
            {data.shop ? <a href={`#/shops/${data.shop.id}`}>{data.shop.name}</a> : '—'}{' '}
            {data.shop?.lockStatus === 'LOCKED' && <Badge value="LOCKED" />}
          </dd>
          <dt>Raised by</dt>
          <dd>
            {data.createdBy?.fullName} · {data.createdBy?.phone} · {dateTime(data.createdAt)}
          </dd>
          {data.callbackPhone && (
            <>
              <dt>Call back</dt>
              <dd>
                <a href={`tel:${data.callbackPhone}`}>{data.callbackPhone}</a> ·{' '}
                {data.callbackWindow}
              </dd>
            </>
          )}
          <dt>App / device</dt>
          <dd>
            {data.appVersion ?? '—'} · {data.deviceInfo ?? '—'}
          </dd>
          {data.lastCorrelationId && (
            <>
              <dt>Correlation id</dt>
              <dd className="secret small">{data.lastCorrelationId}</dd>
            </>
          )}
        </dl>
      </div>

      <div className="thread">
        {data.messages.map((m) => {
          const staff = m.senderType === 'ADMIN' || m.senderType === 'SUPPORT';
          return (
            <div key={m.id} className={`msg ${m.internalNote ? 'note' : staff ? 'staff' : ''}`}>
              <div className="who">
                {m.internalNote ? 'Internal note' : m.senderType} · {dateTime(m.createdAt)}
              </div>
              {m.body}
            </div>
          );
        })}
      </div>

      {data.status === 'CLOSED' && (
        <Alert kind="warn">This ticket is closed. You can still add an internal note.</Alert>
      )}
      <div className="card">
        <label>
          {internal ? 'Internal note (the shop never sees it)' : 'Reply to the shop'}
          <textarea value={body} onChange={(e) => setBody(e.target.value)} />
        </label>
        <div className="row" style={{ marginBottom: 10 }}>
          {CANNED.map((c) => (
            <button key={c} className="small" onClick={() => setBody(c)} title={c}>
              {c.slice(0, 28)}…
            </button>
          ))}
        </div>
        <div className="spread" style={{ marginBottom: 0 }}>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', margin: 0 }}>
            <input
              type="checkbox"
              checked={internal}
              onChange={(e) => setInternal(e.target.checked)}
              style={{ width: 'auto', margin: 0 }}
            />
            Internal note
          </label>
          <button
            className="primary"
            disabled={busy || !body.trim()}
            onClick={() =>
              act(async () => {
                await api.post(`/tickets/${id}/messages`, {
                  body: body.trim(),
                  internalNote: internal,
                });
                setBody('');
              })
            }
          >
            {internal ? 'Add note' : 'Send reply'}
          </button>
        </div>
      </div>
    </>
  );
}

interface Settings {
  phone: string | null;
  whatsapp: string | null;
  hoursText: string | null;
  updatedAt: string | null;
}

export function SupportSettings({ role }: { role: Role }) {
  const { data, error, loading } = useLoad(() => api.get<Settings | null>('/support-settings'), []);
  const [form, setForm] = useState<{ phone: string; whatsapp: string; hours: string } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  if (loading || error) return <Loading loading={loading} error={error} />;
  const f = form ?? {
    phone: data?.phone ?? '',
    whatsapp: data?.whatsapp ?? '',
    hours: data?.hoursText ?? '',
  };
  const readOnly = role !== 'ADMIN';
  return (
    <>
      <h1>Support contact</h1>
      <p className="muted">
        The shop app’s Call and WhatsApp buttons use these, even when a shop is locked. Changes
        apply at once, no app update needed.
      </p>
      <Alert kind="ok">{msg}</Alert>
      <Alert kind="error">{err}</Alert>
      <div className="card" style={{ maxWidth: 520 }}>
        <label>
          Phone (with country code)
          <input
            value={f.phone}
            disabled={readOnly}
            placeholder="+919876543210"
            onChange={(e) => setForm({ ...f, phone: e.target.value })}
          />
        </label>
        <label>
          WhatsApp number (country code, digits only)
          <input
            value={f.whatsapp}
            disabled={readOnly}
            placeholder="919876543210"
            onChange={(e) => setForm({ ...f, whatsapp: e.target.value })}
          />
        </label>
        <label>
          Hours
          <input
            value={f.hours}
            disabled={readOnly}
            placeholder="Mon-Sat 9 am - 7 pm"
            onChange={(e) => setForm({ ...f, hours: e.target.value })}
          />
        </label>
        {!readOnly && (
          <button
            className="primary"
            onClick={() => {
              setMsg(null);
              setErr(null);
              api
                .patch('/support-settings', {
                  ...(f.phone ? { phone: f.phone } : {}),
                  ...(f.whatsapp ? { whatsapp: f.whatsapp } : {}),
                  ...(f.hours ? { hours: f.hours } : {}),
                })
                .then(() => setMsg('Saved. The app shows the new contact at once.'))
                .catch((e: unknown) => setErr(errorText(e)));
            }}
          >
            Save
          </button>
        )}
        {data?.updatedAt && <p className="muted small">Last changed {dateTime(data.updatedAt)}</p>}
      </div>
    </>
  );
}

import { useState } from 'react';
import { api, dateTime, request, type Role } from '../api';
import { Alert, Badge, errorText, Loading, Modal, ReasonDialog, useLoad } from '../ui';

interface AdminRow {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  isActive: boolean;
  mustChangePassword: boolean;
  mfaEnabledAt: string | null;
  lockedUntil: string | null;
  lastLoginAt: string | null;
}

type Pending =
  | { kind: 'role'; a: AdminRow }
  | { kind: 'active'; a: AdminRow }
  | { kind: 'mfa'; a: AdminRow }
  | { kind: 'password'; a: AdminRow }
  | null;

/** ADMIN only: platform admins and support staff (ADMIN_PANEL.md section 6, screen 9). */
export function Admins({ me }: { me: string }) {
  const { data, error, loading, reload } = useLoad(() => api.get<AdminRow[]>('/admins'), []);
  const [creating, setCreating] = useState(false);
  const [pending, setPending] = useState<Pending>(null);
  const [secret, setSecret] = useState<{ email: string; password: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <>
      <div className="spread">
        <h1 style={{ margin: 0 }}>Admins and support</h1>
        <button className="primary" onClick={() => setCreating(true)}>
          Add person
        </button>
      </div>
      <Alert kind="ok">{notice}</Alert>
      <Loading loading={loading} error={error} />
      <div className="card" style={{ padding: 0 }}>
        <table className="cards">
          <thead>
            <tr>
              <th>Name</th>
              <th>Role</th>
              <th>Status</th>
              <th>Authenticator</th>
              <th>Last sign-in</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {(data ?? []).map((a) => (
              <tr key={a.id}>
                <td data-label="Name">
                  <b>{a.fullName}</b>
                  {a.id === me && <span className="muted small"> (you)</span>}
                  <div className="muted small">{a.email}</div>
                </td>
                <td data-label="Role">{a.role}</td>
                <td data-label="Status">
                  <Badge value={a.isActive ? 'ACTIVE' : 'CLOSED'} />
                  {a.mustChangePassword && <div className="muted small">temporary password</div>}
                </td>
                <td data-label="Authenticator">{a.mfaEnabledAt ? 'Set up' : 'Not yet'}</td>
                <td data-label="Last sign-in">{dateTime(a.lastLoginAt)}</td>
                <td data-label="">
                  {a.id !== me && (
                    <div className="row">
                      <button onClick={() => setPending({ kind: 'role', a })}>
                        Make {a.role === 'ADMIN' ? 'support' : 'admin'}
                      </button>
                      <button onClick={() => setPending({ kind: 'active', a })}>
                        {a.isActive ? 'Disable' : 'Enable'}
                      </button>
                      <button onClick={() => setPending({ kind: 'mfa', a })}>
                        Reset authenticator
                      </button>
                      <button onClick={() => setPending({ kind: 'password', a })}>
                        Reset password
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {creating && (
        <CreateAdmin
          onClose={() => setCreating(false)}
          onCreated={(email, password) => {
            setSecret({ email, password });
            reload();
          }}
        />
      )}
      {secret && (
        <Modal title="Temporary password" onClose={() => setSecret(null)}>
          <p>
            Send this to <b>{secret.email}</b> privately. It is shown only once. At first sign-in
            they set up Google Authenticator and choose their own password.
          </p>
          <p className="secret" style={{ fontSize: 18 }}>
            {secret.password}
          </p>
          <div className="actions">
            <button className="primary" onClick={() => setSecret(null)}>
              Done
            </button>
          </div>
        </Modal>
      )}
      {pending && (
        <ReasonDialog
          title={
            pending.kind === 'role'
              ? `Change ${pending.a.fullName} to ${pending.a.role === 'ADMIN' ? 'SUPPORT' : 'ADMIN'}?`
              : pending.kind === 'active'
                ? `${pending.a.isActive ? 'Disable' : 'Enable'} ${pending.a.fullName}?`
                : pending.kind === 'mfa'
                  ? `Reset the authenticator of ${pending.a.fullName}?`
                  : `Reset the password of ${pending.a.fullName}?`
          }
          description="They are signed out. There must always be at least one active ADMIN."
          confirmLabel="Confirm"
          danger={pending.kind !== 'role'}
          onConfirm={async (reason) => {
            const a = pending.a;
            if (pending.kind === 'role') {
              await api.patch(`/admins/${a.id}`, {
                role: a.role === 'ADMIN' ? 'SUPPORT' : 'ADMIN',
                reason,
              });
            } else if (pending.kind === 'active') {
              await api.patch(`/admins/${a.id}`, { isActive: !a.isActive, reason });
            } else if (pending.kind === 'mfa') {
              await api.post(`/admins/${a.id}/reset-mfa`, { reason });
            } else {
              const r = await api.post<{ temporaryPassword: string }>(
                `/admins/${a.id}/reset-password`,
                { reason },
              );
              setSecret({ email: a.email, password: r.temporaryPassword });
            }
            setNotice('Saved.');
            reload();
          }}
          onClose={() => setPending(null)}
        />
      )}
    </>
  );
}

function CreateAdmin({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (email: string, password: string) => void;
}) {
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<Role>('SUPPORT');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="Add admin or support" onClose={onClose}>
      <Alert kind="error">{error}</Alert>
      <label>
        Name
        <input value={fullName} onChange={(e) => setFullName(e.target.value)} />
      </label>
      <label>
        Email
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label>
        Role
        <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
          <option value="SUPPORT">SUPPORT: reads shops, answers tickets</option>
          <option value="ADMIN">ADMIN: everything, including money and locks</option>
        </select>
      </label>
      <div className="actions">
        <button onClick={onClose}>Cancel</button>
        <button
          className="primary"
          disabled={busy || !email || fullName.trim().length < 2}
          onClick={() => {
            setBusy(true);
            setError(null);
            api
              .post<{ admin: { email: string }; temporaryPassword: string }>('/admins', {
                email,
                fullName,
                role,
              })
              .then((r) => {
                onCreated(r.admin.email, r.temporaryPassword);
                onClose();
              })
              .catch((e: unknown) => setError(errorText(e)))
              .finally(() => setBusy(false));
          }}
        >
          Create
        </button>
      </div>
    </Modal>
  );
}

interface AuditRow {
  id: string;
  admin: { email: string; fullName: string };
  action: string;
  organizationId: string | null;
  entityType: string | null;
  reason: string | null;
  ipAddress: string | null;
  beforeData: unknown;
  afterData: unknown;
  createdAt: string;
}

/** ADMIN sees everything; SUPPORT only its own entries (enforced by the API). */
export function Audit({ params }: { params: URLSearchParams }) {
  const [action, setAction] = useState('');
  const orgId = params.get('organizationId') ?? '';
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const path = (c?: string | null) => {
    const p = new URLSearchParams();
    if (action.trim()) p.set('action', action.trim());
    if (orgId) p.set('organizationId', orgId);
    if (c) p.set('cursor', c);
    return `/audit?${p.toString()}`;
  };
  const { error, loading } = useLoad(async () => {
    const r = await request<AuditRow[]>('GET', path());
    setRows(r.data);
    setCursor(r.meta?.nextCursor ?? null);
  }, [action, orgId]);

  return (
    <>
      <h1>Audit log</h1>
      <div className="filters">
        <input
          placeholder="Action, e.g. shop.lock"
          value={action}
          onChange={(e) => setAction(e.target.value)}
          aria-label="Action"
        />
        {orgId && (
          <span className="badge b-OPEN">
            One shop · <a href="#/audit">clear</a>
          </span>
        )}
      </div>
      <Loading loading={loading && rows.length === 0} error={error} />
      <div className="card" style={{ padding: 0 }}>
        <table className="cards">
          <thead>
            <tr>
              <th>When</th>
              <th>Who</th>
              <th>Action</th>
              <th>Reason</th>
              <th>IP</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="click" onClick={() => setOpen(open === r.id ? null : r.id)}>
                <td data-label="When">{dateTime(r.createdAt)}</td>
                <td data-label="Who">{r.admin.email}</td>
                <td data-label="Action">
                  <code>{r.action}</code>
                  {r.organizationId && (
                    <div className="small">
                      <a href={`#/shops/${r.organizationId}`} onClick={(e) => e.stopPropagation()}>
                        shop
                      </a>
                    </div>
                  )}
                  {open === r.id && (
                    <pre className="small" style={{ whiteSpace: 'pre-wrap', textAlign: 'left' }}>
                      {JSON.stringify({ before: r.beforeData, after: r.afterData }, null, 2)}
                    </pre>
                  )}
                </td>
                <td data-label="Reason">{r.reason ?? '—'}</td>
                <td data-label="IP">{r.ipAddress ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {cursor && (
        <button
          onClick={() =>
            void request<AuditRow[]>('GET', path(cursor)).then((r) => {
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

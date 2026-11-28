import { useState } from 'react';
import { api, dateTime, request, type Role } from '../api';
import {
  Alert,
  Avatar,
  Badge,
  Empty,
  errorText,
  Icon,
  Loading,
  Modal,
  PageHead,
  ReasonDialog,
  useLoad,
} from '../ui';

interface UserRow {
  memberId: string;
  status: 'ACTIVE' | 'DEACTIVATED' | 'INVITED';
  joinedAt: string;
  shop: { id: string; name: string };
  role: { id: string; name: string; isOwner: boolean };
  user: {
    id: string;
    fullName: string;
    phone: string | null;
    email: string | null;
    isActive: boolean;
    lastLoginAt: string | null;
    loginLocked: boolean;
  };
}

type Pending =
  | { kind: 'edit'; u: UserRow }
  | { kind: 'remove'; u: UserRow }
  | { kind: 'restore'; u: UserRow }
  | { kind: 'logout'; u: UserRow }
  | { kind: 'reset'; u: UserRow }
  | null;

const TABS = [
  { key: '', label: 'Everyone' },
  { key: 'ACTIVE', label: 'Active' },
  { key: 'DEACTIVATED', label: 'Removed' },
] as const;
const ROLE_FILTERS = ['Owner', 'Manager', 'Cashier', 'Collection Agent'];

const roleTone = (name: string) =>
  name === 'Owner' ? 'PRO' : name === 'Manager' ? 'TRIAL' : name === 'Cashier' ? 'ACTIVE' : 'BASIC';

/** Every person in every shop (ADMIN_PANEL users). ADMIN can edit, change role, remove and reset. */
export function Users({ params, role }: { params: URLSearchParams; role: Role }) {
  const isAdmin = role === 'ADMIN';
  const orgId = params.get('orgId') ?? '';
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [roleName, setRoleName] = useState('');
  const [rows, setRows] = useState<UserRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [secret, setSecret] = useState<{
    name: string;
    phone: string | null;
    password: string;
  } | null>(null);

  const path = (c?: string | null) => {
    const p = new URLSearchParams({ limit: '50' });
    if (q.trim()) p.set('q', q.trim());
    if (status) p.set('status', status);
    if (roleName) p.set('role', roleName);
    if (orgId) p.set('orgId', orgId);
    if (c) p.set('cursor', c);
    return `/users?${p.toString()}`;
  };
  const { error, loading, reload } = useLoad(async () => {
    const r = await request<UserRow[]>('GET', path());
    setRows(r.data);
    setCursor(r.meta?.nextCursor ?? null);
  }, [q, status, roleName, orgId]);

  const done = (msg: string) => {
    setNotice(msg);
    reload();
  };

  return (
    <>
      <PageHead
        title="Users"
        subtitle="Everyone who works in any shop. Edit them, change their role, or remove them."
      />
      <Alert kind="ok">{notice}</Alert>

      <div className="tabs" role="tablist" aria-label="Status">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={status === t.key ? 'on' : ''}
            onClick={() => setStatus(t.key)}
            role="tab"
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="filters">
        <input
          placeholder="Search name, phone, email or shop"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search users"
          style={{ minWidth: 300 }}
        />
        <select value={roleName} onChange={(e) => setRoleName(e.target.value)} aria-label="Role">
          <option value="">Any role</option>
          {ROLE_FILTERS.map((r) => (
            <option key={r}>{r}</option>
          ))}
        </select>
        {orgId && (
          <span className="badge b-OPEN">
            One shop · <a href="#/users">show all</a>
          </span>
        )}
      </div>

      <Loading loading={loading && rows.length === 0} error={error} />
      <div className="card flush">
        <table className="cards">
          <thead>
            <tr>
              <th>Person</th>
              <th>Shop</th>
              <th>Role</th>
              <th>Status</th>
              <th>Last sign-in</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.memberId}>
                <td data-label="Person">
                  <div className="who-cell">
                    <Avatar name={u.user.fullName} />
                    <div style={{ minWidth: 0 }}>
                      <b>{u.user.fullName}</b>
                      <div className="muted small">
                        {[u.user.phone, u.user.email].filter(Boolean).join(' · ')}
                      </div>
                    </div>
                  </div>
                </td>
                <td data-label="Shop">
                  <a href={`#/shops/${u.shop.id}`}>{u.shop.name}</a>
                </td>
                <td data-label="Role">
                  <span className={`badge b-${roleTone(u.role.name)}`}>{u.role.name}</span>
                </td>
                <td data-label="Status">
                  <Badge
                    value={
                      u.status === 'ACTIVE' ? 'ACTIVE' : u.status === 'INVITED' ? 'OPEN' : 'CLOSED'
                    }
                  />
                  {u.user.loginLocked && (
                    <div>
                      <span className="badge b-LOCKED">Login locked</span>
                    </div>
                  )}
                </td>
                <td data-label="Last sign-in">{dateTime(u.user.lastLoginAt)}</td>
                <td data-label="">
                  <div className="row" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                    {isAdmin && (
                      <button className="small" onClick={() => setPending({ kind: 'edit', u })}>
                        {Icon.user} Edit
                      </button>
                    )}
                    {!isAdmin && (
                      <button className="small" onClick={() => setPending({ kind: 'logout', u })}>
                        Sign out
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && rows.length === 0 && <Empty>No users match.</Empty>}
      </div>
      {cursor && (
        <button
          onClick={() =>
            void request<UserRow[]>('GET', path(cursor)).then((r) => {
              setRows((x) => [...x, ...r.data]);
              setCursor(r.meta?.nextCursor ?? null);
            })
          }
        >
          Load more
        </button>
      )}

      {pending?.kind === 'edit' && (
        <EditUser
          u={pending.u}
          onClose={() => setPending(null)}
          onSaved={(m) => done(m)}
          onAction={(kind) => setPending({ kind, u: pending.u })}
        />
      )}
      {pending?.kind === 'remove' && (
        <ReasonDialog
          title={`Remove ${pending.u.user.fullName}?`}
          description={`They are signed out at once and cannot work in ${pending.u.shop.name} any more. Their bills and history stay. You can restore them later.`}
          confirmLabel="Remove from shop"
          danger
          typeToConfirm={pending.u.user.fullName}
          onConfirm={(reason) =>
            api
              .post(`/users/${pending.u.memberId}/status`, { status: 'DEACTIVATED', reason })
              .then(() => done('User removed from the shop.'))
          }
          onClose={() => setPending(null)}
        />
      )}
      {pending?.kind === 'restore' && (
        <ReasonDialog
          title={`Bring ${pending.u.user.fullName} back?`}
          description="They can sign in again. The shop's plan user limit still applies."
          confirmLabel="Restore"
          onConfirm={(reason) =>
            api
              .post(`/users/${pending.u.memberId}/status`, { status: 'ACTIVE', reason })
              .then(() => done('User restored.'))
          }
          onClose={() => setPending(null)}
        />
      )}
      {pending?.kind === 'logout' && (
        <ReasonDialog
          title={`Sign ${pending.u.user.fullName} out?`}
          description="Every phone and browser of this person has to sign in again."
          confirmLabel="Sign out"
          onConfirm={(reason) =>
            api
              .post(`/users/${pending.u.memberId}/force-logout`, { reason })
              .then(() => done('Signed out.'))
          }
          onClose={() => setPending(null)}
        />
      )}
      {pending?.kind === 'reset' && (
        <ReasonDialog
          title={`Reset the password of ${pending.u.user.fullName}?`}
          description="A temporary password is shown once. They are signed out everywhere."
          confirmLabel="Reset password"
          danger
          onConfirm={async (reason) => {
            const r = await api.post<{ temporaryPassword: string }>(
              `/users/${pending.u.memberId}/reset-password`,
              { reason },
            );
            setSecret({
              name: pending.u.user.fullName,
              phone: pending.u.user.phone,
              password: r.temporaryPassword,
            });
          }}
          onClose={() => setPending(null)}
        />
      )}
      {secret && (
        <Modal title="Temporary password" onClose={() => setSecret(null)}>
          <p>
            Give this to <b>{secret.name}</b>
            {secret.phone ? ` (${secret.phone})` : ''}. It is shown only once.
          </p>
          <p className="secret" style={{ fontSize: 20, fontWeight: 700 }}>
            {secret.password}
          </p>
          <div className="actions">
            <button className="primary" onClick={() => setSecret(null)}>
              Done
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

function EditUser({
  u,
  onClose,
  onSaved,
  onAction,
}: {
  u: UserRow;
  onClose: () => void;
  onSaved: (m: string) => void;
  onAction: (kind: 'remove' | 'restore' | 'logout' | 'reset') => void;
}) {
  const roles = useLoad(
    () => api.get<{ id: string; name: string; isSystem: boolean }[]>(`/shops/${u.shop.id}/roles`),
    [u.shop.id],
  );
  const [fullName, setFullName] = useState(u.user.fullName);
  const [phone, setPhone] = useState(u.user.phone ?? '');
  const [email, setEmail] = useState(u.user.email ?? '');
  const [roleId, setRoleId] = useState(u.role.id);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const changed = {
    ...(fullName.trim() !== u.user.fullName ? { fullName: fullName.trim() } : {}),
    ...(phone.trim() !== (u.user.phone ?? '') ? { phone: phone.trim() } : {}),
    ...(email.trim().toLowerCase() !== (u.user.email ?? '') ? { email: email.trim() } : {}),
    ...(roleId !== u.role.id ? { roleId } : {}),
  };
  const dirty = Object.keys(changed).length > 0;
  const removed = u.status === 'DEACTIVATED';

  return (
    <Modal title={`Edit ${u.user.fullName}`} onClose={onClose}>
      <div className="who-cell" style={{ marginBottom: 16 }}>
        <Avatar name={u.user.fullName} size="lg" />
        <div>
          <b>{u.shop.name}</b>
          <div className="row" style={{ marginTop: 4 }}>
            <Badge value={removed ? 'CLOSED' : 'ACTIVE'} />
            <span className="muted small">{removed ? 'Removed from this shop' : u.role.name}</span>
          </div>
        </div>
      </div>
      <Alert kind="error">{error}</Alert>
      <label>
        Full name
        <input value={fullName} onChange={(e) => setFullName(e.target.value)} />
      </label>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <label style={{ flex: 1, minWidth: 180 }}>
          Mobile number
          <input value={phone} inputMode="tel" onChange={(e) => setPhone(e.target.value)} />
        </label>
        <label style={{ flex: 1, minWidth: 180 }}>
          Email
          <input value={email} type="email" onChange={(e) => setEmail(e.target.value)} />
        </label>
      </div>
      <p className="muted small" style={{ marginTop: -6 }}>
        Phone and email belong to the person, so a change applies in every shop they work in.
      </p>
      <label>
        Role in {u.shop.name}
        <select value={roleId} onChange={(e) => setRoleId(e.target.value)} disabled={roles.loading}>
          {(roles.data ?? [{ id: u.role.id, name: u.role.name, isSystem: true }]).map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
              {r.isSystem ? '' : ' (custom)'}
            </option>
          ))}
        </select>
      </label>
      <label>
        Reason (kept in the audit log)
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Why are you changing this?"
        />
      </label>
      <div className="actions">
        <button onClick={onClose}>Cancel</button>
        <button
          className="primary"
          disabled={busy || !dirty || reason.trim().length < 3}
          onClick={() => {
            setBusy(true);
            setError(null);
            api
              .patch(`/users/${u.memberId}`, { ...changed, reason: reason.trim() })
              .then(() => {
                onSaved('Saved.');
                onClose();
              })
              .catch((e: unknown) => setError(errorText(e)))
              .finally(() => setBusy(false));
          }}
        >
          {busy ? 'Saving…' : 'Save changes'}
        </button>
      </div>
      <div className="zone">
        <span className="muted small">More actions</span>
        <div className="row">
          <button className="small" onClick={() => onAction('logout')}>
            Sign out everywhere
          </button>
          <button className="small" onClick={() => onAction('reset')}>
            Reset password
          </button>
          {removed ? (
            <button className="small" onClick={() => onAction('restore')}>
              Restore to shop
            </button>
          ) : (
            <button className="small danger" onClick={() => onAction('remove')}>
              Remove from shop
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}

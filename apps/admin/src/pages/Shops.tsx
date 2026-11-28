import { useState } from 'react';
import { api, date, dateTime, newKey, request, rupees, type Role } from '../api';
import {
  Alert,
  Avatar,
  Badge,
  errorText,
  Icon,
  Loading,
  Modal,
  PageHead,
  ReasonDialog,
  useLoad,
} from '../ui';

interface ShopRow {
  id: string;
  name: string;
  phone: string | null;
  createdAt: string;
  owner: { fullName: string; phone: string } | null;
  state: string;
  planCode: string | null;
  endsAt: string | null;
  daysLeft: number | null;
}

const STATES = ['', 'TRIAL', 'ACTIVE', 'GRACE', 'EXPIRED', 'LOCKED'];

export function Shops({ params }: { params: URLSearchParams }) {
  const [q, setQ] = useState(params.get('q') ?? '');
  const [status, setStatus] = useState(params.get('status') ?? '');
  const [plan, setPlan] = useState(params.get('plan') ?? '');
  const expiring = params.get('expiringInDays') ?? '';
  const [rows, setRows] = useState<ShopRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);

  const query = (c?: string | null) => {
    const p = new URLSearchParams();
    if (q.trim()) p.set('q', q.trim());
    if (status) p.set('status', status);
    if (plan) p.set('plan', plan);
    if (expiring) p.set('expiringInDays', expiring);
    if (c) p.set('cursor', c);
    return `/shops?${p.toString()}`;
  };
  const { error, loading } = useLoad(async () => {
    const r = await request<ShopRow[]>('GET', query());
    setRows(r.data);
    setCursor(r.meta?.nextCursor ?? null);
  }, [q, status, plan, expiring]);

  const more = async () => {
    const r = await request<ShopRow[]>('GET', query(cursor));
    setRows((x) => [...x, ...r.data]);
    setCursor(r.meta?.nextCursor ?? null);
  };

  return (
    <>
      <PageHead
        title="Shops"
        subtitle="Every shop on Yapaaram, with where it stands in its subscription."
      />
      <div className="tabs" role="tablist" aria-label="Stage">
        {STATES.map((st) => (
          <button
            key={st}
            className={status === st ? 'on' : ''}
            onClick={() => setStatus(st)}
            role="tab"
          >
            {st ? st[0] + st.slice(1).toLowerCase() : 'All'}
          </button>
        ))}
      </div>
      <div className="filters">
        <input
          placeholder="Search shop name or phone"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search shops"
          style={{ minWidth: 280 }}
        />
        <select value={plan} onChange={(e) => setPlan(e.target.value)} aria-label="Plan">
          <option value="">Any plan</option>
          <option>TRIAL</option>
          <option>BASIC</option>
          <option>PRO</option>
        </select>
        {expiring && <span className="badge b-GRACE">Ending within {expiring} days</span>}
      </div>
      <Loading loading={loading && rows.length === 0} error={error} />
      <div className="card flush">
        <table className="cards">
          <thead>
            <tr>
              <th>Shop</th>
              <th>Owner</th>
              <th>State</th>
              <th>Plan</th>
              <th>Ends</th>
              <th>Joined</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="click" onClick={() => (location.hash = `#/shops/${r.id}`)}>
                <td data-label="Shop">
                  <div className="who-cell">
                    <Avatar name={r.name} />
                    <div style={{ minWidth: 0 }}>
                      <b>{r.name}</b>
                      {r.phone && <div className="muted small">{r.phone}</div>}
                    </div>
                  </div>
                </td>
                <td data-label="Owner">
                  {r.owner ? (
                    <>
                      {r.owner.fullName}
                      <div className="muted small">{r.owner.phone}</div>
                    </>
                  ) : (
                    '—'
                  )}
                </td>
                <td data-label="State">
                  <Badge value={r.state} />
                </td>
                <td data-label="Plan">
                  <Badge value={r.planCode} />
                </td>
                <td data-label="Ends">
                  {date(r.endsAt)}
                  {r.daysLeft !== null && (
                    <div
                      className={`meter ${r.daysLeft <= 0 ? 'bad' : r.daysLeft <= 7 ? 'warn' : ''}`}
                      title={`${r.daysLeft} days left`}
                    >
                      <i
                        style={{ width: `${Math.max(4, Math.min(100, (r.daysLeft / 30) * 100))}%` }}
                      />
                    </div>
                  )}
                </td>
                <td data-label="Joined">{date(r.createdAt)}</td>
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  No shops match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {cursor && <button onClick={() => void more()}>Load more</button>}
    </>
  );
}

interface Detail {
  id: string;
  name: string;
  legalName: string | null;
  phone: string | null;
  email: string | null;
  gstEnabled: boolean;
  createdAt: string;
  lock: {
    status: string;
    reason: string | null;
    lockedAt: string | null;
    lockedBy: { email: string } | null;
  };
  subscription: {
    state: string;
    planCode: string | null;
    endsAt: string | null;
    graceEndsAt: string | null;
    daysLeft: number | null;
    startsAt: string | null;
    graceDays: number | null;
    plan: { id: string; name: string; maxBranches: number | null; maxUsers: number | null } | null;
  };
  branches: { id: string; code: string; name: string; city: string | null; isActive: boolean }[];
  users: {
    memberId: string;
    status: string;
    role: string;
    isOwner: boolean;
    fullName: string;
    phone: string;
    lastLoginAt: string | null;
  }[];
  devices: {
    id: string;
    name: string | null;
    platform: string;
    appVersion: string | null;
    lastSeenAt: string | null;
    revokedAt: string | null;
    user: { fullName: string };
  }[];
  events: {
    id: string;
    type: string;
    months: number | null;
    oldEndsAt: string | null;
    newEndsAt: string | null;
    reason: string | null;
    createdAt: string;
    plan: { code: string } | null;
    admin: { email: string } | null;
  }[];
  payments:
    | {
        id: string;
        amount: string;
        method: string;
        reference: string | null;
        months: number;
        receivedAt: string;
        reversesPaymentId: string | null;
        recordedBy: { email: string };
      }[]
    | null;
  usage: { products: number; customers: number; sales: number; lastSaleAt: string | null };
}

interface Plan {
  id: string;
  code: string;
  name: string;
  monthlyPrice: string;
  isTrial: boolean;
  isActive: boolean;
}

type Action = 'lock' | 'unlock' | 'logout' | 'reset' | 'note' | 'extend' | 'plan' | 'adjust' | null;

export function ShopDetail({ id, role }: { id: string; role: Role }) {
  const { data, error, loading, reload } = useLoad(() => api.get<Detail>(`/shops/${id}`), [id]);
  const [tab, setTab] = useState<'overview' | 'subscription' | 'people' | 'history'>('overview');
  const [action, setAction] = useState<Action>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [revoke, setRevoke] = useState<string | null>(null);
  if (!data) return <Loading loading={loading} error={error} />;
  const isAdmin = role === 'ADMIN';
  const done = (msg: string) => {
    setNotice(msg);
    reload();
  };
  const sub = data.subscription;

  return (
    <>
      <p className="small" style={{ margin: '0 0 12px' }}>
        <a href="#/shops">← Back to shops</a>
      </p>
      <div className="profile">
        <div className="banner" />
        <div className="profile-body">
          <Avatar name={data.name} size="lg" />
          <div className="id">
            <h1>{data.name}</h1>
            <div className="row">
              <Badge value={sub.state} />
              <Badge value={sub.planCode ?? 'No plan'} />
              {data.phone && <span className="muted">{data.phone}</span>}
              <span className="muted">Joined {date(data.createdAt)}</span>
            </div>
          </div>
          <div className="row toolbar">
            {isAdmin && (
              <button className="primary" onClick={() => setAction('extend')}>
                {Icon.money} Record payment
              </button>
            )}
            {isAdmin &&
              (data.lock.status === 'LOCKED' ? (
                <button onClick={() => setAction('unlock')}>{Icon.check} Unlock</button>
              ) : (
                <button className="danger" onClick={() => setAction('lock')}>
                  {Icon.lock} Lock
                </button>
              ))}
            <button onClick={() => setAction('logout')}>{Icon.alert} Force logout</button>
            <button onClick={() => setAction('note')}>{Icon.log} Note</button>
          </div>
        </div>
        <div className="facts">
          <div className="fact">
            <span>Paid until</span>
            <b>{date(sub.endsAt)}</b>
          </div>
          <div className="fact">
            <span>Days left</span>
            <b className="num">{sub.daysLeft ?? '—'}</b>
          </div>
          <div className="fact">
            <span>Users</span>
            <b className="num">{data.users.length}</b>
          </div>
          <div className="fact">
            <span>Bills made</span>
            <b className="num">{data.usage.sales}</b>
          </div>
          <div className="fact">
            <span>Branches</span>
            <b className="num">{data.branches.length}</b>
          </div>
        </div>
      </div>
      <Alert kind="ok">{notice}</Alert>
      {data.lock.status === 'LOCKED' && (
        <Alert kind="error">
          Locked {dateTime(data.lock.lockedAt)} by {data.lock.lockedBy?.email ?? '—'}:{' '}
          {data.lock.reason}
        </Alert>
      )}

      <div className="tabs" role="tablist">
        {(['overview', 'subscription', 'people', 'history'] as const).map((t) => (
          <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)} role="tab">
            {t === 'people' ? 'Users & devices' : t[0]!.toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="card">
          <dl className="kv">
            <dt>Phone</dt>
            <dd>{data.phone ?? '—'}</dd>
            <dt>Email</dt>
            <dd>{data.email ?? '—'}</dd>
            <dt>Legal name</dt>
            <dd>{data.legalName ?? '—'}</dd>
            <dt>GST</dt>
            <dd>{data.gstEnabled ? 'On' : 'Off'}</dd>
            <dt>Joined</dt>
            <dd>{dateTime(data.createdAt)}</dd>
            <dt>Branches</dt>
            <dd>{data.branches.map((b) => `${b.name}${b.isActive ? '' : ' (off)'}`).join(', ')}</dd>
            <dt>Products / customers</dt>
            <dd className="num">
              {data.usage.products} / {data.usage.customers}
            </dd>
            <dt>Bills</dt>
            <dd className="num">
              {data.usage.sales} · last {dateTime(data.usage.lastSaleAt)}
            </dd>
          </dl>
          {isAdmin && (
            <p style={{ marginTop: 16 }}>
              <button onClick={() => setAction('reset')}>Reset owner password</button>
            </p>
          )}
        </div>
      )}

      {tab === 'subscription' && (
        <>
          <div className="card">
            <div className="spread">
              <h2 style={{ margin: 0 }}>Subscription</h2>
              {isAdmin && (
                <div className="row">
                  <button onClick={() => setAction('plan')}>Change plan</button>
                  <button onClick={() => setAction('adjust')}>Adjust dates</button>
                </div>
              )}
            </div>
            <dl className="kv">
              <dt>State</dt>
              <dd>
                <Badge value={sub.state} />
              </dd>
              <dt>Plan</dt>
              <dd>
                {sub.plan?.name ?? '—'} ({sub.plan?.maxBranches ?? '∞'} branches,{' '}
                {sub.plan?.maxUsers ?? '∞'} users)
              </dd>
              <dt>Started</dt>
              <dd>{date(sub.startsAt)}</dd>
              <dt>Ends</dt>
              <dd>
                {dateTime(sub.endsAt)} {sub.daysLeft ? `(${sub.daysLeft} days left)` : ''}
              </dd>
              <dt>Grace</dt>
              <dd>
                {sub.graceDays ?? '—'} days, read-only from {dateTime(sub.graceEndsAt)}
              </dd>
            </dl>
          </div>
          {data.payments && (
            <div className="card">
              <h2>Payments</h2>
              <PaymentsTable
                rows={data.payments}
                onRefund={isAdmin ? (p) => setRevoke(p) : undefined}
              />
            </div>
          )}
        </>
      )}

      {tab === 'people' && (
        <>
          <div className="card">
            <h2>Users</h2>
            <table className="cards">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Phone</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Last sign-in</th>
                </tr>
              </thead>
              <tbody>
                {data.users.map((u) => (
                  <tr key={u.memberId}>
                    <td data-label="Name">{u.fullName}</td>
                    <td data-label="Phone">{u.phone}</td>
                    <td data-label="Role">{u.role}</td>
                    <td data-label="Status">
                      <Badge value={u.status === 'ACTIVE' ? 'ACTIVE' : 'CLOSED'} />
                    </td>
                    <td data-label="Last sign-in">{dateTime(u.lastLoginAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="card">
            <h2>Devices</h2>
            <table className="cards">
              <thead>
                <tr>
                  <th>Device</th>
                  <th>User</th>
                  <th>App</th>
                  <th>Last seen</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {data.devices.map((d) => (
                  <tr key={d.id}>
                    <td data-label="Device">
                      {d.name ?? d.platform}
                      {d.revokedAt && (
                        <div>
                          <Badge value="LOCKED" />
                        </div>
                      )}
                    </td>
                    <td data-label="User">{d.user.fullName}</td>
                    <td data-label="App">{d.appVersion ?? '—'}</td>
                    <td data-label="Last seen">{dateTime(d.lastSeenAt)}</td>
                    <td data-label="">
                      {!d.revokedAt && (
                        <button onClick={() => setRevoke(`device:${d.id}`)}>Block</button>
                      )}
                    </td>
                  </tr>
                ))}
                {data.devices.length === 0 && (
                  <tr>
                    <td colSpan={5} className="muted">
                      No devices.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'history' && (
        <div className="card">
          <h2>Subscription history</h2>
          <table className="cards">
            <thead>
              <tr>
                <th>When</th>
                <th>Event</th>
                <th>Details</th>
                <th>By</th>
              </tr>
            </thead>
            <tbody>
              {data.events.map((e) => (
                <tr key={e.id}>
                  <td data-label="When">{dateTime(e.createdAt)}</td>
                  <td data-label="Event">
                    <Badge value={e.type} />
                  </td>
                  <td data-label="Details">
                    {[
                      e.plan?.code,
                      e.months ? `${e.months} months` : null,
                      e.newEndsAt ? `→ ${date(e.newEndsAt)}` : null,
                      e.reason,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </td>
                  <td data-label="By">{e.admin?.email ?? 'system'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="small">
            <a href={`#/audit?organizationId=${data.id}`}>Full audit log for this shop →</a>
          </p>
        </div>
      )}

      {action === 'lock' && (
        <ReasonDialog
          title={`Lock ${data.name}?`}
          description="Every user is signed out at once and the app shows a locked screen with your support contact. Data is kept."
          confirmLabel="Lock shop"
          danger
          typeToConfirm={data.name}
          onConfirm={(reason) =>
            api.post(`/shops/${id}/lock`, { reason }).then(() => done('Shop locked.'))
          }
          onClose={() => setAction(null)}
        />
      )}
      {action === 'unlock' && (
        <ReasonDialog
          title={`Unlock ${data.name}?`}
          description="Access comes back at once. Subscription dates do not change."
          confirmLabel="Unlock"
          onConfirm={(reason) =>
            api.post(`/shops/${id}/unlock`, { reason }).then(() => done('Shop unlocked.'))
          }
          onClose={() => setAction(null)}
        />
      )}
      {action === 'logout' && (
        <ReasonDialog
          title="Sign everyone out?"
          description="Every phone and browser of this shop has to sign in again."
          confirmLabel="Force logout"
          onConfirm={(reason) =>
            api
              .post<{ sessionsRevoked: number }>(`/shops/${id}/force-logout`, { reason })
              .then((r) => done(`${r.sessionsRevoked} session(s) ended.`))
          }
          onClose={() => setAction(null)}
        />
      )}
      {action === 'note' && (
        <ReasonDialog
          title="Internal note"
          description="Visible to admin and support only (for example: recommend a lock)."
          confirmLabel="Save note"
          onConfirm={(note) =>
            api.post(`/shops/${id}/notes`, { note }).then(() => done('Note saved.'))
          }
          onClose={() => setAction(null)}
        />
      )}
      {action === 'reset' && (
        <ResetOwner id={id} name={data.name} onClose={() => setAction(null)} />
      )}
      {action === 'extend' && (
        <ExtendDialog
          id={id}
          locked={data.lock.status === 'LOCKED'}
          currentPlanId={sub.plan?.id ?? null}
          onDone={(m) => done(m)}
          onClose={() => setAction(null)}
        />
      )}
      {action === 'plan' && (
        <ChangePlanDialog
          id={id}
          current={sub.plan?.id ?? null}
          onDone={done}
          onClose={() => setAction(null)}
        />
      )}
      {action === 'adjust' && (
        <AdjustDialog
          id={id}
          endsAt={sub.endsAt}
          graceDays={sub.graceDays}
          onDone={done}
          onClose={() => setAction(null)}
        />
      )}
      {revoke?.startsWith('device:') && (
        <ReasonDialog
          title="Block this device?"
          description="The phone is signed out and cannot sign in to this shop again until the owner restores it."
          confirmLabel="Block device"
          danger
          onConfirm={(reason) =>
            api
              .post(`/shops/${id}/devices/${revoke.slice(7)}/revoke`, { reason })
              .then(() => done('Device blocked.'))
          }
          onClose={() => setRevoke(null)}
        />
      )}
      {revoke && !revoke.startsWith('device:') && (
        <RefundDialog
          id={id}
          payment={data.payments!.find((p) => p.id === revoke)!}
          onDone={done}
          onClose={() => setRevoke(null)}
        />
      )}
    </>
  );
}

function PaymentsTable({
  rows,
  onRefund,
}: {
  rows: NonNullable<Detail['payments']>;
  onRefund?: (id: string) => void;
}) {
  const refunded = new Set(rows.map((r) => r.reversesPaymentId).filter(Boolean));
  if (rows.length === 0) return <p className="muted">No payments yet.</p>;
  return (
    <table className="cards">
      <thead>
        <tr>
          <th>Received</th>
          <th className="right">Amount</th>
          <th>Method</th>
          <th>Months</th>
          <th>Reference</th>
          <th>By</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {rows.map((p) => (
          <tr key={p.id}>
            <td data-label="Received">{dateTime(p.receivedAt)}</td>
            <td data-label="Amount" className="right num">
              {rupees(p.amount)}
            </td>
            <td data-label="Method">{p.method}</td>
            <td data-label="Months">{p.months || '—'}</td>
            <td data-label="Reference">{p.reference ?? (p.reversesPaymentId ? 'Refund' : '—')}</td>
            <td data-label="By">{p.recordedBy.email}</td>
            <td data-label="">
              {onRefund && !p.reversesPaymentId && !refunded.has(p.id) && (
                <button onClick={() => onRefund(p.id)}>Refund</button>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function usePlans() {
  return useLoad(() => api.get<Plan[]>('/plans'), []);
}

function ExtendDialog({
  id,
  locked,
  currentPlanId,
  onDone,
  onClose,
}: {
  id: string;
  locked: boolean;
  currentPlanId: string | null;
  onDone: (m: string) => void;
  onClose: () => void;
}) {
  const plans = usePlans();
  const paid = (plans.data ?? []).filter((p) => !p.isTrial && p.isActive);
  const [planId, setPlanId] = useState<string>('');
  const [months, setMonths] = useState(1);
  const [method, setMethod] = useState('UPI');
  const [reference, setReference] = useState('');
  const [amount, setAmount] = useState('');
  const [unlock, setUnlock] = useState(locked);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One key per dialog: a double click or a retry after a lost answer extends once.
  const [key] = useState(newKey);
  const chosen =
    planId ||
    (paid.some((p) => p.id === currentPlanId)
      ? currentPlanId!
      : (paid.find((p) => p.code === 'PRO')?.id ?? ''));
  const quote = useLoad(
    () =>
      chosen
        ? api.get<{ amount: string; gross: string; discountPercent: string }>(
            `/shops/${id}/subscription/quote?months=${months}&planId=${chosen}`,
          )
        : Promise.resolve(null),
    [id, months, chosen],
  );

  return (
    <Modal title="Record payment and extend" onClose={onClose}>
      <Alert kind="error">{error}</Alert>
      <label>
        Plan
        <select value={chosen} onChange={(e) => setPlanId(e.target.value)}>
          {paid.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} · {rupees(p.monthlyPrice)}/month
            </option>
          ))}
        </select>
      </label>
      <label>
        Months
        <select value={months} onChange={(e) => setMonths(Number(e.target.value))}>
          {[1, 2, 3, 4, 5, 6, 9, 12, 18, 24].map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </label>
      {quote.data && (
        <p className="small">
          Price {rupees(quote.data.gross)}
          {quote.data.discountPercent !== '0' && ` − ${quote.data.discountPercent}%`} ={' '}
          <b>{rupees(quote.data.amount)}</b>
        </p>
      )}
      <label>
        Amount received (leave empty to use the price above)
        <input
          inputMode="decimal"
          placeholder={quote.data?.amount ?? ''}
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
        />
      </label>
      <div className="row">
        <label style={{ flex: 1 }}>
          Method
          <select value={method} onChange={(e) => setMethod(e.target.value)}>
            <option>UPI</option>
            <option>CASH</option>
            <option>BANK</option>
            <option>OTHER</option>
          </select>
        </label>
        <label style={{ flex: 2 }}>
          Reference (UPI id / bank ref)
          <input value={reference} onChange={(e) => setReference(e.target.value)} />
        </label>
      </div>
      {locked && (
        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={unlock}
            onChange={(e) => setUnlock(e.target.checked)}
            style={{ width: 'auto', margin: 0 }}
          />
          Also unlock the shop
        </label>
      )}
      <label>
        Note (optional)
        <input value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      <div className="actions">
        <button onClick={onClose}>Cancel</button>
        <button
          className="primary"
          disabled={busy || !chosen}
          onClick={() => {
            setBusy(true);
            setError(null);
            api
              .post<{ newEndsAt: string; payment: { amount: string } }>(
                `/shops/${id}/subscription/extend`,
                {
                  months,
                  planId: chosen,
                  payment: {
                    method,
                    ...(amount ? { amount } : {}),
                    ...(reference.trim() ? { reference: reference.trim() } : {}),
                  },
                  ...(locked ? { unlock } : {}),
                  ...(reason.trim() ? { reason: reason.trim() } : {}),
                },
                key,
              )
              .then((r) => {
                onDone(`Recorded ${rupees(r.payment.amount)}. Paid until ${date(r.newEndsAt)}.`);
                onClose();
              })
              .catch((e: unknown) => setError(errorText(e)))
              .finally(() => setBusy(false));
          }}
        >
          {busy ? 'Saving…' : 'Record payment'}
        </button>
      </div>
    </Modal>
  );
}

function ChangePlanDialog({
  id,
  current,
  onDone,
  onClose,
}: {
  id: string;
  current: string | null;
  onDone: (m: string) => void;
  onClose: () => void;
}) {
  const plans = usePlans();
  const [planId, setPlanId] = useState('');
  const options = (plans.data ?? []).filter((p) => p.isActive && p.id !== current);
  const chosen = planId || options[0]?.id || '';
  return (
    <ReasonDialog
      title="Change plan"
      description="Dates stay the same. Limits of the new plan apply at once."
      confirmLabel="Change plan"
      extra={
        <label>
          New plan
          <select value={chosen} onChange={(e) => setPlanId(e.target.value)}>
            {options.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      }
      onConfirm={(reason) =>
        api
          .post<{ planCode: string }>(`/shops/${id}/subscription/change-plan`, {
            planId: chosen,
            reason,
          })
          .then((r) => onDone(`Plan changed to ${r.planCode}.`))
      }
      onClose={onClose}
    />
  );
}

function AdjustDialog({
  id,
  endsAt,
  graceDays,
  onDone,
  onClose,
}: {
  id: string;
  endsAt: string | null;
  graceDays: number | null;
  onDone: (m: string) => void;
  onClose: () => void;
}) {
  const [ends, setEnds] = useState(endsAt ? endsAt.slice(0, 10) : '');
  const [grace, setGrace] = useState(String(graceDays ?? 5));
  return (
    <ReasonDialog
      title="Adjust dates"
      description="For corrections and goodwill. Payments are recorded with “Record payment”."
      confirmLabel="Save"
      extra={
        <div className="row">
          <label style={{ flex: 1 }}>
            Paid until
            <input type="date" value={ends} onChange={(e) => setEnds(e.target.value)} />
          </label>
          <label style={{ flex: 1 }}>
            Grace days (0-30)
            <input
              type="number"
              min={0}
              max={30}
              value={grace}
              onChange={(e) => setGrace(e.target.value)}
            />
          </label>
        </div>
      }
      onConfirm={(reason) =>
        api
          .post(`/shops/${id}/subscription/adjust`, {
            // End of that day in India time.
            ...(ends && ends !== endsAt?.slice(0, 10)
              ? { endsAt: new Date(`${ends}T23:59:59+05:30`).toISOString() }
              : {}),
            graceDays: Number(grace),
            reason,
          })
          .then(() => onDone('Dates updated.'))
      }
      onClose={onClose}
    />
  );
}

function RefundDialog({
  id,
  payment,
  onDone,
  onClose,
}: {
  id: string;
  payment: NonNullable<Detail['payments']>[number];
  onDone: (m: string) => void;
  onClose: () => void;
}) {
  const [amount, setAmount] = useState('');
  return (
    <ReasonDialog
      title={`Refund ${rupees(payment.amount)}?`}
      description="Adds a refund entry; the original payment stays in the history. Dates do not change (use Adjust dates if needed)."
      confirmLabel="Refund"
      danger
      extra={
        <label>
          Amount (leave empty for the full payment)
          <input
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
          />
        </label>
      }
      onConfirm={(reason) =>
        api
          .post<{ amount: string }>(`/shops/${id}/subscription/refund`, {
            paymentId: payment.id,
            ...(amount ? { amount } : {}),
            reason,
          })
          .then((r) => onDone(`Refunded ${rupees(r.amount.replace('-', ''))}.`))
      }
      onClose={onClose}
    />
  );
}

function ResetOwner({ id, name, onClose }: { id: string; name: string; onClose: () => void }) {
  const [result, setResult] = useState<{ password: string; phone: string } | null>(null);
  if (result) {
    return (
      <Modal title="Temporary password" onClose={onClose}>
        <p>
          Give this to the owner ({result.phone}). It is shown only once. They are signed out
          everywhere.
        </p>
        <p className="secret" style={{ fontSize: 18 }}>
          {result.password}
        </p>
        <div className="actions">
          <button className="primary" onClick={onClose}>
            Done
          </button>
        </div>
      </Modal>
    );
  }
  return (
    <ReasonDialog
      title={`Reset the owner password of ${name}?`}
      confirmLabel="Reset password"
      danger
      onConfirm={
        (reason) =>
          api
            .post<{ temporaryPassword: string; owner: { phone: string } }>(
              `/shops/${id}/reset-owner-password`,
              {
                reason,
              },
            )
            .then((r) => setResult({ password: r.temporaryPassword, phone: r.owner.phone }))
            .then(() => new Promise<never>(() => undefined)) // keep the dialog: the result view replaces it
      }
      onClose={onClose}
    />
  );
}

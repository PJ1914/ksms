import { api, date, dateTime, rupees, type Role } from '../api';
import { Avatar, Badge, Empty, Icon, Loading, PageHead, Sparkline, Stat, useLoad } from '../ui';

interface Dash {
  shops: {
    total: number;
    trial: number;
    active: number;
    grace: number;
    expired: number;
    locked: number;
  };
  signups30d: number;
  expiring7d: number;
  expiringSoon: { id: string; name: string; endsAt: string; planCode: string }[];
  openTickets: Record<string, number>;
  openCallbacks: number;
  revenue: { month: string; amount: string }[] | null;
}

interface ShopCard {
  id: string;
  name: string;
  planCode: string | null;
  endsAt: string | null;
  daysLeft: number | null;
  owner: { fullName: string; phone: string } | null;
}

interface AuditRow {
  id: string;
  admin: { email: string; fullName: string };
  action: string;
  organizationId: string | null;
  reason: string | null;
  createdAt: string;
}

const STAGES = [
  { key: 'TRIAL', label: 'Free trial', color: 'var(--info)' },
  { key: 'ACTIVE', label: 'Active', color: 'var(--primary)' },
  { key: 'GRACE', label: 'Grace period', color: 'var(--accent)' },
  { key: 'EXPIRED', label: 'Expired', color: 'var(--danger)' },
  { key: 'LOCKED', label: 'Locked', color: 'var(--violet)' },
] as const;

/** What an audit action looks like to a human, with an icon and a tone for the feed. */
const ACTIONS: Record<string, { text: string; icon: keyof typeof Icon; color: string }> = {
  'shop.lock': { text: 'locked a shop', icon: 'lock', color: 'var(--danger)' },
  'shop.unlock': { text: 'unlocked a shop', icon: 'check', color: 'var(--primary)' },
  'shop.force_logout': { text: 'signed a shop out', icon: 'alert', color: 'var(--accent)' },
  'shop.device_revoke': { text: 'blocked a phone', icon: 'shield', color: 'var(--danger)' },
  'shop.reset_owner_password': {
    text: 'reset an owner password',
    icon: 'lock',
    color: 'var(--accent)',
  },
  'shop.note': { text: 'left a note', icon: 'log', color: 'var(--info)' },
  'subscription.extend': { text: 'recorded a payment', icon: 'money', color: 'var(--primary)' },
  'subscription.change_plan': { text: 'changed a plan', icon: 'plan', color: 'var(--violet)' },
  'subscription.adjust': { text: 'adjusted dates', icon: 'clock', color: 'var(--accent)' },
  'subscription.refund': { text: 'refunded a payment', icon: 'money', color: 'var(--danger)' },
  'ticket.reply': { text: 'replied to a ticket', icon: 'ticket', color: 'var(--info)' },
  'ticket.status': { text: 'updated a ticket', icon: 'ticket', color: 'var(--info)' },
  'ticket.assign': { text: 'assigned a ticket', icon: 'ticket', color: 'var(--info)' },
  'plan.update': { text: 'edited a plan', icon: 'plan', color: 'var(--violet)' },
  'plan.create': { text: 'created a plan', icon: 'plan', color: 'var(--violet)' },
  'user.update': { text: 'edited a user', icon: 'user', color: 'var(--info)' },
  'user.remove': { text: 'removed a user', icon: 'user', color: 'var(--danger)' },
  'auth.login': { text: 'signed in', icon: 'shield', color: 'var(--muted)' },
};

const greeting = () => {
  const h = Number(
    new Date().toLocaleString('en-IN', {
      hour: 'numeric',
      hour12: false,
      timeZone: 'Asia/Kolkata',
    }),
  );
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
};

export function Dashboard({ role, name }: { role: Role; name: string }) {
  const dash = useLoad(() => api.get<Dash>('/dashboard'), []);
  const data = dash.data;
  if (!data) return <Loading loading={dash.loading} error={dash.error} />;
  const s = data.shops;
  const open = Object.values(data.openTickets).reduce((a, b) => a + b, 0);
  const urgent = (data.openTickets.URGENT ?? 0) + (data.openTickets.HIGH ?? 0);
  const counts: Record<string, number> = {
    TRIAL: s.trial,
    ACTIVE: s.active,
    GRACE: s.grace,
    EXPIRED: s.expired,
    LOCKED: s.locked,
  };

  return (
    <>
      <PageHead
        title={`${greeting()}, ${name.split(' ')[0]}`}
        subtitle={`${s.total} shops on Yapaaram · ${data.signups30d} joined in the last 30 days`}
      >
        <a className="btn" href="#/shops">
          All shops
        </a>
        <a className="btn primary" href="#/tickets">
          Open tickets ({open})
        </a>
      </PageHead>

      {role === 'ADMIN' && data.revenue ? <RevenueHero rows={data.revenue} /> : null}

      <div className="grid">
        <Stat
          label="Paying shops"
          value={s.active}
          to="#/shops?status=ACTIVE"
          icon={Icon.check}
          tone="green"
        />
        <Stat
          label="On free trial"
          value={s.trial}
          to="#/shops?status=TRIAL"
          icon={Icon.spark}
          tone="blue"
        />
        <Stat
          label="Ending this week"
          value={data.expiring7d}
          to="#/shops?expiringInDays=7"
          icon={Icon.clock}
          tone="amber"
          hint="Chase these first"
        />
        <Stat
          label="Open tickets"
          value={open}
          to="#/tickets"
          icon={Icon.ticket}
          tone="violet"
          hint={urgent ? `${urgent} high priority` : `${data.openCallbacks} call-backs`}
        />
      </div>

      <div className="card-head" style={{ marginTop: 6 }}>
        <h2>Shop pipeline</h2>
        <a href="#/shops">Open the full list →</a>
      </div>
      <div className="board">
        {STAGES.map((st) => (
          <Column key={st.key} stage={st} count={counts[st.key] ?? 0} />
        ))}
      </div>

      <div className="split">
        <div className="card flush">
          <div className="card-head" style={{ padding: '20px 22px 6px' }}>
            <h2>Ending in the next 7 days</h2>
            <a href="#/shops?expiringInDays=7">See all</a>
          </div>
          {data.expiringSoon.length === 0 ? (
            <Empty>Nothing ends this week. 🎉</Empty>
          ) : (
            <table className="cards">
              <thead>
                <tr>
                  <th>Shop</th>
                  <th>Plan</th>
                  <th>Ends</th>
                </tr>
              </thead>
              <tbody>
                {data.expiringSoon.map((r) => (
                  <tr
                    key={r.id}
                    className="click"
                    onClick={() => (location.hash = `#/shops/${r.id}`)}
                  >
                    <td data-label="Shop">
                      <div className="who-cell">
                        <Avatar name={r.name} size="sm" />
                        <b>{r.name}</b>
                      </div>
                    </td>
                    <td data-label="Plan">
                      <Badge value={r.planCode} />
                    </td>
                    <td data-label="Ends">{date(r.endsAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <Feed />
      </div>
    </>
  );
}

function Column({ stage, count }: { stage: (typeof STAGES)[number]; count: number }) {
  const { data, loading } = useLoad(
    () => api.get<ShopCard[]>(`/shops?status=${stage.key}&limit=5`),
    [stage.key],
  );
  return (
    <div className="col" style={{ ['--c' as string]: stage.color }}>
      <div className="col-head">
        <b>{stage.label}</b>
        <span>{count}</span>
      </div>
      {loading && !data && <div className="none">Loading…</div>}
      {data?.length === 0 && <div className="none">No shops</div>}
      {data?.map((shop) => (
        <button
          key={shop.id}
          className="kcard"
          onClick={() => (location.hash = `#/shops/${shop.id}`)}
        >
          <Avatar name={shop.name} size="sm" />
          <span className="t">
            <b>{shop.name}</b>
            <span>
              {shop.planCode ?? 'No plan'}
              {shop.daysLeft ? ` · ${shop.daysLeft}d left` : ''}
            </span>
          </span>
        </button>
      ))}
      {count > 5 && (
        <a className="more" href={`#/shops?status=${stage.key}`}>
          +{count - 5} more
        </a>
      )}
    </div>
  );
}

function Feed() {
  const { data, loading } = useLoad(() => api.get<AuditRow[]>('/audit?limit=8'), []);
  return (
    <div className="card">
      <div className="card-head">
        <h2>Recent activity</h2>
        <a href="#/audit">View all</a>
      </div>
      {loading && !data && <p className="muted">Loading…</p>}
      {data?.length === 0 && <Empty>No activity yet.</Empty>}
      <ul className="timeline">
        {(data ?? []).map((r) => {
          const a = ACTIONS[r.action] ?? {
            text: r.action,
            icon: 'log' as const,
            color: 'var(--muted)',
          };
          return (
            <li key={r.id}>
              <span className="dot" style={{ ['--c' as string]: a.color }}>
                {Icon[a.icon]}
              </span>
              <div className="body">
                <b>{r.admin.fullName}</b> {a.text}
                {r.reason ? <span className="muted"> · {r.reason}</span> : null}
                <div className="when">{dateTime(r.createdAt)}</div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** This month's revenue, the change from last month, and the last six months as a line. */
function RevenueHero({ rows }: { rows: { month: string; amount: string }[] }) {
  const values = rows.map((r) => Number(r.amount));
  const now = values.at(-1) ?? 0;
  const before = values.at(-2) ?? 0;
  const delta = before > 0 ? Math.round(((now - before) / before) * 100) : null;
  const total = values.reduce((a, b) => a + b, 0);
  return (
    <div className="hero">
      <div>
        <div className="eyebrow">Revenue this month</div>
        <div className="big num">{rupees(rows.at(-1)?.amount ?? '0')}</div>
        <div className="row">
          {delta !== null ? (
            <span className={`delta ${delta >= 0 ? 'up' : 'down'}`}>
              {delta >= 0 ? '▲' : '▼'} {Math.abs(delta)}% vs last month
            </span>
          ) : (
            <span className="muted small">No earlier month to compare yet</span>
          )}
          <span className="muted small">
            {rupees(total.toFixed(2))} over {rows.length} month{rows.length === 1 ? '' : 's'}
          </span>
        </div>
      </div>
      {values.length > 0 ? <Sparkline values={values} /> : <Empty>No payments yet</Empty>}
    </div>
  );
}

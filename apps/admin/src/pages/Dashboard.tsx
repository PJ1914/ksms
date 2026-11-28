import { api, date, rupees, type Role } from '../api';
import { Badge, Loading, Stat, useLoad } from '../ui';

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

export function Dashboard({ role }: { role: Role }) {
  const { data, error, loading } = useLoad(() => api.get<Dash>('/dashboard'), []);
  if (!data) return <Loading loading={loading} error={error} />;
  const s = data.shops;
  const open = Object.values(data.openTickets).reduce((a, b) => a + b, 0);
  return (
    <>
      <h1>Dashboard</h1>
      <div className="grid">
        <Stat label="All shops" value={s.total} to="#/shops" />
        <Stat label="Active" value={s.active} to="#/shops?status=ACTIVE" />
        <Stat label="On trial" value={s.trial} to="#/shops?status=TRIAL" />
        <Stat label="In grace" value={s.grace} to="#/shops?status=GRACE" />
        <Stat label="Expired (read-only)" value={s.expired} to="#/shops?status=EXPIRED" />
        <Stat label="Locked" value={s.locked} to="#/shops?status=LOCKED" />
        <Stat label="New in 30 days" value={data.signups30d} />
        <Stat label="Open tickets" value={open} to="#/tickets" />
        <Stat
          label="Callback requests"
          value={data.openCallbacks}
          to="#/tickets?category=CALLBACK"
        />
      </div>

      {role === 'ADMIN' && data.revenue && <Revenue rows={data.revenue} />}

      <div className="card">
        <div className="spread">
          <h2 style={{ margin: 0 }}>Ending in the next 7 days ({data.expiring7d})</h2>
          <a href="#/shops?expiringInDays=7">See all</a>
        </div>
        {data.expiringSoon.length === 0 ? (
          <p className="muted">Nothing ends this week.</p>
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
                  <td data-label="Shop">{r.name}</td>
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
    </>
  );
}

/** Revenue by month, net of refunds. Heights compare amounts as numbers only for drawing. */
function Revenue({ rows }: { rows: { month: string; amount: string }[] }) {
  const max = Math.max(1, ...rows.map((r) => Number(r.amount)));
  const total = rows.reduce((sum, r) => sum + Number(r.amount), 0);
  return (
    <div className="card">
      <div className="spread">
        <h2 style={{ margin: 0 }}>Revenue, last 6 months</h2>
        <span className="muted">
          This month: <b className="num">{rupees(rows.at(-1)?.amount ?? '0')}</b>
        </span>
      </div>
      {rows.length === 0 ? (
        <p className="muted">No payments recorded yet.</p>
      ) : (
        <div className="bars" aria-label={`Revenue by month, total ${total}`}>
          {rows.map((r) => (
            <div className="bar" key={r.month} title={`${r.month}: ${rupees(r.amount)}`}>
              <span className="cap num">{rupees(r.amount).replace(/\.\d\d$/, '')}</span>
              <div
                className="fill"
                style={{ height: `${Math.max(2, (Number(r.amount) / max) * 120)}px` }}
              />
              <span className="cap">{r.month}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

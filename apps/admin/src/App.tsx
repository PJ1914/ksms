import { useEffect, useState, type ReactElement } from 'react';
import {
  api,
  clearSession,
  hasRefreshToken,
  markActivity,
  onSignedOut,
  refreshSession,
  type AdminProfile,
} from './api';
import { Admins, Audit } from './pages/Team';
import { Payments, Plans } from './pages/Billing';
import { Dashboard } from './pages/Dashboard';
import { Login } from './pages/Login';
import { ShopDetail, Shops } from './pages/Shops';
import { SupportSettings, TicketDetail, Tickets } from './pages/Tickets';
import { Icon } from './ui';

/** Hash routes: #/shops, #/shops/<id>?..., no server config needed on a static host. */
function useRoute() {
  const read = () => {
    const raw = location.hash.replace(/^#/, '') || '/';
    const [path = '/', query = ''] = raw.split('?');
    return { parts: path.split('/').filter(Boolean), params: new URLSearchParams(query), raw };
  };
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const on = () => {
      setRoute(read());
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

export function App() {
  const [admin, setAdmin] = useState<AdminProfile | null>(null);
  const [booting, setBooting] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const route = useRoute();

  // A reload keeps the session while the tab lives (refresh token in sessionStorage).
  useEffect(() => {
    (async () => {
      if (hasRefreshToken() && (await refreshSession())) {
        const me = await api.get<AdminProfile>('/me').catch(() => null);
        if (me && !me.mustChangePassword) setAdmin(me);
        else clearSession();
      }
      setBooting(false);
    })();
    const off = onSignedOut(() => setAdmin(null));
    return () => {
      off();
    };
  }, []);

  // Any click or key counts as activity for the 30-minute idle sign-out.
  useEffect(() => {
    const on = () => markActivity();
    window.addEventListener('pointerdown', on);
    window.addEventListener('keydown', on);
    return () => {
      window.removeEventListener('pointerdown', on);
      window.removeEventListener('keydown', on);
    };
  }, []);

  useEffect(() => setMenuOpen(false), [route.raw]);

  if (booting)
    return (
      <p className="muted" style={{ padding: 24 }}>
        Loading…
      </p>
    );
  if (!admin) return <Login onSignedIn={setAdmin} />;

  const isAdmin = admin.role === 'ADMIN';
  const [section = 'dashboard', id] = route.parts;
  const nav: { key: string; label: string; icon: ReactElement; adminOnly?: boolean }[] = [
    { key: 'dashboard', label: 'Dashboard', icon: Icon.home },
    { key: 'shops', label: 'Shops', icon: Icon.shop },
    { key: 'tickets', label: 'Tickets', icon: Icon.ticket },
    { key: 'plans', label: 'Plans', icon: Icon.plan },
    { key: 'payments', label: 'Payments', icon: Icon.money, adminOnly: true },
    { key: 'support', label: 'Support contact', icon: Icon.phone },
    { key: 'admins', label: 'Admins', icon: Icon.people, adminOnly: true },
    { key: 'audit', label: 'Audit log', icon: Icon.log },
  ];

  let page: ReactElement;
  switch (section) {
    case 'shops':
      page = id ? (
        <ShopDetail id={id} role={admin.role} />
      ) : (
        <Shops key={route.raw} params={route.params} />
      );
      break;
    case 'tickets':
      page = id ? (
        <TicketDetail id={id} adminId={admin.id} role={admin.role} />
      ) : (
        <Tickets key={route.raw} params={route.params} />
      );
      break;
    case 'plans':
      page = <Plans role={admin.role} />;
      break;
    case 'payments':
      page = isAdmin ? <Payments /> : <NoAccess />;
      break;
    case 'support':
      page = <SupportSettings role={admin.role} />;
      break;
    case 'admins':
      page = isAdmin ? <Admins me={admin.id} /> : <NoAccess />;
      break;
    case 'audit':
      page = <Audit key={route.raw} params={route.params} />;
      break;
    default:
      page = <Dashboard role={admin.role} />;
  }

  return (
    <div className="shell">
      <aside className={`side ${menuOpen ? 'open' : ''}`}>
        <div className="brand">
          <img src="/favicon.svg" alt="" />
          Yapaaram Admin
        </div>
        <nav className="nav" aria-label="Main">
          {nav
            .filter((n) => !n.adminOnly || isAdmin)
            .map((n) => (
              <a key={n.key} href={`#/${n.key}`} className={section === n.key ? 'active' : ''}>
                {n.icon}
                {n.label}
              </a>
            ))}
        </nav>
        <div className="side-foot small">
          <div>
            <b>{admin.fullName}</b>
          </div>
          <div className="muted">
            {admin.email} · {admin.role}
          </div>
          <button
            style={{ marginTop: 10 }}
            onClick={() => {
              void api
                .post('/auth/logout')
                .catch(() => undefined)
                .finally(clearSession);
            }}
          >
            Sign out
          </button>
        </div>
      </aside>
      <div>
        <div className="topbar">
          <button aria-label="Menu" onClick={() => setMenuOpen(true)}>
            {Icon.menu}
          </button>
          <b>Yapaaram Admin</b>
        </div>
        <main className="main">{page}</main>
      </div>
      {menuOpen && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 25 }}
          onClick={() => setMenuOpen(false)}
        />
      )}
    </div>
  );
}

function NoAccess() {
  return <p className="muted">Only an ADMIN can open this page.</p>;
}

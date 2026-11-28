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
import { Palette } from './Palette';
import { Admins, Audit } from './pages/Team';
import { Payments, Plans } from './pages/Billing';
import { Dashboard } from './pages/Dashboard';
import { Login } from './pages/Login';
import { ShopDetail, Shops } from './pages/Shops';
import { SupportSettings, TicketDetail, Tickets } from './pages/Tickets';
import { Users } from './pages/Users';
import { Avatar, Icon } from './ui';

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

interface NavItem {
  key: string;
  label: string;
  icon: ReactElement;
  adminOnly?: boolean;
}
const NAV: { label: string; items: NavItem[] }[] = [
  {
    label: 'Overview',
    items: [{ key: 'dashboard', label: 'Dashboard', icon: Icon.home }],
  },
  {
    label: 'Customers',
    items: [
      { key: 'shops', label: 'Shops', icon: Icon.shop },
      { key: 'users', label: 'Users', icon: Icon.user },
      { key: 'tickets', label: 'Tickets', icon: Icon.ticket },
    ],
  },
  {
    label: 'Money',
    items: [
      { key: 'plans', label: 'Plans', icon: Icon.plan },
      { key: 'payments', label: 'Payments', icon: Icon.money, adminOnly: true },
    ],
  },
  {
    label: 'Workspace',
    items: [
      { key: 'support', label: 'Support contact', icon: Icon.phone },
      { key: 'admins', label: 'Team', icon: Icon.people, adminOnly: true },
      { key: 'audit', label: 'Audit log', icon: Icon.log },
    ],
  },
];

export function App() {
  const [admin, setAdmin] = useState<AdminProfile | null>(null);
  const [booting, setBooting] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [searching, setSearching] = useState(false);
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

  // Any click or key counts as activity for the 30-minute idle sign-out; Ctrl/⌘+K opens search.
  useEffect(() => {
    const onPointer = () => markActivity();
    const onKey = (e: KeyboardEvent) => {
      markActivity();
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearching(true);
      }
    };
    window.addEventListener('pointerdown', onPointer);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  useEffect(() => setMenuOpen(false), [route.raw]);

  if (booting) {
    return (
      <p className="muted" style={{ padding: 24 }}>
        Loading…
      </p>
    );
  }
  if (!admin) return <Login onSignedIn={setAdmin} />;

  const isAdmin = admin.role === 'ADMIN';
  const [section = 'dashboard', id] = route.parts;

  let page: ReactElement;
  switch (section) {
    case 'shops':
      page = id ? (
        <ShopDetail id={id} role={admin.role} />
      ) : (
        <Shops key={route.raw} params={route.params} />
      );
      break;
    case 'users':
      page = <Users key={route.raw} params={route.params} role={admin.role} />;
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
      page = <Dashboard role={admin.role} name={admin.fullName} />;
  }

  return (
    <div className="shell">
      <aside className={`side ${menuOpen ? 'open' : ''}`}>
        <div className="brand">
          <img src="/favicon.svg" alt="" />
          <span>
            Yapaaram
            <small>Admin console</small>
          </span>
        </div>
        <nav className="nav" aria-label="Main">
          {NAV.map((group) => {
            const items = group.items.filter((n) => !n.adminOnly || isAdmin);
            if (items.length === 0) return null;
            return (
              <div key={group.label}>
                <div className="nav-label">{group.label}</div>
                {items.map((n) => (
                  <a
                    key={n.key}
                    href={`#/${n.key}`}
                    className={section === n.key ? 'active' : ''}
                    onClick={() => setMenuOpen(false)}
                  >
                    {n.icon}
                    {n.label}
                  </a>
                ))}
              </div>
            );
          })}
        </nav>
        <div className="side-foot">
          <button
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

      <div className="content">
        <header className="head">
          <button className="iconbtn menu-btn" aria-label="Menu" onClick={() => setMenuOpen(true)}>
            {Icon.menu}
          </button>
          <button className="search" onClick={() => setSearching(true)} aria-label="Search">
            {Icon.search}
            <span>Search shops, users, pages…</span>
            <kbd>Ctrl K</kbd>
          </button>
          <div className="spacer" />
          <div className="chip">
            <Avatar name={admin.fullName} size="sm" round />
            <span className="who">
              {admin.fullName}
              <small>{admin.role === 'ADMIN' ? 'Administrator' : 'Support'}</small>
            </span>
          </div>
        </header>
        <main className="main">{page}</main>
      </div>

      {menuOpen && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 35 }}
          onClick={() => setMenuOpen(false)}
        />
      )}
      {searching && <Palette role={admin.role} onClose={() => setSearching(false)} />}
    </div>
  );
}

function NoAccess() {
  return <p className="muted">Only an ADMIN can open this page.</p>;
}

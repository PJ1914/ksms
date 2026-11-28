import { useEffect, useRef, useState } from 'react';
import { api, type Role } from './api';
import { Avatar, Badge, Icon } from './ui';

interface ShopHit {
  id: string;
  name: string;
  phone: string | null;
  state: string;
  owner: { fullName: string; phone: string } | null;
}

interface Command {
  label: string;
  hash: string;
  hint: string;
  adminOnly?: boolean;
}

const PAGES: Command[] = [
  { label: 'Dashboard', hash: '#/dashboard', hint: 'Overview' },
  { label: 'Shops', hash: '#/shops', hint: 'All shops' },
  { label: 'Users', hash: '#/users', hint: 'Everyone in every shop' },
  { label: 'Tickets', hash: '#/tickets', hint: 'Support queue' },
  { label: 'Plans', hash: '#/plans', hint: 'Prices and limits' },
  { label: 'Payments', hash: '#/payments', hint: 'Money received', adminOnly: true },
  { label: 'Admins and support', hash: '#/admins', hint: 'Your team', adminOnly: true },
  { label: 'Audit log', hash: '#/audit', hint: 'Who did what' },
];

/**
 * Ctrl+K (or ⌘K) search: jumps to a page or finds a shop by name or phone. Keyboard friendly:
 * arrows to move, Enter to open, Esc to close.
 */
export function Palette({ role, onClose }: { role: Role; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [shops, setShops] = useState<ShopHit[]>([]);
  const [cursor, setCursor] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => input.current?.focus(), []);

  useEffect(() => {
    const text = q.trim();
    if (text.length < 2) {
      setShops([]);
      return;
    }
    let alive = true;
    const t = setTimeout(() => {
      api
        .get<ShopHit[]>(`/shops?q=${encodeURIComponent(text)}&limit=6`)
        .then((r) => alive && setShops(r))
        .catch(() => alive && setShops([]));
    }, 180);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q]);

  const text = q.trim().toLowerCase();
  const pages = PAGES.filter(
    (p) => (!p.adminOnly || role === 'ADMIN') && p.label.toLowerCase().includes(text),
  );
  const items: { key: string; go: () => void; node: React.ReactNode }[] = [
    ...shops.map((s) => ({
      key: `s${s.id}`,
      go: () => (location.hash = `#/shops/${s.id}`),
      node: (
        <>
          <Avatar name={s.name} size="sm" />
          <span style={{ flex: 1 }}>
            <b>{s.name}</b>
            <span className="muted small"> · {s.owner?.phone ?? s.phone ?? ''}</span>
          </span>
          <Badge value={s.state} />
        </>
      ),
    })),
    ...pages.map((p) => ({
      key: p.hash,
      go: () => (location.hash = p.hash),
      node: (
        <>
          <span className="av sm" style={{ ['--h' as string]: 150 }}>
            →
          </span>
          <span style={{ flex: 1 }}>
            <b>{p.label}</b>
            <span className="muted small"> · {p.hint}</span>
          </span>
        </>
      ),
    })),
  ];
  const active = Math.min(cursor, Math.max(0, items.length - 1));

  const open = (i: number) => {
    items[i]?.go();
    onClose();
  };

  return (
    <div className="pal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="pal" role="dialog" aria-modal="true" aria-label="Search">
        <input
          ref={input}
          value={q}
          placeholder="Search shops by name or phone, or jump to a page…"
          onChange={(e) => {
            setQ(e.target.value);
            setCursor(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose();
            else if (e.key === 'ArrowDown') {
              e.preventDefault();
              setCursor((c) => Math.min(c + 1, items.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setCursor((c) => Math.max(c - 1, 0));
            } else if (e.key === 'Enter') open(active);
          }}
        />
        <ul>
          {shops.length > 0 && <li className="grp">Shops</li>}
          {items.map((it, i) => (
            <li key={it.key}>
              <button
                className={i === active ? 'on' : ''}
                onClick={() => open(i)}
                onMouseEnter={() => setCursor(i)}
              >
                {it.node}
              </button>
              {i === shops.length - 1 && pages.length > 0 && <div className="grp">Pages</div>}
            </li>
          ))}
          {items.length === 0 && <li className="empty">Nothing found.</li>}
        </ul>
        <div className="hint">
          <span>
            <kbd>↑</kbd> <kbd>↓</kbd> move
          </span>
          <span>
            <kbd>Enter</kbd> open
          </span>
          <span>
            <kbd>Esc</kbd> close
          </span>
          <span style={{ marginLeft: 'auto' }}>{Icon.search}</span>
        </div>
      </div>
    </div>
  );
}

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { ROLE_LABEL, useAuth, type Role } from '../auth';
import { fmtMoney } from './ui';
import { Avatar, Icon, type IconName } from './kit';
import { useTheme } from '../theme';

interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  roles: Role[] | 'superadmin';
}

const ALL: Role[] = ['owner', 'branch_admin', 'coach'];
const STAFF: Role[] = ['owner', 'branch_admin'];

const NAV: { section: string; items: NavItem[] }[] = [
  {
    section: 'Asosiy',
    items: [
      { to: '/dashboard', label: 'Bosh sahifa', icon: 'home', roles: ALL },
      { to: '/athletes', label: 'Sportchilar', icon: 'users', roles: ALL },
      { to: '/attendance', label: 'Davomat', icon: 'calendarCheck', roles: ALL },
      { to: '/groups', label: 'Guruhlar', icon: 'layers', roles: ALL },
      { to: '/coaches', label: 'Murabbiylar', icon: 'whistle', roles: STAFF },
    ],
  },
  {
    section: 'Abonement',
    items: [
      { to: '/subscriptions', label: 'Abonementlar', icon: 'ticket', roles: STAFF },
      { to: '/plans', label: 'Tariflar', icon: 'tag', roles: STAFF },
    ],
  },
  {
    section: 'Moliya',
    items: [
      { to: '/finance/debtors', label: 'Qarzdorlar', icon: 'alert', roles: STAFF },
      { to: '/finance/payments', label: 'To‘lovlar', icon: 'receipt', roles: STAFF },
      { to: '/finance/cash', label: 'Kassa', icon: 'cash', roles: STAFF },
      { to: '/finance/expenses', label: 'Xarajatlar', icon: 'wallet', roles: STAFF },
      { to: '/payroll', label: 'Ish haqi', icon: 'coins', roles: ['owner'] },
      { to: '/reports', label: 'Hisobotlar', icon: 'chart', roles: ALL },
    ],
  },
  {
    section: 'Klub',
    items: [
      { to: '/branches', label: 'Filiallar', icon: 'building', roles: STAFF },
      { to: '/sports', label: 'Sport turlari', icon: 'trophy', roles: STAFF },
      { to: '/communication', label: 'Kommunikatsiya', icon: 'send', roles: STAFF },
      { to: '/import', label: 'Import (CSV)', icon: 'upload', roles: STAFF },
      { to: '/staff', label: 'Xodimlar va rollar', icon: 'shield', roles: ['owner'] },
      { to: '/settings', label: 'Sozlamalar', icon: 'settings', roles: ['owner'] },
    ],
  },
  { section: 'Platforma', items: [{ to: '/platform', label: 'Klublar', icon: 'globe', roles: 'superadmin' }] },
];

export function Layout({ children }: { children: ReactNode }) {
  const { me, logout, switchMembership } = useAuth();
  const [open, setOpen] = useState(false);
  const { theme, toggle } = useTheme();
  const location = useLocation();
  useEffect(() => setOpen(false), [location.pathname]);
  useEffect(() => {
    document.title = me?.club?.clubName ? `${me.club.clubName} · Areno` : 'Areno';
  }, [me?.club?.clubName]);
  if (!me) return null;
  const role = me.club?.role;
  const visible = (i: NavItem) => (i.roles === 'superadmin' ? me.user.isSuperadmin : !!role && i.roles.includes(role));

  return (
    <div className={`shell ${open ? 'nav-open' : ''}`}>
      <aside className="sidebar">
        <div className="brand areno-brand">
          <img src="/brand/areno-logo.png" alt="Areno" />
        </div>
        {me.club && (
          <div className="club-chip" title={me.club.clubName ?? ''}>
            {me.club.logoUrl ? <img src={me.club.logoUrl} alt="" /> : <span className="club-chip-mark">{(me.club.clubName ?? '?').slice(0, 1)}</span>}
            <span className="club-chip-text">
              <strong>{me.club.clubName}</strong>
              <small>Klub</small>
            </span>
          </div>
        )}
        <nav>
          {NAV.map((s) => {
            const items = s.items.filter(visible);
            if (!items.length) return null;
            return (
              <div key={s.section} className="nav-section">
                <div className="nav-title">{s.section}</div>
                {items.map((i) => (
                  <NavLink key={i.to} to={i.to} className={({ isActive }) => (isActive ? 'active' : '')}>
                    <Icon name={i.icon} size={18} />
                    <span>{i.label}</span>
                  </NavLink>
                ))}
              </div>
            );
          })}
        </nav>
        <div className="nav-foot">
          <Link to="/account" className="nav-user" title="Mening hisobim">
            <Avatar name={me.user.fullName} size={34} />
            <span className="nav-user-text">
              <strong>{me.user.fullName}</strong>
              <small>{role ? ROLE_LABEL[role] : me.user.isSuperadmin ? 'Superadmin' : ''}</small>
            </span>
          </Link>
          <button className="nav-logout" onClick={logout} title="Chiqish" aria-label="Chiqish">
            <Icon name="logout" size={18} />
          </button>
        </div>
      </aside>
      {open && <div className="nav-scrim" onClick={() => setOpen(false)} />}
      <div className="main">
        <header className="topbar">
          <button className="btn ghost icon-btn menu-btn" onClick={() => setOpen(!open)} aria-label="Menyu">
            <Icon name="menu" />
          </button>
          {role && <GlobalSearch canSeeMoney={role !== 'coach'} />}
          <div className="spacer" />
          {me.memberships.length > 1 && (
            <select
              className="club-switch"
              value={me.club?.membershipId ?? ''}
              onChange={(e) => switchMembership(e.target.value)}
              aria-label="Klub / rol"
            >
              {me.memberships.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.clubName} — {ROLE_LABEL[m.role]}
                </option>
              ))}
            </select>
          )}
          {(role === 'owner' || role === 'branch_admin') && (
            <Link to="/communication" className="btn ghost icon-btn" title="Xabarlar" aria-label="Xabarlar">
              <Icon name="bell" />
            </Link>
          )}
          <button className="btn ghost icon-btn" role="switch" aria-checked={theme === 'dark'} onClick={toggle} title={theme === 'dark' ? 'Kunduzgi rejim' : 'Tungi rejim'} aria-label="Tungi rejim">
            <Icon name="moon" />
          </button>
          <Link to="/account" className="top-avatar" title={me.user.fullName} aria-label="Mening hisobim">
            <Avatar name={me.user.fullName} size={32} />
          </Link>
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}

interface Hit {
  id: string;
  fullName: string;
  groupNames: string[];
  balance?: number;
  status: string;
}

/** Ctrl+K / "/" — find an athlete by name, own phone or parent phone. */
function GlobalSearch({ canSeeMoney }: { canSeeMoney: boolean }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [active, setActive] = useState(0);
  const [focused, setFocused] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement).tagName);
      if ((e.key === 'k' && (e.ctrlKey || e.metaKey)) || (e.key === '/' && !typing)) {
        e.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  useEffect(() => {
    if (q.trim().length < 2) {
      setHits(null);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const r = await api<{ items: Hit[] }>(`/athletes?q=${encodeURIComponent(q.trim())}&limit=8`);
        setHits(r.items);
        setActive(0);
      } catch {
        setHits([]);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  const go = (id: string) => {
    setQ('');
    setHits(null);
    input.current?.blur();
    navigate(`/athletes/${id}`);
  };

  return (
    <div className="gsearch">
      <Icon name="search" size={16} />
      <input
        ref={input}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 150)}
        onKeyDown={(e) => {
          if (!hits?.length) return;
          if (e.key === 'ArrowDown') setActive((a) => Math.min(hits.length - 1, a + 1));
          else if (e.key === 'ArrowUp') setActive((a) => Math.max(0, a - 1));
          else if (e.key === 'Enter') go(hits[active].id);
          else return;
          e.preventDefault();
        }}
        placeholder="Sportchi: ism yoki telefon"
        aria-label="Sportchini qidirish"
      />
      <kbd>Ctrl K</kbd>
      {focused && hits && (
        <div className="gsearch-results" role="listbox">
          {hits.length === 0 ? (
            <div className="muted pad-sm">Topilmadi</div>
          ) : (
            hits.map((h, i) => (
              <button
                key={h.id}
                role="option"
                aria-selected={i === active}
                className={i === active ? 'active' : ''}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  go(h.id);
                }}
              >
                <span className="gs-text">
                  <strong>{h.fullName}</strong>
                  <small>{h.groupNames.join(', ') || 'guruhsiz'}</small>
                </span>
                {canSeeMoney && h.balance != null && h.balance > 0 && <span className="gs-debt">−{fmtMoney(h.balance)}</span>}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

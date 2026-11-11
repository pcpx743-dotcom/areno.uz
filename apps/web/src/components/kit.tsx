/** Shared UI kit: icons, avatars, list toolbar, summary strips, dialogs & toasts, bar chart. */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';

// ---------------- icons (inline SVG, 20px, currentColor) ----------------
const P: Record<string, ReactNode> = {
  home: <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />,
  users: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5M16 4.8a3.3 3.3 0 0 1 0 6.4M18 14.6c2 .7 3.2 2.5 3.6 5.4" />
    </>
  ),
  check: <path d="M4 12.5 9.5 18 20 6.5" />,
  calendarCheck: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
      <path d="M8 3v4M16 3v4M3.5 10h17M9 15l2 2 4-4" />
    </>
  ),
  layers: <path d="m12 3 9 5-9 5-9-5zM3 12.5l9 5 9-5M3 17l9 5 9-5" />,
  whistle: (
    <>
      <circle cx="8.5" cy="14.5" r="5" />
      <path d="M12 11 20 6v4l-6 3M8.5 14.5h.01" />
    </>
  ),
  ticket: <path d="M3 8a2 2 0 0 0 2-2h14a2 2 0 0 0 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 0-2 2H5a2 2 0 0 0-2-2v-2a2 2 0 0 0 0-4zM10 6v12" />,
  tag: (
    <>
      <path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9z" />
      <circle cx="7.5" cy="7.5" r="1.5" />
    </>
  ),
  alert: <path d="M12 3 2.5 20h19zM12 10v4.5M12 17.5h.01" />,
  wallet: (
    <>
      <path d="M3 7a2 2 0 0 1 2-2h13v4M3 7v11a2 2 0 0 0 2 2h15V9H5a2 2 0 0 1-2-2z" />
      <circle cx="16.5" cy="14.5" r="1.2" />
    </>
  ),
  cash: (
    <>
      <rect x="2.5" y="6" width="19" height="12" rx="2" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M6 9.5v5M18 9.5v5" />
    </>
  ),
  receipt: <path d="M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6M9 16h3" />,
  coins: (
    <>
      <ellipse cx="9" cy="7" rx="5.5" ry="2.5" />
      <path d="M3.5 7v4c0 1.4 2.5 2.5 5.5 2.5s5.5-1.1 5.5-2.5V7M3.5 11v4c0 1.4 2.5 2.5 5.5 2.5M14.5 12.5c3 0 6 1 6 2.5s-2.7 2.5-6 2.5-6-1.1-6-2.5" />
    </>
  ),
  chart: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  building: <path d="M4 21V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v16M15 9h4a1 1 0 0 1 1 1v11M2 21h20M8 8h3M8 12h3M8 16h3" />,
  trophy: <path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H4.5a3 3 0 0 0 3.5 4M16 6h3.5a3 3 0 0 1-3.5 4M12 13v4M8 21h8M9.5 17h5" />,
  send: <path d="m21 3-9.5 18-2-8-7.5-2.5z" />,
  upload: <path d="M12 16V4M7 9l5-5 5 5M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" />,
  shield: <path d="M12 3 4.5 6v6c0 4.5 3.2 7.8 7.5 9 4.3-1.2 7.5-4.5 7.5-9V6z" />,
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z" />
    </>
  ),
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m20 20-4.8-4.8" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  phone: <path d="M5 3h4l2 5-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 5a2 2 0 0 1 2-2z" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  arrowRight: <path d="M5 12h14M13 6l6 6-6 6" />,
  logout: <path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 17l5-5-5-5M15 12H3" />,
  filter: <path d="M3 5h18l-7 8v6l-4 2v-8z" />,
  eye: (
    <>
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  bell: <path d="M6 9a6 6 0 1 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9zM10 20a2.2 2.2 0 0 0 4 0" />,
  menu: <path d="M3 6h18M3 12h18M3 18h18" />,
  moon: <path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11z" />,
};

export type IconName = keyof typeof P;

export function Icon({ name, size = 18, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {P[name]}
    </svg>
  );
}

// ---------------- avatar ----------------
const AVATAR_TONES = 6;
export function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  const parts = name.trim().split(/\s+/);
  const initials = ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase();
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return (
    <span className={`avatar t${h % AVATAR_TONES}`} style={{ width: size, height: size, fontSize: size * 0.38 }} aria-hidden="true">
      {initials}
    </span>
  );
}

/** Name cell: name + optional sub-line (no decoration). */
export function Person({ name, sub }: { name: string; sub?: ReactNode }) {
  return (
    <span className="person">
      <span className="person-text">
        <span className="person-name">{name}</span>
        {sub && <span className="person-sub">{sub}</span>}
      </span>
    </span>
  );
}

// ---------------- URL-backed filter state ----------------
/** Filters live in the URL so they survive reloads and can be shared. */
export function useUrlFilters<K extends string>(keys: readonly K[]) {
  const [params, setParams] = useSearchParams();
  const values = useMemo(() => Object.fromEntries(keys.map((k) => [k, params.get(k) ?? ''])) as Record<K, string>, [params, keys]);
  const set = useCallback(
    (k: K, v: string) => {
      const next = new URLSearchParams(params);
      if (v) next.set(k, v);
      else next.delete(k);
      next.delete('p'); // any filter change goes back to page 1
      setParams(next, { replace: true });
    },
    [params, setParams],
  );
  const clear = useCallback(() => {
    const next = new URLSearchParams(params);
    keys.forEach((k) => next.delete(k));
    next.delete('p');
    setParams(next, { replace: true });
  }, [params, setParams, keys]);
  const active = keys.filter((k) => values[k]).length;
  return { values, set, clear, active };
}

// ---------------- money input ----------------
const groupDigits = (digits: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

/**
 * Whole-so'm amount typed as "500 000". Accepts any integer (no step/rounding), ignores
 * spaces, dots and letters while typing; `value`/`onChange` carry plain digits ("500000").
 */
export function MoneyInput({
  value,
  onChange,
  allowNegative = false,
  required,
  autoFocus,
  min,
  max,
  'aria-label': ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  allowNegative?: boolean;
  required?: boolean;
  autoFocus?: boolean;
  min?: number;
  max?: number;
  'aria-label'?: string;
}) {
  const neg = allowNegative && value.startsWith('-');
  const digits = value.replace(/\D/g, '');
  const shown = (neg ? '−' : '') + groupDigits(digits);
  const n = Number((neg ? '-' : '') + (digits || '0'));
  const error =
    required && !digits ? '' : min != null && digits && n < min ? `Kamida ${groupDigits(String(min))}` : max != null && n > max ? `Ko‘pi bilan ${groupDigits(String(max))}` : '';
  return (
    <span className="money-input">
      <input
        type="text"
        inputMode={allowNegative ? 'text' : 'numeric'}
        autoComplete="off"
        value={shown}
        required={required}
        autoFocus={autoFocus}
        aria-label={ariaLabel}
        ref={(el) => el?.setCustomValidity(error)}
        onChange={(e) => {
          const raw = e.target.value;
          const isNeg = allowNegative && /^[\s]*[-−]/.test(raw);
          const d = raw.replace(/\D/g, '').replace(/^0+(?=\d)/, '').slice(0, 12);
          onChange((isNeg ? '-' : '') + d);
        }}
      />
      <span className="money-suffix">so‘m</span>
    </span>
  );
}

// ---------------- pagination ----------------
export const PAGE_SIZE = 50;
/** Must match the API's LIST_MAX: lists paged in the browser fetch up to this many rows. */
export const LIST_CAP = 5000;
const fmtCount = (n: number) => n.toLocaleString('ru-RU').replace(/ /g, ' ');

/** Current page, kept in the URL (?p=) so refresh and back keep the position. */
export function usePage() {
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Math.floor(Number(params.get('p'))) || 1);
  const setPage = useCallback(
    (n: number) => {
      const next = new URLSearchParams(params);
      if (n > 1) next.set('p', String(n));
      else next.delete('p');
      setParams(next);
      window.scrollTo({ top: 0 });
    },
    [params, setParams],
  );
  return { page, setPage };
}

/** Client-side slice of already-filtered rows; clamps a stale page number. */
export function paginate<T>(rows: T[], page: number, size = PAGE_SIZE) {
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const p = Math.min(page, pages);
  return { items: rows.slice((p - 1) * size, p * size), page: p };
}

/** 1 … 4 5 [6] 7 8 … 31 — 0 marks a gap. */
function pageList(page: number, pages: number): number[] {
  const keep = new Set([1, pages, page - 1, page, page + 1]);
  if (page <= 3) [2, 3, 4].forEach((n) => keep.add(n));
  if (page >= pages - 2) [pages - 1, pages - 2, pages - 3].forEach((n) => keep.add(n));
  const nums = [...keep].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b);
  const out: number[] = [];
  nums.forEach((n, i) => {
    if (i && n - nums[i - 1] > 1) out.push(0);
    out.push(n);
  });
  return out;
}

export function Pager({ page, total, onPage, size = PAGE_SIZE }: { page: number; total: number; onPage: (n: number) => void; size?: number }) {
  const pages = Math.ceil(total / size);
  if (pages <= 1) return null;
  const first = (page - 1) * size + 1;
  const last = Math.min(total, page * size);
  return (
    <nav className="pager" aria-label="Sahifalar">
      <span className="muted small">
        {fmtCount(first)}–{fmtCount(last)} / {fmtCount(total)}
      </span>
      <div className="pager-controls">
        <button className="pg" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Oldingi sahifa">
          ‹ Oldingi
        </button>
        {pageList(page, pages).map((n, i) =>
          n === 0 ? (
            <span key={`gap${i}`} className="gap">
              …
            </span>
          ) : (
            <button key={n} className={`pg ${n === page ? 'current' : ''}`} aria-current={n === page ? 'page' : undefined} onClick={() => onPage(n)}>
              {n}
            </button>
          ),
        )}
        <button className="pg" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Keyingi sahifa">
          Keyingi ›
        </button>
      </div>
    </nav>
  );
}

export const norm = (s: unknown) => String(s ?? '').toLowerCase();

// ---------------- toolbar ----------------
export function Toolbar({ children, count, onClear, active }: { children: ReactNode; count?: ReactNode; onClear?: () => void; active?: number }) {
  return (
    <div className="toolbar">
      <div className="toolbar-fields">{children}</div>
      <div className="toolbar-meta">
        {!!active && onClear && (
          <button className="btn small ghost" onClick={onClear}>
            <Icon name="x" size={14} /> Tozalash ({active})
          </button>
        )}
        {count != null && <span className="muted small">{count}</span>}
      </div>
    </div>
  );
}

export function SearchInput({ value, onChange, placeholder = 'Qidirish…' }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);
  useEffect(() => {
    if (local === value) return;
    const t = setTimeout(() => onChange(local), 250);
    return () => clearTimeout(t);
  }, [local]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <label className="search-input">
      <Icon name="search" size={16} />
      <input value={local} onChange={(e) => setLocal(e.target.value)} placeholder={placeholder} aria-label={placeholder} />
    </label>
  );
}

export function Select({
  value,
  onChange,
  label,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  options: { value: string; label: string }[];
}) {
  return (
    <select className={`filter-select ${value ? 'on' : ''}`} value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
      <option value="">{label}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

// ---------------- summary strip ----------------
export interface MiniStat {
  label: string;
  value: ReactNode;
  icon?: IconName;
  tone?: 'blue' | 'green' | 'amber' | 'red' | 'violet' | 'neutral';
  hint?: ReactNode;
  onClick?: () => void;
  /** Change vs the comparison period, in %; `good` says whether a rise is good (income) or bad (expenses). */
  delta?: { pct: number | null; good: 'up' | 'down'; against?: string };
  /** 0-100: share of a target reached (e.g. collected vs plan). */
  progress?: number | null;
}

/** A single strip of key figures. Color only for figures that signal a problem (tone "red"). */
export function Summary({ items }: { items: MiniStat[] }) {
  // Icons only when every card has one, so the cards in a row line up.
  const withIcons = items.every((i) => i.icon);
  return (
    <div className="figures">
      {items.map((s) => {
        const inner = (
          <>
            {withIcons && s.icon && (
              <span className="figure-icon" aria-hidden="true">
                <Icon name={s.icon} size={16} />
              </span>
            )}
            <span className="figure-label">{s.label}</span>
            <span className={`figure-value ${s.tone === 'red' ? 'red' : ''}`}>{s.value}</span>
            {s.progress != null && (
              <span className="figure-progress" aria-hidden="true">
                <span style={{ width: `${Math.max(0, Math.min(100, s.progress))}%` }} />
              </span>
            )}
            {(s.hint || s.delta) && (
              <span className="figure-hint">
                {s.delta && s.delta.pct != null && <DeltaChip pct={s.delta.pct} good={s.delta.good} />}
                {s.delta?.against && <span>{s.delta.against}</span>}
                {s.hint && <span>{s.hint}</span>}
              </span>
            )}
          </>
        );
        return s.onClick ? (
          <button key={s.label} className="figure" onClick={s.onClick}>
            {inner}
          </button>
        ) : (
          <div key={s.label} className="figure">
            {inner}
          </div>
        );
      })}
    </div>
  );
}

/** "↑ 12%" - green when the change is good, red when it is bad, gray when flat. */
export function DeltaChip({ pct, good }: { pct: number; good: 'up' | 'down' }) {
  const r = Math.round(pct);
  const tone = r === 0 ? 'flat' : (r > 0) === (good === 'up') ? 'good' : 'bad';
  return (
    <span className={`delta ${tone}`}>
      {r > 0 ? '↑' : r < 0 ? '↓' : '→'} {Math.abs(r)}%
    </span>
  );
}

// ---------------- capacity / progress ----------------
export function Progress({ value, max, label }: { value: number; max: number | null; label?: string }) {
  if (!max) return <span className="muted small">{value} / ∞</span>;
  const pct = Math.min(100, Math.round((value / max) * 100));
  const tone = value > max ? 'red' : pct >= 90 ? 'amber' : 'green';
  return (
    <span className="progress" title={label ?? `${value}/${max}`}>
      <span className="progress-track">
        <span className={`progress-fill ${tone}`} style={{ width: `${pct}%` }} />
      </span>
      <span className="progress-text">
        {value}/{max}
      </span>
    </span>
  );
}

// ---------------- dialogs & toasts ----------------
interface ConfirmOpts {
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
}
interface PromptOpts extends ConfirmOpts {
  label: string;
  initial?: string;
  required?: boolean;
  type?: 'text' | 'number' | 'password';
  minLength?: number;
}
type Toast = { id: number; text: string; tone: 'ok' | 'error' };

interface DialogApi {
  confirm: (o: ConfirmOpts) => Promise<boolean>;
  prompt: (o: PromptOpts) => Promise<string | null>;
  toast: (text: string, tone?: 'ok' | 'error') => void;
}

const DialogCtx = createContext<DialogApi | null>(null);

export function useDialogs(): DialogApi {
  const v = useContext(DialogCtx);
  if (!v) throw new Error('useDialogs outside DialogProvider');
  return v;
}

export function DialogProvider({ children }: { children: ReactNode }) {
  const [req, setReq] = useState<null | { kind: 'confirm' | 'prompt'; o: PromptOpts; resolve: (v: string | boolean | null) => void }>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [value, setValue] = useState('');
  const seq = useRef(0);

  const api = useMemo<DialogApi>(
    () => ({
      confirm: (o) => new Promise((resolve) => setReq({ kind: 'confirm', o: { ...o, label: '' }, resolve: (v) => resolve(v === true) })),
      prompt: (o) =>
        new Promise((resolve) => {
          setValue(o.initial ?? '');
          setReq({ kind: 'prompt', o, resolve: (v) => resolve(typeof v === 'string' ? v : null) });
        }),
      toast: (text, tone = 'ok') => {
        const id = ++seq.current;
        setToasts((t) => [...t, { id, text, tone }]);
        setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'error' ? 6000 : 3500);
      },
    }),
    [],
  );

  const close = (v: string | boolean | null) => {
    req?.resolve(v);
    setReq(null);
  };

  useEffect(() => {
    if (!req) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && close(req.kind === 'prompt' ? null : false);
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });

  return (
    <DialogCtx.Provider value={api}>
      {children}
      {req && (
        <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close(req.kind === 'prompt' ? null : false)}>
          <form
            className="modal small-modal"
            role="dialog"
            aria-modal="true"
            aria-label={req.o.title}
            onSubmit={(e) => {
              e.preventDefault();
              if (req.kind === 'prompt') {
                if (req.o.required !== false && !value.trim()) return;
                close(value.trim());
              } else close(true);
            }}
          >
            <h2>{req.o.title}</h2>
            {req.o.message && <div className="muted dialog-msg">{req.o.message}</div>}
            {req.kind === 'prompt' && (
              <label className="field">
                <span>{req.o.label}</span>
                <input
                  autoFocus
                  type={req.o.type ?? 'text'}
                  value={value}
                  minLength={req.o.minLength}
                  required={req.o.required !== false}
                  onChange={(e) => setValue(e.target.value)}
                />
              </label>
            )}
            <div className="form-actions">
              <button type="button" className="btn" onClick={() => close(req.kind === 'prompt' ? null : false)}>
                Bekor qilish
              </button>
              <button type="submit" className={`btn ${req.o.danger ? 'danger-solid' : 'primary'}`} autoFocus={req.kind === 'confirm'}>
                {req.o.confirmLabel ?? 'Tasdiqlash'}
              </button>
            </div>
          </form>
        </div>
      )}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.tone}`}>
            <Icon name={t.tone === 'ok' ? 'check' : 'alert'} size={16} />
            {t.text}
          </div>
        ))}
      </div>
    </DialogCtx.Provider>
  );
}

// ---------------- column chart (single series) ----------------
const compact = (n: number) =>
  Math.abs(n) >= 1_000_000 ? `${+(n / 1_000_000).toFixed(1)} mln` : Math.abs(n) >= 1000 ? `${Math.round(n / 1000)} ming` : String(n);

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const m = v / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
}

/** Daily columns: 4px rounded caps, hairline baseline, hover tooltip, accessible table fallback. */
export function ColumnChart({
  data,
  label,
  format,
}: {
  data: { key: string; label: string; value: number; sub?: string }[];
  label: string;
  format: (n: number) => string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 640;
  const H = 180;
  const padL = 56;
  const padB = 24;
  const padT = 12;
  const max = niceMax(Math.max(0, ...data.map((d) => d.value)));
  const plotW = W - padL - 8;
  const plotH = H - padB - padT;
  const band = plotW / Math.max(1, data.length);
  const barW = Math.min(24, band * 0.6);
  const y = (v: number) => padT + plotH - (Math.max(0, v) / max) * plotH;
  const ticks = [0, max / 2, max];
  const h = hover != null ? data[hover] : null;

  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W - 8} y1={y(t)} y2={y(t)} className="chart-grid" />
            <text x={padL - 8} y={y(t) + 4} textAnchor="end" className="chart-tick">
              {compact(t)}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const x = padL + i * band + (band - barW) / 2;
          const top = y(d.value);
          const bh = padT + plotH - top;
          const r = Math.min(4, bh);
          return (
            <g key={d.key} onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} tabIndex={0} aria-label={`${d.label}: ${format(d.value)}`}>
              <rect x={padL + i * band} y={padT} width={band} height={plotH + padB} fill="transparent" />
              {bh > 0 && (
                <path
                  className={`chart-bar ${hover === i ? 'hl' : ''}`}
                  d={`M${x},${padT + plotH} V${top + r} Q${x},${top} ${x + r},${top} H${x + barW - r} Q${x + barW},${top} ${x + barW},${top + r} V${padT + plotH} Z`}
                />
              )}
              {(i % Math.ceil(data.length / 7) === 0 || i === data.length - 1) && (
                <text x={padL + i * band + band / 2} y={H - 6} textAnchor="middle" className="chart-tick">
                  {d.label}
                </text>
              )}
            </g>
          );
        })}
        <line x1={padL} x2={W - 8} y1={padT + plotH} y2={padT + plotH} className="chart-axis" />
      </svg>
      {h && hover != null && (
        <div className="chart-tip" style={{ left: `${((padL + hover * band + band / 2) / W) * 100}%` }}>
          <strong>{format(h.value)}</strong>
          <span>
            {h.label}
            {h.sub ? ` · ${h.sub}` : ''}
          </span>
        </div>
      )}
      <table className="sr-only">
        <caption>{label}</caption>
        <tbody>
          {data.map((d) => (
            <tr key={d.key}>
              <th scope="row">{d.label}</th>
              <td>{format(d.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------- grouped month bars (two series, one axis) ----------------
export interface MonthBarSeries {
  key: string;
  label: string;
  /** CSS class that sets the fill (colors live in theme.css, validated for both modes). */
  cls: string;
}

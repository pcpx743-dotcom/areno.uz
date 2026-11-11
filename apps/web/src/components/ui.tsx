import { useCallback, useEffect, useState, type ReactNode, type FormEvent } from 'react';
import { api, ApiError } from '../api';

// ---------- data hook ----------
export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    setError(null);
    try {
      setData(await api<T>(path));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }, [path]);
  useEffect(() => {
    load();
  }, [load]);
  return { data, error, loading, reload: load };
}

export function errorText(e: unknown): string {
  if (e instanceof ApiError) {
    const MAP: Record<string, string> = {
      validation_error: 'Ma’lumotlar noto‘g‘ri kiritilgan',
      forbidden: 'Ruxsat yo‘q',
      not_found: 'Topilmadi',
      duplicate: 'Bunday yozuv allaqachon mavjud',
      group_full: 'Guruh to‘lgan',
      already_enrolled: 'Sportchi bu guruhda allaqachon bor',
      discount_reason_required: 'Chegirma sababini kiriting',
      unauthorized: 'Login yoki parol noto‘g‘ri',
      day_closed: 'Bu kun uchun kassa yopilgan',
      already_reversed: 'To‘lov allaqachon storno qilingan',
      already_closed: 'Bu kun allaqachon yopilgan',
      debtor_blocked: 'Qarzdor sportchilar darsga qo‘yilmaydi',
      session_cancelled: 'Dars bekor qilingan',
      future_session: 'Kelajakdagi darsga davomat qo‘yib bo‘lmaydi',
      has_attendance: 'Davomat qo‘yilgan darsni bekor qilib bo‘lmaydi',
      period_closed: 'Davr yopilgan — tuzatish yozuvi yarating',
      overpay: 'To‘lanadigan summadan ko‘p',
      too_many_attempts: 'Juda ko‘p urinish. Birozdan keyin qayta urinib ko‘ring',
      wrong_password: 'Joriy parol noto‘g‘ri',
      shared_account: 'Bu foydalanuvchi boshqa klubda ham bor — parolni o‘zi o‘zgartirishi kerak',
    };
    const base = MAP[e.code] ?? e.message;
    if (e.code === 'validation_error' && Array.isArray(e.details)) {
      const fields = (e.details as { path: (string | number)[]; message: string }[]).map((d) => `${d.path.join('.')}: ${d.message}`);
      return `${base} — ${fields.join('; ')}`;
    }
    return base;
  }
  return e instanceof Error ? e.message : String(e);
}

// ---------- formatting ----------
export const fmtMoney = (n: number | null | undefined) =>
  n == null ? '—' : `${new Intl.NumberFormat('ru-RU').format(n).replace(/ /g, ' ')} so‘m`;

export const fmtDate = (d: string | null | undefined) => {
  if (!d) return '—';
  const [y, m, day] = d.slice(0, 10).split('-');
  return `${day}.${m}.${y}`;
};

export const fmtDateTime = (d: string | null | undefined) => {
  if (!d) return '—';
  const x = new Date(d);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(x.getDate())}.${p(x.getMonth() + 1)}.${x.getFullYear()} ${p(x.getHours())}:${p(x.getMinutes())}`;
};

/** Idempotency key; falls back where crypto.randomUUID is unavailable (non-HTTPS). */
export const newKey = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;

export const monthRange = (iso: string) => {
  const [y, m] = iso.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${iso.slice(0, 7)}-01`, to: `${iso.slice(0, 7)}-${String(last).padStart(2, '0')}` };
};

export const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function ageFrom(birth: string | null): number | null {
  if (!birth) return null;
  const b = new Date(birth);
  const n = new Date();
  let a = n.getFullYear() - b.getFullYear();
  if (n.getMonth() < b.getMonth() || (n.getMonth() === b.getMonth() && n.getDate() < b.getDate())) a--;
  return a;
}

// ---------- components ----------
export function PageHeader({ title, actions, subtitle }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <div className="muted">{subtitle}</div>}
      </div>
      {actions && <div className="actions">{actions}</div>}
    </div>
  );
}

export function Card({ title, actions, children }: { title?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="card">
      {(title || actions) && (
        <div className="card-head">
          {title && <h2>{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="card-head">
          <h2>{title}</h2>
          <button className="btn ghost" onClick={onClose} aria-label="Yopish">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small className="muted">{hint}</small>}
    </label>
  );
}

/** Form wrapper: handles submit state and API errors. */
export function Form({
  onSubmit,
  children,
  submitLabel = 'Saqlash',
}: {
  onSubmit: () => Promise<void>;
  children: ReactNode;
  submitLabel?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await onSubmit();
    } catch (x) {
      setErr(errorText(x));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="form">
      {children}
      {err && <div className="alert error">{err}</div>}
      <div className="form-actions">
        <button className="btn primary" disabled={busy}>
          {busy ? 'Saqlanmoqda…' : submitLabel}
        </button>
      </div>
    </form>
  );
}

export function Badge({ tone = 'neutral', children }: { tone?: 'neutral' | 'green' | 'red' | 'amber' | 'blue'; children: ReactNode }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

export const STATUS_LABEL: Record<string, [string, 'neutral' | 'green' | 'red' | 'amber' | 'blue']> = {
  active: ['Faol', 'green'],
  paused: ['To‘xtatilgan', 'amber'],
  archived: ['Arxiv', 'neutral'],
  ended: ['Tugagan', 'neutral'],
  draft: ['Qoralama', 'neutral'],
  frozen: ['Muzlatilgan', 'blue'],
  expired: ['Muddati o‘tgan', 'neutral'],
  cancelled: ['Bekor qilingan', 'neutral'],
  open: ['To‘lanmagan', 'red'],
  partially_paid: ['Qisman to‘langan', 'amber'],
  paid: ['To‘langan', 'green'],
  void: ['Bekor', 'neutral'],
  scheduled: ['Rejada', 'blue'],
  held: ['O‘tkazildi', 'green'],
};

export function StatusBadge({ status }: { status: string }) {
  const [label, tone] = STATUS_LABEL[status] ?? [status, 'neutral'];
  return <Badge tone={tone}>{label}</Badge>;
}

export const BILLING_LABEL: Record<string, string> = {
  calendar_month: 'Kalendar oy',
  fixed_days: 'Kunlik muddat',
  session_pack: 'Darslar soni',
};

export const METHOD_LABEL: Record<string, string> = { cash: 'Naqd', click_payme: 'Click / Payme', terminal: 'Terminal' };

export const WEEKDAYS = ['', 'Dushanba', 'Seshanba', 'Chorshanba', 'Payshanba', 'Juma', 'Shanba', 'Yakshanba'];

export function Loading() {
  return <div className="muted pad">Yuklanmoqda…</div>;
}

export function ErrorBox({ error }: { error: string | null }) {
  return error ? <div className="alert error">{error}</div> : null;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

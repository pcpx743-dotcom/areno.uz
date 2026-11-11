import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { BILLING_LABEL, Empty, ErrorBox, fmtDate, fmtMoney, Loading, PageHeader, StatusBadge, todayIso, useApi } from '../components/ui';
import { norm, paginate, Pager, Person, SearchInput, Select, Summary, Toolbar, usePage, useUrlFilters } from '../components/kit';
import type { Branch } from '../types';

interface Row {
  id: string;
  athleteId: string;
  athleteName: string;
  planName: string;
  branchId: string;
  billingType: string;
  startDate: string;
  endDate: string | null;
  price: number;
  sessionLimit: number | null;
  usedSessions: number;
  remainingSessions: number | null;
  status: string;
}

const TABS = [
  { key: 'active', label: 'Faol', q: 'status=active' },
  { key: 'expiring', label: 'Tugayotganlar (7 kun)', q: 'expiringWithinDays=7' },
  { key: 'frozen', label: 'Muzlatilganlar', q: 'status=frozen' },
  { key: 'expired', label: 'Muddati o‘tgan', q: 'status=expired' },
  { key: 'all', label: 'Barchasi', q: '' },
];

const daysLeft = (end: string | null) => (end ? Math.round((Date.parse(end) - Date.parse(todayIso())) / 86_400_000) : null);

export default function SubscriptionsPage() {
  const f = useUrlFilters(['tab', 'q', 'branch', 'plan', 'model'] as const);
  const tab = f.values.tab || 'active';
  const q = TABS.find((t) => t.key === tab)?.q ?? '';
  const { data, error } = useApi<Row[]>(`/subscriptions?${q}`);
  const branches = useApi<Branch[]>('/branches').data ?? [];

  const plans = useMemo(() => [...new Set((data ?? []).map((r) => r.planName))].sort(), [data]);
  const rows = useMemo(
    () =>
      (data ?? []).filter((r) => {
        const v = f.values;
        if (v.q && !norm(r.athleteName).includes(norm(v.q))) return false;
        if (v.branch && r.branchId !== v.branch) return false;
        if (v.plan && r.planName !== v.plan) return false;
        if (v.model && r.billingType !== v.model) return false;
        return true;
      }),
    [data, f.values],
  );
  const { page, setPage } = usePage();
  const pg = paginate(rows, page);
  const value = rows.reduce((a, r) => a + r.price, 0);
  const packs = rows.filter((r) => r.remainingSessions != null);
  const lowPacks = packs.filter((r) => (r.remainingSessions ?? 0) <= 2).length;
  const soon = rows.filter((r) => {
    const d = daysLeft(r.endDate);
    return d != null && d >= 0 && d <= 7;
  }).length;

  return (
    <>
      <PageHeader title="Abonementlar" />
      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} className={tab === t.key ? 'active' : ''} onClick={() => f.set('tab', t.key === 'active' ? '' : t.key)}>
            {t.label}
          </button>
        ))}
      </div>
      <Toolbar count={data ? `${rows.length} ta` : undefined} active={['q', 'branch', 'plan', 'model'].filter((k) => f.values[k as 'q']).length} onClear={() => ['q', 'branch', 'plan', 'model'].forEach((k) => f.set(k as 'q', ''))}>
        <SearchInput value={f.values.q} onChange={(v) => f.set('q', v)} placeholder="Sportchi ismi" />
        {branches.length > 1 && <Select label="Barcha filiallar" value={f.values.branch} onChange={(v) => f.set('branch', v)} options={branches.map((b) => ({ value: b.id, label: b.name }))} />}
        <Select label="Barcha tariflar" value={f.values.plan} onChange={(v) => f.set('plan', v)} options={plans.map((p) => ({ value: p, label: p }))} />
        <Select label="Barcha modellar" value={f.values.model} onChange={(v) => f.set('model', v)} options={Object.entries(BILLING_LABEL).map(([value, label]) => ({ value, label }))} />
      </Toolbar>
      <ErrorBox error={error} />
      {!data ? (
        <Loading />
      ) : rows.length === 0 ? (
        <Empty>Abonementlar yo‘q</Empty>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Sportchi</th>
                <th>Tarif</th>
                <th>Davr</th>
                <th>Qoldiq</th>
                <th className="num">Narx</th>
                <th>Holat</th>
              </tr>
            </thead>
            <tbody>
              {pg.items.map((s) => {
                const d = daysLeft(s.endDate);
                return (
                  <tr key={s.id}>
                    <td>
                      <Link to={`/athletes/${s.athleteId}`} className="person-link">
                        <Person name={s.athleteName} />
                      </Link>
                    </td>
                    <td>
                      {s.planName}
                      <div className="muted small">{BILLING_LABEL[s.billingType]}</div>
                    </td>
                    <td>
                      {fmtDate(s.startDate)} – {s.endDate ? fmtDate(s.endDate) : '…'}
                      {d != null && s.status === 'active' && d >= 0 && d <= 7 && <div className="small amber-text">{d === 0 ? 'bugun tugaydi' : `${d} kun qoldi`}</div>}
                    </td>
                    <td>
                      {s.remainingSessions != null ? (
                        <span className={s.remainingSessions <= 2 ? 'debt' : ''}>
                          <strong>{s.remainingSessions}</strong>/{s.sessionLimit} dars
                        </span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td className="num">{fmtMoney(s.price)}</td>
                    <td>
                      <StatusBadge status={s.status} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <Pager page={pg.page} total={rows.length} onPage={setPage} />
        </div>
      )}
    </>
  );
}

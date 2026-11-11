/**
 * Bosh sahifa. Alert, KPI tiles for the chosen month (the selected money tile drives the chart),
 * quick actions, trend, renewals, then today's operational lists.
 */
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useRole } from '../auth';
import { Card, Empty, ErrorBox, fmtDate, fmtDateTime, fmtMoney, Loading, PageHeader, StatusBadge, useApi } from '../components/ui';
import { Avatar, DeltaChip, Icon, Summary, useUrlFilters, type IconName } from '../components/kit';
import { Dynamics, METRICS, Spark, TrendChart, type DayRow, type MetricKey } from '../components/Dynamics';

interface Dash {
  today: string;
  activeAthletes?: number;
  activeGroups?: number;
  activeSubscriptions?: number;
  expiringIn7Days?: number;
  debtors?: number;
  totalDebt?: number;
  myGroups?: number;
}
interface SessionRow {
  id: string;
  groupName: string;
  branchName: string;
  coachName: string | null;
  startTime: string;
  endTime: string;
  status: string;
  marked: number;
  present: number;
  enrolled: number;
}
interface Debtor {
  id: string;
  fullName: string;
  debt: number;
  daysOverdue: number;
}
interface Expiring {
  id: string;
  athleteId: string;
  athleteName: string;
  planName: string;
  endDate: string | null;
  price?: number;
  status: string;
}
interface Pay {
  id: string;
  athleteId: string;
  athleteName: string;
  amount: number;
  paidAt: string;
}
interface MonthRow {
  month: string;
  plan: number;
  collected: number;
  expenses: number;
  result: number;
}

const QUICK: { to: string; label: string; icon: IconName }[] = [
  { to: '/athletes?new=1', label: 'Yangi sportchi', icon: 'plus' },
  { to: '/finance/debtors', label: 'Qarzdorlar', icon: 'alert' },
  { to: '/finance/expenses', label: 'Xarajatlar', icon: 'wallet' },
  { to: '/plans', label: 'Tariflar', icon: 'tag' },
  { to: '/coaches', label: 'Murabbiylar', icon: 'whistle' },
  { to: '/attendance', label: 'Davomat', icon: 'calendarCheck' },
];

const WD = ['yakshanba', 'dushanba', 'seshanba', 'chorshanba', 'payshanba', 'juma', 'shanba'];
const MONTHS = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'];
const MONTHS_SHORT = ['Yan', 'Fev', 'Mar', 'Apr', 'May', 'Iyun', 'Iyul', 'Avg', 'Sen', 'Okt', 'Noy', 'Dek'];
const longDate = (iso: string) => {
  const d = new Date(`${iso}T00:00:00`);
  return `${d.getDate()}-${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${WD[d.getDay()]}`;
};
const monthName = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  const n = MONTHS[m - 1];
  return `${n[0].toUpperCase()}${n.slice(1)} ${y}`;
};
const monthShort = (ym: string) => MONTHS_SHORT[Number(ym.slice(5, 7)) - 1];
/** Plain grouped number; the unit is shown once, smaller, next to it. */
const money = (v: number) => fmtMoney(v).replace(/\s*so.m\s*$/, '');
/** "2026-11", "2026-10", … newest first. */
const lastMonths = (end: string, n: number) => {
  const out: string[] = [];
  let [y, m] = end.split('-').map(Number);
  for (let i = 0; i < n; i++) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    if (--m === 0) (m = 12), y--;
  }
  return out;
};
/** % change; null when there is nothing meaningful to compare against. */
const change = (cur: number, prev: number) => (prev > 0 ? ((cur - prev) / prev) * 100 : null);

export default function DashboardPage() {
  const role = useRole();
  const isStaff = role === 'owner' || role === 'branch_admin';
  const navigate = useNavigate();
  const f = useUrlFilters(['m', 'k', 'r'] as const);
  const [hideAlert, setHideAlert] = useState(false);
  const [renewDays, setRenewDays] = useState(7);
  const dash = useApi<Dash>('/club/dashboard');
  const today = dash.data?.today;
  const month = f.values.m || today?.slice(0, 7) || '';
  const isCurrent = !!today && month === today.slice(0, 7);

  const monthly = useApi<MonthRow[]>(isStaff && month ? `/reports/monthly?months=12&end=${month}` : null);
  const daily = useApi<{ month: string; prevMonth: string; days: DayRow[]; prevDays: DayRow[] }>(isStaff && month ? `/reports/daily?month=${month}` : null);
  const lessons = useApi<{ sessions: SessionRow[] }>('/sessions');
  const cash = useApi<{ totals: { net: number; count: number } }>(isStaff ? '/cash/report' : null);
  const debtors = useApi<Debtor[]>(isStaff ? '/charges/debtors' : null);
  const renewals = useApi<Expiring[]>(isStaff ? `/subscriptions?expiringWithinDays=${renewDays}` : null);
  const payments = useApi<Pay[]>(isStaff ? '/payments?limit=6' : null);

  if (dash.error) return <ErrorBox error={dash.error} />;
  if (!dash.data) return <Loading />;
  const d = dash.data;
  const todays = lessons.data?.sessions ?? [];
  const unmarked = todays.filter((s) => s.status !== 'cancelled' && s.marked === 0).length;

  if (!isStaff) {
    return (
      <>
        <PageHeader title="Bosh sahifa" subtitle={longDate(d.today)} />
        <Summary
          items={[
            { icon: 'calendarCheck', label: 'Darslar bugun', value: todays.length, hint: unmarked ? `${unmarked} tasida davomat yo‘q` : undefined, onClick: () => navigate('/attendance') },
            { icon: 'layers', label: 'Guruhlarim', value: d.myGroups ?? 0, onClick: () => navigate('/groups') },
          ]}
        />
        <LessonsCard todays={todays} loading={!lessons.data} />
      </>
    );
  }

  const rows = monthly.data ?? [];
  const cur = rows[rows.length - 1];
  const prev = rows[rows.length - 2];
  const metric: MetricKey = METRICS.some((m) => m.key === f.values.k) ? (f.values.k as MetricKey) : 'collected';
  const metricName = METRICS.find((m) => m.key === metric)!.label;
  const range = f.values.r === '6' || f.values.r === 'd' ? f.values.r : '12';
  const dayData = daily.data && daily.data.month === month ? daily.data : null;
  const planPct = cur && cur.plan > 0 ? Math.round((cur.collected / cur.plan) * 100) : null;
  const margin = cur && cur.collected > 0 ? Math.round((cur.result / cur.collected) * 100) : null;
  const tiles: { key: MetricKey; label: string; icon: IconName; good: 'up' | 'down'; hint: string }[] = [
    { key: 'plan', label: 'Hisoblangan reja', icon: 'receipt', good: 'up', hint: '' },
    { key: 'collected', label: 'Yig‘ilgan tushum', icon: 'cash', good: 'up', hint: planPct != null ? `rejaning ${planPct}%` : '' },
    { key: 'expenses', label: 'Xarajatlar', icon: 'wallet', good: 'down', hint: '' },
    { key: 'result', label: 'Foyda', icon: 'chart', good: 'up', hint: margin != null ? `rentabellik ${margin}%` : '' },
  ];
  const problems = (d.debtors ?? 0) > 0 || (d.expiringIn7Days ?? 0) > 0;
  const shown = range === '6' ? rows.slice(-6) : rows;

  return (
    <div className="dash">
      <div className="page-header">
        <div>
          <h1>Bosh sahifa</h1>
          <div className="muted">{longDate(d.today)}</div>
        </div>
        <div className="actions">
          <label>
            <span className="sr-only">Oy</span>
            <select className="month-select" value={month} onChange={(e) => f.set('m', e.target.value === today?.slice(0, 7) ? '' : e.target.value)}>
              {lastMonths(today?.slice(0, 7) ?? month, 24).map((m) => (
                <option key={m} value={m}>
                  {monthName(m)}
                </option>
              ))}
            </select>
          </label>
          <Link className="btn" to="/reports">
            Hisobotlar
          </Link>
        </div>
      </div>

      {problems && !hideAlert && (
        <div className="dash-alert" role="status">
          <span className="dash-alert-icon">
            <Icon name="alert" size={16} />
          </span>
          <div>
            <strong>To‘lov bo‘yicha e’tibor kerak</strong>
            <span>
              {[(d.debtors ?? 0) > 0 ? `${d.debtors} sportchida ${fmtMoney(d.totalDebt ?? 0)} qarz bor` : null, (d.expiringIn7Days ?? 0) > 0 ? `${d.expiringIn7Days} ta abonement 7 kunda tugaydi` : null].filter(Boolean).join(', ')}
            </span>
          </div>
          <Link className="btn small ghost" to="/finance/debtors">
            Ko‘rish
          </Link>
          <button type="button" className="dash-alert-x" onClick={() => setHideAlert(true)} aria-label="Yopish">
            <Icon name="x" size={16} />
          </button>
        </div>
      )}

      {monthly.error ? (
        <ErrorBox error={monthly.error} />
      ) : !cur ? (
        <Loading />
      ) : (
        <div className="tiles">
          {tiles.map((t) => {
            const pct = prev ? change(cur[t.key], prev[t.key]) : null;
            return (
              <button type="button" key={t.key} className={`tile ${metric === t.key ? 'on' : ''}`} aria-pressed={metric === t.key} onClick={() => f.set('k', t.key === 'collected' ? '' : t.key)}>
                <span className="tile-head">
                  <span>{t.label}</span>
                  <Icon name={t.icon} size={16} />
                </span>
                <span className={`tile-value ${cur[t.key] < 0 ? 'red' : ''}`}>
                  {money(cur[t.key])} <small>so‘m</small>
                </span>
                <span className="tile-sub">
                  {pct != null && <DeltaChip pct={pct} good={t.good} />}
                  <span>{t.hint}</span>
                </span>
                <Spark values={rows.map((r) => r[t.key])} />
              </button>
            );
          })}
          <Link to="/athletes" className="tile">
            <span className="tile-head">
              <span>Faol sportchilar</span>
              <Icon name="users" size={16} />
            </span>
            <span className="tile-value">{d.activeAthletes ?? 0}</span>
            <span className="tile-sub">
              <span>{d.activeGroups ?? 0} ta guruh</span>
            </span>
            <span className="tile-foot">{d.activeSubscriptions ?? 0} ta faol abonement</span>
          </Link>
          <Link to="/finance/debtors" className="tile">
            <span className="tile-head">
              <span>Qarzdorlar</span>
              <Icon name="alert" size={16} />
            </span>
            <span className={`tile-value ${d.debtors ? 'red' : ''}`}>{d.debtors ?? 0}</span>
            <span className="tile-sub">
              <span>kishi</span>
            </span>
            <span className="tile-foot">{fmtMoney(d.totalDebt ?? 0)} jami qarz</span>
          </Link>
        </div>
      )}

      <div className="quick">
        {QUICK.map((q) => (
          <Link key={q.to} to={q.to} className="quick-btn">
            <Icon name={q.icon} size={16} /> {q.label}
          </Link>
        ))}
      </div>

      <section className="card trend-card">
        <div className="trend-head">
          <div>
            <h2>{metricName} dinamikasi</h2>
            <div className="muted small">{range === 'd' ? `${monthName(month)}, kunlar bo‘yicha` : `So‘nggi ${shown.length} oy`}</div>
          </div>
          <div className="trend-controls">
            <div className="tabs" role="group" aria-label="Ko‘rsatkich">
              {METRICS.map((m) => (
                <button key={m.key} type="button" className={metric === m.key ? 'active' : ''} aria-pressed={metric === m.key} onClick={() => f.set('k', m.key === 'collected' ? '' : m.key)}>
                  {m.label}
                </button>
              ))}
            </div>
            <div className="tabs" role="group" aria-label="Davr">
              {[
                ['12', '12 oy'],
                ['6', '6 oy'],
                ['d', 'Kunlik'],
              ].map(([k, l]) => (
                <button key={k} type="button" className={range === k ? 'active' : ''} aria-pressed={range === k} onClick={() => f.set('r', k === '12' ? '' : k)}>
                  {l}
                </button>
              ))}
            </div>
          </div>
        </div>
        {range === 'd' ? (
          daily.error ? (
            <ErrorBox error={daily.error} />
          ) : !dayData ? (
            <Loading />
          ) : (
            <Dynamics days={dayData.days} prevDays={dayData.prevDays} metric={metric} today={d.today} label={monthName(dayData.month)} prevLabel={monthName(dayData.prevMonth)} fmtDay={fmtDate} />
          )
        ) : !monthly.data ? (
          <Loading />
        ) : (
          <TrendChart name={metricName} rows={shown.map((r) => ({ key: r.month, label: monthShort(r.month), full: monthName(r.month), value: r[metric] }))} />
        )}
      </section>

      <section className="card">
        <div className="card-head renew-head">
          <div>
            <h2>Yaqinda tugaydigan abonementlar</h2>
            <div className="muted small">Yangilash kerak bo‘lgan sportchilar</div>
          </div>
          <div className="tabs" role="group" aria-label="Muddat">
            {[7, 14, 30].map((n) => (
              <button key={n} type="button" className={renewDays === n ? 'active' : ''} aria-pressed={renewDays === n} onClick={() => setRenewDays(n)}>
                {n} kun
              </button>
            ))}
          </div>
        </div>
        {!renewals.data ? (
          <Loading />
        ) : !renewals.data.length ? (
          <Empty>{renewDays} kun ichida tugaydigan abonement yo‘q</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Sportchi</th>
                  <th>Tarif</th>
                  <th>Tugash sanasi</th>
                  <th className="num">Narx</th>
                  <th>Holat</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {renewals.data.slice(0, 8).map((x) => {
                  const left = x.endDate ? Math.round((new Date(`${x.endDate}T00:00:00`).getTime() - new Date(`${d.today}T00:00:00`).getTime()) / 86_400_000) : null;
                  return (
                    <tr key={x.id}>
                      <td>
                        <Link to={`/athletes/${x.athleteId}`} className="person-link">
                          <span className="person">
                            <Avatar name={x.athleteName} size={32} />
                            <span className="person-name">{x.athleteName}</span>
                          </span>
                        </Link>
                      </td>
                      <td>{x.planName}</td>
                      <td>
                        {fmtDate(x.endDate)}
                        {left != null && <div className="cell-sub red">{left === 0 ? 'bugun' : `${left} kun qoldi`}</div>}
                      </td>
                      <td className="num">{x.price != null ? fmtMoney(x.price) : '—'}</td>
                      <td>
                        <StatusBadge status={x.status} />
                      </td>
                      <td className="num">
                        <Link className="btn small primary" to={`/athletes/${x.athleteId}`}>
                          Yangilash
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="dash-grid">
        <div className="dash-main">
          <LessonsCard todays={todays} loading={!lessons.data} unmarked={unmarked} />

          <Card
            title="So‘nggi to‘lovlar"
            actions={
              <Link className="card-link" to="/finance/payments">
                Barchasi
              </Link>
            }
          >
            {!payments.data ? (
              <Loading />
            ) : !payments.data.length ? (
              <Empty>To‘lov yo‘q</Empty>
            ) : (
              <ul className="rows">
                {payments.data.map((p) => (
                  <li key={p.id}>
                    <Link to={`/athletes/${p.athleteId}`} className="row-link">
                      <span className="row-main">{p.athleteName}</span>
                      <span className="row-sub">{fmtDateTime(p.paidAt).slice(0, 10)}</span>
                      <span className={`row-amount ${p.amount < 0 ? 'debt' : ''}`}>{fmtMoney(p.amount)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="dash-side">
          <Card title="Bugun">
            <ul className="rows today-list">
              <li>
                <Link to="/finance/cash" className="row-link">
                  <span className="row-main">Tushum</span>
                  <span className="row-sub">{cash.data?.totals.count ?? 0} ta to‘lov</span>
                  <span className="row-amount">{fmtMoney(cash.data?.totals.net ?? 0)}</span>
                </Link>
              </li>
              <li>
                <Link to="/attendance" className="row-link">
                  <span className="row-main">Darslar</span>
                  <span className="row-sub">{unmarked ? `${unmarked} tasida davomat yo‘q` : ''}</span>
                  <span className="row-amount">{todays.length}</span>
                </Link>
              </li>
              <li>
                <Link to="/finance/debtors" className="row-link">
                  <span className="row-main">Qarzdorlik</span>
                  <span className="row-sub">{d.debtors ?? 0} kishi</span>
                  <span className={`row-amount ${d.totalDebt ? 'debt' : ''}`}>{fmtMoney(d.totalDebt ?? 0)}</span>
                </Link>
              </li>
              <li>
                <Link to="/athletes" className="row-link">
                  <span className="row-main">Faol sportchilar</span>
                  <span className="row-sub">{d.activeSubscriptions ?? 0} ta abonement</span>
                  <span className="row-amount">{d.activeAthletes ?? 0}</span>
                </Link>
              </li>
              <li>
                <Link to="/subscriptions?tab=expiring" className="row-link">
                  <span className="row-main">7 kunda tugaydi</span>
                  <span className="row-sub" />
                  <span className="row-amount">{d.expiringIn7Days ?? 0}</span>
                </Link>
              </li>
            </ul>
          </Card>

          <Card
            title="Qarzdorlar"
            actions={
              <Link className="card-link" to="/finance/debtors">
                Barchasi
              </Link>
            }
          >
            {!debtors.data ? (
              <Loading />
            ) : !debtors.data.length ? (
              <Empty>Qarzdor yo‘q</Empty>
            ) : (
              <ul className="rows">
                {debtors.data.slice(0, 6).map((x) => (
                  <li key={x.id}>
                    <Link to={`/athletes/${x.id}`} className="row-link">
                      <span className="row-main">{x.fullName}</span>
                      <span className="row-sub">{x.daysOverdue ? `${x.daysOverdue} kun` : ''}</span>
                      <span className="row-amount debt">{fmtMoney(x.debt)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function LessonsCard({ todays, loading, unmarked = 0 }: { todays: SessionRow[]; loading: boolean; unmarked?: number }) {
  return (
    <Card
      title={unmarked ? `Bugungi darslar · ${unmarked} tasida davomat yo‘q` : 'Bugungi darslar'}
      actions={
        <Link className="card-link" to="/attendance">
          Davomat
        </Link>
      }
    >
      {loading ? (
        <Loading />
      ) : !todays.length ? (
        <Empty>Bugun dars yo‘q</Empty>
      ) : (
        <ul className="rows">
          {todays.map((s) => (
            <li key={s.id} className={s.status === 'cancelled' ? 'muted' : ''}>
              <span className="lesson-time">
                {s.startTime.slice(0, 5)}–{s.endTime.slice(0, 5)}
              </span>
              <span className="row-main">
                {s.groupName} <span className="row-sub">· {s.coachName ?? '—'}</span>
              </span>
              <span className="row-sub">
                {s.status === 'cancelled' ? 'bekor qilingan' : s.marked ? `${s.present}/${s.marked} keldi` : `${s.enrolled} sportchi`}
              </span>
              {s.status !== 'cancelled' && (
                <Link className="btn small" to={`/attendance/${s.id}`}>
                  {s.marked ? 'Ochish' : 'Belgilash'}
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

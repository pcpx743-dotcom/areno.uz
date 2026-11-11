/** Hisobotlar: financial summary by branch & sport, attendance statistics. */
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useRole } from '../auth';
import { Card, Empty, ErrorBox, fmtMoney, Loading, PageHeader, todayIso, useApi } from '../components/ui';
import { Summary, Toolbar } from '../components/kit';

interface Summary {
  from: string;
  to: string;
  branches: { branchId: string; branchName: string; cashIncome: number; accruedSales: number; debt: number; expenses: number; operatingResult: number }[];
  totals: { cashIncome: number; accruedSales: number; debt: number; branchExpenses: number; clubWideExpenses: number; operatingResult: number };
  bySport: { sport: string; accruedSales: number; allocatedCash: number }[];
}

interface AttendanceReport {
  rows: { athleteId: string; fullName: string; groupName: string; present: number; absent: number; excused: number; total: number; rate: number | null }[];
  totals: { present: number; total: number; rate: number | null };
}

export default function ReportsPage() {
  const role = useRole();
  const isStaff = role === 'owner' || role === 'branch_admin';
  const [params, setParams] = useSearchParams();
  const tab = isStaff ? (params.get('tab') ?? 'finance') : 'attendance';
  const [from, setFrom] = useState(todayIso().slice(0, 8) + '01');
  const [to, setTo] = useState(todayIso());

  return (
    <>
      <PageHeader title="Hisobotlar" />
      {isStaff && (
        <div className="tabs" role="tablist">
          {[
            ['finance', 'Moliya'],
            ['attendance', 'Davomat'],
          ].map(([k, l]) => (
            <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'active' : ''} onClick={() => setParams({ tab: k })}>
              {l}
            </button>
          ))}
        </div>
      )}
      <Toolbar>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Dan" />
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Gacha" />
      </Toolbar>
      {tab === 'finance' ? <FinanceReport from={from} to={to} /> : <AttendanceReportView from={from} to={to} />}
    </>
  );
}

function FinanceReport({ from, to }: { from: string; to: string }) {
  const { data, error } = useApi<Summary>(`/reports/summary?from=${from}&to=${to}`);
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  const t = data.totals;
  return (
    <>
      <Summary
        items={[
          { label: 'Tushum', value: fmtMoney(t.cashIncome) },
          { label: 'Hisoblangan sotuv', value: fmtMoney(t.accruedSales) },
          { label: 'Joriy qarzdorlik', value: fmtMoney(t.debt), tone: t.debt ? 'red' : undefined },
          { label: 'Xarajatlar', value: fmtMoney(t.branchExpenses + t.clubWideExpenses) },
          { label: 'Operatsion natija', value: fmtMoney(t.operatingResult), tone: t.operatingResult < 0 ? 'red' : undefined },
        ]}
      />
      <p className="muted small">
        Naqd tushum — davrda haqiqatda qabul qilingan pul (storno ayirilgan). Hisoblangan sotuv — muddati shu davrga to‘g‘ri keladigan hisoblar.
        Ular bir xil ko‘rsatkich emas.
      </p>
      <Card title="Filiallar kesimida">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Filial</th>
                <th className="num">Naqd tushum</th>
                <th className="num">Hisoblangan</th>
                <th className="num">Qarzdorlik</th>
                <th className="num">Xarajat</th>
                <th className="num">Natija</th>
              </tr>
            </thead>
            <tbody>
              {data.branches.map((b) => (
                <tr key={b.branchId}>
                  <td>{b.branchName}</td>
                  <td className="num">{fmtMoney(b.cashIncome)}</td>
                  <td className="num">{fmtMoney(b.accruedSales)}</td>
                  <td className="num debt">{fmtMoney(b.debt)}</td>
                  <td className="num">{fmtMoney(b.expenses)}</td>
                  <td className={`num ${b.operatingResult < 0 ? 'debt' : ''}`}>{fmtMoney(b.operatingResult)}</td>
                </tr>
              ))}
              {t.clubWideExpenses > 0 && (
                <tr>
                  <td className="muted">Umumklub xarajatlari</td>
                  <td />
                  <td />
                  <td />
                  <td className="num">{fmtMoney(t.clubWideExpenses)}</td>
                  <td className="num debt">−{fmtMoney(t.clubWideExpenses)}</td>
                </tr>
              )}
              <tr className="total-row">
                <td>Jami</td>
                <td className="num">{fmtMoney(t.cashIncome)}</td>
                <td className="num">{fmtMoney(t.accruedSales)}</td>
                <td className="num">{fmtMoney(t.debt)}</td>
                <td className="num">{fmtMoney(t.branchExpenses + t.clubWideExpenses)}</td>
                <td className="num">{fmtMoney(t.operatingResult)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>
      <Card title="Sport yo‘nalishlari kesimida">
        {!data.bySport.length ? (
          <Empty>Ma’lumot yo‘q</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Sport</th>
                  <th className="num">Hisoblangan sotuv</th>
                  <th className="num">Hisoblarga tushgan naqd</th>
                </tr>
              </thead>
              <tbody>
                {data.bySport.map((s) => (
                  <tr key={s.sport}>
                    <td>{s.sport === '—' ? 'Umumiy tariflar / boshqa' : s.sport}</td>
                    <td className="num">{fmtMoney(s.accruedSales)}</td>
                    <td className="num">{fmtMoney(s.allocatedCash)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

function AttendanceReportView({ from, to }: { from: string; to: string }) {
  const { data, error } = useApi<AttendanceReport>(`/reports/attendance?from=${from}&to=${to}`);
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  if (!data.rows.length) return <Empty>Bu davrda davomat yo‘q</Empty>;
  return (
    <>
      <p className="muted">
        Umumiy qatnashish: <strong>{data.totals.rate ?? '—'}%</strong> ({data.totals.present}/{data.totals.total})
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Guruh</th>
              <th>Sportchi</th>
              <th className="num">Keldi</th>
              <th className="num">Kelmadi</th>
              <th className="num">Sababli</th>
              <th className="num">%</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={`${r.groupName}-${r.athleteId}`}>
                <td>{r.groupName}</td>
                <td>
                  <Link to={`/athletes/${r.athleteId}`}>{r.fullName}</Link>
                </td>
                <td className="num">{r.present}</td>
                <td className={`num ${r.absent ? 'debt' : ''}`}>{r.absent}</td>
                <td className="num">{r.excused}</td>
                <td className="num">{r.rate ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

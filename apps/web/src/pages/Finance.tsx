/** Moliya: debtors & charges, payments journal, cash desk, expenses (PRD §6, §9, §11). */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { post } from '../api';
import { useRole } from '../auth';
import {
  Badge,
  Card,
  Empty,
  ErrorBox,
  errorText,
  Field,
  fmtDate,
  fmtDateTime,
  fmtMoney,
  Form,
  Loading,
  METHOD_LABEL,
  Modal,
  PageHeader,
  StatusBadge,
  todayIso,
  useApi,
} from '../components/ui';
import { Icon, LIST_CAP, MoneyInput, norm, Pager, paginate, Person, SearchInput, Select, Summary, Toolbar, useDialogs, usePage, useUrlFilters } from '../components/kit';
import type { Branch } from '../types';

const monthStart = () => todayIso().slice(0, 8) + '01';
const methodHint = (m: Record<string, number>) =>
  Object.entries(m)
    .filter(([k, v]) => k !== 'cash' && v)
    .map(([k, v]) => `${METHOD_LABEL[k] ?? k}: ${fmtMoney(v)}`)
    .join(' · ') || undefined;
const useBranches = () => useApi<Branch[]>('/branches').data ?? [];
const branchOptions = (b: Branch[]) => b.map((x) => ({ value: x.id, label: x.name }));

// ---------------- Debtors & charges ----------------
const DEBT_TABS = [
  { key: 'debtors', label: 'Qarzdorlar' },
  { key: 'upcoming', label: 'Muddati yaqin (3 kun)' },
  { key: 'overdue', label: 'Muddati o‘tgan hisoblar' },
  { key: 'paid', label: 'To‘langan' },
];

interface ChargeRow {
  id: string;
  athleteId: string;
  athleteName: string;
  branchId: string;
  description: string;
  dueDate: string;
  amount: number;
  paidAmount: number;
  outstanding: number;
  status: string;
  daysOverdue: number;
}
interface DebtorRow {
  id: string;
  fullName: string;
  branchId: string;
  debt: number;
  oldestDue: string | null;
  daysOverdue: number;
}

export function DebtorsPage() {
  const f = useUrlFilters(['tab', 'q', 'branch', 'age'] as const);
  const tab = f.values.tab || 'debtors';
  const branches = useBranches();
  const debtors = useApi<DebtorRow[]>('/charges/debtors');
  return (
    <>
      <PageHeader title="Qarzdorlik" />
      {debtors.data && <DebtSummary rows={debtors.data} onPick={(age) => (f.set('tab', ''), f.set('age', age))} />}
      <div className="tabs" role="tablist">
        {DEBT_TABS.map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} className={tab === t.key ? 'active' : ''} onClick={() => f.set('tab', t.key === 'debtors' ? '' : t.key)}>
            {t.label}
          </button>
        ))}
      </div>
      <Toolbar active={['q', 'branch', 'age'].filter((k) => f.values[k as 'q']).length} onClear={() => (f.set('q', ''), f.set('branch', ''), f.set('age', ''))}>
        <SearchInput value={f.values.q} onChange={(v) => f.set('q', v)} placeholder="Sportchi ismi" />
        {branches.length > 1 && <Select label="Barcha filiallar" value={f.values.branch} onChange={(v) => f.set('branch', v)} options={branchOptions(branches)} />}
        {tab === 'debtors' && (
          <Select
            label="Kechikish: barchasi"
            value={f.values.age}
            onChange={(v) => f.set('age', v)}
            options={[
              { value: '0', label: 'Muddati kelmagan' },
              { value: '1', label: '1–7 kun' },
              { value: '8', label: '8–30 kun' },
              { value: '31', label: '30+ kun' },
            ]}
          />
        )}
      </Toolbar>
      {tab === 'debtors' ? (
        <DebtorsList data={debtors.data} error={debtors.error} q={f.values.q} branch={f.values.branch} age={f.values.age} branches={branches} />
      ) : (
        <ChargesList view={tab} q={f.values.q} branch={f.values.branch} />
      )}
    </>
  );
}

const ageBucket = (d: number) => (d <= 0 ? '0' : d <= 7 ? '1' : d <= 30 ? '8' : '31');

function DebtSummary({ rows, onPick }: { rows: DebtorRow[]; onPick: (age: string) => void }) {
  const sum = (xs: DebtorRow[]) => xs.reduce((a, d) => a + d.debt, 0);
  const b = (k: string) => rows.filter((r) => ageBucket(r.daysOverdue) === k);
  return (
    <Summary
      items={[
        { label: 'Jami qarzdorlik', value: fmtMoney(sum(rows)), tone: sum(rows) ? 'red' : undefined, hint: `${rows.length} kishi` },
        { label: 'Muddati kelmagan', value: fmtMoney(sum(b('0'))), icon: 'clock', tone: 'neutral', hint: `${b('0').length} ta`, onClick: () => onPick('0') },
        { label: '1–7 kun kechikkan', value: fmtMoney(sum(b('1'))), hint: `${b('1').length} kishi`, onClick: () => onPick('1') },
        { label: '8–30 kun', value: fmtMoney(sum(b('8'))), tone: sum(b('8')) ? 'red' : undefined, hint: `${b('8').length} kishi`, onClick: () => onPick('8') },
        { label: '30 kundan ortiq', value: fmtMoney(sum(b('31'))), tone: sum(b('31')) ? 'red' : undefined, hint: `${b('31').length} kishi`, onClick: () => onPick('31') },
      ]}
    />
  );
}

function DebtorsList({
  data,
  error,
  q,
  branch,
  age,
  branches,
}: {
  data: DebtorRow[] | null;
  error: string | null;
  q: string;
  branch: string;
  age: string;
  branches: Branch[];
}) {
  const rows = useMemo(
    () => (data ?? []).filter((d) => (!q || norm(d.fullName).includes(norm(q))) && (!branch || d.branchId === branch) && (!age || ageBucket(d.daysOverdue) === age)),
    [data, q, branch, age],
  );
  const { page, setPage } = usePage();
  const pg = paginate(rows, page);
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  if (!rows.length) return <Empty>{data.length ? 'Filtrga mos qarzdor yo‘q' : 'Qarzdor yo‘q'}</Empty>;
  const total = rows.reduce((a, d) => a + d.debt, 0);
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Sportchi</th>
            <th>Filial</th>
            <th>Eng eski muddat</th>
            <th>Kechikish</th>
            <th className="num">Qarz</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {pg.items.map((d) => (
            <tr key={d.id}>
              <td>
                <Link to={`/athletes/${d.id}`} className="person-link">
                  <Person name={d.fullName} />
                </Link>
              </td>
              <td>{branches.find((b) => b.id === d.branchId)?.name ?? ''}</td>
              <td>{fmtDate(d.oldestDue)}</td>
              <td className={d.daysOverdue > 7 ? 'debt' : ''}>{d.daysOverdue ? `${d.daysOverdue} kun` : <span className="muted">muddati kelmagan</span>}</td>
              <td className="num debt">{fmtMoney(d.debt)}</td>
              <td>
                <Link className="btn small" to={`/athletes/${d.id}`}>
                  To‘lov olish
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="table-foot">
        <span>{rows.length} ta qarzdor</span>
        <span>
          Jami: <strong className="debt">{fmtMoney(total)}</strong>
        </span>
      </div>
      <Pager page={pg.page} total={rows.length} onPage={setPage} />
    </div>
  );
}

function ChargesList({ view, q, branch }: { view: string; q: string; branch: string }) {
  const { data, error } = useApi<ChargeRow[]>(`/charges?view=${view}&days=3`);
  const rows = useMemo(() => (data ?? []).filter((c) => (!q || norm(c.athleteName).includes(norm(q))) && (!branch || c.branchId === branch)), [data, q, branch]);
  const { page, setPage } = usePage();
  const pg = paginate(rows, page);
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  if (!rows.length) return <Empty>Ro‘yxat bo‘sh</Empty>;
  const out = rows.reduce((a, c) => a + c.outstanding, 0);
  const amt = rows.reduce((a, c) => a + c.amount, 0);
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Sportchi</th>
            <th>Hisob</th>
            <th>Muddat</th>
            <th className="num">Summa</th>
            <th className="num">Qoldiq</th>
            <th>Holat</th>
          </tr>
        </thead>
        <tbody>
          {pg.items.map((c) => (
            <tr key={c.id}>
              <td>
                <Link to={`/athletes/${c.athleteId}`} className="person-link">
                  <Person name={c.athleteName} />
                </Link>
              </td>
              <td>{c.description}</td>
              <td>
                {fmtDate(c.dueDate)} {c.daysOverdue > 0 && <span className="debt small">+{c.daysOverdue} kun</span>}
              </td>
              <td className="num">{fmtMoney(c.amount)}</td>
              <td className={`num ${c.outstanding > 0 ? 'debt' : ''}`}>{fmtMoney(c.outstanding)}</td>
              <td>
                <StatusBadge status={c.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="table-foot">
        <span>{rows.length} ta hisob</span>
        <span>
          Summa: <strong>{fmtMoney(amt)}</strong> · Qoldiq: <strong className={out ? 'debt' : ''}>{fmtMoney(out)}</strong>
        </span>
      </div>
      <Pager page={pg.page} total={rows.length} onPage={setPage} />
    </div>
  );
}

// ---------------- Payments journal ----------------
interface PaymentRow {
  id: string;
  athleteId: string;
  athleteName: string;
  branchId: string;
  amount: number;
  paidAt: string;
  receiptNo: string | null;
  note: string | null;
  method: string;
  cashierName: string | null;
  reversalOfId: string | null;
  reversedById: string | null;
}

export function PaymentsPage() {
  const f = useUrlFilters(['from', 'to', 'q', 'branch', 'cashier', 'kind', 'method'] as const);
  const from = f.values.from || monthStart();
  const to = f.values.to || todayIso();
  const { data, error, reload } = useApi<PaymentRow[]>(`/payments?from=${from}&to=${to}&limit=${LIST_CAP}${f.values.branch ? `&branchId=${f.values.branch}` : ''}`);
  const branches = useBranches();
  const dialogs = useDialogs();

  const cashiers = useMemo(() => [...new Set((data ?? []).map((p) => p.cashierName).filter(Boolean) as string[])].sort(), [data]);
  const rows = useMemo(
    () =>
      (data ?? []).filter((p) => {
        const v = f.values;
        if (v.q && !norm(`${p.athleteName} ${p.receiptNo} ${p.note}`).includes(norm(v.q))) return false;
        if (v.cashier && p.cashierName !== v.cashier) return false;
        if (v.method && p.method !== v.method) return false;
        if (v.kind === 'income' && p.amount < 0) return false;
        if (v.kind === 'storno' && p.amount > 0 && !p.reversedById) return false;
        return true;
      }),
    [data, f.values],
  );
  const { page, setPage } = usePage();
  const pg = paginate(rows, page);
  const income = rows.filter((p) => p.amount > 0).reduce((a, p) => a + p.amount, 0);
  const refunds = Math.abs(rows.filter((p) => p.amount < 0).reduce((a, p) => a + p.amount, 0));
  const count = rows.filter((p) => p.amount > 0).length;
  const cashOnly = rows.filter((p) => p.method === 'cash').reduce((a, p) => a + p.amount, 0);

  const reverse = async (p: PaymentRow) => {
    const reason = await dialogs.prompt({
      title: 'To‘lovni storno qilish',
      message: (
        <>
          {p.athleteName} — <strong>{fmtMoney(p.amount)}</strong> ({p.receiptNo}). To‘lov o‘chirilmaydi: manfiy yozuv yaratiladi va qarzdorlik qayta hisoblanadi.
        </>
      ),
      label: 'Sabab',
      confirmLabel: 'Storno qilish',
      danger: true,
      minLength: 3,
    });
    if (!reason) return;
    try {
      await post(`/payments/${p.id}/reverse`, { reason });
      dialogs.toast('To‘lov storno qilindi');
      reload();
    } catch (e) {
      dialogs.toast(errorText(e), 'error');
    }
  };

  return (
    <>
      <PageHeader title="To‘lovlar" />
      <Summary
        items={[
          { label: 'Kirim', value: fmtMoney(income), icon: 'cash', tone: 'green', hint: `${count} ta to‘lov` },
          { label: 'Storno', value: fmtMoney(refunds) },
          { label: 'Sof tushum', value: fmtMoney(income - refunds), icon: 'wallet', tone: 'blue', hint: `naqd: ${fmtMoney(cashOnly)}` },
        ]}
      />
      <Toolbar count={data ? `${rows.length} ta yozuv` : undefined} active={['q', 'branch', 'cashier', 'kind', 'method'].filter((k) => f.values[k as 'q']).length} onClear={f.clear}>
        <input type="date" value={from} onChange={(e) => f.set('from', e.target.value)} aria-label="Dan" />
        <input type="date" value={to} onChange={(e) => f.set('to', e.target.value)} aria-label="Gacha" />
        <SearchInput value={f.values.q} onChange={(v) => f.set('q', v)} placeholder="Sportchi, kvitansiya, izoh" />
        {branches.length > 1 && <Select label="Barcha filiallar" value={f.values.branch} onChange={(v) => f.set('branch', v)} options={branchOptions(branches)} />}
        <Select label="Barcha kassirlar" value={f.values.cashier} onChange={(v) => f.set('cashier', v)} options={cashiers.map((c) => ({ value: c, label: c }))} />
        <Select label="Barcha usullar" value={f.values.method} onChange={(v) => f.set('method', v)} options={Object.entries(METHOD_LABEL).map(([value, label]) => ({ value, label }))} />
        <Select
          label="Turi: barchasi"
          value={f.values.kind}
          onChange={(v) => f.set('kind', v)}
          options={[
            { value: 'income', label: 'Faqat kirim' },
            { value: 'storno', label: 'Storno' },
          ]}
        />
      </Toolbar>
      <ErrorBox error={error} />
      {data?.length === LIST_CAP && <p className="muted small">Davr juda katta: faqat so‘nggi {LIST_CAP} ta to‘lov olindi. Sanalarni toraytiring.</p>}
      {!data ? (
        <Loading />
      ) : !rows.length ? (
        <Empty>Bu davrda to‘lov yo‘q</Empty>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Vaqt</th>
                <th>Sportchi</th>
                <th>Kvitansiya</th>
                <th>Kassir</th>
                <th>Usul</th>
                <th className="num">Summa</th>
                <th>Izoh</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {pg.items.map((p) => (
                <tr key={p.id} className={p.reversalOfId || p.reversedById ? 'muted' : ''}>
                  <td>{fmtDateTime(p.paidAt)}</td>
                  <td>
                    <Link to={`/athletes/${p.athleteId}`} className="person-link">
                      <Person name={p.athleteName} />
                    </Link>
                  </td>
                  <td>{p.receiptNo ?? '—'}</td>
                  <td>{p.cashierName ?? '—'}</td>
                  <td>
                    {METHOD_LABEL[p.method] ?? p.method}
                  </td>
                  <td className={`num ${p.amount < 0 ? 'debt' : 'ok'}`}>{fmtMoney(p.amount)}</td>
                  <td className="wrap">{p.note ?? ''}</td>
                  <td>
                    {p.amount > 0 && !p.reversedById ? (
                      <button className="btn small ghost danger" onClick={() => reverse(p)}>
                        Storno
                      </button>
                    ) : p.reversedById ? (
                      <span className="muted small">storno qilingan</span>
                    ) : (
                      <span className="muted small">storno</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="table-foot">
            <span>
              {fmtDate(from)} – {fmtDate(to)}
            </span>
            <span>
              Sof tushum: <strong>{fmtMoney(income - refunds)}</strong>
            </span>
          </div>
          <Pager page={pg.page} total={rows.length} onPage={setPage} />
        </div>
      )}
    </>
  );
}

// ---------------- Cash desk ----------------
interface CashReport {
  date: string;
  totals: { income: number; refunds: number; net: number; count: number; cashNet: number; byMethod: Record<string, number> };
  branches: {
    branchId: string;
    branchName: string;
    income: number;
    refunds: number;
    net: number;
    count: number;
    cashNet: number;
    byMethod: Record<string, number>;
    cashiers: { cashierId: string | null; cashierName: string | null; income: number; refunds: number; net: number; count: number; cashNet: number; byMethod: Record<string, number> }[];
    closing: null | { expectedAmount: number; countedAmount: number; difference: number; note: string | null };
  }[];
}

const shiftDay = (d: string, n: number) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};

export function CashPage() {
  const f = useUrlFilters(['date'] as const);
  const date = f.values.date || todayIso();
  const { data, error, reload } = useApi<CashReport>(`/cash/report?date=${date}`);
  const closings = useApi<
    { id: string; branchName: string; date: string; expectedAmount: number; countedAmount: number; difference: number; closedByName: string | null; note: string | null }[]
  >('/cash/closings');
  const [closing, setClosing] = useState<CashReport['branches'][number] | null>(null);
  const [closingsPage, setClosingsPage] = useState(1);
  const closingsPg = paginate(closings.data ?? [], closingsPage);
  const openBranches = data?.branches.filter((b) => !b.closing).length ?? 0;

  return (
    <>
      <PageHeader title="Kassa" />
      <Toolbar>
        <button className="btn" onClick={() => f.set('date', shiftDay(date, -1))} aria-label="Oldingi kun">
          ‹
        </button>
        <input type="date" value={date} max={todayIso()} onChange={(e) => f.set('date', e.target.value)} aria-label="Sana" />
        <button className="btn" disabled={date >= todayIso()} onClick={() => f.set('date', shiftDay(date, 1))} aria-label="Keyingi kun">
          ›
        </button>
        {date !== todayIso() && (
          <button className="btn ghost" onClick={() => f.set('date', '')}>
            Bugun
          </button>
        )}
      </Toolbar>
      <ErrorBox error={error} />
      {!data ? (
        <Loading />
      ) : (
        <>
          <Summary
            items={[
              { label: 'Kirim', value: fmtMoney(data.totals.income), icon: 'cash', tone: 'green', hint: `${data.totals.count} ta to‘lov` },
              { label: 'Qaytarish (storno)', value: fmtMoney(data.totals.refunds) },
              { label: 'Kassada bo‘lishi kerak (naqd)', value: fmtMoney(data.totals.cashNet), icon: 'wallet', tone: 'blue', hint: methodHint(data.totals.byMethod) },
              {
                label: 'Kun yakuni',
                value: openBranches ? `${openBranches} ta filial ochiq` : 'Hammasi yopilgan',
                icon: 'check',
                tone: openBranches ? 'amber' : 'green',
              },
            ]}
          />
          {data.branches.map((b) => (
            <Card
              key={b.branchId}
              title={`${b.branchName} — ${fmtMoney(b.net)}`}
              actions={
                b.closing ? (
                  <Badge tone={b.closing.difference === 0 ? 'green' : 'amber'}>
                    Yopilgan · sanalgan {fmtMoney(b.closing.countedAmount)} · farq {fmtMoney(b.closing.difference)}
                  </Badge>
                ) : (
                  <button className="btn small primary" onClick={() => setClosing(b)}>
                    <Icon name="check" size={14} /> Kunni yopish
                  </button>
                )
              }
            >
              {b.cashiers.length === 0 ? (
                <Empty>Bu kunda to‘lov yo‘q</Empty>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Kassir</th>
                        <th className="num">Soni</th>
                        <th className="num">Kirim</th>
                        <th className="num">Qaytarish</th>
                        <th className="num">Naqd</th>
                        <th className="num">Click / Terminal</th>
                        <th className="num">Sof</th>
                      </tr>
                    </thead>
                    <tbody>
                      {b.cashiers.map((c) => (
                        <tr key={c.cashierId ?? 'none'}>
                          <td>
                            <Person name={c.cashierName ?? '—'} />
                          </td>
                          <td className="num">{c.count}</td>
                          <td className="num">{fmtMoney(c.income)}</td>
                          <td className="num">{c.refunds ? fmtMoney(c.refunds) : '—'}</td>
                          <td className="num">{fmtMoney(c.cashNet)}</td>
                          <td className="num">{fmtMoney(c.net - c.cashNet)}</td>
                          <td className="num">
                            <strong>{fmtMoney(c.net)}</strong>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          ))}
        </>
      )}
      <Card title="Kun yakunlari tarixi">
        {!closings.data ? (
          <Loading />
        ) : !closings.data.length ? (
          <Empty>Hali yopilgan kun yo‘q</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Sana</th>
                  <th>Filial</th>
                  <th className="num">Kutilgan</th>
                  <th className="num">Sanalgan</th>
                  <th className="num">Farq</th>
                  <th>Yopgan</th>
                  <th>Izoh</th>
                </tr>
              </thead>
              <tbody>
                {closingsPg.items.map((c) => (
                  <tr key={c.id}>
                    <td>{fmtDate(c.date)}</td>
                    <td>{c.branchName}</td>
                    <td className="num">{fmtMoney(c.expectedAmount)}</td>
                    <td className="num">{fmtMoney(c.countedAmount)}</td>
                    <td className={`num ${c.difference < 0 ? 'debt' : c.difference > 0 ? 'ok' : ''}`}>{fmtMoney(c.difference)}</td>
                    <td>{c.closedByName ?? '—'}</td>
                    <td>{c.note ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pager page={closingsPg.page} total={closings.data.length} onPage={setClosingsPage} />
          </div>
        )}
      </Card>
      {closing && (
        <Modal title={`Kunni yopish — ${closing.branchName}, ${fmtDate(date)}`} onClose={() => setClosing(null)}>
          <CloseDayForm
            date={date}
            branch={closing}
            onDone={() => {
              setClosing(null);
              reload();
              closings.reload();
            }}
          />
        </Modal>
      )}
    </>
  );
}

function CloseDayForm({ date, branch, onDone }: { date: string; branch: CashReport['branches'][number]; onDone: () => void }) {
  const [counted, setCounted] = useState(String(branch.cashNet));
  const [note, setNote] = useState('');
  const dialogs = useDialogs();
  const diff = Number(counted || 0) - branch.cashNet;
  return (
    <Form
      submitLabel="Yopish"
      onSubmit={async () => {
        await post('/cash/close', { date, branchId: branch.branchId, countedAmount: Number(counted), note: note || null });
        dialogs.toast('Kun yopildi');
        onDone();
      }}
    >
      <p>
        Tizim bo‘yicha kassada bo‘lishi kerak (faqat naqd): <strong>{fmtMoney(branch.cashNet)}</strong>
        {branch.net !== branch.cashNet && <span className="muted small"> · Click/Payme va terminal: {fmtMoney(branch.net - branch.cashNet)} (kassaga kirmaydi)</span>}
      </p>
      <Field label="Sanalgan naqd pul (so‘m) *">
        <MoneyInput value={counted} onChange={setCounted} required autoFocus />
      </Field>
      {diff !== 0 && <div className={`alert ${diff < 0 ? 'error' : 'ok'}`}>Farq: {fmtMoney(diff)}</div>}
      <Field label="Izoh">
        <input value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <p className="muted small">Yopilgandan keyin administrator bu kun uchun to‘lov qo‘sha yoki storno qila olmaydi.</p>
    </Form>
  );
}

// ---------------- Expenses ----------------
export const EXPENSE_LABEL: Record<string, string> = {
  rent: 'Ijara',
  utilities: 'Kommunal',
  salary: 'Ish haqi',
  equipment: 'Sport anjomlari',
  marketing: 'Marketing',
  repair: 'Ta’mir',
  other: 'Boshqa',
};

interface ExpenseRow {
  id: string;
  branchId: string | null;
  branchName: string | null;
  category: string;
  amount: number;
  incurredAt: string;
  note: string | null;
  createdByName: string | null;
}

export function ExpensesPage() {
  const isOwner = useRole() === 'owner';
  const f = useUrlFilters(['from', 'to', 'q', 'branch', 'category'] as const);
  const from = f.values.from || monthStart();
  const to = f.values.to || todayIso();
  const { data, error, reload } = useApi<ExpenseRow[]>(
    `/expenses?from=${from}&to=${to}${f.values.branch && f.values.branch !== 'club' ? `&branchId=${f.values.branch}` : ''}${f.values.category ? `&category=${f.values.category}` : ''}`,
  );
  const branches = useBranches();
  const [creating, setCreating] = useState(false);
  const dialogs = useDialogs();

  const rows = useMemo(
    () => (data ?? []).filter((e) => (!f.values.q || norm(`${e.note} ${e.createdByName}`).includes(norm(f.values.q))) && (f.values.branch !== 'club' || !e.branchId)),
    [data, f.values],
  );
  const { page, setPage } = usePage();
  const pg = paginate(rows, page);
  const total = rows.reduce((a, e) => a + e.amount, 0);
  const byCat = Object.entries(rows.reduce<Record<string, number>>((m, e) => ((m[e.category] = (m[e.category] ?? 0) + e.amount), m), {})).sort((a, b) => b[1] - a[1]);
  const topCat = byCat[0];

  const voidExpense = async (e: ExpenseRow) => {
    const reason = await dialogs.prompt({
      title: 'Xarajatni bekor qilish',
      message: `${EXPENSE_LABEL[e.category]} — ${fmtMoney(e.amount)}. Yozuv o‘chirilmaydi, “bekor qilingan” deb belgilanadi.`,
      label: 'Sabab',
      confirmLabel: 'Bekor qilish',
      danger: true,
      minLength: 3,
    });
    if (!reason) return;
    try {
      await post(`/expenses/${e.id}/void`, { reason });
      dialogs.toast('Xarajat bekor qilindi');
      reload();
    } catch (x) {
      dialogs.toast(errorText(x), 'error');
    }
  };

  return (
    <>
      <PageHeader
        title="Xarajatlar"
        actions={
          <button className="btn primary" onClick={() => setCreating(true)}>
            <Icon name="plus" size={16} /> Xarajat
          </button>
        }
      />
      <Summary
        items={[
          { label: 'Jami xarajat', value: fmtMoney(total), hint: `${rows.length} ta yozuv` },
          { label: 'Eng katta toifa', value: topCat ? EXPENSE_LABEL[topCat[0]] : '—', icon: 'tag', tone: 'amber', hint: topCat ? fmtMoney(topCat[1]) : undefined },
          { label: 'Umumklub', value: fmtMoney(rows.filter((e) => !e.branchId).reduce((a, e) => a + e.amount, 0)), icon: 'building', tone: 'neutral' },
        ]}
      />
      <Toolbar count={data ? `${rows.length} ta yozuv` : undefined} active={['q', 'branch', 'category'].filter((k) => f.values[k as 'q']).length} onClear={f.clear}>
        <input type="date" value={from} onChange={(e) => f.set('from', e.target.value)} aria-label="Dan" />
        <input type="date" value={to} onChange={(e) => f.set('to', e.target.value)} aria-label="Gacha" />
        <SearchInput value={f.values.q} onChange={(v) => f.set('q', v)} placeholder="Izoh yoki kiritgan" />
        <Select
          label="Barcha filiallar"
          value={f.values.branch}
          onChange={(v) => f.set('branch', v)}
          options={[...branchOptions(branches), ...(isOwner ? [{ value: 'club', label: 'Faqat umumklub' }] : [])]}
        />
        <Select label="Barcha toifalar" value={f.values.category} onChange={(v) => f.set('category', v)} options={Object.entries(EXPENSE_LABEL).map(([value, label]) => ({ value, label }))} />
      </Toolbar>
      <ErrorBox error={error} />
      {!data ? (
        <Loading />
      ) : !rows.length ? (
        <Empty>Bu davrda xarajat yo‘q</Empty>
      ) : (
        <div className="dash-grid">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Sana</th>
                  <th>Toifa</th>
                  <th>Filial</th>
                  <th className="num">Summa</th>
                  <th>Izoh</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {pg.items.map((e) => (
                  <tr key={e.id}>
                    <td>{fmtDate(e.incurredAt)}</td>
                    <td>{EXPENSE_LABEL[e.category] ?? e.category}</td>
                    <td>{e.branchName ?? <span className="muted">umumklub</span>}</td>
                    <td className="num">{fmtMoney(e.amount)}</td>
                    <td className="wrap">
                      {e.note ?? ''}
                      {e.createdByName && <div className="muted small">{e.createdByName}</div>}
                    </td>
                    <td>
                      <button className="btn small ghost danger" onClick={() => voidExpense(e)}>
                        Bekor
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="table-foot">
              <span>{rows.length} ta</span>
              <span>
                Jami: <strong>{fmtMoney(total)}</strong>
              </span>
            </div>
            <Pager page={pg.page} total={rows.length} onPage={setPage} />
          </div>
          <Card title="Toifalar bo‘yicha">
            <div className="cat-bars">
              {byCat.map(([cat, v]) => (
                <div key={cat} className="cat-row">
                  <span>{EXPENSE_LABEL[cat] ?? cat}</span>
                  <span className="cat-track">
                    <span className="cat-fill" style={{ width: `${Math.max(2, (v / byCat[0][1]) * 100)}%`, display: 'block' }} />
                  </span>
                  <span className="small">
                    <strong>{fmtMoney(v)}</strong> <span className="muted">{Math.round((v / total) * 100)}%</span>
                  </span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}
      {creating && (
        <Modal title="Yangi xarajat" onClose={() => setCreating(false)}>
          <ExpenseForm
            branches={branches}
            isOwner={isOwner}
            onDone={() => {
              setCreating(false);
              dialogs.toast('Xarajat qo‘shildi');
              reload();
            }}
          />
        </Modal>
      )}
    </>
  );
}

function ExpenseForm({ branches, isOwner, onDone }: { branches: Branch[]; isOwner: boolean; onDone: () => void }) {
  const [f, setF] = useState({ branchId: branches[0]?.id ?? '', category: 'rent', amount: '', incurredAt: todayIso(), note: '' });
  return (
    <Form
      onSubmit={async () => {
        await post('/expenses', { ...f, branchId: f.branchId || null, amount: Number(f.amount), note: f.note || null });
        onDone();
      }}
    >
      <div className="grid2">
        <Field label="Filial">
          <select value={f.branchId} onChange={(e) => setF({ ...f, branchId: e.target.value })}>
            {isOwner && <option value="">Umumklub</option>}
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Toifa">
          <select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
            {Object.entries(EXPENSE_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Summa (so‘m) *">
          <MoneyInput value={f.amount} onChange={(amount) => setF({ ...f, amount })} min={1} required autoFocus />
        </Field>
        <Field label="Sana">
          <input type="date" value={f.incurredAt} onChange={(e) => setF({ ...f, incurredAt: e.target.value })} required />
        </Field>
      </div>
      <Field label="Izoh">
        <input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
      </Field>
    </Form>
  );
}

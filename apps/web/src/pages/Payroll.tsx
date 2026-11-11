/** Murabbiylar ish haqi: rules, monthly calculation, close, pay, corrections (owner). */
import { useState } from 'react';
import { patch, post } from '../api';
import {
  Badge,
  Card,
  Empty,
  ErrorBox,
  errorText,
  Field,
  fmtDate,
  fmtMoney,
  Form,
  Loading,
  Modal,
  monthRange,
  PageHeader,
  todayIso,
  useApi,
} from '../components/ui';
import { MoneyInput, useDialogs } from '../components/kit';
import type { Branch, Coach } from '../types';

interface Entry {
  id: string;
  coachId: string;
  coachName: string;
  periodStart: string;
  periodEnd: string;
  accrued: number;
  bonus: number;
  deduction: number;
  paid: number;
  total: number;
  due: number;
  closedAt: string | null;
  correctionOfId: string | null;
  note: string | null;
  details: null | { lines: { model: string; base: number; amount: number }[]; byBranch: Record<string, number> };
}

interface Rule {
  id: string;
  coachId: string;
  model: 'fixed_monthly' | 'revenue_percent' | 'per_session';
  fixedAmount: number | null;
  percentBp: number | null;
  perSessionAmount: number | null;
  validFrom: string;
  validTo: string | null;
}

const MODEL_LABEL = { fixed_monthly: 'Qat’iy oylik', revenue_percent: 'Tushumdan foiz', per_session: 'Dars uchun stavka' };

export default function PayrollPage() {
  const dialogs = useDialogs();
  const [month, setMonth] = useState(todayIso().slice(0, 7));
  const { from, to } = monthRange(`${month}-01`);
  const entries = useApi<Entry[]>(`/payroll?periodStart=${from}&periodEnd=${to}`);
  const rules = useApi<Rule[]>('/payroll/rules');
  const coaches = useApi<Coach[]>('/coaches').data ?? [];
  const branches = useApi<Branch[]>('/branches').data ?? [];
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ruleFor, setRuleFor] = useState<string | null>(null);
  const [payEntry, setPayEntry] = useState<Entry | null>(null);
  const bName = (id: string) => branches.find((b) => b.id === id)?.name ?? (id === 'unassigned' ? 'Taqsimlanmagan' : id);
  const cName = (id: string) => coaches.find((c) => c.id === id)?.fullName ?? '—';

  const act = async (fn: () => Promise<unknown>) => {
    setErr(null);
    try {
      await fn();
      entries.reload();
    } catch (e) {
      setErr(errorText(e));
    }
  };

  const ruleText = (r: Rule) =>
    r.model === 'fixed_monthly'
      ? fmtMoney(r.fixedAmount)
      : r.model === 'per_session'
        ? `${fmtMoney(r.perSessionAmount)} / dars`
        : `${(r.percentBp ?? 0) / 100}% tushumdan`;

  return (
    <>
      <PageHeader
        title="Murabbiylar ish haqi"
        actions={
          <button
            className="btn primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await act(() => post('/payroll/calculate', { periodStart: from, periodEnd: to }));
              setBusy(false);
            }}
          >
            {busy ? 'Hisoblanmoqda…' : 'Hisoblash'}
          </button>
        }
      />
      <div className="filters">
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Oy" />
      </div>
      <ErrorBox error={err ?? entries.error} />

      <Card title={`Hisob-kitob: ${fmtDate(from)} – ${fmtDate(to)}`}>
        {!entries.data ? (
          <Loading />
        ) : !entries.data.length ? (
          <Empty>Bu oy uchun hisob yo‘q. Qoidalarni kiriting va “Hisoblash” ni bosing.</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Murabbiy</th>
                  <th className="num">Hisoblangan</th>
                  <th className="num">Bonus</th>
                  <th className="num">Ushlanma</th>
                  <th className="num">Jami</th>
                  <th className="num">To‘langan</th>
                  <th className="num">Qoldiq</th>
                  <th>Holat</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {entries.data.map((e) => (
                  <tr key={e.id}>
                    <td>
                      {e.coachName} {e.correctionOfId && <Badge tone="blue">tuzatish</Badge>}
                      {e.details?.lines?.length ? (
                        <div className="muted small">
                          {e.details.lines.map((l) => `${MODEL_LABEL[l.model as keyof typeof MODEL_LABEL]}: ${fmtMoney(l.amount)}`).join(' · ')}
                          <br />
                          {Object.entries(e.details.byBranch)
                            .map(([b, v]) => `${bName(b)}: ${fmtMoney(v)}`)
                            .join(' · ')}
                        </div>
                      ) : e.note ? (
                        <div className="muted small">{e.note}</div>
                      ) : null}
                    </td>
                    <td className="num">{fmtMoney(e.accrued)}</td>
                    <td className="num">{e.bonus ? fmtMoney(e.bonus) : '—'}</td>
                    <td className="num">{e.deduction ? fmtMoney(e.deduction) : '—'}</td>
                    <td className="num">
                      <strong>{fmtMoney(e.total)}</strong>
                    </td>
                    <td className="num">{fmtMoney(e.paid)}</td>
                    <td className={`num ${e.due > 0 ? 'debt' : ''}`}>{fmtMoney(e.due)}</td>
                    <td>{e.closedAt ? <Badge tone="green">yopilgan</Badge> : <Badge tone="amber">ochiq</Badge>}</td>
                    <td>
                      <span className="row-actions" style={{ marginTop: 0 }}>
                        {!e.closedAt && (
                          <>
                            <button
                              className="btn small ghost"
                              onClick={async () => {
                                const bonus = await dialogs.prompt({ title: `${e.coachName}: bonus`, label: 'Bonus (so‘m)', type: 'number', initial: String(e.bonus) });
                                if (bonus === null) return;
                                const deduction = await dialogs.prompt({ title: `${e.coachName}: ushlanma`, label: 'Ushlanma (so‘m)', type: 'number', initial: String(e.deduction) });
                                if (deduction === null) return;
                                act(() => patch(`/payroll/${e.id}`, { bonus: Number(bonus), deduction: Number(deduction) }));
                              }}
                            >
                              Bonus/ushlanma
                            </button>
                            <button
                              className="btn small ghost"
                              onClick={async () => (await dialogs.confirm({ title: 'Davrni yopish', message: 'Yopilgandan keyin faqat alohida tuzatish yozuvi bilan o‘zgartiriladi.', confirmLabel: 'Yopish' })) && act(() => post(`/payroll/${e.id}/close`))}
                            >
                              Yopish
                            </button>
                          </>
                        )}
                        {e.closedAt && !e.correctionOfId && (
                          <button
                            className="btn small ghost"
                            onClick={async () => {
                              const amount = await dialogs.prompt({ title: 'Tuzatish yozuvi', label: 'Summa (so‘m, manfiy — ushlanma)', type: 'number' });
                              if (!amount) return;
                              const note = await dialogs.prompt({ title: 'Tuzatish yozuvi', label: 'Sabab', minLength: 3 });
                              if (!note) return;
                              act(() => post(`/payroll/${e.id}/correction`, { amount: Number(amount), note }));
                            }}
                          >
                            Tuzatish
                          </button>
                        )}
                        {e.due > 0 && (
                          <button className="btn small primary" onClick={() => setPayEntry(e)}>
                            To‘lash
                          </button>
                        )}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Haq qoidalari">
        {!rules.data ? (
          <Loading />
        ) : (
          <ul className="list">
            {coaches.map((c) => {
              const rs = rules.data!.filter((r) => r.coachId === c.id);
              return (
                <li key={c.id}>
                  <div className="row-between">
                    <strong>{c.fullName}</strong>
                    <button className="btn small" onClick={() => setRuleFor(c.id)}>
                      + Qoida
                    </button>
                  </div>
                  {rs.length === 0 ? (
                    <div className="muted small">Qoida kiritilmagan</div>
                  ) : (
                    rs.map((r) => (
                      <div key={r.id} className="muted small">
                        {MODEL_LABEL[r.model]}: <strong>{ruleText(r)}</strong> · {fmtDate(r.validFrom)} – {r.validTo ? fmtDate(r.validTo) : 'hozirgacha'}
                      </div>
                    ))
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <p className="muted small">
          Foiz — haqiqiy naqd tushumdan (storno ayirilgan), murabbiy guruhlaridagi sportchilar abonementlari bo‘yicha. Bir necha filialda
          ishlasa, summa o‘tilgan darslar ulushi bo‘yicha filiallarga taqsimlanadi.
        </p>
      </Card>

      {ruleFor && (
        <Modal title={`Yangi qoida — ${cName(ruleFor)}`} onClose={() => setRuleFor(null)}>
          <RuleForm
            coachId={ruleFor}
            onDone={() => {
              setRuleFor(null);
              rules.reload();
            }}
          />
        </Modal>
      )}
      {payEntry && (
        <Modal title={`Ish haqi to‘lash — ${payEntry.coachName}`} onClose={() => setPayEntry(null)}>
          <PayForm
            entry={payEntry}
            branches={branches}
            onDone={() => {
              setPayEntry(null);
              entries.reload();
            }}
          />
        </Modal>
      )}
    </>
  );
}

function RuleForm({ coachId, onDone }: { coachId: string; onDone: () => void }) {
  const [f, setF] = useState({ model: 'fixed_monthly' as Rule['model'], value: '', validFrom: todayIso().slice(0, 8) + '01' });
  return (
    <Form
      onSubmit={async () => {
        const v = Number(f.value);
        await post('/payroll/rules', {
          coachId,
          model: f.model,
          validFrom: f.validFrom,
          fixedAmount: f.model === 'fixed_monthly' ? v : null,
          perSessionAmount: f.model === 'per_session' ? v : null,
          percentBp: f.model === 'revenue_percent' ? Math.round(v * 100) : null,
        });
        onDone();
      }}
    >
      <Field label="Model">
        <select value={f.model} onChange={(e) => setF({ ...f, model: e.target.value as Rule['model'] })}>
          {Object.entries(MODEL_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </Field>
      <Field label={f.model === 'revenue_percent' ? 'Foiz (%) *' : f.model === 'per_session' ? 'Bir dars uchun (so‘m) *' : 'Oylik summa (so‘m) *'}>
        {f.model === 'revenue_percent' ? (
          <input type="number" min={0} max={100} step="any" value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} required autoFocus />
        ) : (
          <MoneyInput value={f.value} onChange={(value) => setF({ ...f, value })} required autoFocus />
        )}
      </Field>
      <Field label="Amal qilish boshlanishi" hint="Shu turdagi avvalgi ochiq qoida bir kun oldin yopiladi">
        <input type="date" value={f.validFrom} onChange={(e) => setF({ ...f, validFrom: e.target.value })} required />
      </Field>
    </Form>
  );
}

function PayForm({ entry, branches, onDone }: { entry: Entry; branches: Branch[]; onDone: () => void }) {
  const [amount, setAmount] = useState(String(entry.due));
  const [branchId, setBranchId] = useState('');
  return (
    <Form
      submitLabel="To‘lash"
      onSubmit={async () => {
        await post(`/payroll/${entry.id}/pay`, { amount: Number(amount), branchId: branchId || null, date: todayIso() });
        onDone();
      }}
    >
      <Field label="Summa (so‘m)" hint={`Qoldiq: ${fmtMoney(entry.due)}`}>
        <MoneyInput value={amount} onChange={setAmount} min={1} max={entry.due} required />
      </Field>
      <Field label="Xarajat filiali" hint="Xarajatlar va operatsion natijaga yoziladi">
        <select value={branchId} onChange={(e) => setBranchId(e.target.value)}>
          <option value="">Umumklub</option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </Field>
    </Form>
  );
}

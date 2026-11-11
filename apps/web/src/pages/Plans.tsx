import { useMemo, useState } from 'react';
import { patch, post } from '../api';
import { useRole } from '../auth';
import { BILLING_LABEL, Empty, ErrorBox, Field, fmtMoney, Form, Loading, Modal, PageHeader, useApi } from '../components/ui';
import { Icon, MoneyInput, norm, SearchInput, Select, Toolbar, useDialogs, useUrlFilters } from '../components/kit';
import type { Branch, Plan, Sport } from '../types';

const KIND_LABEL = { group: 'Guruh', single: 'Bir martalik', individual: 'Individual' };

export default function PlansPage() {
  const isOwner = useRole() === 'owner';
  const { data, error, reload } = useApi<Plan[]>('/plans');
  const sports = useApi<Sport[]>('/sports').data ?? [];
  const active = useApi<{ planName: string }[]>('/subscriptions?status=active').data ?? [];
  const [edit, setEdit] = useState<Plan | 'new' | null>(null);
  const f = useUrlFilters(['q', 'model', 'state'] as const);
  const dialogs = useDialogs();
  const sportName = (id: string | null) => (id ? sports.find((s) => s.id === id)?.name : 'Barchasi');
  const usage = useMemo(() => active.reduce<Record<string, number>>((m, s) => ((m[s.planName] = (m[s.planName] ?? 0) + 1), m), {}), [active]);

  const rows = useMemo(
    () =>
      (data ?? []).filter((p) => {
        const v = f.values;
        if (v.q && !norm(p.name).includes(norm(v.q))) return false;
        if (v.model && p.billingType !== v.model) return false;
        if (v.state === 'active' && !p.active) return false;
        if (v.state === 'inactive' && p.active) return false;
        return true;
      }),
    [data, f.values],
  );

  const terms = (p: Plan) =>
    p.billingType === 'fixed_days'
      ? `${p.durationDays ?? 30} kun`
      : p.billingType === 'session_pack'
        ? `${p.sessionLimit} dars${p.maxValidityDays ? `, ${p.maxValidityDays} kun ichida` : ''}`
        : 'oy oxirigacha';

  return (
    <>
      <PageHeader
        title="Tariflar"
        actions={
          isOwner && (
            <button className="btn primary" onClick={() => setEdit('new')}>
              <Icon name="plus" size={16} /> Tarif
            </button>
          )
        }
      />
      <Toolbar count={data ? `${rows.length} ta` : undefined} active={f.active} onClear={f.clear}>
        <SearchInput value={f.values.q} onChange={(v) => f.set('q', v)} placeholder="Tarif nomi" />
        <Select label="Barcha modellar" value={f.values.model} onChange={(v) => f.set('model', v)} options={Object.entries(BILLING_LABEL).map(([value, label]) => ({ value, label }))} />
        <Select
          label="Holat: barchasi"
          value={f.values.state}
          onChange={(v) => f.set('state', v)}
          options={[
            { value: 'active', label: 'Faol' },
            { value: 'inactive', label: 'Nofaol' },
          ]}
        />
      </Toolbar>
      <ErrorBox error={error} />
      {!data ? (
        <Loading />
      ) : rows.length === 0 ? (
        <Empty>{data.length ? 'Filtrga mos tarif yo‘q' : 'Hali tarif yo‘q'}</Empty>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Tarif</th>
                <th>Model</th>
                <th>Shartlar</th>
                <th>Sport</th>
                <th className="num">Narx</th>
                <th className="num">Faol abonementlar</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className={p.active ? '' : 'muted'}>
                  <td>
                    <span className="person-name">{p.name}</span>
                    {p.kind !== 'group' && <span className="muted"> · {KIND_LABEL[p.kind]}</span>}
                    {!p.active && <span className="muted"> · nofaol</span>}
                  </td>
                  <td>{BILLING_LABEL[p.billingType]}</td>
                  <td>{terms(p)}</td>
                  <td>{sportName(p.sportId)}</td>
                  <td className="num">{fmtMoney(p.price)}</td>
                  <td className="num">{usage[p.name] ?? 0}</td>
                  <td>
                    {isOwner && (
                      <button className="btn small ghost" onClick={() => setEdit(p)}>
                        Tahrirlash
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {edit && (
        <PlanModal
          plan={edit === 'new' ? undefined : edit}
          sports={sports}
          onClose={() => setEdit(null)}
          onDone={() => {
            setEdit(null);
            dialogs.toast('Tarif saqlandi');
            reload();
          }}
        />
      )}
    </>
  );
}

function PlanModal({ plan, sports, onClose, onDone }: { plan?: Plan; sports: Sport[]; onClose: () => void; onDone: () => void }) {
  const branches = useApi<Branch[]>('/branches').data ?? [];
  const [f, setF] = useState({
    name: plan?.name ?? '',
    kind: plan?.kind ?? 'group',
    billingType: plan?.billingType ?? 'calendar_month',
    price: plan?.price?.toString() ?? '',
    sportId: plan?.sportId ?? '',
    durationDays: plan?.durationDays?.toString() ?? '30',
    sessionLimit: plan?.sessionLimit?.toString() ?? '12',
    maxValidityDays: plan?.maxValidityDays?.toString() ?? '',
    branchIds: plan?.branchIds ?? [],
    active: plan?.active ?? true,
  });
  const n = (v: string) => (v === '' ? null : Number(v));
  return (
    <Modal title={plan ? 'Tarifni tahrirlash' : 'Yangi tarif'} onClose={onClose}>
      <Form
        onSubmit={async () => {
          const body = {
            name: f.name,
            kind: f.kind,
            billingType: f.billingType,
            price: Number(f.price),
            sportId: f.sportId || null,
            durationDays: f.billingType === 'fixed_days' ? n(f.durationDays) : null,
            sessionLimit: f.billingType === 'session_pack' ? n(f.sessionLimit) : null,
            maxValidityDays: f.billingType === 'session_pack' ? n(f.maxValidityDays) : null,
            branchIds: f.branchIds,
            active: f.active,
          };
          if (plan) await patch(`/plans/${plan.id}`, body);
          else await post('/plans', body);
          onDone();
        }}
      >
        <Field label="Nomi *">
          <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required autoFocus />
        </Field>
        <div className="grid2">
          <Field label="Model *">
            <select value={f.billingType} onChange={(e) => setF({ ...f, billingType: e.target.value as Plan['billingType'] })}>
              <option value="calendar_month">Kalendar oy</option>
              <option value="fixed_days">Kunlik muddat (30 kun)</option>
              <option value="session_pack">Darslar soni</option>
            </select>
          </Field>
          <Field label="Turi">
            <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as Plan['kind'] })}>
              <option value="group">Guruh mashg‘uloti</option>
              <option value="single">Bir martalik dars</option>
              <option value="individual">Individual mashg‘ulot</option>
            </select>
          </Field>
          <Field label="Narx (so‘m) *">
            <MoneyInput value={f.price} onChange={(price) => setF({ ...f, price })} required />
          </Field>
          <Field label="Sport turi">
            <select value={f.sportId} onChange={(e) => setF({ ...f, sportId: e.target.value })}>
              <option value="">Barcha</option>
              {sports.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          {f.billingType === 'fixed_days' && (
            <Field label="Muddat (kun)">
              <input type="number" min={1} value={f.durationDays} onChange={(e) => setF({ ...f, durationDays: e.target.value })} />
            </Field>
          )}
          {f.billingType === 'session_pack' && (
            <>
              <Field label="Darslar soni *">
                <input type="number" min={1} value={f.sessionLimit} onChange={(e) => setF({ ...f, sessionLimit: e.target.value })} required />
              </Field>
              <Field label="Maksimal muddat (kun)">
                <input type="number" min={1} value={f.maxValidityDays} onChange={(e) => setF({ ...f, maxValidityDays: e.target.value })} />
              </Field>
            </>
          )}
        </div>
        <fieldset>
          <legend>Filiallar (bo‘sh — barchasi)</legend>
          {branches.map((b) => (
            <label key={b.id} className="check">
              <input
                type="checkbox"
                checked={f.branchIds.includes(b.id)}
                onChange={(e) =>
                  setF({ ...f, branchIds: e.target.checked ? [...f.branchIds, b.id] : f.branchIds.filter((x) => x !== b.id) })
                }
              />{' '}
              {b.name}
            </label>
          ))}
        </fieldset>
        <label className="check">
          <input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Faol
        </label>
        {plan && <p className="muted small">O‘zgarishlar faqat yangi abonementlarga ta’sir qiladi.</p>}
      </Form>
    </Modal>
  );
}

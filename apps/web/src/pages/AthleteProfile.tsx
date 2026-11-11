import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { del, patch, post } from '../api';
import { useRole } from '../auth';
import {
  ageFrom,
  Badge,
  BILLING_LABEL,
  METHOD_LABEL,
  Card,
  Empty,
  ErrorBox,
  errorText,
  fmtDateTime,
  newKey,
  Field,
  fmtDate,
  fmtMoney,
  Form,
  Loading,
  Modal,
  StatusBadge,
  STATUS_LABEL,
  todayIso,
  useApi,
} from '../components/ui';
import { MoneyInput, useDialogs } from '../components/kit';
import { DocumentsCard, medicalState, type AthleteDocument } from '../components/Documents';
import type { AthleteProfile, Group, Plan, Subscription } from '../types';

type ModalKind = null | 'guardian' | 'enroll' | { move: string } | 'subscription' | { freeze: string } | 'edit' | 'payment' | 'adjust';

export default function AthleteProfilePage() {
  const dialogs = useDialogs();
  const { id } = useParams();
  const role = useRole();
  const isStaff = role === 'owner' || role === 'branch_admin';
  const { data: a, error, reload } = useApi<AthleteProfile>(`/athletes/${id}`);
  const groups = useApi<Group[]>('/groups').data ?? [];
  const docs = useApi<AthleteDocument[]>(`/athletes/${id}/documents`);
  const [modal, setModal] = useState<ModalKind>(null);
  const [finTab, setFinTab] = useState<'charges' | 'payments'>('charges');
  const close = () => setModal(null);
  const done = () => {
    setModal(null);
    reload();
  };

  if (error) return <ErrorBox error={error} />;
  if (!a) return <Loading />;
  const openEnrollments = a.enrollments.filter((e) => e.status !== 'ended');
  const med = docs.data ? medicalState(docs.data) : null;
  const history = a.enrollments.filter((e) => e.status === 'ended');
  const age = ageFrom(a.birthDate);
  const current = a.subscriptions.find((s) => s.status === 'active') ?? a.subscriptions.find((s) => s.status === 'frozen') ?? a.subscriptions[0];
  const mainGroup = openEnrollments.find((e) => e.status === 'active') ?? openEnrollments[0];

  const setEnrollment = async (enrollmentId: string, status: string) => {
    let reason: string | null = null;
    if (status === 'ended') {
      const r = await dialogs.prompt({ title: 'Guruhdan chiqarish', message: 'Tarix saqlanadi.', label: 'Sabab (ixtiyoriy)', required: false, confirmLabel: 'Chiqarish', danger: true });
      if (r === null) return;
      reason = r || null;
    }
    await patch(`/athletes/${a.id}/enrollments/${enrollmentId}`, { status, reason });
    reload();
  };

  return (
    <>
      <nav className="crumbs">
        <Link to="/athletes">Sportchilar</Link>
        <span>/</span>
        <span>{a.fullName}</span>
      </nav>

      <section className="card profile-hero">
        <div className="profile-top">
          <div className="avatar" aria-hidden>
            {initials(a.fullName)}
          </div>
          <div className="profile-id">
            <div className="profile-name">
              <h1>{a.fullName}</h1>
              <StatusBadge status={a.status} />
            </div>
            <div className="profile-meta">
              {age != null && <span>{age} yosh</span>}
              {a.phone && (
                <a href={`tel:${a.phone}`} className="plain-link">
                  {a.phone}
                </a>
              )}
              <span>{fmtDate(a.joinedAt)} dan a’zo</span>
            </div>
          </div>
          {isStaff && (
            <div className="profile-actions">
              <button className="btn" onClick={() => setModal('edit')}>
                Tahrirlash
              </button>
              <button className="btn" onClick={() => setModal('subscription')}>
                + Abonement
              </button>
              {a.balance && (
                <button className="btn primary" onClick={() => setModal('payment')}>
                  To‘lov olish
                </button>
              )}
            </div>
          )}
        </div>

        <div className="profile-stats">
          {a.balance && (
            <div className="pstat">
              <div className="pstat-label">Balans</div>
              {a.balance.debt > 0 ? (
                <div className="pstat-value red">−{fmtMoney(a.balance.debt)}</div>
              ) : a.balance.advance > 0 ? (
                <div className="pstat-value">+{fmtMoney(a.balance.advance)}</div>
              ) : (
                <div className="pstat-value">0 so‘m</div>
              )}
              <div className="pstat-hint">{a.balance.debt > 0 ? 'Qarzdor' : a.balance.advance > 0 ? 'Avans' : 'Qarz yo‘q'}</div>
            </div>
          )}
          <div className="pstat">
            <div className="pstat-label">Abonement</div>
            {current ? (
              <>
                <div className="pstat-value text" title={current.planName}>
                  {current.planName}
                </div>
                <div className="pstat-hint">
                  <SubscriptionLeft s={current} />
                </div>
              </>
            ) : (
              <>
                <div className="pstat-value text muted">Yo‘q</div>
                <div className="pstat-hint">Biriktirilmagan</div>
              </>
            )}
          </div>
          <div className="pstat">
            <div className="pstat-label">Guruh</div>
            {mainGroup ? (
              <>
                <Link to={`/groups/${mainGroup.groupId}`} className="pstat-value text plain-link" title={mainGroup.groupName}>
                  {mainGroup.groupName}
                </Link>
                <div className="pstat-hint">
                  {mainGroup.sportName}
                  {openEnrollments.length > 1 && ` · yana ${openEnrollments.length - 1} ta`}
                </div>
              </>
            ) : (
              <>
                <div className="pstat-value text muted">Yo‘q</div>
                <div className="pstat-hint">Guruhga biriktirilmagan</div>
              </>
            )}
          </div>
          <div className="pstat">
            <div className="pstat-label">086 ma’lumotnoma</div>
            {med ? (
              <>
                <div className={`pstat-value text ${med.tone === 'red' ? 'red' : ''}`}>
                  <span className={`dot ${med.tone}`} />
                  {med.tone === 'green' ? 'Amal qiladi' : med.short}
                </div>
                <div className="pstat-hint">{med.text}</div>
              </>
            ) : (
              <div className="pstat-value text muted">…</div>
            )}
          </div>
        </div>
      </section>

      <div className="cols profile-cols">
        <div className="col">
          <Card
            title="Abonementlar"
            actions={
              isStaff && (
                <button className="btn small" onClick={() => setModal('subscription')}>
                  + Biriktirish
                </button>
              )
            }
          >
            {a.subscriptions.length === 0 ? (
              <Empty>Abonement yo‘q</Empty>
            ) : (
              <ul className="list sub-list">
                {a.subscriptions.map((s) => (
                  <li key={s.id}>
                    <div className="sub-row">
                      <div className="sub-main">
                        <div className="row-main">{s.planName}</div>
                        <div className="row-sub">
                          {fmtDate(s.startDate)} – {s.endDate ? fmtDate(s.endDate) : 'muddatsiz'} · {BILLING_LABEL[s.billingType]}
                          {s.remainingSessions != null && (
                            <>
                              {' '}
                              · qoldiq {s.remainingSessions}/{s.sessionLimit} dars
                            </>
                          )}
                        </div>
                      </div>
                      <div className="sub-side">
                        {s.price != null && <div className="num strong">{fmtMoney(s.price)}</div>}
                        {!!s.discount && <div className="row-sub">chegirma {fmtMoney(s.discount)}</div>}
                      </div>
                      <StatusBadge status={s.status} />
                    </div>
                    {(s.status === 'active' || s.status === 'frozen') && <SubscriptionBar s={s} />}
                    {isStaff && s.status === 'active' && (
                      <div className="row-actions">
                        <button className="btn small ghost" onClick={() => setModal({ freeze: s.id })}>
                          Muzlatish
                        </button>
                        <button
                          className="btn small ghost danger"
                          onClick={async () => {
                            const reason = await dialogs.prompt({ title: 'Abonementni bekor qilish', label: 'Sabab', confirmLabel: 'Davom etish', danger: true, minLength: 2 });
                            if (!reason) return;
                            const voidUnpaidCharge = await dialogs.confirm({ title: 'To‘lanmagan hisob ham bekor qilinsinmi?', message: 'Faqat umuman to‘lanmagan hisob bekor qilinadi. To‘langan pul stornosi alohida qilinadi.', confirmLabel: 'Ha, bekor qilinsin' });
                            await post(`/subscriptions/${s.id}/cancel`, { reason, voidUnpaidCharge });
                            reload();
                          }}
                        >
                          Bekor qilish
                        </button>
                      </div>
                    )}
                    {isStaff && s.status === 'frozen' && (
                      <div className="row-actions">
                        <button
                          className="btn small ghost"
                          onClick={async () => {
                            await post(`/subscriptions/${s.id}/unfreeze`);
                            reload();
                          }}
                        >
                          Muzlatishni bekor qilish
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {a.balance && a.charges && a.payments && (
            <section className="card">
              <div className="card-head">
                <h2>Moliya</h2>
                <div className="row-actions flush">
                  {role === 'owner' && (
                    <button className="btn small ghost" onClick={() => setModal('adjust')}>
                      Tuzatish
                    </button>
                  )}
                  {isStaff && (
                    <button className="btn small" onClick={() => setModal('payment')}>
                      + To‘lov
                    </button>
                  )}
                </div>
              </div>
              <div className="fin-summary">
                <div>
                  <span>Hisoblangan</span>
                  <strong>{fmtMoney(a.balance.charged)}</strong>
                </div>
                <div>
                  <span>To‘langan</span>
                  <strong>{fmtMoney(a.balance.paid)}</strong>
                </div>
                {!!a.balance.adjusted && (
                  <div>
                    <span>Tuzatish</span>
                    <strong>{fmtMoney(a.balance.adjusted)}</strong>
                  </div>
                )}
                <div>
                  <span>{a.balance.debt > 0 ? 'Qarz' : a.balance.advance > 0 ? 'Avans' : 'Qoldiq'}</span>
                  <strong className={a.balance.debt > 0 ? 'debt' : ''}>{fmtMoney(a.balance.debt || a.balance.advance)}</strong>
                </div>
              </div>
              <div className="fin-tabs">
                <div className="tabs" role="tablist">
                  <button role="tab" aria-selected={finTab === 'charges'} className={finTab === 'charges' ? 'active' : ''} onClick={() => setFinTab('charges')}>
                    Hisoblar <span className="tab-count">{a.charges.length}</span>
                  </button>
                  <button role="tab" aria-selected={finTab === 'payments'} className={finTab === 'payments' ? 'active' : ''} onClick={() => setFinTab('payments')}>
                    To‘lovlar <span className="tab-count">{a.payments.length}</span>
                  </button>
                </div>
              </div>

              {finTab === 'charges' &&
                (a.charges.length === 0 ? (
                  <Empty>Hisob yo‘q</Empty>
                ) : (
                  <div className="table-wrap">
                    <table className="fin-table">
                      <thead>
                        <tr>
                          <th>Muddat</th>
                          <th>Tavsif</th>
                          <th className="num">Summa</th>
                          <th className="num">To‘langan</th>
                          <th>Holat</th>
                          {role === 'owner' && <th className="act" />}
                        </tr>
                      </thead>
                      <tbody>
                        {a.charges.map((c) => (
                          <tr key={c.id}>
                            <td className="nowrap">{fmtDate(c.dueDate)}</td>
                            <td className="clip" title={c.description}>
                              {cleanDescription(c.description)}
                            </td>
                            <td className="num nowrap">{fmtMoney(c.amount)}</td>
                            <td className="num nowrap">{fmtMoney(c.paidAmount)}</td>
                            <td>
                              <StatusBadge status={c.status} />
                            </td>
                            {role === 'owner' && (
                              <td className="act">
                                {c.paidAmount === 0 && c.status !== 'void' && (
                                  <button
                                    className="btn small ghost danger"
                                    onClick={async () => {
                                      const reason = await dialogs.prompt({ title: 'Hisobni bekor qilish', label: 'Sabab', confirmLabel: 'Bekor qilish', danger: true, minLength: 3 });
                                      if (!reason) return;
                                      try {
                                        await post(`/charges/${c.id}/void`, { reason });
                                        reload();
                                      } catch (e) {
                                        dialogs.toast(errorText(e), 'error');
                                      }
                                    }}
                                  >
                                    Bekor
                                  </button>
                                )}
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}

              {finTab === 'payments' &&
                (a.payments.length === 0 ? (
                  <Empty>To‘lov yo‘q</Empty>
                ) : (
                  <div className="table-wrap">
                    <table className="fin-table">
                      <thead>
                        <tr>
                          <th>Sana</th>
                          <th>Kvitansiya</th>
                          <th>Izoh</th>
                          <th className="num">Summa</th>
                          {isStaff && <th className="act" />}
                        </tr>
                      </thead>
                      <tbody>
                        {a.payments.map((p) => {
                          const reversed = a.payments!.some((x) => x.reversalOfId === p.id);
                          return (
                            <tr key={p.id} className={p.amount < 0 || reversed ? 'muted' : ''}>
                              <td className="nowrap">{fmtDateTime(p.paidAt)}</td>
                              <td className="nowrap mono">{p.receiptNo ?? '—'}</td>
                              <td className="clip" title={p.note ?? ''}>
                                {p.note ?? ''}
                              </td>
                              <td className={`num nowrap strong ${p.amount < 0 ? 'debt' : ''}`}>{fmtMoney(p.amount)}</td>
                              {isStaff && (
                                <td className="act">
                                  {p.amount > 0 && !reversed && (
                                    <button
                                      className="btn small ghost danger"
                                      onClick={async () => {
                                        const reason = await dialogs.prompt({ title: 'To‘lovni storno qilish', message: 'To‘lov o‘chirilmaydi: manfiy yozuv yaratiladi.', label: 'Sabab', confirmLabel: 'Storno qilish', danger: true, minLength: 3 });
                                        if (!reason) return;
                                        try {
                                          await post(`/payments/${p.id}/reverse`, { reason });
                                          reload();
                                        } catch (e) {
                                          dialogs.toast(errorText(e), 'error');
                                        }
                                      }}
                                    >
                                      Storno
                                    </button>
                                  )}
                                  {reversed && <Badge>storno qilingan</Badge>}
                                </td>
                              )}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ))}
            </section>
          )}
        </div>

        <div className="col">
          <Card title="Ma’lumot">
            <dl className="dl">
              <dt>Tug‘ilgan sana</dt>
              <dd>{a.birthDate ? `${fmtDate(a.birthDate)}${age != null ? ` (${age} yosh)` : ''}` : '—'}</dd>
              <dt>Telefon</dt>
              <dd>{a.phone ? <a href={`tel:${a.phone}`}>{a.phone}</a> : '—'}</dd>
              <dt>A’zo bo‘lgan</dt>
              <dd>{fmtDate(a.joinedAt)}</dd>
              {a.note && (
                <>
                  <dt>Izoh</dt>
                  <dd>{a.note}</dd>
                </>
              )}
            </dl>
          </Card>

          <Card
            title="Guruhlar"
            actions={
              isStaff && (
                <button className="btn small" onClick={() => setModal('enroll')}>
                  + Qo‘shish
                </button>
              )
            }
          >
            {openEnrollments.length === 0 ? (
              <Empty>Guruhga biriktirilmagan</Empty>
            ) : (
              <ul className="list">
                {openEnrollments.map((e) => (
                  <li key={e.id}>
                    <div className="row-between">
                      <div className="sub-main">
                        <Link to={`/groups/${e.groupId}`} className="row-main">
                          {e.groupName}
                        </Link>
                        <div className="row-sub">
                          {e.sportName} · {fmtDate(e.startedAt)} dan
                        </div>
                      </div>
                      {e.status !== 'active' && <StatusBadge status={e.status} />}
                    </div>
                    {isStaff && (
                      <div className="row-actions">
                        <button className="btn small ghost" onClick={() => setModal({ move: e.id })}>
                          Ko‘chirish
                        </button>
                        {e.status === 'active' ? (
                          <button className="btn small ghost" onClick={() => setEnrollment(e.id, 'paused')}>
                            To‘xtatish
                          </button>
                        ) : (
                          <button className="btn small ghost" onClick={() => setEnrollment(e.id, 'active')}>
                            Davom ettirish
                          </button>
                        )}
                        <button className="btn small ghost danger" onClick={() => setEnrollment(e.id, 'ended')}>
                          Chiqarish
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {history.length > 0 && (
              <details className="history">
                <summary className="muted small">Tarix ({history.length})</summary>
                <ul className="list compact">
                  {history.map((e) => (
                    <li key={e.id} className="muted small">
                      {e.groupName}: {fmtDate(e.startedAt)} – {fmtDate(e.endedAt)} {e.reason && `(${e.reason})`}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </Card>

          <Card
            title="Ota-ona / vasiylar"
            actions={
              isStaff && (
                <button className="btn small" onClick={() => setModal('guardian')}>
                  + Qo‘shish
                </button>
              )
            }
          >
            {a.guardians.length === 0 ? (
              <Empty>Vasiy kiritilmagan</Empty>
            ) : (
              <ul className="list">
                {a.guardians.map((g) => (
                  <li key={g.id}>
                    <div className="row-between">
                      <div className="sub-main">
                        <div className="row-main">{g.fullName}</div>
                        <div className="row-sub">
                          {RELATION[g.relation] ?? g.relation}
                          {g.phone && (
                            <>
                              {' · '}
                              <a href={`tel:${g.phone}`}>{g.phone}</a>
                            </>
                          )}
                        </div>
                      </div>
                      <span className="badges">
                        {g.isPrimary && <Badge tone="blue">Asosiy</Badge>}
                        {g.telegramLinked ? <Badge tone="green">Telegram</Badge> : g.telegramConsentAt ? <Badge>Rozilik bor</Badge> : null}
                      </span>
                    </div>
                    {isStaff && (
                      <div className="row-actions">
                        <button
                          className="btn small ghost danger"
                          onClick={async () => {
                            if (!(await dialogs.confirm({ title: 'Vasiyni ajratish', message: 'Vasiy bu sportchidan ajratiladi (boshqa farzandlari bilan bog‘liqligi qoladi).', confirmLabel: 'Ajratish', danger: true }))) return;
                            await del(`/athletes/${a.id}/guardians/${g.id}`);
                            reload();
                          }}
                        >
                          Ajratish
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <DocumentsCard athleteId={a.id} docs={docs.data ?? []} loading={!docs.data && !docs.error} canManage={isStaff} reload={docs.reload} />
        </div>
      </div>

      {modal === 'guardian' && <GuardianModal athleteId={a.id} onClose={close} onDone={done} />}
      {modal === 'enroll' && <EnrollModal athlete={a} groups={groups} onClose={close} onDone={done} />}
      {modal && typeof modal === 'object' && 'move' in modal && (
        <EnrollModal athlete={a} groups={groups} fromEnrollmentId={modal.move} onClose={close} onDone={done} />
      )}
      {modal === 'subscription' && <SubscriptionModal athleteId={a.id} onClose={close} onDone={done} />}
      {modal && typeof modal === 'object' && 'freeze' in modal && <FreezeModal subscriptionId={modal.freeze} onClose={close} onDone={done} />}
      {modal === 'edit' && <EditModal athlete={a} onClose={close} onDone={done} />}
      {modal === 'payment' && <PaymentModal athlete={a} onClose={close} onDone={done} />}
      {modal === 'adjust' && <AdjustModal athleteId={a.id} onClose={close} onDone={done} />}
    </>
  );
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}

/** "BOX — 1 oy (30 kun) (2026-02-03 – 2026-03-04)" → the period is already in the date column. */
function cleanDescription(d: string) {
  return d.replace(/\s*\(\d{4}-\d{2}-\d{2}\s*[–-]\s*\d{4}-\d{2}-\d{2}\)\s*$/, '');
}

const DAY = 86_400_000;
const daysUntil = (iso: string) => Math.round((new Date(iso + 'T00:00:00').getTime() - new Date(todayIso() + 'T00:00:00').getTime()) / DAY);

function SubscriptionLeft({ s }: { s: Subscription }) {
  if (s.status === 'frozen') return <>Muzlatilgan</>;
  if (s.status !== 'active')
    return (
      <span className={s.status === 'expired' ? 'warn-text' : ''}>
        {STATUS_LABEL[s.status]?.[0] ?? s.status}
        {s.endDate ? ` · ${fmtDate(s.endDate)}` : ''}
      </span>
    );
  if (s.remainingSessions != null) return <>{s.remainingSessions} dars qoldi</>;
  if (!s.endDate) return <>Muddatsiz</>;
  const d = daysUntil(s.endDate);
  if (d < 0) return <span className="debt">Muddati o‘tgan</span>;
  if (d === 0) return <span className="warn-text">Bugun tugaydi</span>;
  return <span className={d <= 5 ? 'warn-text' : ''}>{d} kun qoldi · {fmtDate(s.endDate)}</span>;
}

/** Thin progress of how much of the subscription is used (days or sessions). */
function SubscriptionBar({ s }: { s: Subscription }) {
  let pct: number | null = null;
  if (s.sessionLimit) pct = (s.usedSessions / s.sessionLimit) * 100;
  else if (s.endDate) {
    const total = (new Date(s.endDate).getTime() - new Date(s.startDate).getTime()) / DAY;
    const used = total - daysUntil(s.endDate);
    pct = total > 0 ? (used / total) * 100 : 100;
  }
  if (pct == null) return null;
  pct = Math.max(0, Math.min(100, pct));
  return (
    <div className={`sub-bar ${pct >= 85 ? 'late' : ''}`} aria-hidden>
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}

const RELATION: Record<string, string> = { parent: 'Ota-ona', mother: 'Ona', father: 'Ota', guardian: 'Vasiy' };

function GuardianModal({ athleteId, onClose, onDone }: { athleteId: string; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ fullName: '', phone: '', relation: 'parent', isPrimary: false, telegramConsent: false });
  return (
    <Modal title="Vasiy qo‘shish" onClose={onClose}>
      <Form
        onSubmit={async () => {
          await post(`/athletes/${athleteId}/guardians`, f);
          onDone();
        }}
      >
        <Field label="F.I.Sh. *">
          <input value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} required autoFocus />
        </Field>
        <Field label="Telefon *" hint="Mavjud raqam bo‘lsa, o‘sha vasiyga bog‘lanadi (bir nechta farzand)">
          <input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} required placeholder="+998 90 123 45 67" />
        </Field>
        <Field label="Aloqa turi">
          <select value={f.relation} onChange={(e) => setF({ ...f, relation: e.target.value })}>
            {Object.entries(RELATION).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        <label className="check">
          <input type="checkbox" checked={f.isPrimary} onChange={(e) => setF({ ...f, isPrimary: e.target.checked })} /> Asosiy kontakt
        </label>
        <label className="check">
          <input type="checkbox" checked={f.telegramConsent} onChange={(e) => setF({ ...f, telegramConsent: e.target.checked })} /> Telegram
          xabarlariga rozilik
        </label>
      </Form>
    </Modal>
  );
}

function EnrollModal({
  athlete,
  groups,
  fromEnrollmentId,
  onClose,
  onDone,
}: {
  athlete: AthleteProfile;
  groups: Group[];
  fromEnrollmentId?: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const dialogs = useDialogs();
  const current = new Set(athlete.enrollments.filter((e) => e.status !== 'ended').map((e) => e.groupId));
  const options = groups.filter((g) => g.active && !current.has(g.id));
  const [f, setF] = useState({ groupId: options[0]?.id ?? '', startDate: todayIso(), reason: '' });
  const send = (forceCapacity: boolean) =>
    post(`/athletes/${athlete.id}/enrollments`, { ...f, reason: f.reason || null, fromEnrollmentId, forceCapacity });
  return (
    <Modal title={fromEnrollmentId ? 'Boshqa guruhga ko‘chirish' : 'Guruhga qo‘shish'} onClose={onClose}>
      <Form
        onSubmit={async () => {
          try {
            await send(false);
          } catch (e) {
            if ((e as { code?: string }).code === 'group_full_warning' && (await dialogs.confirm({ title: 'Guruh to‘lgan', message: 'Sig‘imdan ortiq qo‘shilsinmi?', confirmLabel: 'Baribir qo‘shish' }))) await send(true);
            else throw e;
          }
          onDone();
        }}
      >
        <Field label="Guruh *">
          <select value={f.groupId} onChange={(e) => setF({ ...f, groupId: e.target.value })} required>
            {options.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name} — {g.branchName} ({g.athleteCount}/{g.capacity ?? '∞'})
              </option>
            ))}
          </select>
        </Field>
        <Field label="Boshlanish sanasi">
          <input type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} required />
        </Field>
        {fromEnrollmentId && (
          <Field label="Sabab">
            <input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />
          </Field>
        )}
      </Form>
    </Modal>
  );
}

function SubscriptionModal({ athleteId, onClose, onDone }: { athleteId: string; onClose: () => void; onDone: () => void }) {
  const plans = (useApi<Plan[]>('/plans').data ?? []).filter((p) => p.active);
  const [f, setF] = useState({ planId: '', startDate: todayIso(), individualPrice: '', discount: '', discountReason: '' });
  const plan = plans.find((p) => p.id === (f.planId || plans[0]?.id));
  const [result, setResult] = useState<null | { subscription: { endDate: string | null; price: number }; pricing: { prorated: boolean } }>(null);

  if (result) {
    return (
      <Modal title="Abonement biriktirildi" onClose={onDone}>
        <p>
          Tugash sanasi: <strong>{result.subscription.endDate ? fmtDate(result.subscription.endDate) : 'muddatsiz'}</strong>
          <br />
          Hisob: <strong>{fmtMoney(result.subscription.price)}</strong> {result.pricing.prorated && <Badge tone="amber">proratsiya</Badge>}
        </p>
        <div className="form-actions">
          <button className="btn primary" onClick={onDone}>
            OK
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Abonement biriktirish" onClose={onClose}>
      <Form
        submitLabel="Biriktirish"
        onSubmit={async () => {
          const r = await post<typeof result>('/subscriptions', {
            athleteId,
            planId: plan?.id,
            startDate: f.startDate,
            individualPrice: f.individualPrice ? Number(f.individualPrice) : null,
            discount: f.discount ? Number(f.discount) : undefined,
            discountReason: f.discountReason || null,
          });
          setResult(r);
        }}
      >
        <Field label="Tarif *">
          <select value={plan?.id ?? ''} onChange={(e) => setF({ ...f, planId: e.target.value })} required>
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} — {fmtMoney(p.price)}
              </option>
            ))}
          </select>
        </Field>
        {plan && (
          <div className="muted small">
            {BILLING_LABEL[plan.billingType]}
            {plan.billingType === 'fixed_days' && ` · ${plan.durationDays ?? 30} kun`}
            {plan.billingType === 'session_pack' && ` · ${plan.sessionLimit} dars${plan.maxValidityDays ? `, ${plan.maxValidityDays} kun ichida` : ''}`}
            {plan.billingType === 'calendar_month' && ' · oy oxirigacha'}
          </div>
        )}
        <Field label="Boshlanish sanasi *">
          <input type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} required />
        </Field>
        <div className="grid2">
          <Field label="Individual narx (so‘m)">
            <MoneyInput value={f.individualPrice} onChange={(individualPrice) => setF({ ...f, individualPrice })} />
          </Field>
          <Field label="Chegirma (so‘m)">
            <MoneyInput value={f.discount} onChange={(discount) => setF({ ...f, discount })} />
          </Field>
        </div>
        {Number(f.discount) > 0 && (
          <Field label="Chegirma sababi *">
            <input value={f.discountReason} onChange={(e) => setF({ ...f, discountReason: e.target.value })} required />
          </Field>
        )}
      </Form>
    </Modal>
  );
}

function FreezeModal({ subscriptionId, onClose, onDone }: { subscriptionId: string; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ fromDate: todayIso(), toDate: todayIso(), reason: '' });
  return (
    <Modal title="Abonementni muzlatish" onClose={onClose}>
      <Form
        onSubmit={async () => {
          await post(`/subscriptions/${subscriptionId}/freeze`, f);
          onDone();
        }}
      >
        <div className="grid2">
          <Field label="Dan">
            <input type="date" value={f.fromDate} onChange={(e) => setF({ ...f, fromDate: e.target.value })} required />
          </Field>
          <Field label="Gacha">
            <input type="date" value={f.toDate} onChange={(e) => setF({ ...f, toDate: e.target.value })} required />
          </Field>
        </div>
        <Field label="Sabab *">
          <input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} required minLength={2} />
        </Field>
        <p className="muted small">Tugash sanasi muzlatilgan kunlar soniga uzaytiriladi.</p>
      </Form>
    </Modal>
  );
}

function EditModal({ athlete, onClose, onDone }: { athlete: AthleteProfile; onClose: () => void; onDone: () => void }) {
  const dialogs = useDialogs();
  const [f, setF] = useState({
    fullName: athlete.fullName,
    birthDate: athlete.birthDate ?? '',
    phone: athlete.phone ?? '',
    note: athlete.note ?? '',
    status: athlete.status,
  });
  return (
    <Modal title="Sportchini tahrirlash" onClose={onClose}>
      <Form
        onSubmit={async () => {
          if (f.status === 'archived' && athlete.status !== 'archived' && !(await dialogs.confirm({ title: 'Arxivlash', message: 'Sportchi barcha guruhlardan chiqariladi (tarix saqlanadi).', confirmLabel: 'Arxivlash', danger: true }))) return;
          await patch(`/athletes/${athlete.id}`, { ...f, birthDate: f.birthDate || null, phone: f.phone || null, note: f.note || null });
          onDone();
        }}
      >
        <Field label="F.I.Sh.">
          <input value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} required />
        </Field>
        <div className="grid2">
          <Field label="Tug‘ilgan sana">
            <input type="date" value={f.birthDate} onChange={(e) => setF({ ...f, birthDate: e.target.value })} />
          </Field>
          <Field label="Telefon">
            <input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
          </Field>
        </div>
        <Field label="Status">
          <select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
            <option value="active">Faol</option>
            <option value="paused">Vaqtincha to‘xtatilgan</option>
            <option value="archived">Arxiv</option>
          </select>
        </Field>
        <Field label="Izoh">
          <textarea value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} rows={2} />
        </Field>
      </Form>
    </Modal>
  );
}

function PaymentModal({ athlete, onClose, onDone }: { athlete: AthleteProfile; onClose: () => void; onDone: () => void }) {
  // one key per opened form: a double click or network retry cannot create two payments
  const [key] = useState(() => newKey());
  const open = (athlete.charges ?? []).filter((c) => c.status === 'open' || c.status === 'partially_paid');
  const [f, setF] = useState({ amount: String(athlete.balance?.debt || ''), method: 'cash', note: '', receiptNo: '', chargeIds: [] as string[] });
  const [result, setResult] = useState<null | { payment: { receiptNo: string; amount: number }; balance: { debt: number; advance: number } }>(null);

  if (result) {
    return (
      <Modal title="To‘lov qabul qilindi" onClose={onDone}>
        <p>
          Kvitansiya: <strong>{result.payment.receiptNo}</strong>
          <br />
          Summa: <strong>{fmtMoney(result.payment.amount)}</strong>
          <br />
          {result.balance.debt > 0 ? (
            <span className="debt">Qolgan qarz: {fmtMoney(result.balance.debt)}</span>
          ) : result.balance.advance > 0 ? (
            <span className="ok">Avans: {fmtMoney(result.balance.advance)}</span>
          ) : (
            <span className="ok">Qarz yo‘q</span>
          )}
        </p>
        <div className="form-actions">
          <button className="btn" onClick={() => window.print()}>
            Chop etish
          </button>
          <button className="btn primary" onClick={onDone}>
            OK
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={`To‘lov qabul qilish — ${athlete.fullName}`} onClose={onClose}>
      <Form
        submitLabel="Qabul qilish"
        onSubmit={async () => {
          const r = await post<typeof result>('/payments', {
            athleteId: athlete.id,
            amount: Number(f.amount),
            note: f.note || null,
            receiptNo: f.receiptNo || null,
            chargeIds: f.chargeIds,
            method: f.method,
            idempotencyKey: key,
          });
          setResult(r);
        }}
      >
        <div className="seg method-seg" role="radiogroup" aria-label="To‘lov turi">
          {Object.entries(METHOD_LABEL).map(([k, v]) => (
            <button type="button" key={k} role="radio" aria-checked={f.method === k} className={f.method === k ? 'on green' : ''} onClick={() => setF({ ...f, method: k })}>
              {v}
            </button>
          ))}
        </div>
        <Field label="Summa *">
          <MoneyInput value={f.amount} onChange={(amount) => setF({ ...f, amount })} min={1} required autoFocus />
        </Field>
        {!!athlete.balance?.debt && Number(f.amount) !== athlete.balance.debt && (
          <button type="button" className="btn small" style={{ alignSelf: 'flex-start' }} onClick={() => setF({ ...f, amount: String(athlete.balance!.debt) })}>
            Qarzni to‘liq yopish: {fmtMoney(athlete.balance.debt)}
          </button>
        )}
        {open.length > 1 && (
          <fieldset>
            <legend>Avval qaysi hisob yopilsin? (bo‘sh — eng eskisidan)</legend>
            {open.map((c) => (
              <label key={c.id} className="check">
                <input
                  type="checkbox"
                  checked={f.chargeIds.includes(c.id)}
                  onChange={(e) => setF({ ...f, chargeIds: e.target.checked ? [...f.chargeIds, c.id] : f.chargeIds.filter((x) => x !== c.id) })}
                />
                {c.description} — {fmtMoney(c.amount - c.paidAmount)}
              </label>
            ))}
          </fieldset>
        )}
        <div className="grid2">
          <Field label="Kvitansiya raqami" hint="Bo‘sh qolsa avtomatik beriladi">
            <input value={f.receiptNo} onChange={(e) => setF({ ...f, receiptNo: e.target.value })} />
          </Field>
          <Field label="Izoh">
            <input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
          </Field>
        </div>
        <p className="muted small">Kassir — siz. Ortiqcha summa avans sifatida saqlanadi. Kun yakunida faqat naqd pul sanaladi.</p>
      </Form>
    </Modal>
  );
}

function AdjustModal({ athleteId, onClose, onDone }: { athleteId: string; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ amount: '', reason: '' });
  return (
    <Modal title="Balansni tuzatish (chegirma)" onClose={onClose}>
      <Form
        onSubmit={async () => {
          await post('/charges/adjustments', { athleteId, amount: Number(f.amount), reason: f.reason });
          onDone();
        }}
      >
        <Field label="Summa (so‘m) *" hint="Musbat — qarzni kamaytiradi, manfiy — oshiradi">
          <MoneyInput value={f.amount} onChange={(amount) => setF({ ...f, amount })} allowNegative required />
        </Field>
        <Field label="Sabab *">
          <input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} required minLength={3} />
        </Field>
      </Form>
    </Modal>
  );
}

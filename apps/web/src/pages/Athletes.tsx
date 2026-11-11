import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { post } from '../api';
import { useRole } from '../auth';
import {
  ageFrom,
  Badge,
  Empty,
  ErrorBox,
  Field,
  fmtDate,
  fmtMoney,
  Form,
  Loading,
  Modal,
  PageHeader,
  StatusBadge,
  todayIso,
  useApi,
} from '../components/ui';
import { Avatar, Icon, PAGE_SIZE, Pager, Person, SearchInput, useDialogs, usePage, useUrlFilters } from '../components/kit';
import type { AthleteListItem, Branch, Coach, Group, Sport } from '../types';

const FILTER_KEYS = ['q', 'branchId', 'sportId', 'coachId', 'groupId', 'status', 'subscription', 'debt', 'ageMin', 'ageMax'] as const;

export default function AthletesPage() {
  const role = useRole();
  const isStaff = role === 'owner' || role === 'branch_admin';
  const [sp, setSp] = useSearchParams();
  const creating = sp.get('new') === '1';
  const closeCreate = () => {
    const next = new URLSearchParams(sp);
    next.delete('new');
    setSp(next, { replace: true });
  };
  const [filtersOpen, setFiltersOpen] = useState(false);
  const navigate = useNavigate();
  const f = useUrlFilters(FILTER_KEYS);
  const { page, setPage } = usePage();

  const query = useMemo(() => {
    const q = new URLSearchParams();
    for (const k of FILTER_KEYS) if (f.values[k]) q.set(k, f.values[k]);
    q.set('limit', String(PAGE_SIZE));
    q.set('offset', String((page - 1) * PAGE_SIZE));
    return q.toString();
  }, [f.values, page]);

  const { data, error, loading } = useApi<{ items: AthleteListItem[]; total: number }>(`/athletes?${query}`);
  const branches = useApi<Branch[]>(isStaff ? '/branches' : null).data ?? [];
  const sports = useApi<Sport[]>('/sports').data ?? [];
  const groups = useApi<Group[]>('/groups').data ?? [];
  const coaches = useApi<Coach[]>(isStaff ? '/coaches' : null).data ?? [];
  const branchName = (id: string) => branches.find((b) => b.id === id)?.name ?? '';

  const items = data?.items ?? [];
  // A stale ?p= beyond the last page (e.g. after archiving) jumps to the last real page.
  useEffect(() => {
    if (data && !data.items.length && data.total > 0 && page > 1) setPage(Math.ceil(data.total / PAGE_SIZE));
  }, [data, page, setPage]);

  const filters: { key: (typeof FILTER_KEYS)[number]; label: string; options: { value: string; label: string }[] }[] = [
    ...(isStaff && branches.length > 1 ? [{ key: 'branchId' as const, label: 'Filial', options: branches.map((b) => ({ value: b.id, label: b.name })) }] : []),
    { key: 'sportId', label: 'Sport turi', options: sports.map((s) => ({ value: s.id, label: s.name })) },
    { key: 'groupId', label: 'Guruh', options: groups.map((g) => ({ value: g.id, label: g.name })) },
    ...(isStaff ? [{ key: 'coachId' as const, label: 'Murabbiy', options: coaches.map((c) => ({ value: c.id, label: c.fullName })) }] : []),
    {
      key: 'subscription',
      label: 'Abonement',
      options: [
        { value: 'active', label: 'Faol abonement' },
        { value: 'expiring', label: '7 kunda tugaydi' },
        { value: 'frozen', label: 'Muzlatilgan' },
        { value: 'expired', label: 'Muddati o‘tgan' },
        { value: 'none', label: 'Abonementsiz' },
      ],
    },
    ...(isStaff
      ? [
          {
            key: 'debt' as const,
            label: 'Qarzdorlik',
            options: [
              { value: 'true', label: 'Qarzdorlar' },
              { value: 'false', label: 'Qarzi yo‘q' },
            ],
          },
        ]
      : []),
    {
      key: 'status',
      label: 'Holat',
      options: [
        { value: 'active', label: 'Faol' },
        { value: 'paused', label: 'To‘xtatilgan' },
        { value: 'archived', label: 'Arxiv' },
      ],
    },
  ];
  const chips = [
    ...filters.filter((x) => f.values[x.key]).map((x) => ({ key: x.key, text: `${x.label}: ${x.options.find((o) => o.value === f.values[x.key])?.label ?? '…'}` })),
    ...(f.values.ageMin ? [{ key: 'ageMin' as const, text: `Yosh: ${f.values.ageMin} dan` }] : []),
    ...(f.values.ageMax ? [{ key: 'ageMax' as const, text: `Yosh: ${f.values.ageMax} gacha` }] : []),
  ];

  return (
    <>
      <PageHeader
        title="Sportchilar"
        subtitle="Sportchilarni boshqaring, profilini ko‘ring va abonementlarini kuzating"
        actions={
          isStaff && (
            <button className="btn primary" onClick={() => setSp(new URLSearchParams([...sp, ['new', '1']]), { replace: true })}>
              <Icon name="plus" size={16} /> Yangi sportchi
            </button>
          )
        }
      />
      <section className="filter-card">
        <div className="filter-row">
          <div className="filter-search">
            <SearchInput value={f.values.q} onChange={(v) => f.set('q', v)} placeholder="Ism yoki telefon bo‘yicha qidirish…" />
          </div>
          <span className="muted small filter-count">{data ? `${data.total} ta sportchi` : ''}</span>
          <div className="filter-menu">
            <button type="button" className="btn" aria-expanded={filtersOpen} onClick={() => setFiltersOpen(!filtersOpen)}>
              <Icon name="filter" size={16} /> Filtrlar
              {chips.length > 0 && <span className="filter-badge">{chips.length}</span>}
            </button>
            {filtersOpen && (
              <>
                <div className="filter-scrim" onClick={() => setFiltersOpen(false)} />
                <div className="filter-pop">
                  {filters.map((x) => (
                    <Field key={x.key} label={x.label}>
                      <select value={f.values[x.key]} onChange={(e) => f.set(x.key, e.target.value)}>
                        <option value="">Barchasi</option>
                        {x.options.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </Field>
                  ))}
                  <div className="grid2">
                    <Field label="Yosh (dan)">
                      <input type="number" min={0} value={f.values.ageMin} onChange={(e) => f.set('ageMin', e.target.value)} />
                    </Field>
                    <Field label="Yosh (gacha)">
                      <input type="number" min={0} value={f.values.ageMax} onChange={(e) => f.set('ageMax', e.target.value)} />
                    </Field>
                  </div>
                </div>
              </>
            )}
          </div>
          {isStaff && (
            <Link className="btn" to="/import">
              <Icon name="upload" size={16} /> Import
            </Link>
          )}
        </div>
        {chips.length > 0 && (
          <div className="chip-row">
            <span className="muted small">Faol filtrlar:</span>
            {chips.map((c) => (
              <button type="button" key={c.key} className="filter-chip" onClick={() => f.set(c.key, '')} aria-label={`${c.text} filtrini olib tashlash`}>
                {c.text} <Icon name="x" size={12} />
              </button>
            ))}
            <button type="button" className="chip-clear" onClick={f.clear}>
              Tozalash
            </button>
          </div>
        )}
      </section>
      <ErrorBox error={error} />
      {loading && !data ? (
        <Loading />
      ) : data && data.total === 0 ? (
        <Empty>{f.active ? 'Filtrga mos sportchi topilmadi' : 'Hali sportchi yo‘q'}</Empty>
      ) : (
        <div className="table-wrap">
          <table className="members">
            <thead>
              <tr>
                <th>Sportchi</th>
                <th>Guruh</th>
                <th>Tarif</th>
                <th>Tugash sanasi</th>
                <th>Holat</th>
                {isStaff && <th className="num">Balans</th>}
                <th>Oxirgi kelgan</th>
                <th aria-label="Amallar" />
              </tr>
            </thead>
            <tbody>
              {items.map((a) => {
                const age = ageFrom(a.birthDate);
                const sub = [a.status !== 'active' ? (a.status === 'archived' ? 'arxivda' : 'to‘xtatilgan') : null, age != null ? `${age} yosh` : null, a.phone, isStaff && branches.length > 1 ? branchName(a.branchId) : null].filter(Boolean).join(' · ');
                return (
                  <tr key={a.id} onClick={() => navigate(`/athletes/${a.id}`)} className="clickable">
                    <td>
                      <Link to={`/athletes/${a.id}`} className="person-link" onClick={(e) => e.stopPropagation()}>
                        <span className="person">
                          <Avatar name={a.fullName} size={36} />
                          <Person name={a.fullName} sub={sub || undefined} />
                        </span>
                      </Link>
                    </td>
                    <td title={a.groupNames.join(', ')}>{a.groupNames.length ? a.groupNames.join(', ') : <span className="muted">—</span>}</td>
                    <td title={a.subscription?.planName}>{a.subscription?.planName ?? <span className="muted">—</span>}</td>
                    <td>{a.subscription?.endDate ? fmtDate(a.subscription.endDate) : <span className="muted">—</span>}</td>
                    <td>{a.subscription ? <StatusBadge status={a.subscription.status} /> : <Badge>Abonementsiz</Badge>}</td>
                    {isStaff && (
                      <td className={`num ${a.balance && a.balance > 0 ? 'debt' : ''}`}>
                        {a.balance && a.balance > 0 ? `−${fmtMoney(a.balance)}` : a.balance && a.balance < 0 ? `+${fmtMoney(-a.balance)}` : fmtMoney(0)}
                      </td>
                    )}
                    <td>{a.lastSeen ? fmtDate(a.lastSeen) : <span className="muted">—</span>}</td>
                    <td className="num">
                      <Link to={`/athletes/${a.id}`} className="row-icon" title="Ko‘rish" aria-label={`${a.fullName}: ko‘rish`} onClick={(e) => e.stopPropagation()}>
                        <Icon name="eye" size={17} />
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {data && <Pager page={page} total={data.total} onPage={setPage} />}
      {creating && <CreateAthleteModal branches={branches} groups={groups} onClose={closeCreate} onCreated={(id) => navigate(`/athletes/${id}`)} />}
    </>
  );
}

function CreateAthleteModal({
  branches,
  groups,
  onClose,
  onCreated,
}: {
  branches: Branch[];
  groups: Group[];
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const dialogs = useDialogs();
  const [f, setF] = useState({
    fullName: '',
    birthDate: '',
    phone: '',
    branchId: branches[0]?.id ?? '',
    groupId: '',
    joinedAt: todayIso(),
    note: '',
    gName: '',
    gPhone: '',
    gRelation: 'parent',
    gConsent: false,
  });
  const up = (k: keyof typeof f) => (e: { target: { value: string; checked?: boolean; type?: string } }) =>
    setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const branchGroups = groups.filter((g) => g.branchId === f.branchId && g.active);

  const submit = async () => {
    const send = async (forceCapacity: boolean) =>
      post<{ id: string }>('/athletes', {
        fullName: f.fullName,
        birthDate: f.birthDate || null,
        phone: f.phone || null,
        branchId: f.branchId,
        joinedAt: f.joinedAt,
        note: f.note || null,
        groupId: f.groupId || undefined,
        forceCapacity,
        guardians: f.gName && f.gPhone ? [{ fullName: f.gName, phone: f.gPhone, relation: f.gRelation, isPrimary: true, telegramConsent: f.gConsent }] : [],
      });
    try {
      const r = await send(false);
      onCreated(r.id);
    } catch (e) {
      if ((e as { code?: string }).code === 'group_full_warning' && (await dialogs.confirm({ title: 'Guruh to‘lgan', message: 'Sig‘imdan ortiq qo‘shilsinmi?', confirmLabel: 'Baribir qo‘shish' }))) {
        const r = await send(true);
        onCreated(r.id);
      } else throw e;
    }
  };

  return (
    <Modal title="Yangi sportchi" onClose={onClose}>
      <Form onSubmit={submit} submitLabel="Yaratish">
        <div className="grid2">
          <Field label="F.I.Sh. *">
            <input value={f.fullName} onChange={up('fullName')} required minLength={2} autoFocus />
          </Field>
          <Field label="Tug‘ilgan sana">
            <input type="date" value={f.birthDate} onChange={up('birthDate')} />
          </Field>
          <Field label="Telefon">
            <input value={f.phone} onChange={up('phone')} placeholder="+998 90 123 45 67" />
          </Field>
          <Field label="Qo‘shilgan sana">
            <input type="date" value={f.joinedAt} onChange={up('joinedAt')} required />
          </Field>
          <Field label="Filial *">
            <select value={f.branchId} onChange={(e) => setF({ ...f, branchId: e.target.value, groupId: '' })} required>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Guruh">
            <select value={f.groupId} onChange={up('groupId')}>
              <option value="">— keyinroq —</option>
              {branchGroups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name} ({g.athleteCount}/{g.capacity ?? '∞'})
                </option>
              ))}
            </select>
          </Field>
        </div>
        <fieldset>
          <legend>Ota-ona / vasiy</legend>
          <div className="grid2">
            <Field label="F.I.Sh.">
              <input value={f.gName} onChange={up('gName')} />
            </Field>
            <Field label="Telefon" hint="Shu raqam bilan vasiy mavjud bo‘lsa, unga bog‘lanadi">
              <input value={f.gPhone} onChange={up('gPhone')} placeholder="+998 90 123 45 67" />
            </Field>
            <Field label="Aloqa turi">
              <select value={f.gRelation} onChange={up('gRelation')}>
                <option value="parent">Ota-ona</option>
                <option value="mother">Ona</option>
                <option value="father">Ota</option>
                <option value="guardian">Vasiy</option>
              </select>
            </Field>
            <label className="check">
              <input type="checkbox" checked={f.gConsent} onChange={up('gConsent')} /> Telegram xabarlariga rozilik berdi
            </label>
          </div>
        </fieldset>
        <Field label="Izoh">
          <textarea value={f.note} onChange={up('note')} rows={2} />
        </Field>
      </Form>
    </Modal>
  );
}

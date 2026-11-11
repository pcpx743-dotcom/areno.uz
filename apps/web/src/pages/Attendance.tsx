/** Davomat: lessons of the day and the attendance sheet (mobile-first for coaches). */
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { patch, put } from '../api';
import { useRole } from '../auth';
import { Badge, Empty, ErrorBox, errorText, fmtDate, Loading, PageHeader, StatusBadge, todayIso, useApi } from '../components/ui';
import { Icon, Progress, Select, Summary, Toolbar, useDialogs, useUrlFilters } from '../components/kit';

interface SessionRow {
  id: string;
  groupId: string;
  groupName: string;
  branchName: string;
  coachName: string | null;
  startTime: string;
  endTime: string;
  room: string | null;
  status: string;
  note: string | null;
  marked: number;
  present: number;
  enrolled: number;
}

const shiftDay = (d: string, n: number) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};

export default function AttendancePage() {
  const dialogs = useDialogs();
  const role = useRole();
  const isStaff = role === 'owner' || role === 'branch_admin';
  const f = useUrlFilters(['date', 'branch', 'state'] as const);
  const date = f.values.date || todayIso();
  const setDate = (d: string) => f.set('date', d === todayIso() ? '' : d);
  const { data, error, reload } = useApi<{ date: string; sessions: SessionRow[] }>(`/sessions?date=${date}`);
  const all = data?.sessions ?? [];
  const branchNames = [...new Set(all.map((s) => s.branchName))].sort();
  const rows = all.filter((s) => {
    if (f.values.branch && s.branchName !== f.values.branch) return false;
    if (f.values.state === 'todo' && (s.marked > 0 || s.status === 'cancelled')) return false;
    if (f.values.state === 'done' && s.marked === 0) return false;
    if (f.values.state === 'cancelled' && s.status !== 'cancelled') return false;
    return true;
  });
  const live = rows.filter((s) => s.status !== 'cancelled');
  const marked = live.filter((s) => s.marked > 0);
  const present = marked.reduce((a, s) => a + s.present, 0);
  const total = marked.reduce((a, s) => a + s.marked, 0);
  const isPast = date < todayIso();

  return (
    <>
      <PageHeader title="Davomat" />
      <Toolbar active={['branch', 'state'].filter((k) => f.values[k as 'branch']).length} onClear={() => (f.set('branch', ''), f.set('state', ''))}>
        <button className="btn" onClick={() => setDate(shiftDay(date, -1))} aria-label="Oldingi kun">
          ‹
        </button>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Sana" />
        <button className="btn" onClick={() => setDate(shiftDay(date, 1))} aria-label="Keyingi kun">
          ›
        </button>
        {date !== todayIso() && (
          <button className="btn ghost" onClick={() => setDate(todayIso())}>
            Bugun
          </button>
        )}
        {branchNames.length > 1 && <Select label="Barcha filiallar" value={f.values.branch} onChange={(v) => f.set('branch', v)} options={branchNames.map((b) => ({ value: b, label: b }))} />}
        <Select
          label="Holat: barchasi"
          value={f.values.state}
          onChange={(v) => f.set('state', v)}
          options={[
            { value: 'todo', label: 'Davomat qo‘yilmagan' },
            { value: 'done', label: 'Belgilangan' },
            { value: 'cancelled', label: 'Bekor qilingan' },
          ]}
        />
      </Toolbar>
      {data && live.length > 0 && (
        <p className="muted small">
          {live.length} dars · {live.length - marked.length ? `${live.length - marked.length} tasida davomat yo‘q` : 'hammasi belgilangan'}
          {total ? ` · ${present}/${total} keldi` : ''}
        </p>
      )}
      <ErrorBox error={error} />
      {!data ? (
        <Loading />
      ) : !rows.length ? (
        <Empty>{all.length ? 'Filtrga mos dars yo‘q' : 'Bu kunda dars yo‘q (guruh jadvallariga qarang)'}</Empty>
      ) : (
        <div className="table-wrap day-list">
          <ul className="rows" style={{ padding: '0 12px' }}>
            {rows.map((s) => (
              <li key={s.id} className={`lesson-row ${s.status === 'cancelled' ? 'cancelled' : ''}`}>
                <span className="lesson-time">
                  {s.startTime.slice(0, 5)}–{s.endTime.slice(0, 5)}
                </span>
                <span>
                  <span className="person-name">{s.groupName}</span>
                  <span className="lesson-meta">
                    {' '}
                    · {s.coachName ?? '—'}
                    {s.room && ` · ${s.room}`}
                    {s.note && ` · ${s.note}`}
                  </span>
                </span>
                <span className="row-sub">
                  {s.status === 'cancelled' ? (
                    'bekor qilingan'
                  ) : s.marked ? (
                    `${s.present}/${s.marked} keldi`
                  ) : (
                    <span className={isPast ? 'debt' : ''}>davomat yo‘q · {s.enrolled} sportchi</span>
                  )}
                </span>
                <span className="row-actions" style={{ marginTop: 0, justifyContent: 'flex-end' }}>
                  {isStaff && s.status !== 'cancelled' && s.marked === 0 && (
                    <button
                      className="btn small ghost"
                      onClick={async () => {
                        const note = await dialogs.prompt({ title: 'Darsni bekor qilish', message: 'Ota-onalarga Telegram orqali xabar yuboriladi.', label: 'Sabab', confirmLabel: 'Bekor qilish', danger: true });
                        if (note === null) return;
                        try {
                          await patch(`/sessions/${s.id}`, { status: 'cancelled', note });
                          dialogs.toast('Dars bekor qilindi');
                          reload();
                        } catch (e) {
                          dialogs.toast(errorText(e), 'error');
                        }
                      }}
                    >
                      Bekor qilish
                    </button>
                  )}
                  {isStaff && s.status === 'cancelled' && (
                    <button
                      className="btn small ghost"
                      onClick={async () => {
                        await patch(`/sessions/${s.id}`, { status: 'scheduled', note: null });
                        reload();
                      }}
                    >
                      Tiklash
                    </button>
                  )}
                  {s.status !== 'cancelled' && (
                    <Link className={`btn small ${s.marked ? '' : 'primary'}`} to={`/attendance/${s.id}`}>
                      {s.marked ? 'Ochish' : 'Belgilash'}
                    </Link>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

type Mark = 'present' | 'absent' | 'excused';
interface SheetRow {
  athleteId: string;
  fullName: string;
  status: Mark | null;
  hasDebt: boolean;
  updatedAt: string | null;
  subscription: null | { billingType: string; endDate: string | null; remainingSessions: number | null };
}

const MARKS: { v: Mark; label: string; tone: string }[] = [
  { v: 'present', label: 'Keldi', tone: 'green' },
  { v: 'absent', label: 'Kelmadi', tone: 'red' },
  { v: 'excused', label: 'Sababli', tone: 'amber' },
];

export function AttendanceSheetPage() {
  const { id } = useParams();
  const { data, error, reload } = useApi<{ session: { sessionDate: string; startTime: string; groupName: string; status: string }; rows: SheetRow[] }>(
    `/sessions/${id}/attendance`,
  );
  const [marks, setMarks] = useState<Record<string, Mark>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (data) setMarks(Object.fromEntries(data.rows.filter((r) => r.status).map((r) => [r.athleteId, r.status as Mark])));
  }, [data]);

  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  const changed = data.rows.filter((r) => marks[r.athleteId] && marks[r.athleteId] !== r.status);
  const isFuture = data.session.sessionDate > todayIso();

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await put<{ warnings: string[] }>(`/sessions/${id}/attendance`, {
        marks: changed.map((c) => ({ athleteId: c.athleteId, status: marks[c.athleteId] })),
      });
      setMsg({ tone: 'ok', text: r.warnings.length ? `Saqlandi. Diqqat: ${r.warnings.join('; ')}` : 'Saqlandi' });
      reload();
    } catch (e) {
      setMsg({ tone: 'error', text: errorText(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title={data.session.groupName}
        subtitle={`${fmtDate(data.session.sessionDate)} · ${data.session.startTime.slice(0, 5)}`}
        actions={
          <Link className="btn" to="/attendance">
            ← Darslar
          </Link>
        }
      />
      {isFuture && <div className="alert error">Bu dars hali bo‘lmagan — davomat qo‘yib bo‘lmaydi.</div>}
      {!data.rows.length ? (
        <Empty>Guruhda sportchi yo‘q</Empty>
      ) : (
        <>
          <div className="row-actions" style={{ marginBottom: 12 }}>
            <button
              className="btn small"
              disabled={isFuture}
              onClick={() => setMarks(Object.fromEntries(data.rows.map((r) => [r.athleteId, marks[r.athleteId] ?? 'present'])))}
            >
              Qolganlarni “Keldi”
            </button>
          </div>
          <ul className="sheet">
            {data.rows.map((r) => (
              <li key={r.athleteId}>
                <div className="sheet-name">
                  <strong>{r.fullName}</strong>
                  <div className="muted small">
                    {r.subscription ? (
                      r.subscription.remainingSessions != null ? (
                        <>qoldiq {r.subscription.remainingSessions} dars</>
                      ) : (
                        <>abonement {r.subscription.endDate ? `${fmtDate(r.subscription.endDate)} gacha` : ''}</>
                      )
                    ) : (
                      <Badge tone="amber">abonement yo‘q</Badge>
                    )}{' '}
                    {r.hasDebt && <Badge tone="red">qarzdor</Badge>} {r.updatedAt && <Badge>tahrirlangan</Badge>}
                  </div>
                </div>
                <div className="seg" role="radiogroup" aria-label={r.fullName}>
                  {MARKS.map((m) => (
                    <button
                      key={m.v}
                      role="radio"
                      aria-checked={marks[r.athleteId] === m.v}
                      disabled={isFuture}
                      className={marks[r.athleteId] === m.v ? `on ${m.tone}` : ''}
                      onClick={() => setMarks({ ...marks, [r.athleteId]: m.v })}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
          {msg && <div className={`alert ${msg.tone}`}>{msg.text}</div>}
          <div className="sticky-save">
            <button className="btn primary" disabled={busy || !changed.length || isFuture} onClick={save}>
              {busy ? 'Saqlanmoqda…' : `Saqlash${changed.length ? ` (${changed.length})` : ''}`}
            </button>
          </div>
        </>
      )}
    </>
  );
}

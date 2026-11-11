import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { patch, post } from '../api';
import { useRole } from '../auth';
import { Empty, ErrorBox, Field, Form, Loading, Modal, PageHeader, useApi } from '../components/ui';
import { Icon, norm, SearchInput, Select, Toolbar, useDialogs, useUrlFilters } from '../components/kit';
import type { Coach, Group } from '../types';

export default function CoachesPage() {
  const isOwner = useRole() === 'owner';
  const { data, error, reload } = useApi<Coach[]>('/coaches');
  const groups = useApi<Group[]>('/groups').data ?? [];
  const [edit, setEdit] = useState<Coach | 'new' | null>(null);
  const f = useUrlFilters(['q', 'state'] as const);
  const dialogs = useDialogs();

  const info = useMemo(() => {
    const m = new Map<string, { groups: Group[]; athletes: number }>();
    for (const g of groups) {
      if (!g.coachId) continue;
      const e = m.get(g.coachId) ?? { groups: [], athletes: 0 };
      e.groups.push(g);
      e.athletes += g.athleteCount;
      m.set(g.coachId, e);
    }
    return m;
  }, [groups]);

  const rows = useMemo(
    () =>
      (data ?? []).filter((c) => {
        const v = f.values;
        const i = info.get(c.id);
        if (v.q && !norm(`${c.fullName} ${c.phone} ${i?.groups.map((g) => g.name).join(' ')}`).includes(norm(v.q))) return false;
        if (v.state === 'active' && !c.active) return false;
        if (v.state === 'inactive' && c.active) return false;
        if (v.state === 'nologin' && c.userId) return false;
        return true;
      }),
    [data, f.values, info],
  );

  return (
    <>
      <PageHeader
        title="Murabbiylar"
        actions={
          <>
            {isOwner && (
              <Link className="btn" to="/payroll">
                Ish haqi
              </Link>
            )}
            <button className="btn primary" onClick={() => setEdit('new')}>
              <Icon name="plus" size={16} /> Murabbiy
            </button>
          </>
        }
      />
      <Toolbar count={data ? `${rows.length} ta` : undefined} active={f.active} onClear={f.clear}>
        <SearchInput value={f.values.q} onChange={(v) => f.set('q', v)} placeholder="Ism, telefon yoki guruh" />
        <Select
          label="Holat: barchasi"
          value={f.values.state}
          onChange={(v) => f.set('state', v)}
          options={[
            { value: 'active', label: 'Faol' },
            { value: 'inactive', label: 'Nofaol' },
            { value: 'nologin', label: 'Tizimga kirish yo‘q' },
          ]}
        />
      </Toolbar>
      <ErrorBox error={error} />
      {!data ? (
        <Loading />
      ) : rows.length === 0 ? (
        <Empty>{data.length ? 'Filtrga mos murabbiy yo‘q' : 'Hali murabbiy yo‘q'}</Empty>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Murabbiy</th>
                <th>Guruhlar</th>
                <th className="num">Sportchilar</th>
                <th>Telefon</th>
                <th>Tizimga kirish</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                const i = info.get(c.id);
                return (
                  <tr key={c.id}>
                    <td>
                      <span className="person-name">{c.fullName}</span>
                      {!c.active && <span className="muted"> · nofaol</span>}
                    </td>
                    <td className="wrap">
                      {i?.groups.length
                        ? i.groups.map((g, k) => (
                            <span key={g.id}>
                              {k > 0 && ', '}
                              <Link to={`/groups/${g.id}`}>{g.name}</Link>
                            </span>
                          ))
                        : <span className="muted">—</span>}
                    </td>
                    <td className="num">{i?.athletes ?? 0}</td>
                    <td>{c.phone ?? <span className="muted">—</span>}</td>
                    <td>{c.userId ? 'bor' : <span className="muted">yo‘q</span>}</td>
                    <td>
                      <button className="btn small ghost" onClick={() => setEdit(c)}>
                        Tahrirlash
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {edit && (
        <CoachModal
          coach={edit === 'new' ? undefined : edit}
          onClose={() => setEdit(null)}
          onDone={() => {
            setEdit(null);
            dialogs.toast('Saqlandi');
            reload();
          }}
        />
      )}
    </>
  );
}

function CoachModal({ coach, onClose, onDone }: { coach?: Coach; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({
    fullName: coach?.fullName ?? '',
    phone: coach?.phone ?? '',
    active: coach?.active ?? true,
  });
  return (
    <Modal title={coach ? 'Murabbiyni tahrirlash' : 'Yangi murabbiy'} onClose={onClose}>
      <Form
        onSubmit={async () => {
          const body = { ...f, phone: f.phone || null };
          if (coach) await patch(`/coaches/${coach.id}`, body);
          else await post('/coaches', body);
          onDone();
        }}
      >
        <Field label="F.I.Sh. *">
          <input value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} required autoFocus />
        </Field>
        <Field label="Telefon">
          <input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
        </Field>
        <label className="check">
          <input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Faol
        </label>
        <p className="muted small">Murabbiyga tizimga kirish huquqini “Xodimlar va rollar” bo‘limida bering.</p>
      </Form>
    </Modal>
  );
}

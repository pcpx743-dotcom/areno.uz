import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { patch, post } from '../api';
import { useRole } from '../auth';
import { Empty, ErrorBox, Field, Form, Loading, Modal, PageHeader, useApi } from '../components/ui';
import { Icon, norm, Progress, SearchInput, Select, Toolbar, useUrlFilters } from '../components/kit';
import type { Branch, Coach, Group, Sport } from '../types';

const KEYS = ['q', 'branch', 'sport', 'coach', 'fill'] as const;

export default function GroupsPage() {
  const role = useRole();
  const isStaff = role === 'owner' || role === 'branch_admin';
  const { data, error, reload } = useApi<Group[]>('/groups');
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();
  const f = useUrlFilters(KEYS);

  const opts = useMemo(() => {
    const uniq = (pairs: [string | null, string | null][]) =>
      [...new Map(pairs.filter(([id]) => id).map(([id, name]) => [id!, name ?? '—'])).entries()].map(([value, label]) => ({ value, label }));
    const rows = data ?? [];
    return {
      branches: uniq(rows.map((g) => [g.branchId, g.branchName])),
      sports: uniq(rows.map((g) => [g.sportId, g.sportName])),
      coaches: uniq(rows.map((g) => [g.coachId, g.coachName])),
    };
  }, [data]);

  const list = useMemo(
    () =>
      (data ?? []).filter((g) => {
        const v = f.values;
        if (v.q && !norm(`${g.name} ${g.coachName} ${g.sportName} ${g.coachPhone ?? ''}`).includes(norm(v.q))) return false;
        if (v.branch && g.branchId !== v.branch) return false;
        if (v.sport && g.sportId !== v.sport) return false;
        if (v.coach && g.coachId !== v.coach) return false;
        const full = !!g.capacity && g.athleteCount >= g.capacity;
        if (v.fill === 'full' && !full) return false;
        if (v.fill === 'free' && full) return false;
        if (v.fill === 'inactive' && g.active) return false;
        return true;
      }),
    [data, f.values],
  );
  const total = list.reduce((a, g) => a + g.athleteCount, 0);

  return (
    <>
      <PageHeader
        title={role === 'coach' ? 'Mening guruhlarim' : 'Guruhlar'}
        actions={
          isStaff && (
            <button className="btn primary" onClick={() => setCreating(true)}>
              <Icon name="plus" size={16} /> Yangi guruh
            </button>
          )
        }
      />
      <Toolbar count={data ? `${list.length} guruh · ${total} sportchi` : undefined} active={f.active} onClear={f.clear}>
        <SearchInput value={f.values.q} onChange={(v) => f.set('q', v)} placeholder="Guruh, murabbiy, sport yoki telefon" />
        {isStaff && opts.branches.length > 1 && <Select label="Barcha filiallar" value={f.values.branch} onChange={(v) => f.set('branch', v)} options={opts.branches} />}
        <Select label="Barcha sport turlari" value={f.values.sport} onChange={(v) => f.set('sport', v)} options={opts.sports} />
        {isStaff && <Select label="Barcha murabbiylar" value={f.values.coach} onChange={(v) => f.set('coach', v)} options={opts.coaches} />}
        <Select
          label="Bandlik: barchasi"
          value={f.values.fill}
          onChange={(v) => f.set('fill', v)}
          options={[
            { value: 'free', label: 'Bo‘sh joy bor' },
            { value: 'full', label: 'To‘lgan' },
            { value: 'inactive', label: 'Nofaol' },
          ]}
        />
      </Toolbar>
      <ErrorBox error={error} />
      {!data ? (
        <Loading />
      ) : list.length === 0 ? (
        <Empty>{data.length ? 'Filtrga mos guruh yo‘q' : 'Hali guruh yo‘q'}</Empty>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Guruh</th>
                <th>Sport</th>
                <th>Murabbiy</th>
                {opts.branches.length > 1 && <th>Filial</th>}
                <th>Telefon</th>
                <th>Sportchilar</th>
              </tr>
            </thead>
            <tbody>
              {list.map((g) => (
                <tr key={g.id} className="clickable" onClick={() => navigate(`/groups/${g.id}`)}>
                  <td>
                    <Link to={`/groups/${g.id}`} className="person-name">
                      {g.name}
                    </Link>
                    {!g.active && <span className="muted"> · nofaol</span>}
                  </td>
                  <td>{g.sportName}</td>
                  <td>{g.coachName ?? <span className="muted">—</span>}</td>
                  {opts.branches.length > 1 && <td>{g.branchName}</td>}
                  <td>
                    {g.coachPhone ? (
                      <a href={`tel:${g.coachPhone.replace(/[^\d+]/g, '')}`} onClick={(e) => e.stopPropagation()}>
                        {g.coachPhone}
                      </a>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td>{g.capacity ? <Progress value={g.athleteCount} max={g.capacity} /> : g.athleteCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {creating && (
        <GroupFormModal
          onClose={() => setCreating(false)}
          onDone={() => {
            setCreating(false);
            reload();
          }}
        />
      )}
    </>
  );
}

export function GroupFormModal({ group, onClose, onDone }: { group?: Group; onClose: () => void; onDone: () => void }) {
  const branches = useApi<Branch[]>('/branches').data ?? [];
  const sports = useApi<Sport[]>('/sports').data ?? [];
  const coaches = useApi<Coach[]>('/coaches').data ?? [];
  const [f, setF] = useState({
    name: group?.name ?? '',
    branchId: group?.branchId ?? '',
    sportId: group?.sportId ?? '',
    coachId: group?.coachId ?? '',
    capacity: group?.capacity?.toString() ?? '',
    ageMin: group?.ageMin?.toString() ?? '',
    ageMax: group?.ageMax?.toString() ?? '',
  });
  const num = (v: string) => (v === '' ? null : Number(v));
  return (
    <Modal title={group ? 'Guruhni tahrirlash' : 'Yangi guruh'} onClose={onClose}>
      <Form
        onSubmit={async () => {
          const body = {
            name: f.name,
            branchId: f.branchId || branches[0]?.id,
            sportId: f.sportId || sports[0]?.id,
            coachId: f.coachId || null,
            capacity: num(f.capacity),
            ageMin: num(f.ageMin),
            ageMax: num(f.ageMax),
          };
          if (group) await patch(`/groups/${group.id}`, body);
          else await post('/groups', body);
          onDone();
        }}
      >
        <Field label="Nomi *">
          <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required autoFocus />
        </Field>
        <div className="grid2">
          <Field label="Filial *">
            <select value={f.branchId || branches[0]?.id || ''} onChange={(e) => setF({ ...f, branchId: e.target.value })}>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Sport turi *">
            <select value={f.sportId || sports[0]?.id || ''} onChange={(e) => setF({ ...f, sportId: e.target.value })}>
              {sports.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Murabbiy">
            <select value={f.coachId} onChange={(e) => setF({ ...f, coachId: e.target.value })}>
              <option value="">—</option>
              {coaches.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.fullName}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Sig‘im">
            <input type="number" min={1} value={f.capacity} onChange={(e) => setF({ ...f, capacity: e.target.value })} />
          </Field>
          <Field label="Yosh (dan)">
            <input type="number" min={0} value={f.ageMin} onChange={(e) => setF({ ...f, ageMin: e.target.value })} />
          </Field>
          <Field label="Yosh (gacha)">
            <input type="number" min={0} value={f.ageMax} onChange={(e) => setF({ ...f, ageMax: e.target.value })} />
          </Field>
        </div>
      </Form>
    </Modal>
  );
}

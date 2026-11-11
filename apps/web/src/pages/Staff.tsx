import { useState } from 'react';
import { patch, post } from '../api';
import { ROLE_LABEL, type Role } from '../auth';
import { Badge, ErrorBox, errorText, Field, Form, Loading, Modal, PageHeader, useApi } from '../components/ui';
import { useDialogs } from '../components/kit';
import type { Branch, Coach } from '../types';

interface StaffRow {
  membershipId: string;
  email: string;
  fullName: string;
  role: Role;
  branchIds: string[];
  status: 'active' | 'disabled';
}

export default function StaffPage() {
  const dialogs = useDialogs();
  const { data, error, reload } = useApi<StaffRow[]>('/staff');
  const branches = useApi<Branch[]>('/branches').data ?? [];
  const [creating, setCreating] = useState(false);
  const bName = (ids: string[]) => (ids.length ? ids.map((id) => branches.find((b) => b.id === id)?.name ?? '?').join(', ') : 'Barchasi');

  return (
    <>
      <PageHeader
        title="Xodimlar va rollar"
        actions={
          <button className="btn primary" onClick={() => setCreating(true)}>
            + Xodim
          </button>
        }
      />
      <ErrorBox error={error} />
      {!data ? (
        <Loading />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>F.I.Sh.</th>
                <th>Email</th>
                <th>Rol</th>
                <th>Filiallar</th>
                <th>Holat</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.map((s) => (
                <tr key={s.membershipId}>
                  <td>{s.fullName}</td>
                  <td>{s.email}</td>
                  <td>{ROLE_LABEL[s.role]}</td>
                  <td>{s.role === 'owner' ? 'Barchasi' : bName(s.branchIds)}</td>
                  <td>{s.status === 'active' ? <Badge tone="green">faol</Badge> : <Badge>o‘chirilgan</Badge>}</td>
                  <td>
                    {s.role !== 'owner' && (
                      <button
                        className="btn small ghost"
                        onClick={async () => {
                          const password = await dialogs.prompt({ title: `${s.fullName}: yangi parol`, message: 'Yangi parolni xodimga xavfsiz yo‘l bilan yetkazing.', label: 'Yangi parol (kamida 8 belgi)', type: 'password', minLength: 8, confirmLabel: 'O‘zgartirish' });
                          if (!password) return;
                          try {
                            await post(`/staff/${s.membershipId}/password`, { password });
                            dialogs.toast('Parol o‘zgartirildi');
                          } catch (e) {
                            dialogs.toast(errorText(e), 'error');
                          }
                        }}
                      >
                        Parol
                      </button>
                    )}
                    {s.role !== 'owner' && (
                      <button
                        className="btn small ghost"
                        onClick={async () => {
                          await patch(`/staff/${s.membershipId}`, { status: s.status === 'active' ? 'disabled' : 'active' });
                          reload();
                        }}
                      >
                        {s.status === 'active' ? 'O‘chirish' : 'Yoqish'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {creating && (
        <StaffModal
          branches={branches}
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

function StaffModal({ branches, onClose, onDone }: { branches: Branch[]; onClose: () => void; onDone: () => void }) {
  const coaches = (useApi<Coach[]>('/coaches').data ?? []).filter((c) => !c.userId);
  const [f, setF] = useState({
    fullName: '',
    email: '',
    password: '',
    role: 'branch_admin' as 'branch_admin' | 'coach',
    branchIds: [] as string[],
    coachId: '',
  });
  return (
    <Modal title="Yangi xodim" onClose={onClose}>
      <Form
        onSubmit={async () => {
          await post('/staff', { ...f, coachId: f.role === 'coach' && f.coachId ? f.coachId : undefined });
          onDone();
        }}
      >
        <Field label="Rol">
          <select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as 'branch_admin' | 'coach' })}>
            <option value="branch_admin">Filial administratori</option>
            <option value="coach">Murabbiy</option>
          </select>
        </Field>
        {f.role === 'coach' && coaches.length > 0 && (
          <Field label="Mavjud murabbiy yozuviga bog‘lash">
            <select
              value={f.coachId}
              onChange={(e) => {
                const c = coaches.find((x) => x.id === e.target.value);
                setF({ ...f, coachId: e.target.value, fullName: c?.fullName ?? f.fullName });
              }}
            >
              <option value="">— yangi murabbiy yaratish —</option>
              {coaches.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.fullName}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="F.I.Sh. *">
          <input value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} required />
        </Field>
        <div className="grid2">
          <Field label="Email *">
            <input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required autoComplete="off" />
          </Field>
          <Field label="Boshlang‘ich parol *" hint="Kamida 8 belgi">
            <input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required minLength={8} autoComplete="new-password" />
          </Field>
        </div>
        <fieldset>
          <legend>Ruxsat berilgan filiallar{f.role === 'branch_admin' ? ' *' : ''}</legend>
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
      </Form>
    </Modal>
  );
}

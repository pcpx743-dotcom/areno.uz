import { useState } from 'react';
import { patch, post } from '../api';
import { useAuth } from '../auth';
import { ErrorBox, Field, fmtDate, Form, Loading, Modal, PageHeader, StatusBadge, useApi } from '../components/ui';

interface ClubRow {
  id: string;
  name: string;
  status: string;
  timezone: string;
  createdAt: string;
  branchCount: number;
  athleteCount: number;
}

export default function PlatformPage() {
  const { me } = useAuth();
  const { data, error, reload } = useApi<ClubRow[]>(me?.user.isSuperadmin ? '/platform/clubs' : null);
  const [creating, setCreating] = useState(false);
  if (!me?.user.isSuperadmin) return <div className="pad">Faqat platforma superadmini uchun.</div>;
  return (
    <>
      <PageHeader
        title="Klublar"
        actions={
          <button className="btn primary" onClick={() => setCreating(true)}>
            + Klub
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
                <th>Klub</th>
                <th>Holat</th>
                <th className="num">Filiallar</th>
                <th className="num">Faol sportchilar</th>
                <th>Yaratilgan</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.map((c) => (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  <td>
                    <StatusBadge status={c.status === 'suspended' ? 'paused' : c.status} />
                  </td>
                  <td className="num">{c.branchCount}</td>
                  <td className="num">{c.athleteCount}</td>
                  <td>{fmtDate(c.createdAt)}</td>
                  <td>
                    <button
                      className="btn small ghost"
                      onClick={async () => {
                        await patch(`/platform/clubs/${c.id}`, { status: c.status === 'active' ? 'suspended' : 'active' });
                        reload();
                      }}
                    >
                      {c.status === 'active' ? 'To‘xtatish' : 'Faollashtirish'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {creating && (
        <Modal title="Yangi klub" onClose={() => setCreating(false)}>
          <NewClubForm
            onDone={() => {
              setCreating(false);
              reload();
            }}
          />
        </Modal>
      )}
    </>
  );
}

function NewClubForm({ onDone }: { onDone: () => void }) {
  const [f, setF] = useState({ name: '', email: '', fullName: '', password: '' });
  return (
    <Form
      onSubmit={async () => {
        await post('/platform/clubs', { name: f.name, owner: { email: f.email, fullName: f.fullName, password: f.password } });
        onDone();
      }}
    >
      <Field label="Klub nomi *">
        <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required autoFocus />
      </Field>
      <Field label="Egasi F.I.Sh. *">
        <input value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} required />
      </Field>
      <Field label="Egasi email *">
        <input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required />
      </Field>
      <Field label="Boshlang‘ich parol *">
        <input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required minLength={8} />
      </Field>
    </Form>
  );
}

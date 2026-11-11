/** Simple reference-data screens: branches and sports. */
import { useState } from 'react';
import { patch, post } from '../api';
import { useRole } from '../auth';
import { Badge, Empty, ErrorBox, Field, Form, Loading, Modal, PageHeader, useApi } from '../components/ui';
import type { Branch, Sport } from '../types';

export function BranchesPage() {
  const isOwner = useRole() === 'owner';
  const { data, error, reload } = useApi<Branch[]>('/branches');
  const [edit, setEdit] = useState<Branch | 'new' | null>(null);
  return (
    <>
      <PageHeader
        title="Filiallar"
        actions={
          isOwner && (
            <button className="btn primary" onClick={() => setEdit('new')}>
              + Filial
            </button>
          )
        }
      />
      <ErrorBox error={error} />
      {!data ? (
        <Loading />
      ) : data.length === 0 ? (
        <Empty>Filiallar yo‘q</Empty>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Nomi</th>
                <th>Manzil</th>
                <th>Telefon</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.map((b) => (
                <tr key={b.id}>
                  <td>
                    {b.name} {!b.active && <Badge>nofaol</Badge>}
                  </td>
                  <td>{b.address ?? '—'}</td>
                  <td>{b.phone ?? '—'}</td>
                  <td>
                    {isOwner && (
                      <button className="btn small ghost" onClick={() => setEdit(b)}>
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
        <BranchModal
          branch={edit === 'new' ? undefined : edit}
          onClose={() => setEdit(null)}
          onDone={() => {
            setEdit(null);
            reload();
          }}
        />
      )}
    </>
  );
}

function BranchModal({ branch, onClose, onDone }: { branch?: Branch; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ name: branch?.name ?? '', address: branch?.address ?? '', phone: branch?.phone ?? '', active: branch?.active ?? true });
  return (
    <Modal title={branch ? 'Filialni tahrirlash' : 'Yangi filial'} onClose={onClose}>
      <Form
        onSubmit={async () => {
          const body = { ...f, address: f.address || null, phone: f.phone || null };
          if (branch) await patch(`/branches/${branch.id}`, body);
          else await post('/branches', body);
          onDone();
        }}
      >
        <Field label="Nomi *">
          <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required autoFocus />
        </Field>
        <Field label="Manzil">
          <input value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} />
        </Field>
        <Field label="Telefon">
          <input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
        </Field>
        <label className="check">
          <input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Faol
        </label>
      </Form>
    </Modal>
  );
}

export function SportsPage() {
  const isOwner = useRole() === 'owner';
  const { data, error, reload } = useApi<Sport[]>('/sports');
  const [name, setName] = useState('');
  return (
    <>
      <PageHeader title="Sport turlari" />
      <ErrorBox error={error} />
      {isOwner && (
        <div className="card">
          <Form
            submitLabel="Qo‘shish"
            onSubmit={async () => {
              await post('/sports', { name });
              setName('');
              reload();
            }}
          >
            <Field label="Yangi sport turi">
              <input value={name} onChange={(e) => setName(e.target.value)} required minLength={2} placeholder="Masalan: Karate" />
            </Field>
          </Form>
        </div>
      )}
      {!data ? (
        <Loading />
      ) : (
        <ul className="chips">
          {data.map((s) => (
            <li key={s.id}>
              {s.name}
              {isOwner && (
                <button
                  className="btn small ghost"
                  onClick={async () => {
                    await patch(`/sports/${s.id}`, { active: !s.active });
                    reload();
                  }}
                >
                  {s.active ? 'faol' : 'nofaol'}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

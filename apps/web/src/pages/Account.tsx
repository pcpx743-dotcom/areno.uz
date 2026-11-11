/** Own account: change password. */
import { useState } from 'react';
import { post } from '../api';
import { ROLE_LABEL, useAuth } from '../auth';
import { Card, Field, Form, PageHeader } from '../components/ui';

export default function AccountPage() {
  const { me } = useAuth();
  const [f, setF] = useState({ currentPassword: '', newPassword: '', repeat: '' });
  const [done, setDone] = useState(false);
  if (!me) return null;
  return (
    <>
      <PageHeader title="Mening hisobim" subtitle={`${me.user.fullName} · ${me.user.email}${me.club ? ` · ${ROLE_LABEL[me.club.role]}` : ''}`} />
      <Card title="Parolni o‘zgartirish">
        <Form
          submitLabel="O‘zgartirish"
          onSubmit={async () => {
            if (f.newPassword !== f.repeat) throw new Error('Yangi parollar mos emas');
            await post('/auth/password', { currentPassword: f.currentPassword, newPassword: f.newPassword });
            setF({ currentPassword: '', newPassword: '', repeat: '' });
            setDone(true);
          }}
        >
          <Field label="Joriy parol">
            <input type="password" value={f.currentPassword} onChange={(e) => setF({ ...f, currentPassword: e.target.value })} required autoComplete="current-password" />
          </Field>
          <Field label="Yangi parol" hint="Kamida 8 belgi">
            <input type="password" value={f.newPassword} onChange={(e) => setF({ ...f, newPassword: e.target.value })} required minLength={8} autoComplete="new-password" />
          </Field>
          <Field label="Yangi parolni takrorlang">
            <input type="password" value={f.repeat} onChange={(e) => setF({ ...f, repeat: e.target.value })} required minLength={8} autoComplete="new-password" />
          </Field>
          {done && <div className="alert ok">Parol o‘zgartirildi</div>}
        </Form>
      </Card>
    </>
  );
}

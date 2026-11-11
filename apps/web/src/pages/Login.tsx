import { useEffect, useState } from 'react';
import { useAuth } from '../auth';
import { Field, Form } from '../components/ui';

/** The login screen is the product's (Areno), not a club's: clubs brand themselves inside the app. */
const BRAND_NAME = 'Areno';

export default function LoginPage() {
  useEffect(() => {
    document.title = BRAND_NAME;
  }, []);
  const { login } = useAuth();
  const [email, setEmail] = useState(import.meta.env.VITE_DEMO_HINTS === 'true' ? 'owner@demo-mma.uz' : '');
  const [password, setPassword] = useState(import.meta.env.VITE_DEMO_HINTS === 'true' ? 'demo12345' : '');
  return (
    <div className="login-wrap">
      <div className="login card">
        <div className="login-brand">
          <img src="/brand/areno-logo.png" alt={BRAND_NAME} />
          <small>Sport klublari uchun boshqaruv tizimi</small>
        </div>
        <Form onSubmit={() => login(email, password)} submitLabel="Kirish">
          <Field label="Email">
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus autoComplete="username" />
          </Field>
          <Field label="Parol">
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
          </Field>
        </Form>
        {import.meta.env.VITE_DEMO_HINTS === 'true' && (
          <p className="muted small">
            Demo: owner@demo-mma.uz, admin.chilonzor@demo-mma.uz, coach.aziz@demo-mma.uz, superadmin@sport-erp.uz — parol: demo12345
          </p>
        )}
      </div>
    </div>
  );
}

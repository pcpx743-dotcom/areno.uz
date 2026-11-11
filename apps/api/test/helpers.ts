import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { createDb, runMigrations, type DbHandle } from '../src/db/client.js';
import { loadConfig } from '../src/config.js';
import { seedDemo, DEMO_PASSWORD, DEMO_USERS } from '../src/db/seed-data.js';

export interface TestEnv {
  app: FastifyInstance;
  handle: DbHandle;
  demo: Awaited<ReturnType<typeof seedDemo>>;
  /** Second, unrelated club for isolation tests. */
  clubB: { clubId: string; ownerEmail: string; branchId: string; athleteId: string };
  login: (email: string, password?: string) => Promise<Api>;
  close: () => Promise<void>;
}

export interface Api {
  token: string;
  get: (url: string) => Promise<Res>;
  post: (url: string, body?: unknown, headers?: Record<string, string>) => Promise<Res>;
  patch: (url: string, body?: unknown) => Promise<Res>;
  put: (url: string, body?: unknown) => Promise<Res>;
  del: (url: string) => Promise<Res>;
}

export interface Res {
  status: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any;
}

export const TODAY = '2026-11-04';

export async function setup(): Promise<TestEnv> {
  const handle = await createDb('pglite://memory');
  await runMigrations(handle);
  const demo = await seedDemo(handle.db, { today: TODAY });
  const app = await buildApp({ db: handle.db, config: loadConfig({ JWT_SECRET: 'test-secret' } as NodeJS.ProcessEnv) });

  const client = (token: string): Api => {
    const call = async (method: string, url: string, body?: unknown, headers: Record<string, string> = {}) => {
      const r = await app.inject({
        method: method as 'GET',
        url,
        payload: body as object | undefined,
        headers: { authorization: `Bearer ${token}`, ...headers },
      });
      return { status: r.statusCode, body: r.body ? safeJson(r.body) : null };
    };
    return {
      token,
      get: (u) => call('GET', u),
      post: (u, b, h) => call('POST', u, b ?? {}, h),
      patch: (u, b) => call('PATCH', u, b ?? {}),
      put: (u, b) => call('PUT', u, b ?? {}),
      del: (u) => call('DELETE', u),
    };
  };

  const login = async (email: string, password = DEMO_PASSWORD) => {
    const r = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } });
    if (r.statusCode !== 200) throw new Error(`login failed for ${email}: ${r.body}`);
    return client(r.json().token);
  };

  // Create club B through the platform API, with its own branch and athlete.
  const sa = await login(DEMO_USERS.superadmin);
  const ownerEmail = 'owner@club-b.uz';
  const created = await sa.post('/api/platform/clubs', {
    name: 'Club B Boks',
    owner: { email: ownerEmail, fullName: 'B Owner', password: 'password-b-123' },
  });
  if (created.status !== 201) throw new Error(JSON.stringify(created.body));
  const ownerB = await login(ownerEmail, 'password-b-123');
  const branchB = await ownerB.post('/api/branches', { name: 'B filial' });
  const athleteB = await ownerB.post('/api/athletes', { fullName: 'Club B Sportchi', branchId: branchB.body.id });

  return {
    app,
    handle,
    demo,
    clubB: { clubId: created.body.club.id, ownerEmail, branchId: branchB.body.id, athleteId: athleteB.body.id },
    login,
    close: async () => {
      await app.close();
      await handle.close();
    },
  };
}

function safeJson(s: string) {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

/** /reports/monthly must agree with /reports/summary for the same month (dashboard figures). */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setup, type TestEnv, type Api } from './helpers.js';
import { DEMO_USERS } from '../src/db/seed-data.js';

let env: TestEnv;
let owner: Api;

beforeAll(async () => {
  env = await setup();
  owner = await env.login(DEMO_USERS.owner);
});
afterAll(() => env.close());

const monthEnd = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  return `${ym}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
};

describe('reports/monthly', () => {
  it('returns the requested months in order, ending at `end`', async () => {
    const r = await owner.get('/api/reports/monthly?months=3&end=2026-01');
    expect(r.status).toBe(200);
    expect(r.body.map((x: { month: string }) => x.month)).toEqual(['2025-11', '2025-12', '2026-01']);
  });

  it('matches the summary report for the current month and result = collected − expenses', async () => {
    const r = await owner.get('/api/reports/monthly?months=2');
    const cur = r.body[1];
    const s = await owner.get(`/api/reports/summary?from=${cur.month}-01&to=${monthEnd(cur.month)}`);
    expect(cur.collected).toBe(s.body.totals.cashIncome);
    expect(cur.plan).toBe(s.body.totals.accruedSales);
    expect(cur.expenses).toBe(s.body.totals.branchExpenses + s.body.totals.clubWideExpenses);
    expect(cur.result).toBe(cur.collected - cur.expenses);
  });

  it('rejects a malformed month and is staff-only', async () => {
    expect((await owner.get('/api/reports/monthly?end=2026-13')).status).toBe(400);
    const coach = await env.login(DEMO_USERS.coach1);
    expect((await coach.get('/api/reports/monthly')).status).toBe(403);
  });
});

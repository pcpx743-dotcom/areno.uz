/** /reports/daily feeds the dashboard chart: its days must add up to the /reports/monthly figures. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setup, type TestEnv, type Api } from './helpers.js';
import { DEMO_USERS } from '../src/db/seed-data.js';

type Day = { date: string; plan: number; collected: number; expenses: number; result: number };

let env: TestEnv;
let owner: Api;

beforeAll(async () => {
  env = await setup();
  owner = await env.login(DEMO_USERS.owner);
});
afterAll(() => env.close());

const total = (days: Day[], k: 'plan' | 'collected' | 'expenses' | 'result') => days.reduce((a, d) => a + d[k], 0);

describe('reports/daily', () => {
  it('zero-fills every day of the month and of the previous month, across a year boundary', async () => {
    const r = await owner.get('/api/reports/daily?month=2026-01');
    expect(r.status).toBe(200);
    expect(r.body.prevMonth).toBe('2025-12');
    expect(r.body.days).toHaveLength(31);
    expect(r.body.prevDays).toHaveLength(31);
    expect(r.body.days[0].date).toBe('2026-01-01');
    expect(r.body.prevDays[30].date).toBe('2025-12-31');
    const feb = await owner.get('/api/reports/daily?month=2026-02');
    expect(feb.body.days).toHaveLength(28);
  });

  it('counts a new payment in the month and agrees with /reports/monthly', async () => {
    const a = await owner.post('/api/athletes', { fullName: 'Kunlik Sportchi', branchId: env.demo.branches.chilonzor });
    const before = await owner.get('/api/reports/daily');
    const pay = await owner.post('/api/payments', { athleteId: a.body.id, amount: 77000, method: 'cash', idempotencyKey: crypto.randomUUID() });
    expect(pay.status).toBeLessThan(300);

    const r = await owner.get('/api/reports/daily');
    expect(total(r.body.days, 'collected')).toBe(total(before.body.days, 'collected') + 77000);

    const m = await owner.get(`/api/reports/monthly?months=2&end=${r.body.month}`);
    for (const [row, days] of [
      [m.body[1], r.body.days],
      [m.body[0], r.body.prevDays],
    ] as const) {
      expect(total(days, 'plan')).toBe(row.plan);
      expect(total(days, 'collected')).toBe(row.collected);
      expect(total(days, 'expenses')).toBe(row.expenses);
      expect(total(days, 'result')).toBe(row.result);
    }
  });

  it('keeps a branch admin inside their branch, rejects a bad month and is staff-only', async () => {
    const a = await owner.post('/api/athletes', { fullName: 'Yunusobod Kunlik', branchId: env.demo.branches.yunusobod });
    const admin = await env.login(DEMO_USERS.adminChilonzor);
    const before = await admin.get('/api/reports/daily');
    await owner.post('/api/payments', { athleteId: a.body.id, amount: 55000, method: 'cash', idempotencyKey: crypto.randomUUID() });
    const after = await admin.get('/api/reports/daily');
    expect(total(after.body.days, 'collected')).toBe(total(before.body.days, 'collected'));

    expect((await owner.get('/api/reports/daily?month=2026-13')).status).toBe(400);
    const coach = await env.login(DEMO_USERS.coach1);
    expect((await coach.get('/api/reports/daily')).status).toBe(403);
  });
});

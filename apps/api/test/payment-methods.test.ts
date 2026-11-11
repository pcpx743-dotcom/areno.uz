/** Click/Payme and terminal payments count as income but not as cash in the drawer. */
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

describe('payment methods', () => {
  it('records the method; cash desk splits by method; closing expects cash only', async () => {
    const branchId = env.demo.branches.yunusobod;
    const a = (await owner.post('/api/athletes', { fullName: 'Usul Test', branchId })).body.id;
    await owner.post('/api/charges', { athleteId: a, amount: 900_000, description: 'Test', dueDate: '2026-11-01' });
    const pay = (amount: number, method: string, key: string) => owner.post('/api/payments', { athleteId: a, amount, method }, { 'idempotency-key': key });
    expect((await pay(300_000, 'cash', 'm-1')).body.payment.method).toBe('cash');
    expect((await pay(400_000, 'click_payme', 'm-2')).body.payment.method).toBe('click_payme');
    expect((await pay(200_000, 'terminal', 'm-3')).status).toBe(201);
    expect((await owner.post('/api/payments', { athleteId: a, amount: 1, method: 'bitcoin' }, { 'idempotency-key': 'm-4' })).status).toBe(400);

    const r = (await owner.get(`/api/cash/report?branchId=${branchId}`)).body;
    const b = r.branches[0];
    expect(b.net).toBe(900_000);
    expect(b.cashNet).toBe(300_000);
    expect(b.byMethod).toEqual({ cash: 300_000, click_payme: 400_000, terminal: 200_000 });

    const close = await owner.post('/api/cash/close', { branchId, countedAmount: 300_000 });
    expect(close.body).toMatchObject({ expectedAmount: 300_000, difference: 0 });

    // a storno keeps the original method
    const list = (await owner.get(`/api/payments?athleteId=${a}`)).body;
    const click = list.find((p: { method: string }) => p.method === 'click_payme');
    const rev = await owner.post(`/api/payments/${click.id}/reverse`, { reason: 'Xato usul' });
    expect(rev.body.reversal.method).toBe('click_payme');
  });
});

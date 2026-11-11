/** Phase 3 — Billing (PRD §6, §14). */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { setup, type TestEnv, type Api } from './helpers.js';
import { DEMO_USERS } from '../src/db/seed-data.js';
import { guardians, notifications, payments } from '../src/db/schema.js';

let env: TestEnv;
let owner: Api;
let admin: Api;
let n = 0;
const key = () => `test-key-${Date.now()}-${++n}`;

async function newAthleteWithCharge(api: Api, amount = 400_000) {
  const a = (await api.post('/api/athletes', { fullName: `Billing ${++n}`, branchId: env.demo.branches.chilonzor })).body.id;
  const c = await api.post('/api/charges', { athleteId: a, amount, description: 'Test hisob', dueDate: '2026-11-01' });
  expect(c.status).toBe(201);
  return { athleteId: a as string, chargeId: c.body.id as string };
}

const pay = (api: Api, athleteId: string, amount: number, k = key(), extra: object = {}) =>
  api.post('/api/payments', { athleteId, amount, ...extra }, { 'idempotency-key': k });

beforeAll(async () => {
  env = await setup();
  owner = await env.login(DEMO_USERS.owner);
  admin = await env.login(DEMO_USERS.adminChilonzor);
});
afterAll(() => env.close());

describe('cash payments', () => {
  it('400 000 charge − 150 000 payment = 250 000 debt; charge partially paid', async () => {
    const { athleteId, chargeId } = await newAthleteWithCharge(owner);
    const r = await pay(admin, athleteId, 150_000);
    expect(r.status).toBe(201);
    expect(r.body.balance.debt).toBe(250_000);
    expect(r.body.allocations).toEqual([expect.objectContaining({ chargeId, amount: 150_000 })]);
    expect(r.body.payment.receiptNo).toMatch(/^K-\d{6}$/);
    const charges = await owner.get(`/api/charges?athleteId=${athleteId}`);
    expect(charges.body[0]).toMatchObject({ status: 'partially_paid', paidAmount: 150_000, outstanding: 250_000 });
  });

  it('the same request sent twice creates exactly one payment', async () => {
    const { athleteId } = await newAthleteWithCharge(owner);
    const k = key();
    const [r1, r2] = await Promise.all([pay(owner, athleteId, 100_000, k), pay(owner, athleteId, 100_000, k)]);
    const r3 = await pay(owner, athleteId, 100_000, k);
    expect([r1.status, r2.status].sort()).toEqual([200, 201]);
    expect(r3.status).toBe(200);
    expect(r3.body.duplicate).toBe(true);
    const rows = await env.handle.db.select().from(payments).where(eq(payments.athleteId, athleteId));
    expect(rows).toHaveLength(1);
    expect(r3.body.balance.debt).toBe(300_000);
  });

  it('requires an idempotency key', async () => {
    const { athleteId } = await newAthleteWithCharge(owner);
    const r = await owner.post('/api/payments', { athleteId, amount: 1000 });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('idempotency_key_required');
  });

  it('overpayment becomes an advance and pays the next charge automatically', async () => {
    const { athleteId } = await newAthleteWithCharge(owner, 100_000);
    const r = await pay(owner, athleteId, 150_000);
    expect(r.body.balance).toMatchObject({ debt: 0, advance: 50_000 });
    const s = await owner.post('/api/subscriptions', { athleteId, planId: env.demo.plans.days30, startDate: '2026-11-04' });
    expect(s.body.charge).toMatchObject({ amount: 450_000, paidAmount: 50_000, status: 'partially_paid' });
    const p = await owner.get(`/api/athletes/${athleteId}`);
    expect(p.body.balance.debt).toBe(400_000);
  });

  it('one payment can cover several charges, chosen ones first', async () => {
    const { athleteId, chargeId: older } = await newAthleteWithCharge(owner, 100_000);
    const newer = (await owner.post('/api/charges', { athleteId, amount: 50_000, description: 'Forma', dueDate: '2026-11-03' })).body.id;
    const r = await pay(owner, athleteId, 120_000, key(), { chargeIds: [newer] });
    expect(r.body.allocations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ chargeId: newer, amount: 50_000 }),
        expect.objectContaining({ chargeId: older, amount: 70_000 }),
      ]),
    );
  });

  it('branch admin cannot take payments for another branch', async () => {
    const r = await pay(admin, env.demo.athletes[15], 10_000);
    expect(r.status).toBe(404);
  });

  it('queues a Telegram notification only for linked, consenting parents', async () => {
    const { athleteId } = await newAthleteWithCharge(owner);
    await owner.post(`/api/athletes/${athleteId}/guardians`, { fullName: 'Ota Telegram', phone: '+998907770001', telegramConsent: true });
    const r1 = await pay(owner, athleteId, 10_000);
    const q = await env.handle.db.select().from(notifications).where(eq(notifications.template, 'payment_received'));
    expect(q.filter((x) => (x.payload as { athleteId: string }).athleteId === athleteId)).toHaveLength(0); // no chat yet
    await env.handle.db.update(guardians).set({ telegramChatId: '123456' }).where(eq(guardians.phone, '+998907770001'));
    const r2 = await pay(owner, athleteId, 10_000);
    expect(r2.status).toBe(201);
    const all = await env.handle.db.select().from(notifications).where(eq(notifications.template, 'payment_received'));
    const mine = all.filter((x) => (x.payload as { athleteId: string }).athleteId === athleteId);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ status: 'queued' });
    expect(mine[0].payload).toMatchObject({ amount: 10_000, debt: 380_000 });
    expect(r1.status).toBe(201);
  });
});

describe('reversal (storno)', () => {
  it('restores debt, reopens the charge and shows as a refund in the cash report', async () => {
    const { athleteId, chargeId } = await newAthleteWithCharge(owner);
    const before = (await owner.get('/api/cash/report')).body.totals;
    const p = (await pay(admin, athleteId, 400_000)).body.payment;
    let ch = (await owner.get(`/api/charges?athleteId=${athleteId}&view=paid`)).body;
    expect(ch[0]).toMatchObject({ id: chargeId, status: 'paid' });

    const r = await admin.post(`/api/payments/${p.id}/reverse`, { reason: 'Xato kiritildi' });
    expect(r.status).toBe(201);
    expect(r.body.reversal.amount).toBe(-400_000);
    expect(r.body.balance.debt).toBe(400_000);
    ch = (await owner.get(`/api/charges?athleteId=${athleteId}`)).body;
    expect(ch[0]).toMatchObject({ status: 'open', paidAmount: 0 });

    const after = (await owner.get('/api/cash/report')).body.totals;
    expect(after.income - before.income).toBe(400_000);
    expect(after.refunds - before.refunds).toBe(400_000);
    expect(after.net).toBe(before.net);

    expect((await owner.post(`/api/payments/${p.id}/reverse`, { reason: 'yana' })).status).toBe(409);
    expect((await owner.post(`/api/payments/${r.body.reversal.id}/reverse`, { reason: 'yana' })).status).toBe(400);
  });

  it('admin can reverse only same-day payments; owner any time', async () => {
    const { athleteId } = await newAthleteWithCharge(owner);
    const yesterday = new Date(Date.now() - 36 * 3600_000).toISOString();
    const p = (await pay(owner, athleteId, 50_000, key(), { paidAt: yesterday })).body.payment;
    expect((await admin.post(`/api/payments/${p.id}/reverse`, { reason: 'test sabab' })).status).toBe(403);
    expect((await owner.post(`/api/payments/${p.id}/reverse`, { reason: 'test sabab' })).status).toBe(201);
  });
});

describe('cash desk', () => {
  it('report: branch sums equal the club total', async () => {
    const r = await owner.get('/api/cash/report');
    expect(r.status).toBe(200);
    const sum = r.body.branches.reduce((a: number, b: { net: number }) => a + b.net, 0);
    expect(sum).toBe(r.body.totals.net);
    expect(r.body.branches.length).toBe(2);
    const adminView = await admin.get('/api/cash/report');
    expect(adminView.body.branches.map((b: { branchId: string }) => b.branchId)).toEqual([env.demo.branches.chilonzor]);
  });

  it('closing the day records the difference and locks it for admins', async () => {
    const { athleteId } = await newAthleteWithCharge(owner);
    await pay(admin, athleteId, 20_000);
    const report = (await admin.get(`/api/cash/report?branchId=${env.demo.branches.chilonzor}`)).body;
    const expected = report.branches[0].net;
    const close = await admin.post('/api/cash/close', { branchId: env.demo.branches.chilonzor, countedAmount: expected - 5_000, note: 'Kam chiqdi' });
    expect(close.status).toBe(201);
    expect(close.body).toMatchObject({ expectedAmount: expected, difference: -5_000 });
    expect((await admin.post('/api/cash/close', { branchId: env.demo.branches.chilonzor, countedAmount: 0 })).status).toBe(409);

    const blocked = await pay(admin, athleteId, 1_000);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toBe('day_closed');
    expect((await pay(owner, athleteId, 1_000)).status).toBe(201);
    const closings = await owner.get('/api/cash/closings');
    expect(closings.body[0]).toMatchObject({ difference: -5_000 });
  });
});

describe('debtor lists', () => {
  it('overdue / upcoming / debtors', async () => {
    const overdue = await owner.get('/api/charges?view=overdue');
    expect(overdue.status).toBe(200);
    expect(overdue.body.every((c: { status: string }) => c.status !== 'paid')).toBe(true);
    const debtors = await owner.get('/api/charges/debtors');
    expect(debtors.body.map((d: { id: string }) => d.id)).toContain(env.demo.athletes[9]);
    expect(debtors.body.find((d: { id: string }) => d.id === env.demo.athletes[9]).debt).toBe(250_000);
  });

  it('adjustment (owner only) reduces the balance; void needs an unpaid charge', async () => {
    const { athleteId, chargeId } = await newAthleteWithCharge(owner, 100_000);
    expect((await admin.post('/api/charges/adjustments', { athleteId, amount: 10_000, reason: 'Chegirma' })).status).toBe(403);
    const adj = await owner.post('/api/charges/adjustments', { athleteId, amount: 10_000, reason: 'Aka-uka chegirmasi' });
    expect(adj.body.balance.debt).toBe(90_000);
    const v = await owner.post(`/api/charges/${chargeId}/void`, { reason: 'Noto‘g‘ri hisob' });
    expect(v.body.status).toBe('void');
  });
});

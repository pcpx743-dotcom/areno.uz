/** Phase 4 — Operations: sessions, attendance, expenses, payroll, reports, daily job (PRD §7–9, §13–14). */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { setup, type TestEnv, type Api } from './helpers.js';
import { DEMO_USERS } from '../src/db/seed-data.js';
import { attendance, subscriptions } from '../src/db/schema.js';
import { addDays, isoWeekday, todayInTz } from '../src/domain/dates.js';

let env: TestEnv;
let owner: Api;
let admin: Api;
let coach1: Api;
let coach2: Api;
const today = todayInTz('Asia/Tashkent');
/** Most recent Monday ≤ today, but not before the seed's enrollment date (2026-11-01). */
let monday = today;
while (isoWeekday(monday) !== 1) monday = addDays(monday, -1);
if (monday < '2026-11-01') monday = addDays(monday, 7);
const mondayInFuture = monday > today;

let sessionId: string;
let k = 0;
const key = () => `ops-${Date.now()}-${++k}`;

beforeAll(async () => {
  env = await setup();
  owner = await env.login(DEMO_USERS.owner);
  admin = await env.login(DEMO_USERS.adminChilonzor);
  coach1 = await env.login(DEMO_USERS.coach1);
  coach2 = await env.login(DEMO_USERS.coach2);
});
afterAll(() => env.close());

describe.skipIf(mondayInFuture)('sessions & attendance', () => {
  it('lessons are generated from the weekly schedule, scoped per coach', async () => {
    const c1 = await coach1.get(`/api/sessions?date=${monday}`);
    expect(c1.status).toBe(200);
    expect(c1.body.sessions.map((s: { groupId: string }) => s.groupId)).toEqual([env.demo.groups[0]]); // group 3 trains Tue/Thu/Sat
    const c2 = await coach2.get(`/api/sessions?date=${monday}`);
    expect(c2.body.sessions.map((s: { groupId: string }) => s.groupId)).toEqual([env.demo.groups[1]]);
    const again = await owner.get(`/api/sessions?date=${monday}`);
    expect(again.body.sessions).toHaveLength(2); // idempotent generation, Chilonzor groups only on Monday
    sessionId = c1.body.sessions[0].id;
  });

  it('sheet shows enrolled athletes with subscription info; coach sees no amounts', async () => {
    const r = await coach1.get(`/api/sessions/${sessionId}/attendance`);
    expect(r.status).toBe(200);
    expect(r.body.rows).toHaveLength(6);
    const pack = r.body.rows.find((x: { athleteId: string }) => x.athleteId === env.demo.athletes[2]);
    expect(pack.subscription).toMatchObject({ billingType: 'session_pack', remainingSessions: 9 });
    expect(Object.keys(pack)).not.toContain('balance');
    expect((await coach2.get(`/api/sessions/${sessionId}/attendance`)).status).toBe(404);
  });

  it('marking deducts the lesson pack once; edits adjust; one row per athlete', async () => {
    const a = env.demo.athletes[2];
    const used = async () =>
      (await env.handle.db.select().from(subscriptions).where(and(eq(subscriptions.athleteId, a), eq(subscriptions.billingType, 'session_pack'))))[0].usedSessions;
    expect(await used()).toBe(3);
    const mark = (status: string) => coach1.put(`/api/sessions/${sessionId}/attendance`, { marks: [{ athleteId: a, status }] });
    expect((await mark('present')).status).toBe(200);
    expect(await used()).toBe(4);
    await mark('present');
    expect(await used()).toBe(4);
    await mark('excused'); // excused does not consume
    expect(await used()).toBe(3);
    await mark('absent'); // absent consumes (decision #2)
    expect(await used()).toBe(4);
    const rows = await env.handle.db.select().from(attendance).where(and(eq(attendance.sessionId, sessionId), eq(attendance.athleteId, a)));
    expect(rows).toHaveLength(1);
    expect(rows[0].updatedBy).not.toBeNull();
  });

  it('the database refuses a second attendance row for the same athlete and lesson', async () => {
    const [row] = await env.handle.db.select().from(attendance).where(eq(attendance.sessionId, sessionId));
    await expect(
      env.handle.db.insert(attendance).values({ clubId: row.clubId, sessionId, athleteId: row.athleteId, status: 'present' }),
    ).rejects.toThrow();
  });

  it('coach can mark only own group; athletes must be in the group', async () => {
    const other = (await coach2.get(`/api/sessions?date=${monday}`)).body.sessions[0].id;
    expect((await coach1.put(`/api/sessions/${other}/attendance`, { marks: [{ athleteId: env.demo.athletes[6], status: 'present' }] })).status).toBe(404);
    const r = await coach1.put(`/api/sessions/${sessionId}/attendance`, { marks: [{ athleteId: env.demo.athletes[6], status: 'present' }] });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('not_in_group');
  });

  it('a single-lesson pack expires when used and comes back if the mark is undone', async () => {
    const plan = (await owner.post('/api/plans', { name: 'Bitta dars', kind: 'single', billingType: 'session_pack', price: 50_000, sessionLimit: 1 })).body;
    const a = (
      await owner.post('/api/athletes', { fullName: 'Bir martalik', branchId: env.demo.branches.chilonzor, groupId: env.demo.groups[0], joinedAt: '2026-11-01', forceCapacity: true })
    ).body.id;
    const s = (await owner.post('/api/subscriptions', { athleteId: a, planId: plan.id, startDate: '2026-11-01' })).body.subscription;
    await coach1.put(`/api/sessions/${sessionId}/attendance`, { marks: [{ athleteId: a, status: 'present' }] });
    const st = async () => (await env.handle.db.select().from(subscriptions).where(eq(subscriptions.id, s.id)))[0].status;
    expect(await st()).toBe('expired');
    await coach1.put(`/api/sessions/${sessionId}/attendance`, { marks: [{ athleteId: a, status: 'excused' }] });
    expect(await st()).toBe('active');
  });

  it('debtors: warning by default, blocked when the club chooses', async () => {
    const a = (
      await owner.post('/api/athletes', { fullName: 'Qarzdor Bola', branchId: env.demo.branches.chilonzor, groupId: env.demo.groups[0], joinedAt: '2026-11-01', forceCapacity: true })
    ).body.id;
    await owner.post('/api/charges', { athleteId: a, amount: 100_000, description: 'Qarz', dueDate: '2026-11-01' });
    const r = await coach1.put(`/api/sessions/${sessionId}/attendance`, { marks: [{ athleteId: a, status: 'present' }] });
    expect(r.status).toBe(200);
    expect(r.body.warnings.join(' ')).toMatch(/qarzdor/);
    await owner.patch('/api/club/settings', { debtorPolicy: 'block' });
    await coach1.put(`/api/sessions/${sessionId}/attendance`, { marks: [{ athleteId: a, status: 'absent' }] });
    const blocked = await coach1.put(`/api/sessions/${sessionId}/attendance`, { marks: [{ athleteId: a, status: 'present' }] });
    expect(blocked.status).toBe(409);
    await owner.patch('/api/club/settings', { debtorPolicy: 'warn' });
  });

  it('future lessons cannot be marked; cancelled lessons cannot be marked or cancelled after marking', async () => {
    const future = (await owner.get(`/api/sessions?date=${addDays(monday, 7)}`)).body.sessions[0];
    if (addDays(monday, 7) > today) {
      const r = await owner.put(`/api/sessions/${future.id}/attendance`, { marks: [{ athleteId: env.demo.athletes[0], status: 'present' }] });
      expect(r.status).toBe(400);
    }
    expect((await owner.patch(`/api/sessions/${sessionId}`, { status: 'cancelled' })).status).toBe(409);
    const c = await admin.patch(`/api/sessions/${future.id}`, { status: 'cancelled', note: 'Bayram' });
    expect(c.body.status).toBe('cancelled');
    expect((await coach1.patch(`/api/sessions/${future.id}`, { status: 'scheduled' })).status).toBe(403);
  });

  it('attendance report counts marks', async () => {
    const r = await owner.get(`/api/reports/attendance?from=${monday}&to=${monday}&groupId=${env.demo.groups[0]}`);
    expect(r.status).toBe(200);
    expect(r.body.totals.total).toBeGreaterThan(0);
    const c2 = await coach2.get(`/api/reports/attendance?from=${monday}&to=${monday}`);
    expect(c2.body.rows.every((x: { groupId: string }) => x.groupId === env.demo.groups[1])).toBe(true);
  });
});

describe('expenses', () => {
  it('admin records own-branch expenses only; club-wide is owner-only; voiding keeps the row', async () => {
    const e = await admin.post('/api/expenses', { branchId: env.demo.branches.chilonzor, category: 'utilities', amount: 300_000, note: 'Elektr' });
    expect(e.status).toBe(201);
    expect((await admin.post('/api/expenses', { branchId: null, category: 'rent', amount: 1 })).status).toBe(403);
    expect((await admin.post('/api/expenses', { branchId: env.demo.branches.yunusobod, category: 'rent', amount: 1 })).status).toBe(403);
    expect((await owner.post('/api/expenses', { branchId: null, category: 'marketing', amount: 500_000 })).status).toBe(201);
    const v = await admin.post(`/api/expenses/${e.body.id}/void`, { reason: 'Xato summa' });
    expect(v.body.voidedAt).not.toBeNull();
    const list = await admin.get('/api/expenses');
    expect(list.body.find((x: { id: string }) => x.id === e.body.id)).toBeUndefined();
    const withVoided = await admin.get('/api/expenses?includeVoided=true');
    expect(withVoided.body.find((x: { id: string }) => x.id === e.body.id)).toBeDefined();
  });
});

describe('payroll', () => {
  const ps = '2026-11-01';
  const pe = '2026-11-30';

  it('percent of actual cash for coach 2; corrections only after closing; payout becomes an expense', async () => {
    const coach2Id = env.demo.coaches[1];
    expect((await owner.post('/api/payroll/rules', { coachId: coach2Id, model: 'revenue_percent', percentBp: 1000, validFrom: '2026-01-01' })).status).toBe(201);
    expect((await admin.post('/api/payroll/rules', { coachId: coach2Id, model: 'per_session', perSessionAmount: 1, validFrom: '2026-01-01' })).status).toBe(403);
    const calc = await owner.post('/api/payroll/calculate', { periodStart: ps, periodEnd: pe, coachId: coach2Id });
    expect(calc.status).toBe(200);
    // group 1 athletes 6–10: seeded payments 400 000 + 450 000 + 150 000 (all paid "now")
    expect(calc.body.results[0].accrued).toBe(100_000);

    const entry = (await owner.get(`/api/payroll?periodStart=${ps}&coachId=${coach2Id}`)).body[0];
    expect(entry.details.byBranch).toEqual({ [env.demo.branches.chilonzor]: 100_000 });
    await owner.patch(`/api/payroll/${entry.id}`, { bonus: 50_000 });
    expect((await owner.post(`/api/payroll/${entry.id}/close`)).status).toBe(200);
    expect((await owner.patch(`/api/payroll/${entry.id}`, { bonus: 1 })).status).toBe(409);
    const recalc = await owner.post('/api/payroll/calculate', { periodStart: ps, periodEnd: pe, coachId: coach2Id });
    expect(recalc.body.results[0].skipped).toBe('closed');
    expect((await owner.post(`/api/payroll/${entry.id}/correction`, { amount: -20_000, note: 'Ushlanma' })).status).toBe(201);

    const paid = await owner.post(`/api/payroll/${entry.id}/pay`, { amount: 150_000, branchId: env.demo.branches.chilonzor });
    expect(paid.body.paid).toBe(150_000);
    expect((await owner.post(`/api/payroll/${entry.id}/pay`, { amount: 1 })).status).toBe(400);
    const exp = await owner.get('/api/expenses?category=salary');
    expect(exp.body.some((e: { amount: number }) => e.amount === 150_000)).toBe(true);
    const all = (await owner.get(`/api/payroll?periodStart=${ps}&coachId=${coach2Id}`)).body;
    expect(all).toHaveLength(2);
  });

  it.skipIf(mondayInFuture)('per-session rule counts held lessons', async () => {
    const coach1Id = env.demo.coaches[0];
    await owner.post('/api/payroll/rules', { coachId: coach1Id, model: 'per_session', perSessionAmount: 100_000, validFrom: '2026-01-01' });
    const calc = await owner.post('/api/payroll/calculate', { periodStart: ps, periodEnd: pe, coachId: coach1Id });
    expect(calc.body.results[0].accrued).toBeGreaterThanOrEqual(100_000);
  });
});

describe('reports', () => {
  it('summary: cash ≠ accrued, branch rows sum to totals, club-wide expenses apart', async () => {
    const pay = await owner.post('/api/payments', { athleteId: env.demo.athletes[15], amount: 100_000 }, { 'idempotency-key': key() });
    expect(pay.status).toBe(201);
    const r = await owner.get(`/api/reports/summary?from=2026-11-01&to=${today}`);
    expect(r.status).toBe(200);
    const t = r.body.totals;
    const s = (k: string) => r.body.branches.reduce((a: number, b: Record<string, number>) => a + b[k], 0);
    expect(s('cashIncome')).toBe(t.cashIncome);
    expect(s('accruedSales')).toBe(t.accruedSales);
    expect(s('expenses')).toBe(t.branchExpenses);
    expect(t.operatingResult).toBe(t.cashIncome - t.branchExpenses - t.clubWideExpenses);
    expect(t.cashIncome).not.toBe(t.accruedSales);
    expect(r.body.bySport.length).toBeGreaterThan(0);
    const adminView = await admin.get(`/api/reports/summary?from=2026-11-01&to=${today}`);
    expect(adminView.body.branches).toHaveLength(1);
    expect(adminView.body.totals.clubWideExpenses).toBe(0);
  });
});

describe('daily job', () => {
  it('expires ended subscriptions and renews them for active, enrolled athletes', async () => {
    const a = (
      await owner.post('/api/athletes', { fullName: 'Avto Yangilash', branchId: env.demo.branches.chilonzor, groupId: env.demo.groups[1], joinedAt: '2026-10-01' })
    ).body.id;
    const start = addDays(today, -30); // 30-day plan → ended yesterday
    const s = (await owner.post('/api/subscriptions', { athleteId: a, planId: env.demo.plans.days30, startDate: start })).body.subscription;
    expect(s.endDate).toBe(addDays(today, -1));
    const r1 = await owner.post('/api/club/jobs/daily');
    expect(r1.status).toBe(200);
    expect(r1.body.expired).toBeGreaterThanOrEqual(1);
    expect(r1.body.renewed).toBeGreaterThanOrEqual(1);
    const subs = (await owner.get(`/api/subscriptions?athleteId=${a}`)).body;
    expect(subs.map((x: { status: string }) => x.status).sort()).toEqual(['active', 'expired']);
    const renewed = subs.find((x: { status: string }) => x.status === 'active');
    expect(renewed.startDate).toBe(today);
    const r2 = await owner.post('/api/club/jobs/daily');
    expect(r2.body.renewed).toBe(0); // idempotent
    const p = await owner.get(`/api/athletes/${a}`);
    expect(p.body.charges).toHaveLength(2);
  });
});

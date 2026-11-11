/**
 * Sprint 1 demo (PRD §17): club owner logs in, creates an athlete, adds them to a group,
 * and assigns a subscription. Plus CRM rules from PRD §4–5.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { setup, type TestEnv, type Api } from './helpers.js';
import { DEMO_USERS } from '../src/db/seed-data.js';
import { auditLogs } from '../src/db/schema.js';

let env: TestEnv;
let owner: Api;

beforeAll(async () => {
  env = await setup();
  owner = await env.login(DEMO_USERS.owner);
});
afterAll(() => env.close());

describe('sprint demo flow', () => {
  it('owner: create athlete → group → subscription → charge → balance', async () => {
    const me = await owner.get('/api/auth/me');
    expect(me.body.club.role).toBe('owner');

    // 1. create athlete with guardian; the guardian's phone already belongs to a parent of two kids
    const a = await owner.post('/api/athletes', {
      fullName: 'Karimov Umar',
      birthDate: '2016-03-10',
      branchId: env.demo.branches.chilonzor,
      guardians: [{ fullName: 'Karimova Nilufar', phone: '+998 90 111 00 00', relation: 'mother' }],
    });
    expect(a.status).toBe(201);
    const athleteId = a.body.id;

    // 2. add to group
    const e = await owner.post(`/api/athletes/${athleteId}/enrollments`, { groupId: env.demo.groups[0], startDate: '2026-11-04' });
    expect(e.status).toBe(201);

    // 3. assign calendar-month plan (400 000), joined on the 4th → prorated 27/30 = 360 000
    const s = await owner.post('/api/subscriptions', { athleteId, planId: env.demo.plans.month, startDate: '2026-11-04' });
    expect(s.status).toBe(201);
    expect(s.body.subscription).toMatchObject({ startDate: '2026-11-04', endDate: '2026-11-30', price: 360_000, status: 'active' });
    expect(s.body.pricing.prorated).toBe(true);
    expect(s.body.charge).toMatchObject({ amount: 360_000, dueDate: '2026-11-04', status: 'open' });

    // 4. profile shows everything
    const p = await owner.get(`/api/athletes/${athleteId}`);
    expect(p.body.enrollments[0]).toMatchObject({ groupId: env.demo.groups[0], status: 'active' });
    expect(p.body.subscriptions).toHaveLength(1);
    expect(p.body.balance).toMatchObject({ charged: 360_000, debt: 360_000 });
    expect(p.body.guardians[0]).toMatchObject({ id: env.demo.sharedGuardianId, relation: 'mother', isPrimary: true });

    // the shared guardian is now linked to 3 children (no duplicate guardian created)
    const group = await owner.get(`/api/groups/${env.demo.groups[0]}`);
    expect(group.body.athletes.map((x: { athleteId: string }) => x.athleteId)).toContain(athleteId);

    // 5. audited
    const logs = await env.handle.db.select().from(auditLogs).where(eq(auditLogs.entityId, s.body.subscription.id));
    expect(logs).toHaveLength(1);
  });

  it('seeded partial payment: 400 000 charge − 150 000 paid = 250 000 debt', async () => {
    const p = await owner.get(`/api/athletes/${env.demo.athletes[9]}`);
    expect(p.body.balance).toMatchObject({ charged: 400_000, paid: 150_000, debt: 250_000 });
    const debtors = await owner.get('/api/athletes?debt=true&limit=200');
    expect(debtors.body.items.map((x: { id: string }) => x.id)).toContain(env.demo.athletes[9]);
    expect(debtors.body.items.map((x: { id: string }) => x.id)).not.toContain(env.demo.athletes[0]);
  });
});

describe('subscriptions', () => {
  it('30-day and 12-lesson plans compute correctly', async () => {
    const a = (await owner.post('/api/athletes', { fullName: 'Test Ikki', branchId: env.demo.branches.chilonzor })).body.id;
    const s30 = await owner.post('/api/subscriptions', { athleteId: a, planId: env.demo.plans.days30, startDate: '2026-11-15' });
    expect(s30.body.subscription).toMatchObject({ endDate: '2026-12-14', price: 450_000 });
    const s12 = await owner.post('/api/subscriptions', { athleteId: a, planId: env.demo.plans.pack12, startDate: '2026-11-15' });
    expect(s12.body.subscription).toMatchObject({ sessionLimit: 12, usedSessions: 0, remainingSessions: 12, endDate: '2026-12-29' });
  });

  it('discount requires a reason', async () => {
    const a = env.demo.athletes[19];
    const bad = await owner.post('/api/subscriptions', { athleteId: a, planId: env.demo.plans.month, discount: 50_000 });
    expect(bad.status).toBe(400);
    const ok = await owner.post('/api/subscriptions', {
      athleteId: a,
      planId: env.demo.plans.month,
      startDate: '2026-12-01',
      discount: 50_000,
      discountReason: 'Aka-uka chegirmasi',
    });
    expect(ok.status).toBe(201);
    expect(ok.body.subscription).toMatchObject({ listPrice: 400_000, discount: 50_000, price: 350_000 });
  });

  it('proration follows the club setting (default daily, switchable to full)', async () => {
    const a = (await owner.post('/api/athletes', { fullName: 'Proratsiya', branchId: env.demo.branches.chilonzor })).body.id;
    const s = await owner.post('/api/subscriptions', { athleteId: a, planId: env.demo.plans.month, startDate: '2026-11-16' });
    expect(s.body.subscription.price).toBe(200_000);
    expect((await owner.patch('/api/club/settings', { calendarProration: 'full' })).status).toBe(200);
    const s2 = await owner.post('/api/subscriptions', { athleteId: a, planId: env.demo.plans.month, startDate: '2026-12-16' });
    expect(s2.body.subscription.price).toBe(400_000);
    await owner.patch('/api/club/settings', { calendarProration: 'daily' });
  });

  it('freeze extends the end date and respects limits', async () => {
    const a = (await owner.post('/api/athletes', { fullName: 'Muzlatish', branchId: env.demo.branches.chilonzor })).body.id;
    const s = (await owner.post('/api/subscriptions', { athleteId: a, planId: env.demo.plans.days30, startDate: '2026-11-01' })).body
      .subscription;
    const f = await owner.post(`/api/subscriptions/${s.id}/freeze`, { fromDate: '2026-11-20', toDate: '2026-11-26', reason: 'Kasallik' });
    expect(f.status).toBe(200);
    expect(f.body.endDate).toBe('2026-12-07');
    const tooLong = await owner.post(`/api/subscriptions/${s.id}/freeze`, { fromDate: '2026-11-27', toDate: '2026-12-31', reason: 'Safar' });
    expect(tooLong.status).toBe(422);
  });

  it('cancel can void an unpaid charge', async () => {
    const a = (await owner.post('/api/athletes', { fullName: 'Bekor', branchId: env.demo.branches.chilonzor })).body.id;
    const s = (await owner.post('/api/subscriptions', { athleteId: a, planId: env.demo.plans.days30 })).body.subscription;
    const c = await owner.post(`/api/subscriptions/${s.id}/cancel`, { reason: 'Xato kiritilgan', voidUnpaidCharge: true });
    expect(c.body.voidedCharges).toHaveLength(1);
    const p = await owner.get(`/api/athletes/${a}`);
    expect(p.body.balance.debt).toBe(0);
  });
});

describe('CRM rules', () => {
  it('capacity: warn requires confirmation; block refuses', async () => {
    const g = await owner.post('/api/groups', {
      name: 'Kichik guruh',
      branchId: env.demo.branches.chilonzor,
      sportId: (await owner.get('/api/sports')).body[0].id,
      capacity: 1,
    });
    const [a1, a2] = await Promise.all(
      ['Bir', 'Ikki'].map(async (n) => (await owner.post('/api/athletes', { fullName: `Sig‘im ${n}`, branchId: env.demo.branches.chilonzor })).body.id),
    );
    expect((await owner.post(`/api/athletes/${a1}/enrollments`, { groupId: g.body.id })).status).toBe(201);
    const warn = await owner.post(`/api/athletes/${a2}/enrollments`, { groupId: g.body.id });
    expect(warn.status).toBe(409);
    expect(warn.body.error).toBe('group_full_warning');
    await owner.patch('/api/club/settings', { capacityPolicy: 'block' });
    const blocked = await owner.post(`/api/athletes/${a2}/enrollments`, { groupId: g.body.id, forceCapacity: true });
    expect(blocked.body.error).toBe('group_full');
    await owner.patch('/api/club/settings', { capacityPolicy: 'warn' });
    const forced = await owner.post(`/api/athletes/${a2}/enrollments`, { groupId: g.body.id, forceCapacity: true });
    expect(forced.status).toBe(201);
    expect(forced.body.warnings[0]).toMatch(/Over capacity/);
  });

  it('move between groups keeps history; duplicate enrollment refused', async () => {
    const id = env.demo.athletes[2];
    const before = (await owner.get(`/api/athletes/${id}`)).body.enrollments[0];
    const dup = await owner.post(`/api/athletes/${id}/enrollments`, { groupId: before.groupId });
    expect(dup.status).toBe(409);
    const mv = await owner.post(`/api/athletes/${id}/enrollments`, {
      groupId: env.demo.groups[1],
      fromEnrollmentId: before.id,
      reason: 'Yoshi bo‘yicha',
    });
    expect(mv.status).toBe(201);
    const after = (await owner.get(`/api/athletes/${id}`)).body.enrollments;
    expect(after).toHaveLength(2);
    expect(after.find((e: { id: string }) => e.id === before.id).status).toBe('ended');
  });

  it('archive closes enrollments and hides from default list', async () => {
    const id = env.demo.athletes[3];
    expect((await owner.patch(`/api/athletes/${id}`, { status: 'archived' })).status).toBe(200);
    const p = (await owner.get(`/api/athletes/${id}`)).body;
    expect(p.enrollments.every((e: { status: string }) => e.status === 'ended')).toBe(true);
    const list = await owner.get('/api/athletes?limit=200');
    expect(list.body.items.map((x: { id: string }) => x.id)).not.toContain(id);
    const archived = await owner.get('/api/athletes?status=archived');
    expect(archived.body.items.map((x: { id: string }) => x.id)).toContain(id);
  });

  it('search and filters', async () => {
    const byName = await owner.get('/api/athletes?q=Karimov');
    expect(byName.body.items.length).toBeGreaterThan(0);
    const byGroup = await owner.get(`/api/athletes?groupId=${env.demo.groups[2]}`);
    expect(byGroup.body.total).toBe(5);
    const kids = await owner.get('/api/athletes?ageMax=12&limit=200');
    expect(kids.body.items.every((a: { birthDate: string }) => a.birthDate > '2013-11-04')).toBe(true);
    const noSub = await owner.get('/api/athletes?subscription=none&limit=200');
    expect(noSub.body.items.map((x: { id: string }) => x.id)).toContain(env.demo.athletes[15]);
  });

  it('validation errors are 400 with details', async () => {
    const r = await owner.post('/api/athletes', { fullName: 'X', branchId: 'not-a-uuid', birthDate: '2020-13-45' });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('validation_error');
  });
});

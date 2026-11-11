/** PRD §2 / §14: coach only sees own groups; branch admin works within own branch. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setup, type TestEnv, type Api } from './helpers.js';
import { DEMO_USERS } from '../src/db/seed-data.js';

let env: TestEnv;
let owner: Api;
let admin: Api;
let coach1: Api;
let coach2: Api;

beforeAll(async () => {
  env = await setup();
  owner = await env.login(DEMO_USERS.owner);
  admin = await env.login(DEMO_USERS.adminChilonzor);
  coach1 = await env.login(DEMO_USERS.coach1);
  coach2 = await env.login(DEMO_USERS.coach2);
});
afterAll(() => env.close());

describe('branch administrator', () => {
  it('sees only own-branch athletes, groups, branches', async () => {
    const list = await admin.get('/api/athletes?limit=200');
    expect(list.status).toBe(200);
    expect(list.body.total).toBe(11); // athletes 0–10 are in Chilonzor
    expect(list.body.items.every((a: { branchId: string }) => a.branchId === env.demo.branches.chilonzor)).toBe(true);

    const groups = await admin.get('/api/groups');
    expect(groups.body.map((g: { id: string }) => g.id).sort()).toEqual([env.demo.groups[0], env.demo.groups[1]].sort());

    const branches = await admin.get('/api/branches');
    expect(branches.body.map((b: { id: string }) => b.id)).toEqual([env.demo.branches.chilonzor]);
  });

  it('cannot access the other branch', async () => {
    const yunusobodAthlete = env.demo.athletes[15];
    expect((await admin.get(`/api/athletes/${yunusobodAthlete}`)).status).toBe(404);
    expect((await admin.get(`/api/groups/${env.demo.groups[2]}`)).status).toBe(404);
    const r = await admin.post('/api/athletes', { fullName: 'Boshqa filial', branchId: env.demo.branches.yunusobod });
    expect(r.status).toBe(403);
    const e = await admin.post(`/api/athletes/${env.demo.athletes[0]}/enrollments`, { groupId: env.demo.groups[2] });
    expect(e.status).toBe(404);
  });

  it('can create athletes and subscriptions in own branch', async () => {
    const r = await admin.post('/api/athletes', { fullName: 'Yangi Sportchi', branchId: env.demo.branches.chilonzor, groupId: env.demo.groups[0] });
    expect(r.status).toBe(201);
    const s = await admin.post('/api/subscriptions', { athleteId: r.body.id, planId: env.demo.plans.days30, startDate: '2026-11-04' });
    expect(s.status).toBe(201);
  });

  it('cannot do owner-only operations', async () => {
    expect((await admin.post('/api/branches', { name: 'X filial' })).status).toBe(403);
    expect((await admin.post('/api/plans', { name: 'X', billingType: 'fixed_days', price: 1 })).status).toBe(403);
    expect((await admin.get('/api/staff')).status).toBe(403);
    expect((await admin.patch('/api/club/settings', { capacityPolicy: 'block' })).status).toBe(403);
    expect((await admin.post('/api/sports', { name: 'Karate' })).status).toBe(403);
  });
});

describe('coach', () => {
  it('sees only assigned groups (across branches)', async () => {
    const g = await coach1.get('/api/groups');
    expect(g.status).toBe(200);
    expect(g.body.map((x: { id: string }) => x.id).sort()).toEqual([env.demo.groups[0], env.demo.groups[3]].sort());
    expect((await coach2.get(`/api/groups/${env.demo.groups[0]}`)).status).toBe(404);
    expect((await coach1.get(`/api/groups/${env.demo.groups[0]}`)).status).toBe(200);
  });

  it('sees only athletes of own groups, without finances', async () => {
    const list = await coach2.get('/api/athletes?limit=200');
    expect(list.body.total).toBe(5); // group 1 = athletes 6–10
    expect(list.body.items[0].balance).toBeUndefined();
    const own = await coach2.get(`/api/athletes/${env.demo.athletes[6]}`);
    expect(own.status).toBe(200);
    expect(own.body.balance).toBeUndefined();
    expect(own.body.charges).toBeUndefined();
    expect(own.body.payments).toBeUndefined();
    expect((await coach2.get(`/api/athletes/${env.demo.athletes[0]}`)).status).toBe(404);
  });

  it('cannot manage CRM or billing', async () => {
    expect((await coach1.post('/api/athletes', { fullName: 'X', branchId: env.demo.branches.chilonzor })).status).toBe(403);
    expect((await coach1.post('/api/subscriptions', { athleteId: env.demo.athletes[0], planId: env.demo.plans.month })).status).toBe(403);
    expect((await coach1.get('/api/subscriptions')).status).toBe(403);
    expect((await coach1.get('/api/plans')).status).toBe(403);
    expect((await coach1.post('/api/groups', {})).status).toBe(403);
  });
});

describe('membership changes take effect immediately', () => {
  it('disabled staff membership is rejected on the next request', async () => {
    const created = await owner.post('/api/staff', {
      email: 'temp.admin@demo-mma.uz',
      fullName: 'Vaqtinchalik Admin',
      password: 'temp-pass-123',
      role: 'branch_admin',
      branchIds: [env.demo.branches.yunusobod],
    });
    expect(created.status).toBe(201);
    const temp = await env.login('temp.admin@demo-mma.uz', 'temp-pass-123');
    expect((await temp.get('/api/athletes')).body.total).toBe(9);
    await owner.patch(`/api/staff/${created.body.membershipId}`, { status: 'disabled' });
    expect((await temp.get('/api/athletes')).status).toBe(401);
  });

  it('branch admin requires a branch', async () => {
    const r = await owner.post('/api/staff', { email: 'x@y.uz', fullName: 'X Y', password: 'password1', role: 'branch_admin' });
    expect(r.status).toBe(400);
  });
});

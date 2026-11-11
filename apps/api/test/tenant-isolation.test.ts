/** PRD §14: "Club A user cannot see club B athletes and finances via the API." */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setup, type TestEnv, type Api } from './helpers.js';
import { DEMO_USERS } from '../src/db/seed-data.js';

let env: TestEnv;
let ownerA: Api;
let ownerB: Api;

beforeAll(async () => {
  env = await setup();
  ownerA = await env.login(DEMO_USERS.owner);
  ownerB = await env.login(env.clubB.ownerEmail, 'password-b-123');
});
afterAll(() => env.close());

describe('tenant isolation', () => {
  it('lists only own-club records', async () => {
    const a = await ownerA.get('/api/athletes?limit=200');
    expect(a.status).toBe(200);
    expect(a.body.total).toBe(20);
    expect(a.body.items.map((x: { id: string }) => x.id)).not.toContain(env.clubB.athleteId);

    const b = await ownerB.get('/api/athletes');
    expect(b.body.total).toBe(1);
    expect(b.body.items[0].id).toBe(env.clubB.athleteId);

    const branchesB = await ownerB.get('/api/branches');
    expect(branchesB.body.map((x: { id: string }) => x.id)).toEqual([env.clubB.branchId]);
  });

  it('cannot read another club’s athlete, group, finances (404, no existence leak)', async () => {
    const athleteA = env.demo.athletes[9]; // has a 250 000 debt
    expect((await ownerB.get(`/api/athletes/${athleteA}`)).status).toBe(404);
    expect((await ownerB.get(`/api/groups/${env.demo.groups[0]}`)).status).toBe(404);
    const subs = await ownerB.get(`/api/subscriptions?athleteId=${athleteA}`);
    expect(subs.status).toBe(200);
    expect(subs.body).toEqual([]);
    expect((await ownerA.get(`/api/athletes/${env.clubB.athleteId}`)).status).toBe(404);
  });

  it('cannot write into another club', async () => {
    // assign club A plan to club B athlete, and club B plan to club A athlete
    expect((await ownerB.post('/api/subscriptions', { athleteId: env.demo.athletes[0], planId: env.demo.plans.month })).status).toBe(404);
    expect((await ownerA.post('/api/subscriptions', { athleteId: env.clubB.athleteId, planId: env.demo.plans.month })).status).toBe(404);
    // patch a foreign branch / athlete
    expect((await ownerB.patch(`/api/branches/${env.demo.branches.chilonzor}`, { name: 'hacked' })).status).toBe(404);
    expect((await ownerB.patch(`/api/athletes/${env.demo.athletes[0]}`, { fullName: 'hacked' })).status).toBe(404);
    // create in a foreign branch
    const r = await ownerB.post('/api/athletes', { fullName: 'Intruder', branchId: env.demo.branches.chilonzor });
    expect(r.status).toBe(400);
    const g = await ownerB.post('/api/groups', {
      name: 'x',
      branchId: env.clubB.branchId,
      sportId: (await ownerA.get('/api/sports')).body[0].id,
    });
    expect(g.status).toBe(400); // foreign sport rejected
  });

  it('ignores a club_id supplied by the client', async () => {
    const r = await ownerB.post('/api/branches', { name: 'Sneaky', clubId: env.demo.clubId, club_id: env.demo.clubId });
    expect(r.status).toBe(201);
    const aBranches = await ownerA.get('/api/branches');
    expect(aBranches.body.map((b: { name: string }) => b.name)).not.toContain('Sneaky');
  });

  it('dashboard totals are per club', async () => {
    const a = await ownerA.get('/api/club/dashboard');
    const b = await ownerB.get('/api/club/dashboard');
    expect(a.body.activeAthletes).toBe(20);
    expect(b.body.activeAthletes).toBe(1);
    expect(b.body.totalDebt).toBe(0);
  });
});

describe('authentication', () => {
  it('rejects missing, invalid and tampered tokens', async () => {
    expect((await env.app.inject({ method: 'GET', url: '/api/athletes' })).statusCode).toBe(401);
    expect(
      (await env.app.inject({ method: 'GET', url: '/api/athletes', headers: { authorization: 'Bearer nope' } })).statusCode,
    ).toBe(401);
    const parts = ownerA.token.split('.');
    const forged = [parts[0], Buffer.from(JSON.stringify({ sub: 'x', mid: 'y' })).toString('base64url'), parts[2]].join('.');
    expect(
      (await env.app.inject({ method: 'GET', url: '/api/athletes', headers: { authorization: `Bearer ${forged}` } })).statusCode,
    ).toBe(401);
  });

  it('rejects wrong password with a generic message', async () => {
    const r = await env.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: DEMO_USERS.owner, password: 'wrong' } });
    expect(r.statusCode).toBe(401);
    const r2 = await env.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'nobody@x.uz', password: 'wrong' } });
    expect(r2.json().message).toBe(r.json().message);
  });

  it('superadmin manages clubs but has no club data access', async () => {
    const sa = await env.login(DEMO_USERS.superadmin);
    const clubs = await sa.get('/api/platform/clubs');
    expect(clubs.status).toBe(200);
    expect(clubs.body.length).toBe(2);
    expect((await sa.get('/api/athletes')).status).toBe(403);
    expect((await ownerA.get('/api/platform/clubs')).status).toBe(403);
  });

  it('suspending a club blocks its users', async () => {
    const sa = await env.login(DEMO_USERS.superadmin);
    await sa.patch(`/api/platform/clubs/${env.clubB.clubId}`, { status: 'suspended' });
    expect((await ownerB.get('/api/athletes')).status).toBe(403);
    await sa.patch(`/api/platform/clubs/${env.clubB.clubId}`, { status: 'active' });
    expect((await ownerB.get('/api/athletes')).status).toBe(200);
  });
});

/** The athlete list shows the current plan and last visit; coaches still never see money. */
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

const find = async (api: Api, name: string) => {
  const r = await api.get(`/api/athletes?q=${encodeURIComponent(name)}`);
  expect(r.status).toBe(200);
  return r.body.items[0];
};

describe('GET /athletes list columns', () => {
  it('is null without a subscription or a visit, then shows the running subscription', async () => {
    const a = await owner.post('/api/athletes', { fullName: 'Royxat Sportchi', branchId: env.demo.branches.chilonzor });
    const before = await find(owner, 'Royxat Sportchi');
    expect(before.subscription).toBeNull();
    expect(before.lastSeen).toBeNull();

    const plans = await owner.get('/api/plans');
    const plan = plans.body.find((p: { active: boolean }) => p.active);
    const sub = await owner.post('/api/subscriptions', { athleteId: a.body.id, planId: plan.id, startDate: '2026-11-01' });
    expect(sub.status).toBeLessThan(300);

    const after = await find(owner, 'Royxat Sportchi');
    expect(after.subscription.planName).toBe(plan.name);
    expect(after.subscription.status).toBe('active');
    expect(after.subscription.startDate).toBe('2026-11-01');
  });

  it('a coach gets the same plan column but no balance', async () => {
    const a = await owner.post('/api/athletes', { fullName: 'Murabbiy Sportchisi', branchId: env.demo.branches.chilonzor });
    await owner.post(`/api/athletes/${a.body.id}/enrollments`, { groupId: env.demo.groups[0], startDate: '2026-11-04' });
    const coach = await env.login(DEMO_USERS.coach1);
    const item = await find(coach, 'Murabbiy Sportchisi');
    expect(item).toHaveProperty('subscription');
    expect(item).toHaveProperty('lastSeen');
    expect(item).not.toHaveProperty('balance');
  });
});

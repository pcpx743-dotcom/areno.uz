/** Paging contract the web app relies on: athletes are paged on the server, other journals return complete lists. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setup, type TestEnv, type Api } from './helpers.js';
import { DEMO_USERS } from '../src/db/seed-data.js';
import { LIST_MAX, page } from '../src/lib/scope.js';

let env: TestEnv;
let owner: Api;

beforeAll(async () => {
  env = await setup();
  owner = await env.login(DEMO_USERS.owner);
});
afterAll(() => env.close());

describe('pagination', () => {
  it('page() clamps limit and offset', () => {
    expect(page({})).toEqual({ limit: 50, offset: 0 });
    expect(page({ limit: 10_000, offset: -5 })).toEqual({ limit: 200, offset: 0 });
    expect(page({ limit: 10_000 }, LIST_MAX)).toEqual({ limit: LIST_MAX, offset: 0 });
  });

  it('athlete pages are disjoint, stable, and cover the whole list', async () => {
    // Same-name athletes force the id tiebreak to matter.
    for (let i = 0; i < 3; i++) {
      const r = await owner.post('/api/athletes', { fullName: 'Aaa Bir xil', branchId: env.demo.branches.chilonzor });
      expect(r.status).toBe(201);
    }
    const all = await owner.get('/api/athletes?limit=200');
    const total: number = all.body.total;
    expect(total).toBeGreaterThan(4);

    const size = 2;
    const seen: string[] = [];
    for (let offset = 0; offset < total; offset += size) {
      const r = await owner.get(`/api/athletes?limit=${size}&offset=${offset}`);
      expect(r.body.total).toBe(total);
      expect(r.body.items.length).toBe(Math.min(size, total - offset));
      seen.push(...r.body.items.map((a: { id: string }) => a.id));
    }
    expect(new Set(seen).size).toBe(total);
    expect(seen).toEqual(all.body.items.map((a: { id: string }) => a.id));

    const past = await owner.get(`/api/athletes?limit=${size}&offset=${total + 10}`);
    expect(past.body.items).toEqual([]);
    expect(past.body.total).toBe(total);
  });

  it('filtered total matches the filtered rows', async () => {
    const r = await owner.get('/api/athletes?q=Bir%20xil&limit=2');
    expect(r.body.total).toBe(3);
    expect(r.body.items.length).toBe(2);
  });

  it('payments accept a limit above the generic 200 cap', async () => {
    const r = await owner.get(`/api/payments?limit=${LIST_MAX}`);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body)).toBe(true);
  });
});

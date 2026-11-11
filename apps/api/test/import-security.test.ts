/** Phase 5 — CSV import, login rate limiting, passwords. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setup, type TestEnv, type Api } from './helpers.js';
import { DEMO_USERS, DEMO_PASSWORD } from '../src/db/seed-data.js';
import { parseCsv, parseDateLoose } from '../src/lib/csv.js';

let env: TestEnv;
let owner: Api;
let admin: Api;

beforeAll(async () => {
  env = await setup();
  owner = await env.login(DEMO_USERS.owner);
  admin = await env.login(DEMO_USERS.adminChilonzor);
});
afterAll(() => env.close());

describe('csv parsing', () => {
  it('handles quotes, semicolons, BOM and CRLF', () => {
    const rows = parseCsv('﻿a;b;c\r\n"x;1";"say ""hi""";\r\n\r\n3;4;5');
    expect(rows).toEqual([
      ['a', 'b', 'c'],
      ['x;1', 'say "hi"', ''],
      ['3', '4', '5'],
    ]);
    expect(parseCsv('a,b\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });
  it('parses dates in common formats', () => {
    expect(parseDateLoose('15.03.2015')).toBe('2015-03-15');
    expect(parseDateLoose('2015-3-5')).toBe('2015-03-05');
    expect(parseDateLoose('31.02.2015')).toBeNull();
  });
});

describe('athlete import', () => {
  const csv = [
    'F.I.Sh.;Tug‘ilgan sana;Filial;Guruh;Ota-ona;Ota-ona telefon;Aloqa',
    'Import Birinchi;10.05.2014;Chilonzor filiali;MMA Bolalar (8–12);Import Ona;+998 90 555 11 22;ona',
    'Import Ikkinchi;11.06.2013;chilonzor filiali;;Import Ona;+998905551122;ona',
    'Import Uchinchi;;Chilonzor filiali;MMA Kattalar;;;',
  ].join('\n');

  it('dry run validates without writing', async () => {
    const before = (await owner.get('/api/athletes?limit=200')).body.total;
    const r = await owner.post('/api/import/athletes', { csv, dryRun: true });
    expect(r.status).toBe(200);
    expect(r.body.summary).toMatchObject({ total: 3, errors: 0, toImport: 3 });
    expect((await owner.get('/api/athletes?limit=200')).body.total).toBe(before);
  });

  it('any invalid row blocks the whole import', async () => {
    const bad = csv + '\nYomon;32.13.2014;Noma’lum filial;;;;';
    const r = await owner.post('/api/import/athletes', { csv: bad, dryRun: false });
    expect(r.body.imported).toBe(0);
    expect(r.body.summary.errors).toBe(1);
    const row = r.body.rows.find((x: { line: number }) => x.line === 5);
    expect(row.errors.join(' ')).toMatch(/Filial topilmadi/);
    expect(row.errors.join(' ')).toMatch(/sana noto‘g‘ri/);
  });

  it('imports athletes, groups and a shared parent; re-import skips duplicates', async () => {
    const r = await owner.post('/api/import/athletes', { csv, dryRun: false });
    expect(r.body.imported).toBe(3);
    const list = (await owner.get('/api/athletes?q=Import&limit=50')).body.items;
    expect(list).toHaveLength(3);
    const first = (await owner.get(`/api/athletes/${list.find((a: { fullName: string }) => a.fullName === 'Import Birinchi').id}`)).body;
    const second = (await owner.get(`/api/athletes/${list.find((a: { fullName: string }) => a.fullName === 'Import Ikkinchi').id}`)).body;
    expect(first.enrollments[0].groupName).toBe('MMA Bolalar (8–12)');
    expect(first.guardians[0].id).toBe(second.guardians[0].id); // same phone → one parent, two children
    expect(first.guardians[0].relation).toBe('mother');
    const again = await owner.post('/api/import/athletes', { csv, dryRun: false });
    expect(again.body.summary.duplicates).toBe(3);
    expect(again.body.imported).toBe(0);
  });

  it('branch admin cannot import into another branch; required columns enforced', async () => {
    const r = await admin.post('/api/import/athletes', { csv: 'full_name;branch\nX Y;Yunusobod filiali', dryRun: true });
    expect(r.body.rows[0].errors.join(' ')).toMatch(/ruxsat/);
    expect((await owner.post('/api/import/athletes', { csv: 'name\nA', dryRun: true })).status).toBe(400);
  });

  it('provides a template', async () => {
    const r = await env.app.inject({ method: 'GET', url: '/api/import/athletes/template', headers: { authorization: `Bearer ${owner.token}` } });
    expect(r.headers['content-type']).toContain('text/csv');
    expect(r.body).toContain('guardian_phone');
  });
});

describe('security', () => {
  it('locks login after 10 failed attempts for that account', async () => {
    const email = DEMO_USERS.coach3;
    const tryLogin = (password: string) => env.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } });
    for (let i = 0; i < 10; i++) expect((await tryLogin('wrong')).statusCode).toBe(401);
    const locked = await tryLogin(DEMO_PASSWORD);
    expect(locked.statusCode).toBe(429);
    expect(locked.json().error).toBe('too_many_attempts');
    // other accounts are unaffected
    expect((await env.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: DEMO_USERS.coach2, password: DEMO_PASSWORD } })).statusCode).toBe(200);
  });

  it('user changes own password', async () => {
    const coach = await env.login(DEMO_USERS.coach1);
    expect((await coach.post('/api/auth/password', { currentPassword: 'nope', newPassword: 'new-password-1' })).status).toBe(400);
    expect((await coach.post('/api/auth/password', { currentPassword: DEMO_PASSWORD, newPassword: 'new-password-1' })).status).toBe(200);
    await env.login(DEMO_USERS.coach1, 'new-password-1');
  });

  it('owner resets a staff password; admins cannot', async () => {
    const staff = (await owner.get('/api/staff')).body;
    const adminM = staff.find((s: { email: string }) => s.email === DEMO_USERS.adminChilonzor);
    const ownerM = staff.find((s: { role: string }) => s.role === 'owner');
    expect((await admin.post(`/api/staff/${adminM.membershipId}/password`, { password: 'x-password-9' })).status).toBe(403);
    expect((await owner.post(`/api/staff/${ownerM.membershipId}/password`, { password: 'x-password-9' })).status).toBe(400);
    expect((await owner.post(`/api/staff/${adminM.membershipId}/password`, { password: 'reset-pass-123' })).status).toBe(200);
    await env.login(DEMO_USERS.adminChilonzor, 'reset-pass-123');
  });
});

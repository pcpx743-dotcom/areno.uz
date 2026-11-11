/** Athlete documents: upload, type sniffing, limits, coach and branch/club isolation, download, delete. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setup, type TestEnv, type Api } from './helpers.js';
import { DEMO_USERS } from '../src/db/seed-data.js';
import { MAX_DOCUMENT_BYTES, sniffMime } from '../src/routes/documents.js';

let env: TestEnv;
let owner: Api;
let admin: Api;
let coach1: Api;
let coach2: Api;
let athleteChil: string; // Chilonzor, in coach1's group
let athleteYun: string; // Yunusobod (outside the Chilonzor admin's branch)

const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(200, 0x20), Buffer.from('\n%%EOF')]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
const b64 = (b: Buffer) => b.toString('base64');

beforeAll(async () => {
  env = await setup();
  owner = await env.login(DEMO_USERS.owner);
  admin = await env.login(DEMO_USERS.adminChilonzor);
  coach1 = await env.login(DEMO_USERS.coach1);
  coach2 = await env.login(DEMO_USERS.coach2);
  const a = await owner.post('/api/athletes', { fullName: 'Hujjat Sportchi', branchId: env.demo.branches.chilonzor });
  athleteChil = a.body.id;
  await owner.post(`/api/athletes/${athleteChil}/enrollments`, { groupId: env.demo.groups[0], startDate: '2026-11-04' });
  const y = await owner.post('/api/athletes', { fullName: 'Yunusobod Sportchi', branchId: env.demo.branches.yunusobod });
  athleteYun = y.body.id;
});
afterAll(() => env.close());

describe('sniffMime', () => {
  it('recognises allowed formats by their bytes only', () => {
    expect(sniffMime(PDF)).toBe('application/pdf');
    expect(sniffMime(PNG)).toBe('image/png');
    expect(sniffMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toBe('image/jpeg');
    expect(sniffMime(Buffer.from('RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp');
    expect(sniffMime(Buffer.from('<html><script>alert(1)</script>'))).toBeNull();
    expect(sniffMime(Buffer.from('MZ\x90\0'))).toBeNull();
  });
});

describe('athlete documents', () => {
  let medId: string;
  let passportId: string;

  it('owner uploads an 086 certificate and a passport; list shows metadata, never the bytes', async () => {
    const med = await owner.post(`/api/athletes/${athleteChil}/documents`, {
      type: 'medical_086',
      title: '086 tibbiy ma’lumotnoma',
      fileName: '086.pdf',
      validUntil: '2027-11-01',
      content: b64(PDF),
    });
    expect(med.status).toBe(201);
    expect(med.body.mimeType).toBe('application/pdf');
    expect(med.body.sizeBytes).toBe(PDF.length);
    medId = med.body.id;

    const pass = await owner.post(`/api/athletes/${athleteChil}/documents`, {
      type: 'passport',
      title: 'Pasport',
      fileName: 'pasport skan.png',
      content: b64(PNG),
    });
    expect(pass.status).toBe(201);
    passportId = pass.body.id;

    const list = await owner.get(`/api/athletes/${athleteChil}/documents`);
    expect(list.status).toBe(200);
    expect(list.body.map((d: { type: string }) => d.type).sort()).toEqual(['medical_086', 'passport']);
    expect(JSON.stringify(list.body)).not.toContain(b64(PDF));
  });

  it('download returns the exact bytes with safe headers', async () => {
    const r = await env.app.inject({
      method: 'GET',
      url: `/api/athletes/${athleteChil}/documents/${medId}/file`,
      headers: { authorization: `Bearer ${owner.token}` },
    });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toBe('application/pdf');
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['cache-control']).toContain('no-store');
    expect(Buffer.compare(r.rawPayload, PDF)).toBe(0);
  });

  it('rejects files that are not PDF/JPG/PNG/WEBP even if named .pdf, and files over 10 MB', async () => {
    const html = await owner.post(`/api/athletes/${athleteChil}/documents`, {
      type: 'other',
      title: 'x',
      fileName: 'evil.pdf',
      content: b64(Buffer.from('<html><script>alert(1)</script></html>')),
    });
    expect(html.status).toBe(400);
    expect(html.body.error).toBe('unsupported_file');

    const big = Buffer.concat([PDF, Buffer.alloc(MAX_DOCUMENT_BYTES)]);
    const tooBig = await owner.post(`/api/athletes/${athleteChil}/documents`, { type: 'other', title: 'x', fileName: 'big.pdf', content: b64(big) });
    expect([400, 413]).toContain(tooBig.status);
  });

  it('coach of the athlete sees and opens only the 086 certificate; cannot upload or delete', async () => {
    const list = await coach1.get(`/api/athletes/${athleteChil}/documents`);
    expect(list.status).toBe(200);
    expect(list.body.map((d: { type: string }) => d.type)).toEqual(['medical_086']);
    expect((await coach1.get(`/api/athletes/${athleteChil}/documents/${medId}/file`)).status).toBe(200);
    expect((await coach1.get(`/api/athletes/${athleteChil}/documents/${passportId}/file`)).status).toBe(404);
    expect((await coach1.post(`/api/athletes/${athleteChil}/documents`, { type: 'other', title: 'x', fileName: 'a.pdf', content: b64(PDF) })).status).toBe(403);
    expect((await coach1.del(`/api/athletes/${athleteChil}/documents/${medId}`)).status).toBe(403);
  });

  it('a coach without the athlete, another branch admin and another club get 404', async () => {
    expect((await coach2.get(`/api/athletes/${athleteChil}/documents`)).status).toBe(404);
    const yDoc = await owner.post(`/api/athletes/${athleteYun}/documents`, { type: 'passport', title: 'P', fileName: 'p.pdf', content: b64(PDF) });
    expect(yDoc.status).toBe(201);
    expect((await admin.get(`/api/athletes/${athleteYun}/documents`)).status).toBe(404);
    expect((await admin.get(`/api/athletes/${athleteYun}/documents/${yDoc.body.id}/file`)).status).toBe(404);
    const ownerB = await env.login(env.clubB.ownerEmail, 'password-b-123');
    expect((await ownerB.get(`/api/athletes/${athleteChil}/documents/${passportId}/file`)).status).toBe(404);
    // a document id from another athlete cannot be fetched through this athlete's URL
    expect((await owner.get(`/api/athletes/${athleteChil}/documents/${yDoc.body.id}/file`)).status).toBe(404);
  });

  it('branch admin manages documents in their branch; edits expiry; delete removes the file', async () => {
    const upd = await admin.patch(`/api/athletes/${athleteChil}/documents/${medId}`, { validUntil: '2027-12-31' });
    expect(upd.status).toBe(200);
    expect(upd.body.validUntil).toBe('2027-12-31');
    expect((await admin.del(`/api/athletes/${athleteChil}/documents/${passportId}`)).status).toBe(200);
    expect((await owner.get(`/api/athletes/${athleteChil}/documents/${passportId}/file`)).status).toBe(404);
    const list = await owner.get(`/api/athletes/${athleteChil}/documents`);
    expect(list.body.map((d: { id: string }) => d.id)).toEqual([medId]);
  });
});

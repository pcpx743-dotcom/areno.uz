/**
 * CSV import of athletes + guardians (decision #9). Always validate first (dryRun);
 * the real import is all-or-nothing: any row error → nothing is written.
 *
 * Columns (header row, names case-insensitive; Uzbek aliases accepted):
 *   full_name*, birth_date, phone, branch*, group, joined_at, note,
 *   guardian_name, guardian_phone, guardian_relation
 */
import type { FastifyInstance } from 'fastify';
import { and, eq, ne } from 'drizzle-orm';
import { z } from 'zod';
import { athleteGuardians, athletes, branches, groupEnrollments, groups, guardians } from '../db/schema.js';
import { canAccessBranch, requireClub, STAFF } from '../auth/context.js';
import { audit } from '../lib/audit.js';
import { badRequest } from '../lib/errors.js';
import { parseCsv, parseDateLoose } from '../lib/csv.js';
import { todayInTz } from '../domain/dates.js';

const ALIASES: Record<string, string[]> = {
  full_name: ['full_name', 'fio', 'f.i.sh', 'f.i.sh.', 'ism', 'sportchi', 'name'],
  birth_date: ['birth_date', 'tugilgan_sana', 'tug‘ilgan sana', "tug'ilgan sana", 'birthday'],
  phone: ['phone', 'telefon'],
  branch: ['branch', 'filial'],
  group: ['group', 'guruh'],
  joined_at: ['joined_at', 'qoshilgan_sana', 'qo‘shilgan sana', "qo'shilgan sana"],
  note: ['note', 'izoh'],
  guardian_name: ['guardian_name', 'ota_ona', 'ota-ona', 'vasiy', 'parent'],
  guardian_phone: ['guardian_phone', 'ota_ona_telefon', 'ota-ona telefon', 'vasiy telefon', 'parent_phone'],
  guardian_relation: ['guardian_relation', 'aloqa', 'relation'],
};

const RELATIONS: Record<string, string> = { ona: 'mother', ota: 'father', vasiy: 'guardian', 'ota-ona': 'parent', mother: 'mother', father: 'father', guardian: 'guardian', parent: 'parent' };

const normPhone = (s: string) => s.replace(/[\s()-]/g, '');
const phoneOk = (s: string) => /^\+?\d{9,15}$/.test(s);

export const CSV_TEMPLATE =
  'full_name;birth_date;phone;branch;group;joined_at;guardian_name;guardian_phone;guardian_relation;note\n' +
  'Karimov Ali;15.03.2015;;Chilonzor filiali;MMA Bolalar (8–12);01.11.2026;Karimova Nilufar;+998901234567;ona;\n';

interface RowResult {
  line: number;
  fullName: string;
  errors: string[];
  warnings: string[];
}

export default async function importRoutes(app: FastifyInstance) {
  const db = app.db;

  app.get('/athletes/template', async (req, reply) => {
    requireClub(req, ...STAFF);
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', 'attachment; filename="sportchilar-shablon.csv"')
      .send('﻿' + CSV_TEMPLATE);
  });

  app.post('/athletes', { bodyLimit: 5 * 1024 * 1024 }, async (req) => {
    const ctx = requireClub(req, ...STAFF);
    const { csv, dryRun } = z.object({ csv: z.string().min(1).max(5_000_000), dryRun: z.boolean().default(true) }).parse(req.body);
    const rows = parseCsv(csv);
    if (rows.length < 2) throw badRequest('empty_csv', 'CSV needs a header row and at least one data row');
    if (rows.length > 2001) throw badRequest('too_many_rows', 'Max 2000 rows per import');

    const header = rows[0].map((h) => h.trim().toLowerCase());
    const col: Record<string, number> = {};
    for (const [key, names] of Object.entries(ALIASES)) {
      const idx = header.findIndex((h) => names.includes(h));
      if (idx >= 0) col[key] = idx;
    }
    if (col.full_name === undefined || col.branch === undefined) {
      throw badRequest('missing_columns', 'Required columns: full_name, branch');
    }
    const get = (r: string[], k: string) => (col[k] !== undefined ? (r[col[k]] ?? '').trim() : '');

    const branchRows = await db.select().from(branches).where(eq(branches.clubId, ctx.clubId));
    const groupRows = await db.select().from(groups).where(eq(groups.clubId, ctx.clubId));
    const existing = await db
      .select({ fullName: athletes.fullName, birthDate: athletes.birthDate })
      .from(athletes)
      .where(and(eq(athletes.clubId, ctx.clubId), ne(athletes.status, 'archived')));
    const seen = new Set(existing.map((a) => `${a.fullName.toLowerCase()}|${a.birthDate ?? ''}`));
    const today = todayInTz(ctx.timezone);
    const lc = (s: string) => s.trim().toLowerCase();

    const parsed = rows.slice(1).map((r, i) => {
      const res: RowResult = { line: i + 2, fullName: get(r, 'full_name'), errors: [], warnings: [] };
      const fullName = get(r, 'full_name');
      if (fullName.length < 2) res.errors.push('F.I.Sh. bo‘sh');
      const branch = branchRows.find((b) => lc(b.name) === lc(get(r, 'branch')));
      if (!branch) res.errors.push(`Filial topilmadi: “${get(r, 'branch')}”`);
      else if (!canAccessBranch(ctx, branch.id)) res.errors.push('Bu filialga ruxsat yo‘q');
      const groupName = get(r, 'group');
      const group = groupName ? groupRows.find((g) => lc(g.name) === lc(groupName) && (!branch || g.branchId === branch.id)) : undefined;
      if (groupName && !group) res.errors.push(`Guruh topilmadi (shu filialda): “${groupName}”`);
      const bd = get(r, 'birth_date');
      const birthDate = bd ? parseDateLoose(bd) : null;
      if (bd && !birthDate) res.errors.push(`Tug‘ilgan sana noto‘g‘ri: “${bd}”`);
      const jd = get(r, 'joined_at');
      const joinedAt = jd ? parseDateLoose(jd) : today;
      if (jd && !joinedAt) res.errors.push(`Qo‘shilgan sana noto‘g‘ri: “${jd}”`);
      const phone = normPhone(get(r, 'phone'));
      if (phone && !phoneOk(phone)) res.errors.push(`Telefon noto‘g‘ri: “${get(r, 'phone')}”`);
      const gName = get(r, 'guardian_name');
      const gPhone = normPhone(get(r, 'guardian_phone'));
      if (gPhone && !phoneOk(gPhone)) res.errors.push(`Vasiy telefoni noto‘g‘ri: “${get(r, 'guardian_phone')}”`);
      if (gName && !gPhone) res.errors.push('Vasiy telefoni kiritilmagan');
      if (gPhone && !gName) res.warnings.push('Vasiy ismi yo‘q — telefon ismi sifatida yoziladi');
      const key = `${fullName.toLowerCase()}|${birthDate ?? ''}`;
      const duplicate = seen.has(key);
      if (duplicate) res.warnings.push('Bunday sportchi allaqachon bor — o‘tkazib yuboriladi');
      seen.add(key);
      return {
        res,
        duplicate,
        data: {
          fullName,
          birthDate,
          phone: phone || null,
          branchId: branch?.id,
          groupId: group?.id,
          joinedAt: joinedAt ?? today,
          note: get(r, 'note') || null,
          guardian: gPhone ? { fullName: gName || gPhone, phone: gPhone, relation: RELATIONS[lc(get(r, 'guardian_relation'))] ?? 'parent' } : null,
        },
      };
    });

    const errors = parsed.filter((p) => p.res.errors.length).length;
    const toImport = parsed.filter((p) => !p.res.errors.length && !p.duplicate);
    const summary = { total: parsed.length, valid: parsed.length - errors, errors, duplicates: parsed.filter((p) => p.duplicate).length, toImport: toImport.length };
    const report = parsed.map((p) => p.res);
    if (dryRun || errors) return { dryRun: true, imported: 0, summary, rows: report };

    await db.transaction(async (tx) => {
      for (const p of toImport) {
        const d = p.data;
        const [a] = await tx
          .insert(athletes)
          .values({ clubId: ctx.clubId, branchId: d.branchId!, fullName: d.fullName, birthDate: d.birthDate, phone: d.phone, joinedAt: d.joinedAt, note: d.note })
          .returning();
        if (d.groupId) await tx.insert(groupEnrollments).values({ clubId: ctx.clubId, athleteId: a.id, groupId: d.groupId, startedAt: d.joinedAt });
        if (d.guardian) {
          let [g] = await tx
            .select()
            .from(guardians)
            .where(and(eq(guardians.clubId, ctx.clubId), eq(guardians.phone, d.guardian.phone)));
          if (!g) [g] = await tx.insert(guardians).values({ clubId: ctx.clubId, fullName: d.guardian.fullName, phone: d.guardian.phone }).returning();
          await tx
            .insert(athleteGuardians)
            .values({ clubId: ctx.clubId, athleteId: a.id, guardianId: g.id, relation: d.guardian.relation, isPrimary: true })
            .onConflictDoNothing();
        }
      }
      await audit(tx, ctx, { action: 'import', entity: 'athletes', after: summary });
    });
    return { dryRun: false, imported: toImport.length, summary, rows: report };
  });
}

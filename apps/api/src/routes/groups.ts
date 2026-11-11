import type { FastifyInstance } from 'fastify';
import { and, asc, eq, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { athletes, branches, coaches, groupEnrollments, groups, schedules, sports } from '../db/schema.js';
import { assertBranch, requireClub, STAFF } from '../auth/context.js';
import { audit } from '../lib/audit.js';
import { badRequest, notFound } from '../lib/errors.js';
import { loadGroup } from '../lib/loaders.js';
import { branchScope, idsOrNone, qcol } from '../lib/scope.js';
import { idParam, isoDate } from '../lib/validation.js';
import type { Db, Tx } from '../db/client.js';
import type { ClubCtx } from '../auth/context.js';

const groupBase = z.object({
    name: z.string().trim().min(1).max(200),
    branchId: z.uuid(),
    sportId: z.uuid(),
    coachId: z.uuid().nullable().optional(),
    capacity: z.number().int().positive().nullable().optional(),
    ageMin: z.number().int().min(0).max(100).nullable().optional(),
    ageMax: z.number().int().min(0).max(100).nullable().optional(),
    active: z.boolean().optional(),
});
const ageOk = (g: { ageMin?: number | null; ageMax?: number | null }) => g.ageMin == null || g.ageMax == null || g.ageMin <= g.ageMax;
const groupBody = groupBase.refine(ageOk, { message: 'ageMin > ageMax' });
const groupPatch = groupBase.partial().refine(ageOk, { message: 'ageMin > ageMax' });

const time = z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, 'Expected HH:MM');
const scheduleBody = z
  .object({
    weekday: z.number().int().min(1).max(7),
    startTime: time,
    endTime: time,
    room: z.string().trim().max(100).nullable().optional(),
    validFrom: isoDate.nullable().optional(),
    validTo: isoDate.nullable().optional(),
  })
  .refine((s) => s.startTime < s.endTime, { message: 'startTime must be before endTime' });

/** Validate that referenced branch/sport/coach belong to the same club. */
async function assertRefs(db: Db | Tx, ctx: ClubCtx, data: { branchId?: string; sportId?: string; coachId?: string | null }) {
  const check = async (table: typeof branches | typeof sports | typeof coaches, id: string, what: string) => {
    const [r] = await db
      .select({ id: table.id })
      .from(table)
      .where(and(eq(table.id, id), eq(table.clubId, ctx.clubId)));
    if (!r) throw badRequest('invalid_reference', `Unknown ${what}`);
  };
  if (data.branchId) await check(branches, data.branchId, 'branch');
  if (data.sportId) await check(sports, data.sportId, 'sport');
  if (data.coachId) await check(coaches, data.coachId, 'coach');
}

const activeCount = sql<number>`(select count(*) from ${groupEnrollments} e where e.group_id = ${qcol(groups.id)} and e.status = 'active')`.mapWith(
  Number,
);

export default async function groupRoutes(app: FastifyInstance) {
  const db = app.db;

  app.get('/', async (req) => {
    const ctx = requireClub(req, 'owner', 'branch_admin', 'coach');
    const q = z
      .object({ branchId: z.uuid().optional(), sportId: z.uuid().optional(), coachId: z.uuid().optional() })
      .parse(req.query);
    const scope = ctx.role === 'coach' ? idsOrNone(groups.coachId, ctx.coachIds) : branchScope(ctx, groups.branchId);
    return db
      .select({
        id: groups.id,
        name: groups.name,
        branchId: groups.branchId,
        branchName: branches.name,
        sportId: groups.sportId,
        sportName: sports.name,
        coachId: groups.coachId,
        coachName: coaches.fullName,
        coachPhone: coaches.phone,
        capacity: groups.capacity,
        ageMin: groups.ageMin,
        ageMax: groups.ageMax,
        active: groups.active,
        athleteCount: activeCount,
      })
      .from(groups)
      .innerJoin(branches, eq(branches.id, groups.branchId))
      .innerJoin(sports, eq(sports.id, groups.sportId))
      .leftJoin(coaches, eq(coaches.id, groups.coachId))
      .where(
        and(
          eq(groups.clubId, ctx.clubId),
          scope,
          q.branchId ? eq(groups.branchId, q.branchId) : undefined,
          q.sportId ? eq(groups.sportId, q.sportId) : undefined,
          q.coachId ? eq(groups.coachId, q.coachId) : undefined,
        ),
      )
      .orderBy(asc(branches.name), asc(groups.name));
  });

  app.get('/:id', async (req) => {
    const ctx = requireClub(req, 'owner', 'branch_admin', 'coach');
    const { id } = idParam.parse(req.params);
    const g = await loadGroup(db, ctx, id);
    const [meta] = await db
      .select({ branchName: branches.name, sportName: sports.name, coachName: coaches.fullName })
      .from(groups)
      .innerJoin(branches, eq(branches.id, groups.branchId))
      .innerJoin(sports, eq(sports.id, groups.sportId))
      .leftJoin(coaches, eq(coaches.id, groups.coachId))
      .where(eq(groups.id, id));
    const members = await db
      .select({
        enrollmentId: groupEnrollments.id,
        athleteId: athletes.id,
        fullName: athletes.fullName,
        birthDate: athletes.birthDate,
        status: groupEnrollments.status,
        startedAt: groupEnrollments.startedAt,
      })
      .from(groupEnrollments)
      .innerJoin(athletes, eq(athletes.id, groupEnrollments.athleteId))
      .where(and(eq(groupEnrollments.groupId, id), ne(groupEnrollments.status, 'ended')))
      .orderBy(asc(athletes.fullName));
    const sched = await db
      .select()
      .from(schedules)
      .where(eq(schedules.groupId, id))
      .orderBy(asc(schedules.weekday), asc(schedules.startTime));
    return { ...g, ...meta, athletes: members, schedules: sched };
  });

  app.post('/', async (req, reply) => {
    const ctx = requireClub(req, ...STAFF);
    const data = groupBody.parse(req.body);
    assertBranch(ctx, data.branchId);
    const row = await db.transaction(async (tx) => {
      await assertRefs(tx, ctx, data);
      const [row] = await tx.insert(groups).values({ ...data, clubId: ctx.clubId }).returning();
      await audit(tx, ctx, { action: 'create', entity: 'groups', entityId: row.id, after: row });
      return row;
    });
    return reply.status(201).send(row);
  });

  app.patch('/:id', async (req) => {
    const ctx = requireClub(req, ...STAFF);
    const { id } = idParam.parse(req.params);
    const data = groupPatch.parse(req.body);
    if (data.branchId) assertBranch(ctx, data.branchId);
    return db.transaction(async (tx) => {
      const before = await loadGroup(tx, ctx, id);
      await assertRefs(tx, ctx, data);
      const [after] = await tx.update(groups).set(data).where(eq(groups.id, id)).returning();
      await audit(tx, ctx, { action: 'update', entity: 'groups', entityId: id, before, after });
      return after;
    });
  });

  // ----- weekly schedule -----
  app.post('/:id/schedules', async (req, reply) => {
    const ctx = requireClub(req, ...STAFF);
    const { id } = idParam.parse(req.params);
    const data = scheduleBody.parse(req.body);
    const row = await db.transaction(async (tx) => {
      await loadGroup(tx, ctx, id);
      const [row] = await tx
        .insert(schedules)
        .values({ ...data, groupId: id, clubId: ctx.clubId })
        .returning();
      await audit(tx, ctx, { action: 'create', entity: 'schedules', entityId: row.id, after: row });
      return row;
    });
    return reply.status(201).send(row);
  });

  app.delete('/:id/schedules/:scheduleId', async (req, reply) => {
    const ctx = requireClub(req, ...STAFF);
    const { id, scheduleId } = z.object({ id: z.uuid(), scheduleId: z.uuid() }).parse(req.params);
    await db.transaction(async (tx) => {
      await loadGroup(tx, ctx, id);
      const [before] = await tx
        .delete(schedules)
        .where(and(eq(schedules.id, scheduleId), eq(schedules.groupId, id), eq(schedules.clubId, ctx.clubId)))
        .returning();
      if (!before) throw notFound('Schedule');
      await audit(tx, ctx, { action: 'delete', entity: 'schedules', entityId: scheduleId, before });
    });
    return reply.status(204).send();
  });
}

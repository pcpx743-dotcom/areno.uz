/** Athlete & guardian CRM + group enrollment history (PRD §4). */
import type { FastifyInstance } from 'fastify';
import { and, asc, count, desc, eq, exists, gt, ilike, inArray, lte, ne, notExists, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  athleteGuardians,
  athletes,
  branches,
  charges,
  groupEnrollments,
  groups,
  guardians,
  payments,
  plans,
  sports,
  subscriptions,
  attendance,
  sessions,
} from '../db/schema.js';
import { assertBranch, requireClub, STAFF, type ClubCtx } from '../auth/context.js';
import type { Db, Tx } from '../db/client.js';
import { audit } from '../lib/audit.js';
import { athleteBalance, balanceSql } from '../lib/balance-queries.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { loadAthlete, loadGroup } from '../lib/loaders.js';
import { branchScope, idsOrNone, page, qcol } from '../lib/scope.js';
import { idParam, isoDate, optText, phone } from '../lib/validation.js';
import { addDays, todayInTz } from '../domain/dates.js';
import { remainingSessions } from '../domain/subscription-engine.js';

const guardianInput = z.object({
  fullName: z.string().trim().min(2).max(200),
  phone,
  relation: z.string().trim().max(50).default('parent'),
  isPrimary: z.boolean().default(false),
  telegramConsent: z.boolean().optional(),
});

const athleteBase = z.object({
  fullName: z.string().trim().min(2).max(200),
  birthDate: isoDate.nullable().optional(),
  phone: phone.nullable().optional(),
  branchId: z.uuid(),
  joinedAt: isoDate.optional(),
  note: optText,
});

const createBody = athleteBase.extend({
  guardians: z.array(guardianInput).max(5).default([]),
  groupId: z.uuid().optional(),
  forceCapacity: z.boolean().optional(),
});

const listQuery = z.object({
  q: z.string().trim().optional(),
  branchId: z.uuid().optional(),
  sportId: z.uuid().optional(),
  coachId: z.uuid().optional(),
  groupId: z.uuid().optional(),
  status: z.enum(['active', 'paused', 'archived']).optional(),
  ageMin: z.coerce.number().int().min(0).optional(),
  ageMax: z.coerce.number().int().min(0).optional(),
  subscription: z.enum(['active', 'frozen', 'expired', 'none', 'expiring']).optional(),
  debt: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().optional(),
  offset: z.coerce.number().optional(),
});

/** Upsert guardian by phone (one guardian per phone per club) and link to athlete. */
async function linkGuardian(tx: Tx, ctx: ClubCtx, athleteId: string, g: z.infer<typeof guardianInput>) {
  let [guardian] = await tx
    .select()
    .from(guardians)
    .where(and(eq(guardians.clubId, ctx.clubId), eq(guardians.phone, g.phone)));
  if (!guardian) {
    [guardian] = await tx
      .insert(guardians)
      .values({
        clubId: ctx.clubId,
        fullName: g.fullName,
        phone: g.phone,
        telegramConsentAt: g.telegramConsent ? new Date() : null,
      })
      .returning();
  }
  if (g.isPrimary) {
    await tx.update(athleteGuardians).set({ isPrimary: false }).where(eq(athleteGuardians.athleteId, athleteId));
  }
  await tx
    .insert(athleteGuardians)
    .values({ clubId: ctx.clubId, athleteId, guardianId: guardian.id, relation: g.relation, isPrimary: g.isPrimary })
    .onConflictDoUpdate({
      target: [athleteGuardians.athleteId, athleteGuardians.guardianId],
      set: { relation: g.relation, isPrimary: g.isPrimary },
    });
  return guardian;
}

/** Enroll into a group, honoring the club's capacity policy (warn | block). */
async function enroll(
  tx: Tx,
  ctx: ClubCtx,
  athleteId: string,
  groupId: string,
  startedAt: string,
  force: boolean | undefined,
): Promise<{ enrollmentId: string; warnings: string[] }> {
  const group = await loadGroup(tx, ctx, groupId);
  const warnings: string[] = [];
  if (group.capacity != null) {
    const [{ c }] = await tx
      .select({ c: count() })
      .from(groupEnrollments)
      .where(and(eq(groupEnrollments.groupId, groupId), eq(groupEnrollments.status, 'active')));
    if (c >= group.capacity) {
      if (ctx.settings.capacityPolicy === 'block') {
        throw conflict('group_full', `Group is full (${c}/${group.capacity})`);
      }
      if (!force) {
        throw conflict('group_full_warning', `Group is full (${c}/${group.capacity}). Resend with forceCapacity=true to proceed.`, {
          count: c,
          capacity: group.capacity,
        });
      }
      warnings.push(`Over capacity: ${c + 1}/${group.capacity}`);
    }
  }
  const [open] = await tx
    .select({ id: groupEnrollments.id })
    .from(groupEnrollments)
    .where(and(eq(groupEnrollments.athleteId, athleteId), eq(groupEnrollments.groupId, groupId), ne(groupEnrollments.status, 'ended')));
  if (open) throw conflict('already_enrolled', 'Athlete is already in this group');
  const [e] = await tx
    .insert(groupEnrollments)
    .values({ clubId: ctx.clubId, athleteId, groupId, startedAt, status: 'active' })
    .returning();
  await audit(tx, ctx, { action: 'enroll', entity: 'group_enrollments', entityId: e.id, after: e });
  return { enrollmentId: e.id, warnings };
}

export default async function athleteRoutes(app: FastifyInstance) {
  const db = app.db;

  // ---------- list / search ----------
  app.get('/', async (req) => {
    const ctx = requireClub(req, 'owner', 'branch_admin', 'coach');
    const q = listQuery.parse(req.query);
    const { limit, offset } = page(q);
    const today = todayInTz(ctx.timezone);
    const isCoach = ctx.role === 'coach';

    // enrollment-based filters (sport / coach / group) and coach scope
    const enrolledWhere = (extra: ReturnType<typeof and>) =>
      exists(
        db
          .select({ x: sql`1` })
          .from(groupEnrollments)
          .innerJoin(groups, eq(groups.id, groupEnrollments.groupId))
          .where(and(eq(groupEnrollments.athleteId, athletes.id), ne(groupEnrollments.status, 'ended'), extra)),
      );
    const subWhere = (extra: ReturnType<typeof and>) =>
      db
        .select({ x: sql`1` })
        .from(subscriptions)
        .where(and(eq(subscriptions.athleteId, athletes.id), extra));

    const bal = balanceSql(qcol(athletes.id));
    const conds = [
      eq(athletes.clubId, ctx.clubId),
      isCoach ? enrolledWhere(and(idsOrNone(groups.coachId, ctx.coachIds))) : branchScope(ctx, athletes.branchId),
      q.q ? searchCond(q.q) : undefined,
      q.branchId ? eq(athletes.branchId, q.branchId) : undefined,
      q.status ? eq(athletes.status, q.status) : ne(athletes.status, 'archived'),
      q.sportId ? enrolledWhere(and(eq(groups.sportId, q.sportId))) : undefined,
      q.coachId ? enrolledWhere(and(eq(groups.coachId, q.coachId))) : undefined,
      q.groupId ? enrolledWhere(and(eq(groups.id, q.groupId))) : undefined,
      // age: born on or before (today − ageMin years); born after (today − (ageMax+1) years)
      q.ageMin != null ? lte(athletes.birthDate, shiftYears(today, -q.ageMin)) : undefined,
      q.ageMax != null ? gt(athletes.birthDate, shiftYears(today, -(q.ageMax + 1))) : undefined,
      q.subscription === 'none'
        ? notExists(subWhere(and(inArray(subscriptions.status, ['active', 'frozen']))))
        : q.subscription === 'expiring'
          ? exists(subWhere(and(eq(subscriptions.status, 'active'), lte(subscriptions.endDate, addDays(today, 7)))))
          : q.subscription
            ? exists(subWhere(and(eq(subscriptions.status, q.subscription))))
            : undefined,
      !isCoach && q.debt === 'true' ? sql`${bal} > 0` : undefined,
      !isCoach && q.debt === 'false' ? sql`${bal} <= 0` : undefined,
    ];
    const where = and(...conds);

    const [{ total }] = await db.select({ total: count() }).from(athletes).where(where);
    const items = await db
      .select({
        id: athletes.id,
        fullName: athletes.fullName,
        birthDate: athletes.birthDate,
        phone: athletes.phone,
        branchId: athletes.branchId,
        status: athletes.status,
        joinedAt: athletes.joinedAt,
        groupNames: sql<string[]>`coalesce((
          select array_agg(g.name order by g.name) from ${groupEnrollments} e
          join ${groups} g on g.id = e.group_id
          where e.athlete_id = ${qcol(athletes.id)} and e.status <> 'ended'), '{}')`,
        // the running subscription, else the latest one (null when never subscribed)
        subscription: sql<{ planName: string; status: string; startDate: string; endDate: string | null } | null>`(
          select json_build_object('planName', p.name, 'status', s.status, 'startDate', s.start_date, 'endDate', s.end_date)
          from ${subscriptions} s join ${plans} p on p.id = s.plan_id
          where s.athlete_id = ${qcol(athletes.id)} and s.status <> 'cancelled'
          order by (s.status in ('active', 'frozen')) desc, s.end_date desc nulls first, s.start_date desc
          limit 1)`,
        lastSeen: sql<string | null>`(
          select to_char(max(ss.session_date), 'YYYY-MM-DD') from ${attendance} at
          join ${sessions} ss on ss.id = at.session_id
          where at.athlete_id = ${qcol(athletes.id)} and at.status = 'present')`,
        ...(isCoach ? {} : { balance: bal }),
      })
      .from(athletes)
      .where(where)
      .orderBy(asc(athletes.fullName), asc(athletes.id))
      .limit(limit)
      .offset(offset);
    return { items, total, limit, offset };
  });

  // ---------- profile ----------
  app.get('/:id', async (req) => {
    const ctx = requireClub(req, 'owner', 'branch_admin', 'coach');
    const { id } = idParam.parse(req.params);
    const athlete = await loadAthlete(db, ctx, id);
    const guardianRows = await db
      .select({
        id: guardians.id,
        fullName: guardians.fullName,
        phone: guardians.phone,
        relation: athleteGuardians.relation,
        isPrimary: athleteGuardians.isPrimary,
        telegramLinked: sql<boolean>`${guardians.telegramChatId} is not null`,
        telegramConsentAt: guardians.telegramConsentAt,
      })
      .from(athleteGuardians)
      .innerJoin(guardians, eq(guardians.id, athleteGuardians.guardianId))
      .where(eq(athleteGuardians.athleteId, id));
    const enrollments = await db
      .select({
        id: groupEnrollments.id,
        groupId: groups.id,
        groupName: groups.name,
        sportName: sports.name,
        status: groupEnrollments.status,
        startedAt: groupEnrollments.startedAt,
        endedAt: groupEnrollments.endedAt,
        reason: groupEnrollments.reason,
      })
      .from(groupEnrollments)
      .innerJoin(groups, eq(groups.id, groupEnrollments.groupId))
      .innerJoin(sports, eq(sports.id, groups.sportId))
      .where(eq(groupEnrollments.athleteId, id))
      .orderBy(desc(groupEnrollments.startedAt), desc(groupEnrollments.createdAt));
    const subs = await db
      .select({
        id: subscriptions.id,
        planName: plans.name,
        billingType: subscriptions.billingType,
        startDate: subscriptions.startDate,
        endDate: subscriptions.endDate,
        price: subscriptions.price,
        discount: subscriptions.discount,
        sessionLimit: subscriptions.sessionLimit,
        usedSessions: subscriptions.usedSessions,
        status: subscriptions.status,
      })
      .from(subscriptions)
      .innerJoin(plans, eq(plans.id, subscriptions.planId))
      .where(eq(subscriptions.athleteId, id))
      .orderBy(desc(subscriptions.startDate));
    const subscriptionsOut = subs.map((s) => ({ ...s, remainingSessions: remainingSessions(s) }));

    // Coaches see training info, not finances (PRD §2).
    if (ctx.role === 'coach') {
      return {
        ...athlete,
        guardians: guardianRows.map((g) => ({ ...g, phone: null })),
        enrollments,
        subscriptions: subscriptionsOut.map(({ price: _p, discount: _d, ...s }) => s),
      };
    }
    const chargeRows = await db.select().from(charges).where(eq(charges.athleteId, id)).orderBy(desc(charges.dueDate));
    const paymentRows = await db.select().from(payments).where(eq(payments.athleteId, id)).orderBy(desc(payments.paidAt));
    return {
      ...athlete,
      guardians: guardianRows,
      enrollments,
      subscriptions: subscriptionsOut,
      charges: chargeRows,
      payments: paymentRows,
      balance: await athleteBalance(db, ctx.clubId, id),
    };
  });

  // ---------- create / update ----------
  app.post('/', async (req, reply) => {
    const ctx = requireClub(req, ...STAFF);
    const data = createBody.parse(req.body);
    assertBranch(ctx, data.branchId);
    const today = todayInTz(ctx.timezone);
    const result = await db.transaction(async (tx) => {
      await assertBranchInClub(tx, ctx, data.branchId);
      const { guardians: gs, groupId, forceCapacity, ...fields } = data;
      const [athlete] = await tx
        .insert(athletes)
        .values({ ...fields, clubId: ctx.clubId, joinedAt: fields.joinedAt ?? today })
        .returning();
      await audit(tx, ctx, { action: 'create', entity: 'athletes', entityId: athlete.id, after: athlete });
      if (gs.length && !gs.some((g) => g.isPrimary)) gs[0].isPrimary = true;
      for (const g of gs) await linkGuardian(tx, ctx, athlete.id, g);
      let warnings: string[] = [];
      if (groupId) warnings = (await enroll(tx, ctx, athlete.id, groupId, athlete.joinedAt, forceCapacity)).warnings;
      return { ...athlete, warnings };
    });
    return reply.status(201).send(result);
  });

  app.patch('/:id', async (req) => {
    const ctx = requireClub(req, ...STAFF);
    const { id } = idParam.parse(req.params);
    const data = athleteBase.partial().extend({ status: z.enum(['active', 'paused', 'archived']).optional() }).parse(req.body);
    if (data.branchId) assertBranch(ctx, data.branchId);
    return db.transaction(async (tx) => {
      const before = await loadAthlete(tx, ctx, id);
      if (data.branchId) await assertBranchInClub(tx, ctx, data.branchId);
      const [after] = await tx
        .update(athletes)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(athletes.id, id))
        .returning();
      // Archiving closes open group enrollments (history is kept).
      if (data.status === 'archived' && before.status !== 'archived') {
        await tx
          .update(groupEnrollments)
          .set({ status: 'ended', endedAt: todayInTz(ctx.timezone), reason: 'archived' })
          .where(and(eq(groupEnrollments.athleteId, id), ne(groupEnrollments.status, 'ended')));
      }
      await audit(tx, ctx, { action: data.status === 'archived' ? 'archive' : 'update', entity: 'athletes', entityId: id, before, after });
      return after;
    });
  });

  // ---------- guardians ----------
  app.post('/:id/guardians', async (req, reply) => {
    const ctx = requireClub(req, ...STAFF);
    const { id } = idParam.parse(req.params);
    const g = guardianInput.parse(req.body);
    const guardian = await db.transaction(async (tx) => {
      await loadAthlete(tx, ctx, id);
      const guardian = await linkGuardian(tx, ctx, id, g);
      await audit(tx, ctx, { action: 'link_guardian', entity: 'athlete_guardians', entityId: id, after: { guardianId: guardian.id, ...g } });
      return guardian;
    });
    return reply.status(201).send(guardian);
  });

  app.delete('/:id/guardians/:guardianId', async (req, reply) => {
    const ctx = requireClub(req, ...STAFF);
    const { id, guardianId } = z.object({ id: z.uuid(), guardianId: z.uuid() }).parse(req.params);
    await db.transaction(async (tx) => {
      await loadAthlete(tx, ctx, id);
      const [before] = await tx
        .delete(athleteGuardians)
        .where(and(eq(athleteGuardians.athleteId, id), eq(athleteGuardians.guardianId, guardianId), eq(athleteGuardians.clubId, ctx.clubId)))
        .returning();
      if (!before) throw notFound('Guardian link');
      await audit(tx, ctx, { action: 'unlink_guardian', entity: 'athlete_guardians', entityId: id, before });
    });
    return reply.status(204).send();
  });

  // ---------- group enrollment: add / move / pause / resume / end ----------
  app.post('/:id/enrollments', async (req, reply) => {
    const ctx = requireClub(req, ...STAFF);
    const { id } = idParam.parse(req.params);
    const data = z
      .object({
        groupId: z.uuid(),
        startDate: isoDate.optional(),
        /** Move: ends this enrollment and enrolls into groupId. */
        fromEnrollmentId: z.uuid().optional(),
        reason: optText,
        forceCapacity: z.boolean().optional(),
      })
      .parse(req.body);
    const result = await db.transaction(async (tx) => {
      const athlete = await loadAthlete(tx, ctx, id);
      if (athlete.status === 'archived') throw badRequest('athlete_archived', 'Athlete is archived');
      const start = data.startDate ?? todayInTz(ctx.timezone);
      if (data.fromEnrollmentId) {
        const [from] = await tx
          .update(groupEnrollments)
          .set({ status: 'ended', endedAt: start, reason: data.reason ?? 'moved' })
          .where(
            and(
              eq(groupEnrollments.id, data.fromEnrollmentId),
              eq(groupEnrollments.athleteId, id),
              eq(groupEnrollments.clubId, ctx.clubId),
              ne(groupEnrollments.status, 'ended'),
            ),
          )
          .returning();
        if (!from) throw notFound('Enrollment');
        await audit(tx, ctx, { action: 'move_out', entity: 'group_enrollments', entityId: from.id, after: from });
      }
      return enroll(tx, ctx, id, data.groupId, start, data.forceCapacity);
    });
    return reply.status(201).send(result);
  });

  app.patch('/:id/enrollments/:enrollmentId', async (req) => {
    const ctx = requireClub(req, ...STAFF);
    const { id, enrollmentId } = z.object({ id: z.uuid(), enrollmentId: z.uuid() }).parse(req.params);
    const data = z.object({ status: z.enum(['active', 'paused', 'ended']), reason: optText }).parse(req.body);
    return db.transaction(async (tx) => {
      await loadAthlete(tx, ctx, id);
      const where = and(eq(groupEnrollments.id, enrollmentId), eq(groupEnrollments.athleteId, id), eq(groupEnrollments.clubId, ctx.clubId));
      const [before] = await tx.select().from(groupEnrollments).where(where);
      if (!before) throw notFound('Enrollment');
      if (before.status === 'ended') throw badRequest('enrollment_ended', 'Ended enrollments are history and cannot change');
      const [after] = await tx
        .update(groupEnrollments)
        .set({
          status: data.status,
          reason: data.reason ?? before.reason,
          endedAt: data.status === 'ended' ? todayInTz(ctx.timezone) : null,
        })
        .where(where)
        .returning();
      await audit(tx, ctx, { action: `enrollment_${data.status}`, entity: 'group_enrollments', entityId: enrollmentId, before, after });
      return after;
    });
  });
}

/** Name contains the text, or (if it has 4+ digits) athlete / parent phone contains them. */
function searchCond(text: string) {
  const byName = ilike(athletes.fullName, `%${text.replace(/[%_]/g, '\\$&')}%`);
  const digits = text.replace(/\D/g, '');
  if (digits.length < 4) return byName;
  const like = `%${digits}%`;
  return or(
    byName,
    sql`regexp_replace(coalesce(${athletes.phone}, ''), '\D', '', 'g') like ${like}`,
    sql`exists (select 1 from ${athleteGuardians} ag join ${guardians} g on g.id = ag.guardian_id
               where ag.athlete_id = ${qcol(athletes.id)} and regexp_replace(g.phone, '\D', '', 'g') like ${like})`,
  );
}

async function assertBranchInClub(tx: Db | Tx, ctx: ClubCtx, branchId: string) {
  const [b] = await tx
    .select({ id: branches.id })
    .from(branches)
    .where(and(eq(branches.id, branchId), eq(branches.clubId, ctx.clubId)));
  if (!b) throw badRequest('invalid_branch', 'Unknown branch');
}

function shiftYears(iso: string, years: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const target = new Date(Date.UTC(y + years, m - 1, d));
  // Feb 29 → Feb 28 in non-leap years
  if (target.getUTCMonth() !== m - 1) target.setUTCDate(0);
  return target.toISOString().slice(0, 10);
}

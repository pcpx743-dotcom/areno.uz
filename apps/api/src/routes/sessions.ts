/** Daily lessons and attendance sheet (PRD §7, §13B). */
import type { FastifyInstance } from 'fastify';
import { and, asc, eq, inArray, lte, ne, or, gt, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  athletes,
  attendance,
  branches,
  coaches,
  groupEnrollments,
  groups,
  sessions,
} from '../db/schema.js';
import { canAccessBranch, requireClub, STAFF, type ClubCtx } from '../auth/context.js';
import type { Db, Tx } from '../db/client.js';
import { audit } from '../lib/audit.js';
import { balanceSql } from '../lib/balance-queries.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { loadGroup } from '../lib/loaders.js';
import { enqueueForAthlete } from '../lib/notify.js';
import { branchScope, idsOrNone, qcol } from '../lib/scope.js';
import { applyUsage, ensureSessions, findSubscriptionFor } from '../lib/sessions.js';
import { idParam, isoDate } from '../lib/validation.js';
import { remainingSessions, sessionUsageDelta, type AttendanceStatus } from '../domain/subscription-engine.js';
import { todayInTz } from '../domain/dates.js';

const time = z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, 'Expected HH:MM');

/** Group ids visible to the caller (coach: own groups; staff: branch scope). */
async function scopedGroupIds(db: Db | Tx, ctx: ClubCtx, branchId?: string) {
  const rows = await db
    .select({ id: groups.id })
    .from(groups)
    .where(
      and(
        eq(groups.clubId, ctx.clubId),
        eq(groups.active, true),
        ctx.role === 'coach' ? idsOrNone(groups.coachId, ctx.coachIds) : branchScope(ctx, groups.branchId),
        branchId ? eq(groups.branchId, branchId) : undefined,
      ),
    );
  return rows.map((r) => r.id);
}

async function loadSession(db: Db | Tx, ctx: ClubCtx, id: string) {
  const [s] = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.id, id), eq(sessions.clubId, ctx.clubId)));
  if (!s) throw notFound('Session');
  const group = await loadGroup(db, ctx, s.groupId); // enforces coach / branch scope
  return { session: s, group };
}

/** Athletes on the sheet: enrolled (not paused) on the session date, plus anyone already marked. */
async function roster(db: Db | Tx, groupId: string, sessionId: string, date: string) {
  const enrolled = await db
    .select({ athleteId: groupEnrollments.athleteId })
    .from(groupEnrollments)
    .where(
      and(
        eq(groupEnrollments.groupId, groupId),
        lte(groupEnrollments.startedAt, date),
        or(eq(groupEnrollments.status, 'active'), and(eq(groupEnrollments.status, 'ended'), gt(groupEnrollments.endedAt, date))),
      ),
    );
  const marked = await db.select({ athleteId: attendance.athleteId }).from(attendance).where(eq(attendance.sessionId, sessionId));
  return [...new Set([...enrolled, ...marked].map((r) => r.athleteId))];
}

async function notifyGroup(tx: Tx, ctx: ClubCtx, groupId: string, payload: Record<string, unknown>, dedupe: string) {
  const ids = await tx
    .select({ athleteId: groupEnrollments.athleteId })
    .from(groupEnrollments)
    .where(and(eq(groupEnrollments.groupId, groupId), eq(groupEnrollments.status, 'active')));
  for (const { athleteId } of ids) await enqueueForAthlete(tx, ctx.clubId, athleteId, 'session_changed', payload, dedupe);
}

export default async function sessionRoutes(app: FastifyInstance) {
  const db = app.db;

  /** Lessons of a day; generated from schedules on first view. */
  app.get('/', async (req) => {
    const ctx = requireClub(req, 'owner', 'branch_admin', 'coach');
    const q = z.object({ date: isoDate.optional(), branchId: z.uuid().optional() }).parse(req.query);
    const date = q.date ?? todayInTz(ctx.timezone);
    const gids = await scopedGroupIds(db, ctx, q.branchId);
    await ensureSessions(db, ctx.clubId, date, gids);
    if (!gids.length) return { date, sessions: [] };
    const rows = await db
      .select({
        id: sessions.id,
        groupId: sessions.groupId,
        groupName: groups.name,
        branchName: branches.name,
        coachName: coaches.fullName,
        sessionDate: sessions.sessionDate,
        startTime: sessions.startTime,
        endTime: sessions.endTime,
        room: sessions.room,
        status: sessions.status,
        note: sessions.note,
        marked: sql<number>`(select count(*) from ${attendance} a where a.session_id = ${qcol(sessions.id)})`.mapWith(Number),
        present: sql<number>`(select count(*) from ${attendance} a where a.session_id = ${qcol(sessions.id)} and a.status = 'present')`.mapWith(Number),
        enrolled: sql<number>`(select count(*) from ${groupEnrollments} e where e.group_id = ${qcol(sessions.groupId)} and e.status = 'active')`.mapWith(Number),
      })
      .from(sessions)
      .innerJoin(groups, eq(groups.id, sessions.groupId))
      .innerJoin(branches, eq(branches.id, groups.branchId))
      .leftJoin(coaches, eq(coaches.id, sessions.coachId))
      .where(and(eq(sessions.clubId, ctx.clubId), eq(sessions.sessionDate, date), inArray(sessions.groupId, gids)))
      .orderBy(asc(sessions.startTime), asc(groups.name));
    return { date, sessions: rows };
  });

  /** One-off extra lesson. */
  app.post('/', async (req, reply) => {
    const ctx = requireClub(req, ...STAFF);
    const data = z
      .object({ groupId: z.uuid(), sessionDate: isoDate, startTime: time, endTime: time, room: z.string().max(100).nullable().optional(), note: z.string().max(500).optional() })
      .parse(req.body);
    const row = await db.transaction(async (tx) => {
      const g = await loadGroup(tx, ctx, data.groupId);
      const [s] = await tx.insert(sessions).values({ ...data, clubId: ctx.clubId, coachId: g.coachId }).returning();
      await audit(tx, ctx, { action: 'create', entity: 'sessions', entityId: s.id, after: s });
      return s;
    });
    return reply.status(201).send(row);
  });

  /** Cancel / restore / move a lesson; parents are notified. */
  app.patch('/:id', async (req) => {
    const ctx = requireClub(req, ...STAFF);
    const { id } = idParam.parse(req.params);
    const data = z
      .object({
        status: z.enum(['scheduled', 'cancelled']).optional(),
        sessionDate: isoDate.optional(),
        startTime: time.optional(),
        endTime: time.optional(),
        room: z.string().max(100).nullable().optional(),
        note: z.string().max(500).nullable().optional(),
      })
      .parse(req.body);
    return db.transaction(async (tx) => {
      const { session: before } = await loadSession(tx, ctx, id);
      const [{ c }] = await tx.select({ c: sql<number>`count(*)`.mapWith(Number) }).from(attendance).where(eq(attendance.sessionId, id));
      if (c > 0 && (data.status === 'cancelled' || data.sessionDate)) throw conflict('has_attendance', 'Attendance already marked for this lesson');
      const [after] = await tx.update(sessions).set(data).where(eq(sessions.id, id)).returning();
      await audit(tx, ctx, { action: data.status === 'cancelled' ? 'cancel' : 'update', entity: 'sessions', entityId: id, before, after });
      if (data.status === 'cancelled' || data.sessionDate || data.startTime) {
        await notifyGroup(
          tx,
          ctx,
          before.groupId,
          { groupName: (await loadGroup(tx, ctx, before.groupId)).name, status: after.status, sessionDate: after.sessionDate, startTime: after.startTime, oldDate: before.sessionDate, note: after.note },
          `session_changed:${id}:${after.status}:${after.sessionDate}:${after.startTime}`,
        );
      }
      return after;
    });
  });

  /** Holiday: cancel all (unmarked) lessons of a day in scope. */
  app.post('/cancel-day', async (req) => {
    const ctx = requireClub(req, ...STAFF);
    const data = z.object({ date: isoDate, reason: z.string().trim().min(2).max(300), branchId: z.uuid().optional() }).parse(req.body);
    return db.transaction(async (tx) => {
      const gids = await scopedGroupIds(tx, ctx, data.branchId);
      await ensureSessions(tx, ctx.clubId, data.date, gids);
      if (!gids.length) return { cancelled: 0 };
      const rows = await tx
        .update(sessions)
        .set({ status: 'cancelled', note: data.reason })
        .where(
          and(
            eq(sessions.clubId, ctx.clubId),
            eq(sessions.sessionDate, data.date),
            inArray(sessions.groupId, gids),
            ne(sessions.status, 'cancelled'),
            sql`not exists (select 1 from ${attendance} a where a.session_id = ${qcol(sessions.id)})`,
          ),
        )
        .returning();
      for (const s of rows) {
        const g = await loadGroup(tx, ctx, s.groupId);
        await notifyGroup(tx, ctx, s.groupId, { groupName: g.name, status: 'cancelled', sessionDate: s.sessionDate, startTime: s.startTime, note: data.reason }, `session_changed:${s.id}:cancelled`);
      }
      await audit(tx, ctx, { action: 'cancel_day', entity: 'sessions', after: { ...data, count: rows.length } });
      return { cancelled: rows.length };
    });
  });

  /** Attendance sheet. */
  app.get('/:id/attendance', async (req) => {
    const ctx = requireClub(req, 'owner', 'branch_admin', 'coach');
    const { id } = idParam.parse(req.params);
    const { session, group } = await loadSession(db, ctx, id);
    const ids = await roster(db, group.id, id, session.sessionDate);
    if (!ids.length) return { session: { ...session, groupName: group.name }, rows: [] };
    const bal = balanceSql(qcol(athletes.id));
    const people = await db
      .select({ id: athletes.id, fullName: athletes.fullName, birthDate: athletes.birthDate, balance: bal })
      .from(athletes)
      .where(inArray(athletes.id, ids))
      .orderBy(asc(athletes.fullName));
    const marks = await db.select().from(attendance).where(eq(attendance.sessionId, id));
    const rows = [];
    for (const p of people) {
      const mark = marks.find((m) => m.athleteId === p.id);
      const sub = await findSubscriptionFor(db, ctx.clubId, p.id, group.sportId, session.sessionDate);
      rows.push({
        athleteId: p.id,
        fullName: p.fullName,
        status: mark?.status ?? null,
        markedAt: mark?.markedAt ?? null,
        updatedAt: mark?.updatedAt ?? null,
        hasDebt: p.balance > 0, // flag only — amounts are hidden from coaches
        subscription: sub
          ? { id: sub.id, billingType: sub.billingType, endDate: sub.endDate, remainingSessions: remainingSessions(sub) }
          : null,
      });
    }
    return { session: { ...session, groupName: group.name }, rows };
  });

  /** Mark attendance (coach of the group or staff). One final record per athlete — edits are tracked. */
  app.put('/:id/attendance', async (req) => {
    const ctx = requireClub(req, 'owner', 'branch_admin', 'coach');
    const { id } = idParam.parse(req.params);
    const { marks } = z
      .object({
        marks: z
          .array(z.object({ athleteId: z.uuid(), status: z.enum(['present', 'absent', 'excused']) }))
          .min(1)
          .max(200),
      })
      .parse(req.body);
    const today = todayInTz(ctx.timezone);
    return db.transaction(async (tx) => {
      const { session, group } = await loadSession(tx, ctx, id);
      if (ctx.role !== 'coach' && !canAccessBranch(ctx, group.branchId)) throw notFound('Session');
      if (session.status === 'cancelled') throw conflict('session_cancelled', 'Lesson is cancelled');
      if (session.sessionDate > today) throw badRequest('future_session', 'Cannot mark attendance for a future lesson');
      const allowed = new Set(await roster(tx, group.id, id, session.sessionDate));
      const unknown = marks.filter((m) => !allowed.has(m.athleteId));
      if (unknown.length) throw badRequest('not_in_group', 'Athlete is not in this group', unknown.map((u) => u.athleteId));

      const bal = balanceSql(qcol(athletes.id));
      const debtRows = await tx
        .select({ id: athletes.id, name: athletes.fullName, balance: bal })
        .from(athletes)
        .where(inArray(athletes.id, marks.map((m) => m.athleteId)));
      const debtors = new Set(debtRows.filter((d) => d.balance > 0).map((d) => d.id));
      const names = new Map(debtRows.map((d) => [d.id, d.name]));
      const existing = await tx.select().from(attendance).where(eq(attendance.sessionId, id));

      if (ctx.settings.debtorPolicy === 'block') {
        const blocked = marks.filter((m) => m.status === 'present' && debtors.has(m.athleteId) && existing.find((e) => e.athleteId === m.athleteId)?.status !== 'present');
        if (blocked.length) throw conflict('debtor_blocked', 'Debtors cannot attend (club setting)', blocked.map((b) => names.get(b.athleteId)));
      }

      const warnings: string[] = [];
      for (const m of marks) {
        const prev = existing.find((e) => e.athleteId === m.athleteId);
        if (prev?.status === m.status) continue;
        let subId = prev?.subscriptionId ?? null;
        if (!subId) subId = (await findSubscriptionFor(tx, ctx.clubId, m.athleteId, group.sportId, session.sessionDate))?.id ?? null;
        const delta = sessionUsageDelta((prev?.status as AttendanceStatus) ?? null, m.status, ctx.settings);
        if (subId) await applyUsage(tx, subId, delta, today);
        else if (m.status === 'present') warnings.push(`${names.get(m.athleteId)}: faol abonement yo‘q`);
        if (m.status === 'present' && debtors.has(m.athleteId)) warnings.push(`${names.get(m.athleteId)}: qarzdor`);

        if (prev) {
          await tx
            .update(attendance)
            .set({ status: m.status, subscriptionId: subId, updatedBy: ctx.userId, updatedAt: new Date() })
            .where(eq(attendance.id, prev.id));
          await audit(tx, ctx, { action: 'update', entity: 'attendance', entityId: prev.id, before: prev, after: { status: m.status } });
        } else {
          // the unique (session_id, athlete_id) index rejects any double insert
          await tx.insert(attendance).values({
            clubId: ctx.clubId,
            sessionId: id,
            athleteId: m.athleteId,
            status: m.status,
            subscriptionId: subId,
            markedBy: ctx.userId,
          });
        }
        const notify = ctx.settings.attendanceNotify;
        if (notify === 'all' || (notify === 'absent_only' && m.status === 'absent')) {
          await enqueueForAthlete(
            tx,
            ctx.clubId,
            m.athleteId,
            'attendance_marked',
            { athleteName: names.get(m.athleteId), status: m.status, sessionDate: session.sessionDate, groupName: group.name },
            `attendance:${id}:${m.athleteId}:${m.status}`,
          );
        }
      }
      if (session.status !== 'held') await tx.update(sessions).set({ status: 'held' }).where(eq(sessions.id, id));
      return { ok: true, warnings };
    });
  });
}

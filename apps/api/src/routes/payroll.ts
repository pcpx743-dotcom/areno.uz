/** Coach pay rules, payroll calculation, closing, corrections and payouts (PRD §8). Owner only. */
import type { FastifyInstance } from 'fastify';
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lt, lte, ne, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  charges,
  coachCompensationRules,
  coaches,
  expenses,
  groupEnrollments,
  groups,
  paymentAllocations,
  payments,
  payrollEntries,
  plans,
  sessions,
  subscriptions,
} from '../db/schema.js';
import { requireClub, type ClubCtx } from '../auth/context.js';
import type { Db, Tx } from '../db/client.js';
import { audit } from '../lib/audit.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { idParam, isoDate, optText } from '../lib/validation.js';
import { addDays, dateInTz, zonedDayRangeUtc } from '../domain/dates.js';
import { calculatePayroll, type HeldSession, type RevenueItem } from '../domain/payroll.js';

const ruleBody = z
  .object({
    coachId: z.uuid(),
    model: z.enum(['fixed_monthly', 'revenue_percent', 'per_session']),
    fixedAmount: z.number().int().positive().nullable().optional(),
    percentBp: z.number().int().min(1).max(10_000).nullable().optional(),
    perSessionAmount: z.number().int().positive().nullable().optional(),
    validFrom: isoDate,
    validTo: isoDate.nullable().optional(),
  })
  .refine((r) => (r.model === 'fixed_monthly' ? !!r.fixedAmount : r.model === 'per_session' ? !!r.perSessionAmount : !!r.percentBp), {
    message: 'Amount for the chosen model is required',
  });

/**
 * Cash attributed to each coach for a period (decision #5): subscription payments only,
 * matched to the athlete's groups of the plan's sport, split equally between those groups.
 */
async function revenueByCoach(db: Db | Tx, ctx: ClubCtx, start: string, end: string): Promise<Map<string, RevenueItem[]>> {
  const { from } = zonedDayRangeUtc(start, ctx.timezone);
  const { to } = zonedDayRangeUtc(end, ctx.timezone);
  const allocs = await db
    .select({
      amount: paymentAllocations.amount,
      paidAt: payments.paidAt,
      athleteId: charges.athleteId,
      sportId: plans.sportId,
    })
    .from(paymentAllocations)
    .innerJoin(payments, eq(payments.id, paymentAllocations.paymentId))
    .innerJoin(charges, eq(charges.id, paymentAllocations.chargeId))
    .innerJoin(subscriptions, eq(subscriptions.id, charges.subscriptionId))
    .innerJoin(plans, eq(plans.id, subscriptions.planId))
    .where(and(eq(payments.clubId, ctx.clubId), gte(payments.paidAt, from), lt(payments.paidAt, to)));
  const out = new Map<string, RevenueItem[]>();
  if (!allocs.length) return out;
  const athleteIds = [...new Set(allocs.map((a) => a.athleteId))];
  const enr = await db
    .select({ athleteId: groupEnrollments.athleteId, groupId: groups.id, sportId: groups.sportId, coachId: groups.coachId, branchId: groups.branchId })
    .from(groupEnrollments)
    .innerJoin(groups, eq(groups.id, groupEnrollments.groupId))
    .where(
      and(
        inArray(groupEnrollments.athleteId, athleteIds),
        isNotNull(groups.coachId),
        lte(groupEnrollments.startedAt, end),
        or(ne(groupEnrollments.status, 'ended'), gte(groupEnrollments.endedAt, start)),
      ),
    );
  for (const a of allocs) {
    const targets = enr.filter((e) => e.athleteId === a.athleteId && (a.sportId === null || e.sportId === a.sportId));
    const uniq = [...new Map(targets.map((t) => [t.groupId, t])).values()];
    if (!uniq.length) continue;
    const share = a.amount / uniq.length;
    for (const t of uniq) {
      const list = out.get(t.coachId!) ?? [];
      list.push({ date: dateInTz(a.paidAt, ctx.timezone), branchId: t.branchId, groupId: t.groupId, amount: share });
      out.set(t.coachId!, list);
    }
  }
  return out;
}

export default async function payrollRoutes(app: FastifyInstance) {
  const db = app.db;

  // ----- rules -----
  app.get('/rules', async (req) => {
    const ctx = requireClub(req, 'owner');
    const q = z.object({ coachId: z.uuid().optional() }).parse(req.query);
    return db
      .select()
      .from(coachCompensationRules)
      .where(and(eq(coachCompensationRules.clubId, ctx.clubId), q.coachId ? eq(coachCompensationRules.coachId, q.coachId) : undefined))
      .orderBy(desc(coachCompensationRules.validFrom));
  });

  /** New rule; an open rule of the same model for the coach is closed the day before. */
  app.post('/rules', async (req, reply) => {
    const ctx = requireClub(req, 'owner');
    const data = ruleBody.parse(req.body);
    const row = await db.transaction(async (tx) => {
      const [c] = await tx.select({ id: coaches.id }).from(coaches).where(and(eq(coaches.id, data.coachId), eq(coaches.clubId, ctx.clubId)));
      if (!c) throw notFound('Coach');
      await tx
        .update(coachCompensationRules)
        .set({ validTo: addDays(data.validFrom, -1) })
        .where(
          and(
            eq(coachCompensationRules.coachId, data.coachId),
            eq(coachCompensationRules.model, data.model),
            isNull(coachCompensationRules.validTo),
            lt(coachCompensationRules.validFrom, data.validFrom),
          ),
        );
      const [r] = await tx.insert(coachCompensationRules).values({ ...data, clubId: ctx.clubId }).returning();
      await audit(tx, ctx, { action: 'create', entity: 'coach_compensation_rules', entityId: r.id, after: r });
      return r;
    });
    return reply.status(201).send(row);
  });

  app.post('/rules/:id/end', async (req) => {
    const ctx = requireClub(req, 'owner');
    const { id } = idParam.parse(req.params);
    const { validTo } = z.object({ validTo: isoDate }).parse(req.body);
    return db.transaction(async (tx) => {
      const where = and(eq(coachCompensationRules.id, id), eq(coachCompensationRules.clubId, ctx.clubId));
      const [before] = await tx.select().from(coachCompensationRules).where(where);
      if (!before) throw notFound('Rule');
      const [after] = await tx.update(coachCompensationRules).set({ validTo }).where(where).returning();
      await audit(tx, ctx, { action: 'end', entity: 'coach_compensation_rules', entityId: id, before, after });
      return after;
    });
  });

  // ----- entries -----
  app.get('/', async (req) => {
    const ctx = requireClub(req, 'owner');
    const q = z.object({ periodStart: isoDate.optional(), periodEnd: isoDate.optional(), coachId: z.uuid().optional() }).parse(req.query);
    const rows = await db
      .select({ e: payrollEntries, coachName: coaches.fullName })
      .from(payrollEntries)
      .innerJoin(coaches, eq(coaches.id, payrollEntries.coachId))
      .where(
        and(
          eq(payrollEntries.clubId, ctx.clubId),
          q.periodStart ? eq(payrollEntries.periodStart, q.periodStart) : undefined,
          q.periodEnd ? eq(payrollEntries.periodEnd, q.periodEnd) : undefined,
          q.coachId ? eq(payrollEntries.coachId, q.coachId) : undefined,
        ),
      )
      .orderBy(desc(payrollEntries.periodStart), asc(coaches.fullName), asc(payrollEntries.createdAt));
    return rows.map(({ e, coachName }) => {
      const total = e.accrued + e.bonus - e.deduction;
      return { ...e, coachName, total, due: total - e.paid };
    });
  });

  /** (Re)calculate open entries for a period. Closed entries are never touched. */
  app.post('/calculate', async (req) => {
    const ctx = requireClub(req, 'owner');
    const data = z.object({ periodStart: isoDate, periodEnd: isoDate, coachId: z.uuid().optional() }).parse(req.body);
    if (data.periodEnd < data.periodStart) throw badRequest('invalid_range', 'periodEnd is before periodStart');
    return db.transaction(async (tx) => {
      const coachRows = await tx
        .select({ id: coaches.id })
        .from(coaches)
        .where(and(eq(coaches.clubId, ctx.clubId), data.coachId ? eq(coaches.id, data.coachId) : undefined));
      const revenue = await revenueByCoach(tx, ctx, data.periodStart, data.periodEnd);
      const results = [];
      for (const { id: coachId } of coachRows) {
        const rules = await tx
          .select()
          .from(coachCompensationRules)
          .where(
            and(
              eq(coachCompensationRules.coachId, coachId),
              lte(coachCompensationRules.validFrom, data.periodEnd),
              or(isNull(coachCompensationRules.validTo), gte(coachCompensationRules.validTo, data.periodStart)),
            ),
          );
        if (!rules.length) continue;
        const held: HeldSession[] = (
          await tx
            .select({ date: sessions.sessionDate, branchId: groups.branchId, groupId: groups.id })
            .from(sessions)
            .innerJoin(groups, eq(groups.id, sessions.groupId))
            .where(
              and(
                eq(sessions.clubId, ctx.clubId),
                eq(sessions.coachId, coachId),
                eq(sessions.status, 'held'),
                gte(sessions.sessionDate, data.periodStart),
                lte(sessions.sessionDate, data.periodEnd),
              ),
            )
        ).map((s) => ({ ...s }));
        const calc = calculatePayroll({ ...data, rules, sessions: held, revenue: revenue.get(coachId) ?? [] });
        const [open] = await tx
          .select()
          .from(payrollEntries)
          .where(
            and(
              eq(payrollEntries.coachId, coachId),
              eq(payrollEntries.periodStart, data.periodStart),
              eq(payrollEntries.periodEnd, data.periodEnd),
              isNull(payrollEntries.correctionOfId),
            ),
          );
        if (open?.closedAt) {
          results.push({ coachId, skipped: 'closed' });
          continue;
        }
        const values = { accrued: calc.accrued, details: calc as never };
        const [entry] = open
          ? await tx.update(payrollEntries).set(values).where(eq(payrollEntries.id, open.id)).returning()
          : await tx.insert(payrollEntries).values({ clubId: ctx.clubId, coachId, ...data, ...values }).returning();
        await audit(tx, ctx, { action: 'calculate', entity: 'payroll_entries', entityId: entry.id, before: open ?? null, after: entry });
        results.push({ coachId, entryId: entry.id, accrued: calc.accrued });
      }
      return { results };
    });
  });

  async function loadEntry(tx: Tx, ctx: ClubCtx, id: string) {
    const [e] = await tx
      .select()
      .from(payrollEntries)
      .where(and(eq(payrollEntries.id, id), eq(payrollEntries.clubId, ctx.clubId)))
      .for('update');
    if (!e) throw notFound('Payroll entry');
    return e;
  }

  app.patch('/:id', async (req) => {
    const ctx = requireClub(req, 'owner');
    const { id } = idParam.parse(req.params);
    const data = z
      .object({ bonus: z.number().int().min(0).optional(), deduction: z.number().int().min(0).optional(), note: optText })
      .parse(req.body);
    return db.transaction(async (tx) => {
      const before = await loadEntry(tx, ctx, id);
      if (before.closedAt) throw conflict('period_closed', 'Closed period: create a correction instead');
      const [after] = await tx.update(payrollEntries).set(data).where(eq(payrollEntries.id, id)).returning();
      await audit(tx, ctx, { action: 'update', entity: 'payroll_entries', entityId: id, before, after });
      return after;
    });
  });

  app.post('/:id/close', async (req) => {
    const ctx = requireClub(req, 'owner');
    const { id } = idParam.parse(req.params);
    return db.transaction(async (tx) => {
      const before = await loadEntry(tx, ctx, id);
      if (before.closedAt) throw conflict('period_closed', 'Already closed');
      const [after] = await tx.update(payrollEntries).set({ closedAt: new Date() }).where(eq(payrollEntries.id, id)).returning();
      await audit(tx, ctx, { action: 'close', entity: 'payroll_entries', entityId: id, before, after });
      return after;
    });
  });

  /** After closing, changes only via a separate correction entry (PRD §8). */
  app.post('/:id/correction', async (req, reply) => {
    const ctx = requireClub(req, 'owner');
    const { id } = idParam.parse(req.params);
    const data = z
      .object({ amount: z.number().int().refine((n) => n !== 0, 'Must not be zero'), note: z.string().trim().min(3).max(500) })
      .parse(req.body);
    const row = await db.transaction(async (tx) => {
      const orig = await loadEntry(tx, ctx, id);
      if (!orig.closedAt) throw badRequest('period_open', 'Edit the open entry instead');
      const [c] = await tx
        .insert(payrollEntries)
        .values({
          clubId: ctx.clubId,
          coachId: orig.coachId,
          periodStart: orig.periodStart,
          periodEnd: orig.periodEnd,
          accrued: data.amount > 0 ? data.amount : 0,
          deduction: data.amount < 0 ? -data.amount : 0,
          correctionOfId: orig.id,
          note: data.note,
          closedAt: new Date(),
        })
        .returning();
      await audit(tx, ctx, { action: 'correction', entity: 'payroll_entries', entityId: c.id, after: c });
      return c;
    });
    return reply.status(201).send(row);
  });

  /** Pay out salary: records `paid` and a salary expense (operating result). */
  app.post('/:id/pay', async (req) => {
    const ctx = requireClub(req, 'owner');
    const { id } = idParam.parse(req.params);
    const data = z.object({ amount: z.number().int().positive(), branchId: z.uuid().nullable().optional(), date: isoDate.optional() }).parse(req.body);
    return db.transaction(async (tx) => {
      const before = await loadEntry(tx, ctx, id);
      const due = before.accrued + before.bonus - before.deduction - before.paid;
      if (data.amount > due) throw badRequest('overpay', `Only ${due} is due`);
      const [after] = await tx
        .update(payrollEntries)
        .set({ paid: sql`${payrollEntries.paid} + ${data.amount}` })
        .where(eq(payrollEntries.id, id))
        .returning();
      const [coach] = await tx.select({ name: coaches.fullName }).from(coaches).where(eq(coaches.id, before.coachId));
      await tx.insert(expenses).values({
        clubId: ctx.clubId,
        branchId: data.branchId ?? null,
        category: 'salary',
        amount: data.amount,
        incurredAt: data.date ?? before.periodEnd,
        note: `Ish haqi: ${coach?.name} (${before.periodStart} – ${before.periodEnd})`,
        createdBy: ctx.userId,
        paidBy: ctx.userId,
        payrollEntryId: id,
      });
      await audit(tx, ctx, { action: 'pay', entity: 'payroll_entries', entityId: id, before, after: { ...after, paidNow: data.amount } });
      return after;
    });
  });
}

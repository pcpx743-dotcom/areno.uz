/** Charges (obligations), debtor lists and balance adjustments (PRD §6). */
import type { FastifyInstance } from 'fastify';
import { and, asc, desc, eq, gte, inArray, lt, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import { athletes, balanceAdjustments, charges } from '../db/schema.js';
import { assertBranch, requireClub, STAFF } from '../auth/context.js';
import { audit } from '../lib/audit.js';
import { athleteBalance, balanceSql } from '../lib/balance-queries.js';
import { applyAdvance } from '../lib/billing.js';
import { badRequest, notFound } from '../lib/errors.js';
import { loadAthlete } from '../lib/loaders.js';
import { branchScope, LIST_MAX, qcol } from '../lib/scope.js';
import { idParam, isoDate, uzs } from '../lib/validation.js';
import { addDays, todayInTz } from '../domain/dates.js';

export default async function chargeRoutes(app: FastifyInstance) {
  const db = app.db;

  /**
   * view=upcoming (due within `days`, unpaid) | overdue (past due, unpaid) | paid | open (all unpaid)
   */
  app.get('/', async (req) => {
    const ctx = requireClub(req, ...STAFF);
    const q = z
      .object({
        view: z.enum(['upcoming', 'overdue', 'paid', 'open']).default('open'),
        days: z.coerce.number().int().min(0).max(90).default(3),
        branchId: z.uuid().optional(),
        athleteId: z.uuid().optional(),
      })
      .parse(req.query);
    const today = todayInTz(ctx.timezone);
    const unpaid = inArray(charges.status, ['open', 'partially_paid']);
    const viewCond =
      q.view === 'upcoming'
        ? and(unpaid, gte(charges.dueDate, today), lte(charges.dueDate, addDays(today, q.days)))
        : q.view === 'overdue'
          ? and(unpaid, lt(charges.dueDate, today))
          : q.view === 'paid'
            ? eq(charges.status, 'paid')
            : unpaid;
    const rows = await db
      .select({
        id: charges.id,
        athleteId: charges.athleteId,
        athleteName: athletes.fullName,
        branchId: charges.branchId,
        description: charges.description,
        dueDate: charges.dueDate,
        amount: charges.amount,
        paidAmount: charges.paidAmount,
        status: charges.status,
      })
      .from(charges)
      .innerJoin(athletes, eq(athletes.id, charges.athleteId))
      .where(
        and(
          eq(charges.clubId, ctx.clubId),
          branchScope(ctx, charges.branchId),
          viewCond,
          q.branchId ? eq(charges.branchId, q.branchId) : undefined,
          q.athleteId ? eq(charges.athleteId, q.athleteId) : undefined,
        ),
      )
      .orderBy(q.view === 'paid' ? desc(charges.dueDate) : asc(charges.dueDate))
      .limit(LIST_MAX);
    return rows.map((r) => ({
      ...r,
      outstanding: r.amount - r.paidAmount,
      daysOverdue: r.dueDate < today && r.status !== 'paid' ? Math.round((Date.parse(today) - Date.parse(r.dueDate)) / 86_400_000) : 0,
    }));
  });

  /** Debtors: athletes with positive balance (PRD §6, §11). */
  app.get('/debtors', async (req) => {
    const ctx = requireClub(req, ...STAFF);
    const bal = balanceSql(qcol(athletes.id));
    const oldestDue = sql<string | null>`(select min(c.due_date) from ${charges} c where c.athlete_id = ${qcol(athletes.id)} and c.status in ('open','partially_paid'))`;
    const rows = await db
      .select({ id: athletes.id, fullName: athletes.fullName, branchId: athletes.branchId, debt: bal, oldestDue })
      .from(athletes)
      .where(and(eq(athletes.clubId, ctx.clubId), branchScope(ctx, athletes.branchId), sql`${bal} > 0`))
      .orderBy(desc(bal));
    const today = todayInTz(ctx.timezone);
    return rows.map((r) => ({
      ...r,
      daysOverdue: r.oldestDue && r.oldestDue < today ? Math.round((Date.parse(today) - Date.parse(r.oldestDue)) / 86_400_000) : 0,
    }));
  });

  /** Manual one-off charge (e.g. single lesson, kit). */
  app.post('/', async (req, reply) => {
    const ctx = requireClub(req, ...STAFF);
    const data = z
      .object({
        athleteId: z.uuid(),
        amount: uzs.refine((n) => n > 0, 'Must be positive'),
        dueDate: isoDate.optional(),
        description: z.string().trim().min(2).max(300),
        branchId: z.uuid().optional(),
      })
      .parse(req.body);
    const row = await db.transaction(async (tx) => {
      const a = await loadAthlete(tx, ctx, data.athleteId);
      const branchId = data.branchId ?? a.branchId;
      assertBranch(ctx, branchId);
      const [c] = await tx
        .insert(charges)
        .values({
          clubId: ctx.clubId,
          branchId,
          athleteId: a.id,
          description: data.description,
          dueDate: data.dueDate ?? todayInTz(ctx.timezone),
          amount: data.amount,
        })
        .returning();
      await applyAdvance(tx, ctx.clubId, a.id);
      await audit(tx, ctx, { action: 'create', entity: 'charges', entityId: c.id, after: c });
      return c;
    });
    return reply.status(201).send(row);
  });

  /** Void an unpaid charge (owner). Paid money must be reversed first. */
  app.post('/:id/void', async (req) => {
    const ctx = requireClub(req, 'owner');
    const { id } = idParam.parse(req.params);
    const { reason } = z.object({ reason: z.string().trim().min(3).max(500) }).parse(req.body);
    return db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(charges)
        .where(and(eq(charges.id, id), eq(charges.clubId, ctx.clubId)));
      if (!before) throw notFound('Charge');
      if (before.status === 'void') throw badRequest('already_void', 'Charge is already void');
      if (before.paidAmount !== 0) throw badRequest('charge_has_payments', 'Reverse the payments first');
      const [after] = await tx.update(charges).set({ status: 'void' }).where(eq(charges.id, id)).returning();
      await audit(tx, ctx, { action: 'void', entity: 'charges', entityId: id, before, after: { ...after, reason } });
      return after;
    });
  });

  /** Approved discount / correction reducing the balance (owner). */
  app.post('/adjustments', async (req, reply) => {
    const ctx = requireClub(req, 'owner');
    const data = z
      .object({
        athleteId: z.uuid(),
        amount: z.number().int().refine((n) => n !== 0, 'Must not be zero'),
        reason: z.string().trim().min(3).max(500),
        chargeId: z.uuid().optional(),
      })
      .parse(req.body);
    const row = await db.transaction(async (tx) => {
      await loadAthlete(tx, ctx, data.athleteId);
      const [adj] = await tx
        .insert(balanceAdjustments)
        .values({ ...data, clubId: ctx.clubId, createdBy: ctx.userId })
        .returning();
      await audit(tx, ctx, { action: 'create', entity: 'balance_adjustments', entityId: adj.id, after: adj });
      return adj;
    });
    return reply.status(201).send({ adjustment: row, balance: await athleteBalance(db, ctx.clubId, data.athleteId) });
  });
}

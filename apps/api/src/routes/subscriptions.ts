/** Subscriptions (PRD §5) — calculations delegated to the pure subscription engine. */
import type { FastifyInstance } from 'fastify';
import { and, asc, eq, gte, inArray, lte } from 'drizzle-orm';
import { z } from 'zod';
import { athletes, charges, plans, subscriptionFreezes, subscriptions } from '../db/schema.js';
import { assertBranch, requireClub, STAFF, type ClubCtx } from '../auth/context.js';
import type { Db, Tx } from '../db/client.js';
import { audit } from '../lib/audit.js';
import { applyAdvance } from '../lib/billing.js';
import { badRequest, notFound } from '../lib/errors.js';
import { loadAthlete } from '../lib/loaders.js';
import { branchScope } from '../lib/scope.js';
import { idParam, isoDate, optText, uzs } from '../lib/validation.js';
import { addDays, compareIso, todayInTz } from '../domain/dates.js';
import { computePeriod, computePrice, planFreeze, remainingSessions } from '../domain/subscription-engine.js';

const createBody = z.object({
  athleteId: z.uuid(),
  planId: z.uuid(),
  startDate: isoDate.optional(),
  branchId: z.uuid().optional(),
  individualPrice: uzs.nullable().optional(),
  discount: uzs.optional(),
  discountReason: optText,
  dueDate: isoDate.optional(),
});

async function loadSubscription(db: Db | Tx, ctx: ClubCtx, id: string) {
  const [s] = await db
    .select()
    .from(subscriptions)
    .where(and(eq(subscriptions.id, id), eq(subscriptions.clubId, ctx.clubId), branchScope(ctx, subscriptions.branchId)));
  if (!s) throw notFound('Subscription');
  return s;
}

export default async function subscriptionRoutes(app: FastifyInstance) {
  const db = app.db;

  app.get('/', async (req) => {
    const ctx = requireClub(req, ...STAFF);
    const q = z
      .object({
        athleteId: z.uuid().optional(),
        branchId: z.uuid().optional(),
        status: z.enum(['draft', 'active', 'frozen', 'expired', 'cancelled']).optional(),
        expiringWithinDays: z.coerce.number().int().min(0).max(90).optional(),
      })
      .parse(req.query);
    const today = todayInTz(ctx.timezone);
    const rows = await db
      .select({
        id: subscriptions.id,
        athleteId: subscriptions.athleteId,
        athleteName: athletes.fullName,
        planName: plans.name,
        branchId: subscriptions.branchId,
        billingType: subscriptions.billingType,
        startDate: subscriptions.startDate,
        endDate: subscriptions.endDate,
        price: subscriptions.price,
        sessionLimit: subscriptions.sessionLimit,
        usedSessions: subscriptions.usedSessions,
        status: subscriptions.status,
      })
      .from(subscriptions)
      .innerJoin(athletes, eq(athletes.id, subscriptions.athleteId))
      .innerJoin(plans, eq(plans.id, subscriptions.planId))
      .where(
        and(
          eq(subscriptions.clubId, ctx.clubId),
          branchScope(ctx, subscriptions.branchId),
          q.athleteId ? eq(subscriptions.athleteId, q.athleteId) : undefined,
          q.branchId ? eq(subscriptions.branchId, q.branchId) : undefined,
          q.status ? eq(subscriptions.status, q.status) : undefined,
          q.expiringWithinDays != null
            ? and(
                eq(subscriptions.status, 'active'),
                gte(subscriptions.endDate, today),
                lte(subscriptions.endDate, addDays(today, q.expiringWithinDays)),
              )
            : undefined,
        ),
      )
      .orderBy(asc(subscriptions.endDate));
    return rows.map((r) => ({ ...r, remainingSessions: remainingSessions(r) }));
  });

  /** Assign a plan to an athlete → subscription + charge (PRD §13A). */
  app.post('/', async (req, reply) => {
    const ctx = requireClub(req, ...STAFF);
    const data = createBody.parse(req.body);
    if ((data.discount ?? 0) > 0 && !data.discountReason) {
      throw badRequest('discount_reason_required', 'A reason is required for discounts');
    }
    const result = await db.transaction(async (tx) => {
      const athlete = await loadAthlete(tx, ctx, data.athleteId);
      if (athlete.status === 'archived') throw badRequest('athlete_archived', 'Athlete is archived');
      const branchId = data.branchId ?? athlete.branchId;
      assertBranch(ctx, branchId);

      const [plan] = await tx
        .select()
        .from(plans)
        .where(and(eq(plans.id, data.planId), eq(plans.clubId, ctx.clubId)));
      if (!plan) throw notFound('Plan');
      if (!plan.active) throw badRequest('plan_inactive', 'Plan is not active');
      if (plan.branchIds.length && !plan.branchIds.includes(branchId)) {
        throw badRequest('plan_not_in_branch', 'Plan is not available in this branch');
      }

      const startDate = data.startDate ?? todayInTz(ctx.timezone);
      const period = computePeriod(plan, startDate);
      const price = computePrice({
        plan,
        startDate,
        individualPrice: data.individualPrice,
        discount: data.discount,
        settings: ctx.settings,
      });

      const [sub] = await tx
        .insert(subscriptions)
        .values({
          clubId: ctx.clubId,
          branchId,
          athleteId: athlete.id,
          planId: plan.id,
          billingType: plan.billingType,
          startDate,
          endDate: period.endDate,
          listPrice: price.listPrice,
          discount: price.discount,
          discountReason: data.discountReason ?? null,
          price: price.price,
          sessionLimit: plan.billingType === 'session_pack' ? plan.sessionLimit : null,
          status: 'active',
          createdBy: ctx.userId,
        })
        .returning();

      let charge = null;
      if (price.price > 0) {
        [charge] = await tx
          .insert(charges)
          .values({
            clubId: ctx.clubId,
            branchId,
            athleteId: athlete.id,
            subscriptionId: sub.id,
            description: `${plan.name} (${startDate}${period.endDate ? ' – ' + period.endDate : ''})`,
            dueDate: data.dueDate ?? startDate,
            amount: price.price,
          })
          .returning();
        // an existing advance (overpayment) pays the new charge automatically
        await applyAdvance(tx, ctx.clubId, athlete.id);
        [charge] = await tx.select().from(charges).where(eq(charges.id, charge.id));
      }
      await audit(tx, ctx, { action: 'create', entity: 'subscriptions', entityId: sub.id, after: { subscription: sub, charge, price } });
      return { subscription: { ...sub, remainingSessions: remainingSessions(sub) }, charge, pricing: price };
    });
    return reply.status(201).send(result);
  });

  app.post('/:id/freeze', async (req) => {
    const ctx = requireClub(req, ...STAFF);
    const { id } = idParam.parse(req.params);
    const data = z.object({ fromDate: isoDate, toDate: isoDate, reason: z.string().trim().min(2).max(500) }).parse(req.body);
    return db.transaction(async (tx) => {
      const before = await loadSubscription(tx, ctx, id);
      const plan = planFreeze({ sub: before, fromDate: data.fromDate, toDate: data.toDate, settings: ctx.settings });
      const today = todayInTz(ctx.timezone);
      const frozenNow = compareIso(data.fromDate, today) <= 0 && compareIso(today, data.toDate) <= 0;
      const [after] = await tx
        .update(subscriptions)
        .set({
          endDate: plan.newEndDate,
          freezeCount: plan.freezeCount,
          frozenDays: plan.frozenDays,
          status: frozenNow ? 'frozen' : before.status,
        })
        .where(eq(subscriptions.id, id))
        .returning();
      await tx.insert(subscriptionFreezes).values({ clubId: ctx.clubId, subscriptionId: id, ...data, createdBy: ctx.userId });
      await audit(tx, ctx, { action: 'freeze', entity: 'subscriptions', entityId: id, before, after: { ...after, freeze: data } });
      return after;
    });
  });

  app.post('/:id/unfreeze', async (req) => {
    const ctx = requireClub(req, ...STAFF);
    const { id } = idParam.parse(req.params);
    return db.transaction(async (tx) => {
      const before = await loadSubscription(tx, ctx, id);
      if (before.status !== 'frozen') throw badRequest('invalid_state', 'Subscription is not frozen');
      const [after] = await tx.update(subscriptions).set({ status: 'active' }).where(eq(subscriptions.id, id)).returning();
      await audit(tx, ctx, { action: 'unfreeze', entity: 'subscriptions', entityId: id, before, after });
      return after;
    });
  });

  app.post('/:id/cancel', async (req) => {
    const ctx = requireClub(req, ...STAFF);
    const { id } = idParam.parse(req.params);
    const data = z.object({ reason: z.string().trim().min(2).max(500), voidUnpaidCharge: z.boolean().default(false) }).parse(req.body);
    return db.transaction(async (tx) => {
      const before = await loadSubscription(tx, ctx, id);
      if (before.status === 'cancelled') throw badRequest('invalid_state', 'Already cancelled');
      const [after] = await tx.update(subscriptions).set({ status: 'cancelled' }).where(eq(subscriptions.id, id)).returning();
      let voided: string[] = [];
      if (data.voidUnpaidCharge) {
        // Only fully unpaid charges are voided; paid money is handled via reversal in Billing.
        const rows = await tx
          .update(charges)
          .set({ status: 'void' })
          .where(and(eq(charges.subscriptionId, id), eq(charges.paidAmount, 0), inArray(charges.status, ['open'])))
          .returning({ id: charges.id });
        voided = rows.map((r) => r.id);
      }
      await audit(tx, ctx, { action: 'cancel', entity: 'subscriptions', entityId: id, before, after: { ...after, reason: data.reason, voided } });
      return { ...after, voidedCharges: voided };
    });
  });
}

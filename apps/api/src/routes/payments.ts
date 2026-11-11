/** Cash payments (PRD §6): idempotent create, allocation, reversal (storno). */
import type { FastifyInstance } from 'fastify';
import { and, desc, eq, gte, lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import { athletes, cashClosings, paymentAllocations, payments, users } from '../db/schema.js';
import { assertBranch, requireClub, STAFF, type ClubCtx } from '../auth/context.js';
import type { Db, Tx } from '../db/client.js';
import { audit } from '../lib/audit.js';
import { athleteBalance } from '../lib/balance-queries.js';
import { allocate, applyAdvance, nextReceiptNo, recomputeCharges } from '../lib/billing.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { loadAthlete } from '../lib/loaders.js';
import { enqueueForAthlete } from '../lib/notify.js';
import { branchScope, LIST_MAX, page } from '../lib/scope.js';
import { idParam, isoDate, optText } from '../lib/validation.js';
import { dateInTz, todayInTz, zonedDayRangeUtc } from '../domain/dates.js';

const createBody = z.object({
  athleteId: z.uuid(),
  amount: z.number().int().positive().max(1_000_000_000),
  method: z.enum(['cash', 'click_payme', 'terminal']).default('cash'),
  paidAt: z.iso.datetime({ offset: true }).optional(),
  branchId: z.uuid().optional(),
  receiptNo: z.string().trim().max(50).optional().nullable(),
  note: optText,
  /** Charges to pay first; the rest goes oldest-due first. */
  chargeIds: z.array(z.uuid()).max(50).default([]),
  idempotencyKey: z.string().trim().min(8).max(100).optional(),
});

export async function isDayClosed(db: Db | Tx, clubId: string, branchId: string, date: string) {
  const [c] = await db
    .select({ id: cashClosings.id })
    .from(cashClosings)
    .where(and(eq(cashClosings.clubId, clubId), eq(cashClosings.branchId, branchId), eq(cashClosings.date, date)));
  return !!c;
}

async function paymentResponse(db: Db | Tx, ctx: ClubCtx, paymentId: string, duplicate: boolean) {
  const [payment] = await db.select().from(payments).where(eq(payments.id, paymentId));
  const allocations = await db.select().from(paymentAllocations).where(eq(paymentAllocations.paymentId, paymentId));
  const balance = await athleteBalance(db, ctx.clubId, payment.athleteId);
  return { payment, allocations, balance, duplicate };
}

export default async function paymentRoutes(app: FastifyInstance) {
  const db = app.db;

  app.get('/', async (req) => {
    const ctx = requireClub(req, ...STAFF);
    const q = z
      .object({
        from: isoDate.optional(),
        to: isoDate.optional(),
        branchId: z.uuid().optional(),
        athleteId: z.uuid().optional(),
        cashierId: z.uuid().optional(),
        limit: z.coerce.number().optional(),
        offset: z.coerce.number().optional(),
      })
      .parse(req.query);
    const { limit, offset } = page(q, LIST_MAX);
    const range = q.from ? zonedDayRangeUtc(q.from, ctx.timezone) : null;
    const rangeTo = q.to ? zonedDayRangeUtc(q.to, ctx.timezone) : null;
    const reversedBy = sql<string | null>`(select r.id from ${payments} r where r.reversal_of_id = ${payments.id} limit 1)`;
    return db
      .select({
        id: payments.id,
        athleteId: payments.athleteId,
        athleteName: athletes.fullName,
        branchId: payments.branchId,
        amount: payments.amount,
        method: payments.method,
        paidAt: payments.paidAt,
        receiptNo: payments.receiptNo,
        note: payments.note,
        cashierName: users.fullName,
        reversalOfId: payments.reversalOfId,
        reversalReason: payments.reversalReason,
        reversedById: reversedBy,
      })
      .from(payments)
      .innerJoin(athletes, eq(athletes.id, payments.athleteId))
      .leftJoin(users, eq(users.id, payments.receivedBy))
      .where(
        and(
          eq(payments.clubId, ctx.clubId),
          branchScope(ctx, payments.branchId),
          q.branchId ? eq(payments.branchId, q.branchId) : undefined,
          q.athleteId ? eq(payments.athleteId, q.athleteId) : undefined,
          q.cashierId ? eq(payments.receivedBy, q.cashierId) : undefined,
          range ? gte(payments.paidAt, range.from) : undefined,
          rangeTo ? lt(payments.paidAt, rangeTo.to) : undefined,
        ),
      )
      .orderBy(desc(payments.paidAt), desc(payments.id))
      .limit(limit)
      .offset(offset);
  });

  /** Accept cash. Idempotency key (header `Idempotency-Key` or body) is required. */
  app.post('/', async (req, reply) => {
    const ctx = requireClub(req, ...STAFF);
    const data = createBody.parse(req.body);
    const key = (req.headers['idempotency-key'] as string | undefined)?.trim() || data.idempotencyKey;
    if (!key) throw badRequest('idempotency_key_required', 'Idempotency-Key header is required');

    const findExisting = async () => {
      const [p] = await db
        .select({ id: payments.id })
        .from(payments)
        .where(and(eq(payments.clubId, ctx.clubId), eq(payments.idempotencyKey, key)));
      return p?.id;
    };
    const existing = await findExisting();
    if (existing) return reply.status(200).send(await paymentResponse(db, ctx, existing, true));

    const paidAt = data.paidAt ? new Date(data.paidAt) : new Date();
    if (paidAt.getTime() > Date.now() + 5 * 60_000) throw badRequest('future_payment', 'Payment date cannot be in the future');

    try {
      const paymentId = await db.transaction(async (tx) => {
        const athlete = await loadAthlete(tx, ctx, data.athleteId);
        const branchId = data.branchId ?? athlete.branchId;
        assertBranch(ctx, branchId);
        const day = dateInTz(paidAt, ctx.timezone);
        if (ctx.role !== 'owner' && (await isDayClosed(tx, ctx.clubId, branchId, day))) {
          throw conflict('day_closed', 'Cash day is closed for this branch; only the owner can add payments');
        }
        const receiptNo = data.receiptNo || (await nextReceiptNo(tx, ctx.clubId));
        const [p] = await tx
          .insert(payments)
          .values({
            clubId: ctx.clubId,
            branchId,
            athleteId: athlete.id,
            amount: data.amount,
            method: data.method,
            paidAt,
            receivedBy: ctx.userId,
            receiptNo,
            note: data.note ?? null,
            idempotencyKey: key,
          })
          .returning();
        const { allocations, remainder } = await allocate(tx, ctx.clubId, athlete.id, p.id, data.amount, data.chargeIds);
        const balance = await athleteBalance(tx, ctx.clubId, athlete.id);
        await enqueueForAthlete(
          tx,
          ctx.clubId,
          athlete.id,
          'payment_received',
          { athleteName: athlete.fullName, amount: data.amount, method: data.method, paidAt: paidAt.toISOString(), receiptNo, debt: balance.debt, advance: balance.advance },
          `payment_received:${p.id}`,
        );
        await audit(tx, ctx, { action: 'create', entity: 'payments', entityId: p.id, after: { payment: p, allocations, remainder } });
        return p.id;
      });
      return reply.status(201).send(await paymentResponse(db, ctx, paymentId, false));
    } catch (e) {
      // Concurrent retry with the same key: the other request won the unique index.
      const code = (e as { code?: string; cause?: { code?: string } }).cause?.code ?? (e as { code?: string }).code;
      if (code === '23505') {
        const id = await findExisting();
        if (id) return reply.status(200).send(await paymentResponse(db, ctx, id, true));
      }
      throw e;
    }
  });

  /** Storno: never delete — create a negative mirror payment. */
  app.post('/:id/reverse', async (req, reply) => {
    const ctx = requireClub(req, ...STAFF);
    const { id } = idParam.parse(req.params);
    const { reason } = z.object({ reason: z.string().trim().min(3).max(500) }).parse(req.body);
    const result = await db.transaction(async (tx) => {
      const [orig] = await tx
        .select()
        .from(payments)
        .where(and(eq(payments.id, id), eq(payments.clubId, ctx.clubId), branchScope(ctx, payments.branchId)))
        .for('update');
      if (!orig) throw notFound('Payment');
      if (orig.reversalOfId || orig.amount <= 0) throw badRequest('not_reversible', 'A reversal cannot be reversed');
      const [already] = await tx.select({ id: payments.id }).from(payments).where(eq(payments.reversalOfId, id));
      if (already) throw conflict('already_reversed', 'Payment is already reversed');

      if (ctx.role !== 'owner') {
        const payDay = dateInTz(orig.paidAt, ctx.timezone);
        if (payDay !== todayInTz(ctx.timezone)) throw forbidden('Administrators can reverse only same-day payments');
        if (await isDayClosed(tx, ctx.clubId, orig.branchId, payDay)) throw forbidden('Cash day is closed; ask the owner');
      }

      const [rev] = await tx
        .insert(payments)
        .values({
          clubId: ctx.clubId,
          branchId: orig.branchId,
          athleteId: orig.athleteId,
          amount: -orig.amount,
          method: orig.method,
          receivedBy: ctx.userId,
          receiptNo: orig.receiptNo ? `${orig.receiptNo}-S` : null,
          note: `Storno: ${reason}`,
          reversalOfId: orig.id,
          reversalReason: reason,
        })
        .returning();
      const allocs = await tx.select().from(paymentAllocations).where(eq(paymentAllocations.paymentId, orig.id));
      if (allocs.length) {
        await tx.insert(paymentAllocations).values(allocs.map((a) => ({ paymentId: rev.id, chargeId: a.chargeId, amount: -a.amount })));
        await recomputeCharges(
          tx,
          allocs.map((a) => a.chargeId),
        );
      }
      // other advance money may now cover the reopened charges
      await applyAdvance(tx, ctx.clubId, orig.athleteId);
      await audit(tx, ctx, { action: 'reverse', entity: 'payments', entityId: orig.id, before: orig, after: { reversal: rev, reason } });
      return rev;
    });
    return reply.status(201).send({ reversal: result, balance: await athleteBalance(db, ctx.clubId, result.athleteId) });
  });
}

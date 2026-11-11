/** Cash desk report and end-of-day closing (PRD §6, §13D). */
import type { FastifyInstance } from 'fastify';
import { and, asc, desc, eq, gte, lt, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import { branches, cashClosings, payments, users } from '../db/schema.js';
import { assertBranch, requireClub, STAFF, type ClubCtx } from '../auth/context.js';
import type { Db, Tx } from '../db/client.js';
import { audit } from '../lib/audit.js';
import { conflict } from '../lib/errors.js';
import { branchScope, LIST_MAX } from '../lib/scope.js';
import { isoDate, uzs, optText } from '../lib/validation.js';
import { todayInTz, zonedDayRangeUtc } from '../domain/dates.js';

/** Cash movement per branch & cashier for one day (club timezone). */
export async function cashDay(db: Db | Tx, ctx: ClubCtx, date: string, branchId?: string) {
  const { from, to } = zonedDayRangeUtc(date, ctx.timezone);
  const rows = await db
    .select({
      branchId: payments.branchId,
      cashierId: payments.receivedBy,
      cashierName: users.fullName,
      method: payments.method,
      income: sql<number>`coalesce(sum(${payments.amount}) filter (where ${payments.amount} > 0), 0)`.mapWith(Number),
      refunds: sql<number>`coalesce(-sum(${payments.amount}) filter (where ${payments.amount} < 0), 0)`.mapWith(Number),
      count: sql<number>`count(*) filter (where ${payments.amount} > 0)`.mapWith(Number),
    })
    .from(payments)
    .leftJoin(users, eq(users.id, payments.receivedBy))
    .where(
      and(
        eq(payments.clubId, ctx.clubId),
        branchScope(ctx, payments.branchId),
        branchId ? eq(payments.branchId, branchId) : undefined,
        gte(payments.paidAt, from),
        lt(payments.paidAt, to),
      ),
    )
    .groupBy(payments.branchId, payments.receivedBy, users.fullName, payments.method);
  // merge methods per cashier; `cash*` = physical cash only (what must be in the drawer)
  const out = new Map<string, Cashier>();
  for (const r of rows) {
    const key = `${r.branchId}|${r.cashierId ?? ''}`;
    const c = out.get(key) ?? { branchId: r.branchId, cashierId: r.cashierId, cashierName: r.cashierName, income: 0, refunds: 0, net: 0, count: 0, cashNet: 0, byMethod: {} };
    const net = r.income - r.refunds;
    c.income += r.income;
    c.refunds += r.refunds;
    c.net += net;
    c.count += r.count;
    if (r.method === 'cash') c.cashNet += net;
    c.byMethod[r.method] = (c.byMethod[r.method] ?? 0) + net;
    out.set(key, c);
  }
  return [...out.values()];
}

export interface Cashier {
  branchId: string;
  cashierId: string | null;
  cashierName: string | null;
  income: number;
  refunds: number;
  net: number;
  count: number;
  cashNet: number;
  byMethod: Record<string, number>;
}

export default async function cashRoutes(app: FastifyInstance) {
  const db = app.db;

  app.get('/report', async (req) => {
    const ctx = requireClub(req, ...STAFF);
    const q = z.object({ date: isoDate.optional(), branchId: z.uuid().optional() }).parse(req.query);
    const date = q.date ?? todayInTz(ctx.timezone);
    const rows = await cashDay(db, ctx, date, q.branchId);
    const branchRows = await db
      .select({ id: branches.id, name: branches.name })
      .from(branches)
      .where(and(eq(branches.clubId, ctx.clubId), branchScope(ctx, branches.id), q.branchId ? eq(branches.id, q.branchId) : undefined))
      .orderBy(asc(branches.name));
    const closings = await db
      .select()
      .from(cashClosings)
      .where(and(eq(cashClosings.clubId, ctx.clubId), eq(cashClosings.date, date), branchScope(ctx, cashClosings.branchId)));
    const byBranch = branchRows.map((b) => {
      const cashiers = rows.filter((r) => r.branchId === b.id);
      const sum = (k: 'income' | 'refunds' | 'net' | 'count' | 'cashNet') => cashiers.reduce((a, r) => a + r[k], 0);
      const byMethod: Record<string, number> = {};
      for (const c of cashiers) for (const [m, v] of Object.entries(c.byMethod)) byMethod[m] = (byMethod[m] ?? 0) + v;
      return {
        branchId: b.id,
        branchName: b.name,
        income: sum('income'),
        refunds: sum('refunds'),
        net: sum('net'),
        count: sum('count'),
        cashNet: sum('cashNet'),
        byMethod,
        cashiers,
        closing: closings.find((c) => c.branchId === b.id) ?? null,
      };
    });
    const total = (k: 'income' | 'refunds' | 'net' | 'count' | 'cashNet') => byBranch.reduce((a, b) => a + b[k], 0);
    const byMethod: Record<string, number> = {};
    for (const b of byBranch) for (const [m, v] of Object.entries(b.byMethod)) byMethod[m] = (byMethod[m] ?? 0) + v;
    return {
      date,
      branches: byBranch,
      totals: { income: total('income'), refunds: total('refunds'), net: total('net'), count: total('count'), cashNet: total('cashNet'), byMethod },
    };
  });

  /** Close the day: admin counts cash; difference vs expected is recorded. */
  app.post('/close', async (req, reply) => {
    const ctx = requireClub(req, ...STAFF);
    const data = z
      .object({ date: isoDate.optional(), branchId: z.uuid(), countedAmount: uzs, note: optText })
      .parse(req.body);
    assertBranch(ctx, data.branchId);
    const date = data.date ?? todayInTz(ctx.timezone);
    if (date > todayInTz(ctx.timezone)) throw conflict('future_day', 'Cannot close a future day');
    const row = await db.transaction(async (tx) => {
      const rows = await cashDay(tx, ctx, date, data.branchId);
      // only physical cash is counted in the drawer; Click/Payme and terminal go to the bank
      const expected = rows.reduce((a, r) => a + r.cashNet, 0);
      const [existing] = await tx
        .select({ id: cashClosings.id })
        .from(cashClosings)
        .where(and(eq(cashClosings.branchId, data.branchId), eq(cashClosings.date, date)));
      if (existing) throw conflict('already_closed', 'This day is already closed for the branch');
      const [c] = await tx
        .insert(cashClosings)
        .values({
          clubId: ctx.clubId,
          branchId: data.branchId,
          date,
          expectedAmount: expected,
          countedAmount: data.countedAmount,
          difference: data.countedAmount - expected,
          note: data.note ?? null,
          closedBy: ctx.userId,
        })
        .returning();
      await audit(tx, ctx, { action: 'close_day', entity: 'cash_closings', entityId: c.id, after: c });
      return c;
    });
    return reply.status(201).send(row);
  });

  app.get('/closings', async (req) => {
    const ctx = requireClub(req, ...STAFF);
    const q = z.object({ from: isoDate.optional(), to: isoDate.optional() }).parse(req.query);
    return db
      .select({
        id: cashClosings.id,
        branchId: cashClosings.branchId,
        branchName: branches.name,
        date: cashClosings.date,
        expectedAmount: cashClosings.expectedAmount,
        countedAmount: cashClosings.countedAmount,
        difference: cashClosings.difference,
        note: cashClosings.note,
        closedByName: users.fullName,
      })
      .from(cashClosings)
      .innerJoin(branches, eq(branches.id, cashClosings.branchId))
      .leftJoin(users, eq(users.id, cashClosings.closedBy))
      .where(
        and(
          eq(cashClosings.clubId, ctx.clubId),
          branchScope(ctx, cashClosings.branchId),
          q.from ? gte(cashClosings.date, q.from) : undefined,
          q.to ? lte(cashClosings.date, q.to) : undefined,
        ),
      )
      .orderBy(desc(cashClosings.date))
      .limit(LIST_MAX);
  });
}

/**
 * Reports (PRD §9, §11). Cash received and accrued sales are reported separately — they are
 * not the same metric. Branch rows sum to the club total; club-wide expenses are shown apart.
 */
import type { FastifyInstance } from 'fastify';
import { and, asc, eq, gte, inArray, isNull, lt, lte, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { athletes, attendance, branches, charges, expenses, groups, paymentAllocations, payments, plans, sessions, sports, subscriptions } from '../db/schema.js';
import { coachGroupIds, requireClub, STAFF } from '../auth/context.js';
import { branchScope, idsOrNone } from '../lib/scope.js';
import { isoDate } from '../lib/validation.js';
import { addDays, startOfMonth, todayInTz, zonedDayRangeUtc } from '../domain/dates.js';

const range = z.object({ from: isoDate.optional(), to: isoDate.optional(), branchId: z.uuid().optional() });

export default async function reportRoutes(app: FastifyInstance) {
  const db = app.db;

  app.get('/summary', async (req) => {
    const ctx = requireClub(req, ...STAFF);
    const q = range.parse(req.query);
    const today = todayInTz(ctx.timezone);
    const from = q.from ?? startOfMonth(today);
    const to = q.to ?? today;
    const utcFrom = zonedDayRangeUtc(from, ctx.timezone).from;
    const utcTo = zonedDayRangeUtc(to, ctx.timezone).to;
    const bFilter = (col: Parameters<typeof eq>[0]) => (q.branchId ? eq(col, q.branchId) : undefined);
    const sum = (c: Parameters<typeof sql>[1]) => sql<number>`coalesce(sum(${c}), 0)`.mapWith(Number);

    const cash = await db
      .select({ branchId: payments.branchId, v: sum(payments.amount) })
      .from(payments)
      .where(and(eq(payments.clubId, ctx.clubId), branchScope(ctx, payments.branchId), bFilter(payments.branchId), gte(payments.paidAt, utcFrom), lt(payments.paidAt, utcTo)))
      .groupBy(payments.branchId);
    const accrued = await db
      .select({ branchId: charges.branchId, v: sum(charges.amount) })
      .from(charges)
      .where(and(eq(charges.clubId, ctx.clubId), branchScope(ctx, charges.branchId), bFilter(charges.branchId), ne(charges.status, 'void'), gte(charges.dueDate, from), lte(charges.dueDate, to)))
      .groupBy(charges.branchId);
    const debt = await db
      .select({ branchId: charges.branchId, v: sum(sql`${charges.amount} - ${charges.paidAmount}`) })
      .from(charges)
      .where(and(eq(charges.clubId, ctx.clubId), branchScope(ctx, charges.branchId), bFilter(charges.branchId), inArray(charges.status, ['open', 'partially_paid'])))
      .groupBy(charges.branchId);
    const exp = await db
      .select({ branchId: expenses.branchId, v: sum(expenses.amount) })
      .from(expenses)
      .where(
        and(
          eq(expenses.clubId, ctx.clubId),
          ctx.branchIds === null ? undefined : branchScope(ctx, expenses.branchId),
          q.branchId ? eq(expenses.branchId, q.branchId) : undefined,
          isNull(expenses.voidedAt),
          gte(expenses.incurredAt, from),
          lte(expenses.incurredAt, to),
        ),
      )
      .groupBy(expenses.branchId);

    const branchRows = await db
      .select({ id: branches.id, name: branches.name })
      .from(branches)
      .where(and(eq(branches.clubId, ctx.clubId), branchScope(ctx, branches.id), q.branchId ? eq(branches.id, q.branchId) : undefined))
      .orderBy(asc(branches.name));
    const pick = (rows: { branchId: string | null; v: number }[], id: string | null) => rows.find((r) => r.branchId === id)?.v ?? 0;
    const byBranch = branchRows.map((b) => {
      const cashIncome = pick(cash, b.id);
      const expensesV = pick(exp, b.id);
      return {
        branchId: b.id,
        branchName: b.name,
        cashIncome,
        accruedSales: pick(accrued, b.id),
        debt: pick(debt, b.id),
        expenses: expensesV,
        operatingResult: cashIncome - expensesV,
      };
    });
    const tot = (k: 'cashIncome' | 'accruedSales' | 'debt' | 'expenses' | 'operatingResult') => byBranch.reduce((a, b) => a + b[k], 0);
    const clubWideExpenses = ctx.branchIds === null && !q.branchId ? pick(exp, null) : 0;

    // by sport: accrued sales and cash allocated to subscription charges
    const accruedBySport = await db
      .select({ sport: sql<string>`coalesce(${sports.name}, '—')`, v: sum(charges.amount) })
      .from(charges)
      .leftJoin(subscriptions, eq(subscriptions.id, charges.subscriptionId))
      .leftJoin(plans, eq(plans.id, subscriptions.planId))
      .leftJoin(sports, eq(sports.id, plans.sportId))
      .where(and(eq(charges.clubId, ctx.clubId), branchScope(ctx, charges.branchId), bFilter(charges.branchId), ne(charges.status, 'void'), gte(charges.dueDate, from), lte(charges.dueDate, to)))
      .groupBy(sports.name);
    const cashBySport = await db
      .select({ sport: sql<string>`coalesce(${sports.name}, '—')`, v: sum(paymentAllocations.amount) })
      .from(paymentAllocations)
      .innerJoin(payments, eq(payments.id, paymentAllocations.paymentId))
      .innerJoin(charges, eq(charges.id, paymentAllocations.chargeId))
      .leftJoin(subscriptions, eq(subscriptions.id, charges.subscriptionId))
      .leftJoin(plans, eq(plans.id, subscriptions.planId))
      .leftJoin(sports, eq(sports.id, plans.sportId))
      .where(and(eq(payments.clubId, ctx.clubId), branchScope(ctx, payments.branchId), bFilter(payments.branchId), gte(payments.paidAt, utcFrom), lt(payments.paidAt, utcTo)))
      .groupBy(sports.name);
    const sportNames = [...new Set([...accruedBySport, ...cashBySport].map((r) => r.sport))].sort();
    const bySport = sportNames.map((s) => ({
      sport: s,
      accruedSales: accruedBySport.find((r) => r.sport === s)?.v ?? 0,
      allocatedCash: cashBySport.find((r) => r.sport === s)?.v ?? 0,
    }));

    return {
      from,
      to,
      branches: byBranch,
      totals: {
        cashIncome: tot('cashIncome'),
        accruedSales: tot('accruedSales'),
        debt: tot('debt'),
        branchExpenses: tot('expenses'),
        clubWideExpenses,
        operatingResult: tot('cashIncome') - tot('expenses') - clubWideExpenses,
      },
      bySport,
    };
  });

  /** Net cash per day (club timezone) for the last `days` days, zero-filled. */
  app.get('/cash-daily', async (req) => {
    const ctx = requireClub(req, ...STAFF);
    const q = z.object({ days: z.coerce.number().int().min(1).max(92).default(14), branchId: z.uuid().optional() }).parse(req.query);
    const today = todayInTz(ctx.timezone);
    const start = addDays(today, -(q.days - 1));
    const from = zonedDayRangeUtc(start, ctx.timezone).from;
    const to = zonedDayRangeUtc(today, ctx.timezone).to;
    const day = sql<string>`to_char(${payments.paidAt} at time zone ${ctx.timezone}, 'YYYY-MM-DD')`;
    const rows = await db
      .select({ date: day, net: sql<number>`coalesce(sum(${payments.amount}), 0)`.mapWith(Number), count: sql<number>`count(*) filter (where ${payments.amount} > 0)`.mapWith(Number) })
      .from(payments)
      .where(and(eq(payments.clubId, ctx.clubId), branchScope(ctx, payments.branchId), q.branchId ? eq(payments.branchId, q.branchId) : undefined, gte(payments.paidAt, from), lt(payments.paidAt, to)))
      .groupBy(sql`1`);
    const out = [];
    for (let d = start; d <= today; d = addDays(d, 1)) {
      const r = rows.find((x) => x.date === d);
      out.push({ date: d, net: r?.net ?? 0, count: r?.count ?? 0 });
    }
    return out;
  });

  /**
   * Month-by-month money for the dashboard: plan (charges due in the month), collected cash
   * (net of storno), expenses (non-voided, incl. paid payroll) and result = collected − expenses.
   */
  app.get('/monthly', async (req) => {
    const ctx = requireClub(req, ...STAFF);
    const q = z
      .object({
        months: z.coerce.number().int().min(1).max(24).default(6),
        end: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(),
        branchId: z.uuid().optional(),
      })
      .parse(req.query);
    const end = q.end ?? todayInTz(ctx.timezone).slice(0, 7);
    const monthKeys: string[] = [];
    {
      let [y, m] = end.split('-').map(Number);
      for (let i = 0; i < q.months; i++) {
        monthKeys.unshift(`${y}-${String(m).padStart(2, '0')}`);
        if (--m === 0) (m = 12), y--;
      }
    }
    const fromDate = `${monthKeys[0]}-01`;
    const [ey, em] = end.split('-').map(Number);
    const toDate = `${end}-${String(new Date(Date.UTC(ey, em, 0)).getUTCDate()).padStart(2, '0')}`;
    const sum = (c: Parameters<typeof sql>[1]) => sql<number>`coalesce(sum(${c}), 0)`.mapWith(Number);
    const bFilter = (col: Parameters<typeof eq>[0]) => (q.branchId ? eq(col, q.branchId) : undefined);

    const payMonth = sql<string>`to_char(${payments.paidAt} at time zone ${ctx.timezone}, 'YYYY-MM')`;
    const cash = await db
      .select({ month: payMonth, v: sum(payments.amount) })
      .from(payments)
      .where(
        and(
          eq(payments.clubId, ctx.clubId),
          branchScope(ctx, payments.branchId),
          bFilter(payments.branchId),
          gte(payments.paidAt, zonedDayRangeUtc(fromDate, ctx.timezone).from),
          lt(payments.paidAt, zonedDayRangeUtc(toDate, ctx.timezone).to),
        ),
      )
      .groupBy(sql`1`);
    const plan = await db
      .select({ month: sql<string>`to_char(${charges.dueDate}, 'YYYY-MM')`, v: sum(charges.amount) })
      .from(charges)
      .where(
        and(
          eq(charges.clubId, ctx.clubId),
          branchScope(ctx, charges.branchId),
          bFilter(charges.branchId),
          ne(charges.status, 'void'),
          gte(charges.dueDate, fromDate),
          lte(charges.dueDate, toDate),
        ),
      )
      .groupBy(sql`1`);
    const exp = await db
      .select({ month: sql<string>`to_char(${expenses.incurredAt}, 'YYYY-MM')`, v: sum(expenses.amount) })
      .from(expenses)
      .where(
        and(
          eq(expenses.clubId, ctx.clubId),
          ctx.branchIds === null ? undefined : branchScope(ctx, expenses.branchId),
          q.branchId ? eq(expenses.branchId, q.branchId) : undefined,
          isNull(expenses.voidedAt),
          gte(expenses.incurredAt, fromDate),
          lte(expenses.incurredAt, toDate),
        ),
      )
      .groupBy(sql`1`);
    const pick = (rows: { month: string; v: number }[], m: string) => rows.find((r) => r.month === m)?.v ?? 0;
    return monthKeys.map((month) => {
      const collected = pick(cash, month);
      const expensesV = pick(exp, month);
      return { month, plan: pick(plan, month), collected, expenses: expensesV, result: collected - expensesV };
    });
  });

  /**
   * Day-by-day money for one month and the month before it (dashboard chart). Same definitions as
   * /monthly, so each month's days sum to its /monthly row.
   */
  app.get('/daily', async (req) => {
    const ctx = requireClub(req, ...STAFF);
    const q = z
      .object({
        month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(),
        branchId: z.uuid().optional(),
      })
      .parse(req.query);
    const month = q.month ?? todayInTz(ctx.timezone).slice(0, 7);
    const [y, m] = month.split('-').map(Number);
    const prevMonth = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
    const monthEnd = (ym: string) => {
      const [yy, mm] = ym.split('-').map(Number);
      return `${ym}-${String(new Date(Date.UTC(yy, mm, 0)).getUTCDate()).padStart(2, '0')}`;
    };
    const fromDate = `${prevMonth}-01`;
    const toDate = monthEnd(month);
    const sum = (c: Parameters<typeof sql>[1]) => sql<number>`coalesce(sum(${c}), 0)`.mapWith(Number);
    const bFilter = (col: Parameters<typeof eq>[0]) => (q.branchId ? eq(col, q.branchId) : undefined);

    const cash = await db
      .select({ date: sql<string>`to_char(${payments.paidAt} at time zone ${ctx.timezone}, 'YYYY-MM-DD')`, v: sum(payments.amount) })
      .from(payments)
      .where(
        and(
          eq(payments.clubId, ctx.clubId),
          branchScope(ctx, payments.branchId),
          bFilter(payments.branchId),
          gte(payments.paidAt, zonedDayRangeUtc(fromDate, ctx.timezone).from),
          lt(payments.paidAt, zonedDayRangeUtc(toDate, ctx.timezone).to),
        ),
      )
      .groupBy(sql`1`);
    const plan = await db
      .select({ date: sql<string>`to_char(${charges.dueDate}, 'YYYY-MM-DD')`, v: sum(charges.amount) })
      .from(charges)
      .where(
        and(
          eq(charges.clubId, ctx.clubId),
          branchScope(ctx, charges.branchId),
          bFilter(charges.branchId),
          ne(charges.status, 'void'),
          gte(charges.dueDate, fromDate),
          lte(charges.dueDate, toDate),
        ),
      )
      .groupBy(sql`1`);
    const exp = await db
      .select({ date: sql<string>`to_char(${expenses.incurredAt}, 'YYYY-MM-DD')`, v: sum(expenses.amount) })
      .from(expenses)
      .where(
        and(
          eq(expenses.clubId, ctx.clubId),
          ctx.branchIds === null ? undefined : branchScope(ctx, expenses.branchId),
          q.branchId ? eq(expenses.branchId, q.branchId) : undefined,
          isNull(expenses.voidedAt),
          gte(expenses.incurredAt, fromDate),
          lte(expenses.incurredAt, toDate),
        ),
      )
      .groupBy(sql`1`);

    const toMap = (rows: { date: string; v: number }[]) => new Map(rows.map((r) => [r.date, r.v]));
    const cashBy = toMap(cash);
    const planBy = toMap(plan);
    const expBy = toMap(exp);
    const daysOf = (ym: string) => {
      const out = [];
      const end = monthEnd(ym);
      for (let d = `${ym}-01`; d <= end; d = addDays(d, 1)) {
        const collected = cashBy.get(d) ?? 0;
        const expensesV = expBy.get(d) ?? 0;
        out.push({ date: d, plan: planBy.get(d) ?? 0, collected, expenses: expensesV, result: collected - expensesV });
      }
      return out;
    };
    return { month, prevMonth, days: daysOf(month), prevDays: daysOf(prevMonth) };
  });

  /** Attendance statistics per athlete (coach: own groups). */
  app.get('/attendance', async (req) => {
    const ctx = requireClub(req, 'owner', 'branch_admin', 'coach');
    const q = range.extend({ groupId: z.uuid().optional() }).parse(req.query);
    const today = todayInTz(ctx.timezone);
    const from = q.from ?? startOfMonth(today);
    const to = q.to ?? today;
    const scope =
      ctx.role === 'coach' ? idsOrNone(groups.id, await coachGroupIds(db, ctx)) : branchScope(ctx, groups.branchId);
    const cnt = (s: string) => sql<number>`count(*) filter (where ${attendance.status} = ${s})`.mapWith(Number);
    const rows = await db
      .select({
        athleteId: athletes.id,
        fullName: athletes.fullName,
        groupId: groups.id,
        groupName: groups.name,
        present: cnt('present'),
        absent: cnt('absent'),
        excused: cnt('excused'),
      })
      .from(attendance)
      .innerJoin(sessions, eq(sessions.id, attendance.sessionId))
      .innerJoin(groups, eq(groups.id, sessions.groupId))
      .innerJoin(athletes, eq(athletes.id, attendance.athleteId))
      .where(
        and(
          eq(attendance.clubId, ctx.clubId),
          scope,
          q.groupId ? eq(groups.id, q.groupId) : undefined,
          q.branchId ? eq(groups.branchId, q.branchId) : undefined,
          gte(sessions.sessionDate, from),
          lte(sessions.sessionDate, to),
        ),
      )
      .groupBy(athletes.id, athletes.fullName, groups.id, groups.name)
      .orderBy(asc(groups.name), asc(athletes.fullName));
    const withRate = rows.map((r) => {
      const total = r.present + r.absent + r.excused;
      return { ...r, total, rate: total ? Math.round((r.present / total) * 100) : null };
    });
    const t = withRate.reduce((a, r) => ({ present: a.present + r.present, total: a.total + r.total }), { present: 0, total: 0 });
    return { from, to, rows: withRate, totals: { ...t, rate: t.total ? Math.round((t.present / t.total) * 100) : null } };
  });
}

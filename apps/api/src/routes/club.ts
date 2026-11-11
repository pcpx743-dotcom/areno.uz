import type { FastifyInstance } from 'fastify';
import { and, count, eq, gte, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import { athletes, clubs, groups, subscriptions, DEFAULT_CLUB_SETTINGS } from '../db/schema.js';
import { requireClub, STAFF, coachGroupIds } from '../auth/context.js';
import { audit } from '../lib/audit.js';
import { branchScope, qcol } from '../lib/scope.js';
import { balanceSql } from '../lib/balance-queries.js';
import { addDays, todayInTz } from '../domain/dates.js';
import { runDailyForClub } from '../jobs/daily.js';

const settingsPatch = z
  .object({
    capacityPolicy: z.enum(['warn', 'block']),
    calendarProration: z.enum(['full', 'daily']),
    sessionPackCountsAbsent: z.boolean(),
    sessionPackCountsExcused: z.boolean(),
    maxFreezeDays: z.number().int().min(0).max(365),
    maxFreezesPerSubscription: z.number().int().min(0).max(12),
    autoRenew: z.boolean(),
    debtorPolicy: z.enum(['warn', 'block']),
    attendanceNotify: z.enum(['all', 'absent_only', 'off']),
  })
  .partial();

export default async function clubRoutes(app: FastifyInstance) {
  const db = app.db;

  app.get('/', async (req) => {
    const ctx = requireClub(req);
    const [club] = await db.select().from(clubs).where(eq(clubs.id, ctx.clubId));
    return { ...club, settings: { ...DEFAULT_CLUB_SETTINGS, ...club.settings } };
  });

  app.patch('/settings', async (req) => {
    const ctx = requireClub(req, 'owner');
    const patch = settingsPatch.parse(req.body);
    return db.transaction(async (tx) => {
      const [before] = await tx.select().from(clubs).where(eq(clubs.id, ctx.clubId));
      const settings = { ...DEFAULT_CLUB_SETTINGS, ...before.settings, ...patch };
      const [after] = await tx.update(clubs).set({ settings }).where(eq(clubs.id, ctx.clubId)).returning();
      await audit(tx, ctx, { action: 'update_settings', entity: 'clubs', entityId: ctx.clubId, before: before.settings, after: settings });
      return after;
    });
  });

  /** Run the daily job now for this club (it also runs hourly in the server). */
  app.post('/jobs/daily', async (req) => {
    const ctx = requireClub(req, 'owner');
    return runDailyForClub(db, ctx.clubId);
  });

  app.get('/dashboard', async (req) => {
    const ctx = requireClub(req);
    const today = todayInTz(ctx.timezone);
    if (ctx.role === 'coach') {
      const gids = await coachGroupIds(db, ctx);
      return { today, myGroups: gids.length };
    }
    requireClub(req, ...STAFF);
    const aScope = branchScope(ctx, athletes.branchId);
    const sScope = branchScope(ctx, subscriptions.branchId);
    const [ath] = await db
      .select({ c: count() })
      .from(athletes)
      .where(and(eq(athletes.clubId, ctx.clubId), eq(athletes.status, 'active'), aScope));
    const [grp] = await db
      .select({ c: count() })
      .from(groups)
      .where(and(eq(groups.clubId, ctx.clubId), eq(groups.active, true), branchScope(ctx, groups.branchId)));
    const [activeSubs] = await db
      .select({ c: count() })
      .from(subscriptions)
      .where(and(eq(subscriptions.clubId, ctx.clubId), eq(subscriptions.status, 'active'), sScope));
    const [expiring] = await db
      .select({ c: count() })
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.clubId, ctx.clubId),
          eq(subscriptions.status, 'active'),
          gte(subscriptions.endDate, today),
          lte(subscriptions.endDate, addDays(today, 7)),
          sScope,
        ),
      );
    const bal = balanceSql(qcol(athletes.id));
    const [debt] = await db
      .select({
        debtors: sql<number>`count(*) filter (where ${bal} > 0)`.mapWith(Number),
        totalDebt: sql<number>`coalesce(sum(greatest(${bal}, 0)), 0)`.mapWith(Number),
      })
      .from(athletes)
      .where(and(eq(athletes.clubId, ctx.clubId), aScope));
    return {
      today,
      activeAthletes: ath.c,
      activeGroups: grp.c,
      activeSubscriptions: activeSubs.c,
      expiringIn7Days: expiring.c,
      debtors: debt.debtors,
      totalDebt: debt.totalDebt,
    };
  });
}

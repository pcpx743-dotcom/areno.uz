/**
 * Daily job (PRD §13C, §10): freezes, expiry, auto-renewal, payment reminders.
 * Idempotent — safe to run every hour. Each club is processed with its own timezone "today".
 */
import { and, asc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import {
  athletes,
  charges,
  clubs,
  DEFAULT_CLUB_SETTINGS,
  groupEnrollments,
  plans,
  subscriptionFreezes,
  subscriptions,
} from '../db/schema.js';
import { addDays, todayInTz } from '../domain/dates.js';
import { computePeriod, computePrice, nextPeriodStart } from '../domain/subscription-engine.js';
import { applyAdvance } from '../lib/billing.js';
import { enqueueForAthlete } from '../lib/notify.js';
import { audit } from '../lib/audit.js';

export interface DailyResult {
  clubId: string;
  today: string;
  frozen: number;
  unfrozen: number;
  expired: number;
  renewed: number;
  reminders: number;
}

export async function runDailyForClub(db: Db, clubId: string, todayOverride?: string): Promise<DailyResult> {
  const [club] = await db.select().from(clubs).where(eq(clubs.id, clubId));
  const settings = { ...DEFAULT_CLUB_SETTINGS, ...club.settings };
  const today = todayOverride ?? todayInTz(club.timezone);
  const res: DailyResult = { clubId, today, frozen: 0, unfrozen: 0, expired: 0, renewed: 0, reminders: 0 };
  const actor = { clubId, userId: null }; // system action

  await db.transaction(async (tx) => {
    // 1. freezes: start today → frozen; ended → active
    const startNow = await tx
      .update(subscriptions)
      .set({ status: 'frozen' })
      .where(
        and(
          eq(subscriptions.clubId, clubId),
          eq(subscriptions.status, 'active'),
          sql`exists (select 1 from ${subscriptionFreezes} f where f.subscription_id = ${subscriptions.id} and f.from_date <= ${today} and f.to_date >= ${today})`,
        ),
      )
      .returning({ id: subscriptions.id });
    res.frozen = startNow.length;
    const endNow = await tx
      .update(subscriptions)
      .set({ status: 'active' })
      .where(
        and(
          eq(subscriptions.clubId, clubId),
          eq(subscriptions.status, 'frozen'),
          sql`not exists (select 1 from ${subscriptionFreezes} f where f.subscription_id = ${subscriptions.id} and f.from_date <= ${today} and f.to_date >= ${today})`,
        ),
      )
      .returning({ id: subscriptions.id });
    res.unfrozen = endNow.length;

    // 2. expiry
    const expired = await tx
      .update(subscriptions)
      .set({ status: 'expired' })
      .where(and(eq(subscriptions.clubId, clubId), eq(subscriptions.status, 'active'), lt(subscriptions.endDate, today)))
      .returning();
    res.expired = expired.length;

    // 3. auto-renew (decision: calendar & fixed-days plans, active athletes still in a group)
    if (settings.autoRenew) {
      const candidates = await tx
        .select({ sub: subscriptions, plan: plans })
        .from(subscriptions)
        .innerJoin(plans, eq(plans.id, subscriptions.planId))
        .innerJoin(athletes, eq(athletes.id, subscriptions.athleteId))
        .where(
          and(
            eq(subscriptions.clubId, clubId),
            eq(subscriptions.status, 'expired'),
            inArray(subscriptions.billingType, ['calendar_month', 'fixed_days']),
            gte(subscriptions.endDate, addDays(today, -7)), // only recently ended periods
            eq(plans.active, true),
            eq(athletes.status, 'active'),
            sql`exists (select 1 from ${groupEnrollments} e where e.athlete_id = ${subscriptions.athleteId} and e.status = 'active')`,
            sql`not exists (select 1 from ${subscriptions} n where n.renewed_from_id = ${subscriptions.id})`,
            // no other current subscription for the same plan
            sql`not exists (select 1 from ${subscriptions} o where o.athlete_id = ${subscriptions.athleteId} and o.plan_id = ${subscriptions.planId} and o.id <> ${subscriptions.id} and o.status in ('active','frozen') )`,
          ),
        );
      for (const { sub, plan } of candidates) {
        const start = nextPeriodStart(sub, today);
        const period = computePeriod(plan, start);
        // renewal keeps the individual price and discount; full periods are not prorated
        const price = computePrice({
          plan,
          startDate: start,
          individualPrice: sub.listPrice !== plan.price ? sub.listPrice : null,
          discount: sub.discount,
          settings: { calendarProration: 'full' },
        });
        const [n] = await tx
          .insert(subscriptions)
          .values({
            clubId,
            branchId: sub.branchId,
            athleteId: sub.athleteId,
            planId: plan.id,
            billingType: plan.billingType,
            startDate: start,
            endDate: period.endDate,
            listPrice: price.listPrice,
            discount: price.discount,
            discountReason: sub.discountReason,
            price: price.price,
            status: 'active',
            renewedFromId: sub.id,
          })
          .returning();
        if (price.price > 0) {
          await tx.insert(charges).values({
            clubId,
            branchId: sub.branchId,
            athleteId: sub.athleteId,
            subscriptionId: n.id,
            description: `${plan.name} (${start}${period.endDate ? ' – ' + period.endDate : ''})`,
            dueDate: start,
            amount: price.price,
          });
          await applyAdvance(tx, clubId, sub.athleteId);
        }
        await audit(tx, actor, { action: 'auto_renew', entity: 'subscriptions', entityId: n.id, after: { from: sub.id, subscription: n } });
        res.renewed++;
      }
    }

    // 4. reminders: due in 3 days; overdue 1, 3, 7 days
    const remind = async (dueDate: string, template: 'payment_due_soon' | 'payment_overdue', tag: string) => {
      const rows = await tx
        .select({ c: charges, name: athletes.fullName })
        .from(charges)
        .innerJoin(athletes, eq(athletes.id, charges.athleteId))
        .where(and(eq(charges.clubId, clubId), eq(charges.dueDate, dueDate), inArray(charges.status, ['open', 'partially_paid'])))
        .orderBy(asc(charges.dueDate));
      for (const { c, name } of rows) {
        res.reminders += await enqueueForAthlete(
          tx,
          clubId,
          c.athleteId,
          template,
          { athleteName: name, clubName: club.name, dueDate: c.dueDate, outstanding: c.amount - c.paidAmount, description: c.description },
          `${template}:${tag}:${c.id}`,
        );
      }
    };
    await remind(addDays(today, 3), 'payment_due_soon', 'd-3');
    for (const d of [1, 3, 7]) await remind(addDays(today, -d), 'payment_overdue', `d+${d}`);

    const expiring = await tx
      .select({ s: subscriptions, name: athletes.fullName })
      .from(subscriptions)
      .innerJoin(athletes, eq(athletes.id, subscriptions.athleteId))
      .where(and(eq(subscriptions.clubId, clubId), eq(subscriptions.status, 'active'), eq(subscriptions.endDate, addDays(today, 3))));
    for (const { s, name } of expiring) {
      res.reminders += await enqueueForAthlete(tx, clubId, s.athleteId, 'subscription_expiring', { athleteName: name, endDate: s.endDate }, `subscription_expiring:${s.id}`);
    }
  });
  return res;
}

export async function runDailyAll(db: Db): Promise<DailyResult[]> {
  const rows = await db.select({ id: clubs.id }).from(clubs).where(eq(clubs.status, 'active'));
  const out = [];
  for (const c of rows) out.push(await runDailyForClub(db, c.id));
  return out;
}

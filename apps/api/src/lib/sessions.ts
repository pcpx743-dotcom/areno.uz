/** Session generation from weekly schedules + subscription usage (PRD §7, §13B). */
import { and, asc, eq, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import type { Db, Tx } from '../db/client.js';
import { groups, plans, schedules, sessions, subscriptions } from '../db/schema.js';
import { isoWeekday, type IsoDate } from '../domain/dates.js';

/** Create sessions for `date` from active schedules of the given groups (idempotent). */
export async function ensureSessions(tx: Db | Tx, clubId: string, date: IsoDate, groupIds: string[]) {
  if (!groupIds.length) return;
  const rows = await tx
    .select({ s: schedules, coachId: groups.coachId })
    .from(schedules)
    .innerJoin(groups, eq(groups.id, schedules.groupId))
    .where(
      and(
        eq(schedules.clubId, clubId),
        inArray(schedules.groupId, groupIds),
        eq(groups.active, true),
        eq(schedules.weekday, isoWeekday(date)),
        or(isNull(schedules.validFrom), lte(schedules.validFrom, date)),
        or(isNull(schedules.validTo), gte(schedules.validTo, date)),
      ),
    );
  if (!rows.length) return;
  await tx
    .insert(sessions)
    .values(
      rows.map(({ s, coachId }) => ({
        clubId,
        groupId: s.groupId,
        scheduleId: s.id,
        coachId,
        sessionDate: date,
        startTime: s.startTime,
        endTime: s.endTime,
        room: s.room,
      })),
    )
    .onConflictDoNothing();
}

/**
 * The subscription a lesson on `date` in a group of `sportId` counts against:
 * active, valid on the date, plan sport matches (or plan is for all sports).
 * Session packs with lessons left are preferred (they need deduction), earliest end first.
 */
export async function findSubscriptionFor(tx: Db | Tx, clubId: string, athleteId: string, sportId: string, date: IsoDate) {
  const rows = await tx
    .select({ sub: subscriptions })
    .from(subscriptions)
    .innerJoin(plans, eq(plans.id, subscriptions.planId))
    .where(
      and(
        eq(subscriptions.clubId, clubId),
        eq(subscriptions.athleteId, athleteId),
        eq(subscriptions.status, 'active'),
        lte(subscriptions.startDate, date),
        or(isNull(subscriptions.endDate), gte(subscriptions.endDate, date)),
        or(isNull(plans.sportId), eq(plans.sportId, sportId)),
        or(isNull(subscriptions.sessionLimit), sql`${subscriptions.usedSessions} < ${subscriptions.sessionLimit}`),
      ),
    )
    .orderBy(sql`case when ${subscriptions.billingType} = 'session_pack' then 0 else 1 end`, asc(subscriptions.endDate));
  return rows[0]?.sub ?? null;
}

/** Add `delta` used lessons; exhausting a pack expires it, giving one back re-activates it. */
export async function applyUsage(tx: Tx, subscriptionId: string, delta: number, today: IsoDate) {
  if (!delta) return;
  const [s] = await tx
    .update(subscriptions)
    .set({ usedSessions: sql`greatest(0, ${subscriptions.usedSessions} + ${delta})` })
    .where(eq(subscriptions.id, subscriptionId))
    .returning();
  if (!s || s.billingType !== 'session_pack' || s.sessionLimit == null) return;
  if (s.status === 'active' && s.usedSessions >= s.sessionLimit) {
    await tx.update(subscriptions).set({ status: 'expired' }).where(eq(subscriptions.id, s.id));
  } else if (s.status === 'expired' && s.usedSessions < s.sessionLimit && (!s.endDate || s.endDate >= today)) {
    await tx.update(subscriptions).set({ status: 'active' }).where(eq(subscriptions.id, s.id));
  }
}

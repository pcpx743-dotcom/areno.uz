/**
 * Notification outbox (PRD §10). Rows are written inside the business transaction and
 * delivered later by the Telegram worker, so a delivery failure never rolls back money.
 * Only guardians with a linked chat AND consent receive messages. `dedupeKey` prevents duplicates.
 */
import { and, eq, isNotNull } from 'drizzle-orm';
import type { Db, Tx } from '../db/client.js';
import { athleteGuardians, guardians, notifications } from '../db/schema.js';

export type Template =
  | 'payment_due_soon'
  | 'payment_overdue'
  | 'payment_received'
  | 'attendance_marked'
  | 'session_changed'
  | 'subscription_expiring';

export async function enqueueForAthlete(
  tx: Db | Tx,
  clubId: string,
  athleteId: string,
  template: Template,
  payload: Record<string, unknown>,
  dedupeBase: string,
): Promise<number> {
  const rows = await tx
    .select({ id: guardians.id })
    .from(athleteGuardians)
    .innerJoin(guardians, eq(guardians.id, athleteGuardians.guardianId))
    .where(
      and(
        eq(athleteGuardians.athleteId, athleteId),
        eq(athleteGuardians.clubId, clubId),
        isNotNull(guardians.telegramChatId),
        isNotNull(guardians.telegramConsentAt),
      ),
    );
  if (!rows.length) return 0;
  const inserted = await tx
    .insert(notifications)
    .values(
      rows.map((g) => ({
        clubId,
        guardianId: g.id,
        template,
        payload: { athleteId, ...payload },
        dedupeKey: `${dedupeBase}:${g.id}`,
      })),
    )
    .onConflictDoNothing()
    .returning({ id: notifications.id });
  return inserted.length;
}

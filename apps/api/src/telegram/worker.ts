/**
 * Notification sender (PRD §10): reads the outbox, delivers, retries with backoff, logs errors.
 * Only chats that are linked AND consented receive messages. A user who blocks the bot is unlinked.
 */
import { and, asc, eq, isNull, lte, or } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { clubs, guardians, notifications } from '../db/schema.js';
import { TelegramError, type TelegramApi } from './client.js';
import { renderNotification } from './templates.js';

export const MAX_ATTEMPTS = 5;

export interface DeliveryResult {
  sent: number;
  failed: number;
  retried: number;
  skipped: number;
}

export async function deliverPending(db: Db, tg: TelegramApi, now = new Date(), batch = 50): Promise<DeliveryResult> {
  const res: DeliveryResult = { sent: 0, failed: 0, retried: 0, skipped: 0 };
  const rows = await db
    .select({ n: notifications, chatId: guardians.telegramChatId, consentAt: guardians.telegramConsentAt, guardianId: guardians.id, clubName: clubs.name })
    .from(notifications)
    .innerJoin(clubs, eq(clubs.id, notifications.clubId))
    .leftJoin(guardians, eq(guardians.id, notifications.guardianId))
    .where(and(eq(notifications.status, 'queued'), or(isNull(notifications.nextAttemptAt), lte(notifications.nextAttemptAt, now))))
    .orderBy(asc(notifications.createdAt))
    .limit(batch);

  for (const { n, chatId, consentAt, guardianId, clubName } of rows) {
    if (!chatId || !consentAt) {
      await db.update(notifications).set({ status: 'skipped', lastError: 'chat not linked or no consent' }).where(eq(notifications.id, n.id));
      res.skipped++;
      continue;
    }
    // claim the row first so a parallel worker cannot send it twice
    const claimed = await db
      .update(notifications)
      .set({ attempts: n.attempts + 1 })
      .where(and(eq(notifications.id, n.id), eq(notifications.status, 'queued'), eq(notifications.attempts, n.attempts)))
      .returning({ id: notifications.id });
    if (!claimed.length) continue;
    try {
      await tg.call('sendMessage', {
        chat_id: chatId,
        text: renderNotification(n.template, n.payload as Record<string, unknown>, clubName),
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      });
      await db.update(notifications).set({ status: 'sent', sentAt: new Date(), lastError: null }).where(eq(notifications.id, n.id));
      res.sent++;
    } catch (e) {
      const err = e instanceof TelegramError ? e : new TelegramError(0, (e as Error).message);
      const attempts = n.attempts + 1;
      if (err.code === 403) {
        // user blocked the bot: stop messaging this chat
        if (guardianId) await db.update(guardians).set({ telegramChatId: null, telegramConsentAt: null }).where(eq(guardians.id, guardianId));
        await db.update(notifications).set({ status: 'failed', lastError: `403: ${err.message}` }).where(eq(notifications.id, n.id));
        res.failed++;
      } else if (attempts >= MAX_ATTEMPTS || err.code === 400) {
        await db.update(notifications).set({ status: 'failed', lastError: `${err.code}: ${err.message}` }).where(eq(notifications.id, n.id));
        res.failed++;
      } else {
        const delaySec = err.retryAfter ?? 60 * 2 ** (attempts - 1); // 1, 2, 4, 8 min
        await db
          .update(notifications)
          .set({ lastError: `${err.code}: ${err.message}`, nextAttemptAt: new Date(now.getTime() + delaySec * 1000) })
          .where(eq(notifications.id, n.id));
        res.retried++;
      }
    }
  }
  return res;
}

/** Kommunikatsiya: bot status, message log, manual retry (PRD §10, §11). */
import type { FastifyInstance } from 'fastify';
import { and, count, desc, eq, isNotNull } from 'drizzle-orm';
import { z } from 'zod';
import { guardians, notifications } from '../db/schema.js';
import { requireClub, STAFF } from '../auth/context.js';
import { audit } from '../lib/audit.js';
import { badRequest, notFound } from '../lib/errors.js';
import { idParam } from '../lib/validation.js';
import { LIST_MAX } from '../lib/scope.js';
import { botStatus } from '../telegram/runner.js';

export default async function notificationRoutes(app: FastifyInstance) {
  const db = app.db;

  app.get('/status', async (req) => {
    const ctx = requireClub(req, ...STAFF);
    const [linked] = await db
      .select({ c: count() })
      .from(guardians)
      .where(and(eq(guardians.clubId, ctx.clubId), isNotNull(guardians.telegramChatId), isNotNull(guardians.telegramConsentAt)));
    const [total] = await db.select({ c: count() }).from(guardians).where(eq(guardians.clubId, ctx.clubId));
    const byStatus = await db
      .select({ status: notifications.status, c: count() })
      .from(notifications)
      .where(eq(notifications.clubId, ctx.clubId))
      .groupBy(notifications.status);
    return {
      bot: { configured: botStatus.configured, username: botStatus.username, lastPollAt: botStatus.lastPollAt, lastError: botStatus.lastError },
      guardians: { linked: linked.c, total: total.c },
      queue: Object.fromEntries(byStatus.map((r) => [r.status, r.c])),
    };
  });

  app.get('/', async (req) => {
    const ctx = requireClub(req, ...STAFF);
    const q = z.object({ status: z.enum(['queued', 'sent', 'failed', 'skipped']).optional() }).parse(req.query);
    return db
      .select({
        id: notifications.id,
        template: notifications.template,
        payload: notifications.payload,
        status: notifications.status,
        attempts: notifications.attempts,
        lastError: notifications.lastError,
        createdAt: notifications.createdAt,
        sentAt: notifications.sentAt,
        guardianName: guardians.fullName,
      })
      .from(notifications)
      .leftJoin(guardians, eq(guardians.id, notifications.guardianId))
      .where(and(eq(notifications.clubId, ctx.clubId), q.status ? eq(notifications.status, q.status) : undefined))
      .orderBy(desc(notifications.createdAt))
      .limit(LIST_MAX);
  });

  app.post('/:id/retry', async (req) => {
    const ctx = requireClub(req, ...STAFF);
    const { id } = idParam.parse(req.params);
    const [n] = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.id, id), eq(notifications.clubId, ctx.clubId)));
    if (!n) throw notFound('Notification');
    if (n.status !== 'failed' && n.status !== 'skipped') throw badRequest('not_failed', 'Only failed or skipped messages can be retried');
    const [after] = await db
      .update(notifications)
      .set({ status: 'queued', attempts: 0, nextAttemptAt: null })
      .where(eq(notifications.id, id))
      .returning();
    await audit(db, ctx, { action: 'retry', entity: 'notifications', entityId: id, before: n, after });
    return after;
  });
}

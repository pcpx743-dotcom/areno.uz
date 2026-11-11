/** Long-polling loop for the parent bot + periodic notification delivery. */
import type { FastifyBaseLogger } from 'fastify';
import type { Db } from '../db/client.js';
import { ParentBot } from './bot.js';
import type { TelegramApi, TgUpdate } from './client.js';
import { deliverPending } from './worker.js';

export interface BotStatus {
  configured: boolean;
  username: string | null;
  lastPollAt: string | null;
  lastError: string | null;
}

export const botStatus: BotStatus = { configured: false, username: null, lastPollAt: null, lastError: null };

export function startTelegram(db: Db, tg: TelegramApi, log: FastifyBaseLogger) {
  const bot = new ParentBot(db, tg);
  let stopped = false;
  let offset = 0;
  botStatus.configured = true;

  const poll = async () => {
    try {
      const me = await tg.call<{ username: string }>('getMe');
      botStatus.username = me.username;
      await tg.call('deleteWebhook', { drop_pending_updates: false });
      log.info(`Telegram bot @${me.username} started`);
    } catch (e) {
      botStatus.lastError = (e as Error).message;
      log.error(e, 'Telegram getMe failed — check TELEGRAM_BOT_TOKEN');
    }
    while (!stopped) {
      try {
        const updates = await tg.call<TgUpdate[]>('getUpdates', { offset, timeout: 25, allowed_updates: ['message'] });
        botStatus.lastPollAt = new Date().toISOString();
        for (const u of updates) {
          offset = u.update_id + 1;
          try {
            await bot.handleUpdate(u);
          } catch (e) {
            log.error(e, 'bot update failed');
          }
        }
      } catch (e) {
        botStatus.lastError = (e as Error).message;
        if (!stopped) await new Promise((r) => setTimeout(r, 5_000));
      }
    }
  };
  void poll();

  const deliver = async () => {
    try {
      const r = await deliverPending(db, tg);
      if (r.sent || r.failed || r.retried) log.info({ telegram: r }, 'notifications delivered');
    } catch (e) {
      log.error(e, 'notification delivery failed');
    }
  };
  const timer = setInterval(deliver, 10_000);

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

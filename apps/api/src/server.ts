import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createDb, runMigrations } from './db/client.js';

const config = loadConfig();
const handle = await createDb(config.databaseUrl);
if (handle.kind === 'pglite') await runMigrations(handle); // local convenience; prod runs `db:migrate` explicitly
const app = await buildApp({ db: handle.db, config, logger: true });

// Daily job: idempotent, so running hourly keeps every club's timezone covered.
const { runDailyAll } = await import('./jobs/daily.js');
const daily = async () => {
  try {
    const r = await runDailyAll(handle.db);
    app.log.info({ daily: r }, 'daily job done');
  } catch (e) {
    app.log.error(e, 'daily job failed');
  }
};
setTimeout(daily, 5_000);
const dailyTimer = setInterval(daily, 60 * 60_000);

let stopTelegram: (() => void) | null = null;
if (config.telegramBotToken) {
  const { HttpTelegramApi } = await import('./telegram/client.js');
  const { startTelegram } = await import('./telegram/runner.js');
  stopTelegram = startTelegram(handle.db, new HttpTelegramApi(config.telegramBotToken), app.log);
} else {
  app.log.warn('TELEGRAM_BOT_TOKEN not set — parent bot and message delivery are disabled (messages stay queued)');
}

const shutdown = async () => {
  stopTelegram?.();
  clearInterval(dailyTimer);
  await app.close();
  await handle.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ port: config.port, host: '0.0.0.0' });

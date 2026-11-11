/** Phase 5 — parent bot and notification delivery (PRD §10, §14). */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { setup, type TestEnv, type Api } from './helpers.js';
import { DEMO_USERS } from '../src/db/seed-data.js';
import { guardians, notifications } from '../src/db/schema.js';
import { ParentBot, BTN, phoneKey } from '../src/telegram/bot.js';
import { TelegramError, type TelegramApi, type TgUpdate } from '../src/telegram/client.js';
import { deliverPending, MAX_ATTEMPTS } from '../src/telegram/worker.js';
import { renderNotification } from '../src/telegram/templates.js';

class FakeTelegram implements TelegramApi {
  sent: { chat_id: string | number; text: string; reply_markup?: unknown }[] = [];
  failWith: TelegramError | null = null;
  async call<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    if (method === 'sendMessage') {
      if (this.failWith) throw this.failWith;
      this.sent.push(params as never);
    }
    return { message_id: 1 } as T;
  }
  last() {
    return this.sent[this.sent.length - 1];
  }
}

let env: TestEnv;
let owner: Api;
let tg: FakeTelegram;
let bot: ParentBot;
let uid = 1000;
const CHAT = 777001;
const msg = (m: object): TgUpdate => ({ update_id: ++uid, message: { message_id: uid, chat: { id: CHAT, type: 'private' }, from: { id: CHAT }, ...m } });

beforeAll(async () => {
  env = await setup();
  owner = await env.login(DEMO_USERS.owner);
  tg = new FakeTelegram();
  bot = new ParentBot(env.handle.db, tg);
});
afterAll(() => env.close());

describe('linking', () => {
  it('/start asks for the phone via a contact button', async () => {
    await bot.handleUpdate(msg({ text: '/start' }));
    expect(tg.last().text).toMatch(/telefon raqamingizni/);
    expect(JSON.stringify(tg.last().reply_markup)).toContain('request_contact');
  });

  it('refuses someone else’s contact', async () => {
    await bot.handleUpdate(msg({ contact: { phone_number: '998901110000', user_id: 999 } }));
    expect(tg.last().text).toMatch(/o‘z/);
    const [g] = await env.handle.db.select().from(guardians).where(eq(guardians.id, env.demo.sharedGuardianId));
    expect(g.telegramChatId).toBeNull();
  });

  it('own contact links the parent to all their children (number format independent)', async () => {
    expect(phoneKey('+998 (90) 111-00-00')).toBe(phoneKey('998901110000'));
    await bot.handleUpdate(msg({ contact: { phone_number: '998901110000', user_id: CHAT } }));
    expect(tg.last().text).toMatch(/Ulandi/);
    const [g] = await env.handle.db.select().from(guardians).where(eq(guardians.id, env.demo.sharedGuardianId));
    expect(g.telegramChatId).toBe(String(CHAT));
    expect(g.telegramConsentAt).not.toBeNull();
  });

  it('unknown number is not linked', async () => {
    const other = 777002;
    await bot.handleUpdate({ update_id: ++uid, message: { message_id: 1, chat: { id: other, type: 'private' }, from: { id: other }, contact: { phone_number: '998935550000', user_id: other } } });
    expect(tg.last().text).toMatch(/topilmadi/);
  });

  it('ignores group chats', async () => {
    const before = tg.sent.length;
    await bot.handleUpdate({ update_id: ++uid, message: { message_id: 1, chat: { id: -100, type: 'group' }, from: { id: 5 }, text: '/start' } });
    expect(tg.sent.length).toBe(before);
  });
});

describe('menu: a parent sees each of two children separately (PRD §14)', () => {
  const names = ['Karimov Ali', 'Rahimov Jasur'];
  it('children', async () => {
    await bot.handleUpdate(msg({ text: BTN.children }));
    for (const n of names) expect(tg.last().text).toContain(n);
  });
  it('subscriptions', async () => {
    await bot.handleUpdate(msg({ text: BTN.subs }));
    expect(tg.last().text).toContain('MMA oylik');
    expect(tg.last().text).toContain('30 kunlik');
  });
  it('payments', async () => {
    await bot.handleUpdate(msg({ text: BTN.payments }));
    expect(tg.last().text).toMatch(/Qarz yo‘q|Qarz:/);
    expect(tg.last().text).toContain('Oxirgi to‘lovlar');
  });
  it('attendance, schedule, contact', async () => {
    await bot.handleUpdate(msg({ text: BTN.attendance }));
    expect(tg.last().text).toContain('oxirgi 10 dars');
    await bot.handleUpdate(msg({ text: BTN.schedule }));
    expect(tg.last().text).toMatch(/Dushanba 16:00–17:30/);
    await bot.handleUpdate(msg({ text: BTN.contact }));
    expect(tg.last().text).toContain('Chilonzor filiali');
  });
  it('does not leak other families', async () => {
    await bot.handleUpdate(msg({ text: BTN.children }));
    expect(tg.last().text).not.toContain('Toshmatov');
  });
});

describe('delivery worker', () => {
  it('a cash payment notifies the linked parent once (outbox + dedupe)', async () => {
    tg.sent = [];
    const r = await owner.post('/api/payments', { athleteId: env.demo.athletes[0], amount: 50_000 }, { 'idempotency-key': 'tg-pay-1' });
    expect(r.status).toBe(201);
    const res = await deliverPending(env.handle.db, tg);
    expect(res.sent).toBe(1);
    expect(tg.sent[0].chat_id).toBe(String(CHAT));
    expect(tg.sent[0].text).toContain('To‘lov qabul qilindi');
    expect(tg.sent[0].text).toContain('50 000 so‘m');
    expect((await deliverPending(env.handle.db, tg)).sent).toBe(0); // nothing re-sent
  });

  it('a Telegram outage does not undo the payment; the message is retried later', async () => {
    tg.failWith = new TelegramError(502, 'Bad Gateway');
    const r = await owner.post('/api/payments', { athleteId: env.demo.athletes[1], amount: 10_000 }, { 'idempotency-key': 'tg-pay-2' });
    expect(r.status).toBe(201); // money recorded regardless of messaging
    const first = await deliverPending(env.handle.db, tg);
    expect(first.retried).toBe(1);
    const [n] = await env.handle.db.select().from(notifications).where(eq(notifications.dedupeKey, `payment_received:${r.body.payment.id}:${env.demo.sharedGuardianId}`));
    expect(n).toMatchObject({ status: 'queued', attempts: 1 });
    expect(n.lastError).toContain('502');
    expect((await deliverPending(env.handle.db, tg)).retried).toBe(0); // backoff: not due yet
    tg.failWith = null;
    const later = new Date(Date.now() + 10 * 60_000);
    expect((await deliverPending(env.handle.db, tg, later)).sent).toBe(1);
  });

  it('gives up after max attempts', async () => {
    tg.failWith = new TelegramError(500, 'down');
    await owner.post('/api/payments', { athleteId: env.demo.athletes[1], amount: 1_000 }, { 'idempotency-key': 'tg-pay-3' });
    let t = Date.now();
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      await deliverPending(env.handle.db, tg, new Date(t));
      t += 60 * 60_000;
    }
    const failed = await env.handle.db.select().from(notifications).where(eq(notifications.status, 'failed'));
    expect(failed.length).toBeGreaterThanOrEqual(1);
    tg.failWith = null;
  });

  it('admin can see the log and retry a failed message', async () => {
    const log = await owner.get('/api/notifications?status=failed');
    expect(log.status).toBe(200);
    const id = log.body[0].id;
    expect((await owner.post(`/api/notifications/${id}/retry`)).body.status).toBe('queued');
    expect((await deliverPending(env.handle.db, tg)).sent).toBe(1);
    const st = await owner.get('/api/notifications/status');
    expect(st.body.guardians.linked).toBe(1);
  });

  it('a parent who blocks the bot is unlinked', async () => {
    tg.failWith = new TelegramError(403, 'Forbidden: bot was blocked by the user');
    await owner.post('/api/payments', { athleteId: env.demo.athletes[0], amount: 2_000 }, { 'idempotency-key': 'tg-pay-4' });
    const r = await deliverPending(env.handle.db, tg);
    expect(r.failed).toBe(1);
    const [g] = await env.handle.db.select().from(guardians).where(eq(guardians.id, env.demo.sharedGuardianId));
    expect(g.telegramChatId).toBeNull();
    tg.failWith = null;
  });

  it('/stop revokes consent', async () => {
    await bot.handleUpdate(msg({ contact: { phone_number: '+998901110000', user_id: CHAT } }));
    await bot.handleUpdate(msg({ text: '/stop' }));
    const [g] = await env.handle.db.select().from(guardians).where(eq(guardians.id, env.demo.sharedGuardianId));
    expect(g.telegramConsentAt).toBeNull();
    expect(tg.last().text).toMatch(/o‘chirildi/);
  });
});

describe('templates', () => {
  it('escape HTML and format money/dates', () => {
    const t = renderNotification('payment_due_soon', { athleteName: '<b>X</b>', outstanding: 400000, dueDate: '2026-11-07', description: 'A&B' }, 'Klub');
    expect(t).toContain('&lt;b&gt;X&lt;/b&gt;');
    expect(t).toContain('400 000 so‘m');
    expect(t).toContain('07.11.2026');
    expect(t).toContain('A&amp;B');
  });
});

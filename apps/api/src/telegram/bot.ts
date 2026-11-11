/**
 * Parent Telegram bot (PRD §10).
 * Linking: the parent starts the bot and shares their OWN contact (Telegram verifies that the
 * shared contact belongs to the sender via contact.user_id === from.id). The phone is matched to
 * guardians in every club; sharing = consent to receive messages. /stop revokes consent.
 */
import { and, asc, desc, eq, gte, inArray, isNotNull, lte, ne, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import {
  athleteGuardians,
  athletes,
  attendance,
  branches,
  clubs,
  groupEnrollments,
  groups,
  guardians,
  payments,
  plans,
  schedules,
  sessions,
  subscriptions,
} from '../db/schema.js';
import { athleteBalance } from '../lib/balance-queries.js';
import { remainingSessions } from '../domain/subscription-engine.js';
import { addDays, todayInTz } from '../domain/dates.js';
import type { TelegramApi, TgMessage, TgUpdate } from './client.js';
import { dmy, esc, som } from './templates.js';

export const BTN = {
  share: '📱 Telefon raqamni yuborish',
  children: '👦 Farzandlarim',
  subs: '🎫 Abonement',
  payments: '💳 To‘lovlar',
  attendance: '📋 Davomat',
  schedule: '📅 Jadval',
  contact: '☎️ Klub bilan aloqa',
  stop: '🔕 Xabarlarni o‘chirish',
};

const MENU = {
  keyboard: [
    [{ text: BTN.children }, { text: BTN.subs }],
    [{ text: BTN.payments }, { text: BTN.attendance }],
    [{ text: BTN.schedule }, { text: BTN.contact }],
    [{ text: BTN.stop }],
  ],
  resize_keyboard: true,
};

const SHARE = {
  keyboard: [[{ text: BTN.share, request_contact: true }]],
  resize_keyboard: true,
  one_time_keyboard: true,
};

const WEEKDAYS = ['', 'Dushanba', 'Seshanba', 'Chorshanba', 'Payshanba', 'Juma', 'Shanba', 'Yakshanba'];
const ATT: Record<string, string> = { present: '✅ keldi', absent: '❌ kelmadi', excused: '🟡 sababli' };

/** Last 9 digits identify an Uzbek number regardless of +998 / 998 / 0 prefixes. */
export const phoneKey = (p: string) => p.replace(/\D/g, '').slice(-9);

export class ParentBot {
  constructor(
    private db: Db,
    private tg: TelegramApi,
  ) {}

  private send(chatId: number | string, text: string, keyboard?: object) {
    return this.tg.call('sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      ...(keyboard ? { reply_markup: keyboard } : {}),
    });
  }

  private async guardianIds(chatId: string) {
    const rows = await this.db
      .select({ id: guardians.id })
      .from(guardians)
      .where(and(eq(guardians.telegramChatId, chatId), isNotNull(guardians.telegramConsentAt)));
    return rows.map((r) => r.id);
  }

  /** Children linked to this chat across all clubs (archived excluded). */
  private async children(chatId: string) {
    const gids = await this.guardianIds(chatId);
    if (!gids.length) return [];
    return this.db
      .selectDistinct({
        id: athletes.id,
        fullName: athletes.fullName,
        clubId: athletes.clubId,
        branchId: athletes.branchId,
        clubName: clubs.name,
        timezone: clubs.timezone,
      })
      .from(athleteGuardians)
      .innerJoin(athletes, eq(athletes.id, athleteGuardians.athleteId))
      .innerJoin(clubs, eq(clubs.id, athletes.clubId))
      .where(and(inArray(athleteGuardians.guardianId, gids), ne(athletes.status, 'archived'), eq(clubs.status, 'active')))
      .orderBy(asc(athletes.fullName));
  }

  async handleUpdate(update: TgUpdate): Promise<void> {
    const m = update.message;
    if (!m || m.chat.type !== 'private') return;
    const chatId = String(m.chat.id);
    if (m.contact) return this.onContact(m);
    const text = (m.text ?? '').trim();

    if (text.startsWith('/start')) {
      const kids = await this.children(chatId);
      if (kids.length) return void (await this.send(chatId, 'Xush kelibsiz! Menyudan tanlang.', MENU));
      return void (await this.send(
        chatId,
        'Assalomu alaykum! Bu bot orqali farzandingizning abonementi, to‘lovlari va davomatini ko‘rasiz.\n\n' +
          'Ulanish uchun klubda ro‘yxatdan o‘tgan <b>o‘z telefon raqamingizni</b> yuboring. ' +
          'Raqamni yuborish orqali klubdan xabarlar olishga rozilik bildirasiz.',
        SHARE,
      ));
    }
    if (text === '/stop' || text === BTN.stop) return this.onStop(chatId);

    const kids = await this.children(chatId);
    if (!kids.length) {
      return void (await this.send(chatId, 'Avval telefon raqamingizni yuboring.', SHARE));
    }
    switch (text) {
      case BTN.children:
        return this.showChildren(chatId, kids);
      case BTN.subs:
        return this.showSubscriptions(chatId, kids);
      case BTN.payments:
        return this.showPayments(chatId, kids);
      case BTN.attendance:
        return this.showAttendance(chatId, kids);
      case BTN.schedule:
        return this.showSchedule(chatId, kids);
      case BTN.contact:
        return this.showContact(chatId, kids);
      default:
        await this.send(chatId, 'Menyudan bo‘limni tanlang.', MENU);
    }
  }

  private async onContact(m: TgMessage) {
    const chatId = String(m.chat.id);
    const c = m.contact!;
    // Security: only the sender's own contact is accepted (Telegram-verified ownership).
    if (!m.from || c.user_id !== m.from.id) {
      return void (await this.send(chatId, 'Iltimos, tugma orqali <b>o‘z</b> raqamingizni yuboring.', SHARE));
    }
    const key = phoneKey(c.phone_number);
    if (key.length < 9) return void (await this.send(chatId, 'Telefon raqami noto‘g‘ri.', SHARE));
    const matches = await this.db
      .select({ id: guardians.id })
      .from(guardians)
      .innerJoin(clubs, eq(clubs.id, guardians.clubId))
      .where(and(sql`right(regexp_replace(${guardians.phone}, '\\D', '', 'g'), 9) = ${key}`, eq(clubs.status, 'active')));
    if (!matches.length) {
      return void (await this.send(
        chatId,
        'Bu raqam klub bazasida topilmadi. Iltimos, klub administratoriga murojaat qilib, raqamingizni to‘g‘ri kiritishlarini so‘rang.',
        SHARE,
      ));
    }
    await this.db
      .update(guardians)
      .set({ telegramChatId: chatId, telegramConsentAt: new Date() })
      .where(inArray(guardians.id, matches.map((g) => g.id)));
    const kids = await this.children(chatId);
    await this.send(
      chatId,
      `✅ Ulandi! Farzandlaringiz: ${kids.map((k) => `<b>${esc(k.fullName)}</b>`).join(', ') || '—'}.\n` +
        'Endi to‘lov, eslatma va davomat xabarlarini shu yerda olasiz.',
      MENU,
    );
  }

  private async onStop(chatId: string) {
    await this.db.update(guardians).set({ telegramChatId: null, telegramConsentAt: null }).where(eq(guardians.telegramChatId, chatId));
    await this.send(chatId, '🔕 Xabarlar o‘chirildi. Qayta ulanish uchun /start yuboring.', { remove_keyboard: true });
  }

  private async showChildren(chatId: string, kids: Awaited<ReturnType<ParentBot['children']>>) {
    const lines = [];
    for (const k of kids) {
      const gs = await this.db
        .select({ name: groups.name })
        .from(groupEnrollments)
        .innerJoin(groups, eq(groups.id, groupEnrollments.groupId))
        .where(and(eq(groupEnrollments.athleteId, k.id), eq(groupEnrollments.status, 'active')));
      lines.push(`👤 <b>${esc(k.fullName)}</b> — ${esc(k.clubName)}\nGuruh: ${gs.map((g) => esc(g.name)).join(', ') || '—'}`);
    }
    await this.send(chatId, lines.join('\n\n'), MENU);
  }

  private async showSubscriptions(chatId: string, kids: Awaited<ReturnType<ParentBot['children']>>) {
    const lines = [];
    for (const k of kids) {
      const subs = await this.db
        .select({ s: subscriptions, planName: plans.name })
        .from(subscriptions)
        .innerJoin(plans, eq(plans.id, subscriptions.planId))
        .where(and(eq(subscriptions.athleteId, k.id), inArray(subscriptions.status, ['active', 'frozen'])))
        .orderBy(asc(subscriptions.endDate));
      const body = subs.length
        ? subs
            .map(({ s, planName }) => {
              const rem = remainingSessions(s);
              return `• ${esc(planName)}${s.status === 'frozen' ? ' (muzlatilgan)' : ''}: ${s.endDate ? `${dmy(s.endDate)} gacha` : 'muddatsiz'}${rem != null ? `, qoldiq <b>${rem}</b> dars` : ''}`;
            })
            .join('\n')
        : 'Faol abonement yo‘q';
      lines.push(`👤 <b>${esc(k.fullName)}</b>\n${body}`);
    }
    await this.send(chatId, lines.join('\n\n'), MENU);
  }

  private async showPayments(chatId: string, kids: Awaited<ReturnType<ParentBot['children']>>) {
    const lines = [];
    for (const k of kids) {
      const bal = await athleteBalance(this.db, k.clubId, k.id);
      const last = await this.db
        .select({ amount: payments.amount, paidAt: payments.paidAt })
        .from(payments)
        .where(and(eq(payments.athleteId, k.id), sql`${payments.amount} > 0`))
        .orderBy(desc(payments.paidAt))
        .limit(3);
      const status = bal.debt > 0 ? `Qarz: <b>${som(bal.debt)}</b>` : bal.advance > 0 ? `Avans: <b>${som(bal.advance)}</b>` : 'Qarz yo‘q ✅';
      const hist = last.map((p) => `• ${dmy(p.paidAt.toISOString())}: ${som(p.amount)}`).join('\n');
      lines.push(`👤 <b>${esc(k.fullName)}</b>\n${status}${hist ? `\nOxirgi to‘lovlar:\n${hist}` : ''}`);
    }
    await this.send(chatId, lines.join('\n\n'), MENU);
  }

  private async showAttendance(chatId: string, kids: Awaited<ReturnType<ParentBot['children']>>) {
    const lines = [];
    for (const k of kids) {
      const rows = await this.db
        .select({ date: sessions.sessionDate, status: attendance.status, group: groups.name })
        .from(attendance)
        .innerJoin(sessions, eq(sessions.id, attendance.sessionId))
        .innerJoin(groups, eq(groups.id, sessions.groupId))
        .where(eq(attendance.athleteId, k.id))
        .orderBy(desc(sessions.sessionDate))
        .limit(10);
      const body = rows.length ? rows.map((r) => `• ${dmy(r.date)} ${ATT[r.status] ?? r.status}`).join('\n') : 'Hali davomat yo‘q';
      lines.push(`👤 <b>${esc(k.fullName)}</b> (oxirgi 10 dars)\n${body}`);
    }
    await this.send(chatId, lines.join('\n\n'), MENU);
  }

  private async showSchedule(chatId: string, kids: Awaited<ReturnType<ParentBot['children']>>) {
    const lines = [];
    for (const k of kids) {
      const gs = await this.db
        .select({ id: groups.id, name: groups.name })
        .from(groupEnrollments)
        .innerJoin(groups, eq(groups.id, groupEnrollments.groupId))
        .where(and(eq(groupEnrollments.athleteId, k.id), eq(groupEnrollments.status, 'active')));
      const parts = [];
      for (const g of gs) {
        const sch = await this.db.select().from(schedules).where(eq(schedules.groupId, g.id)).orderBy(asc(schedules.weekday), asc(schedules.startTime));
        const today = todayInTz(k.timezone);
        const cancelled = await this.db
          .select({ date: sessions.sessionDate, time: sessions.startTime })
          .from(sessions)
          .where(and(eq(sessions.groupId, g.id), eq(sessions.status, 'cancelled'), gte(sessions.sessionDate, today), lte(sessions.sessionDate, addDays(today, 7))));
        parts.push(
          `<b>${esc(g.name)}</b>\n` +
            (sch.map((s) => `• ${WEEKDAYS[s.weekday]} ${s.startTime.slice(0, 5)}–${s.endTime.slice(0, 5)}${s.room ? ` (${esc(s.room)})` : ''}`).join('\n') || '• jadval kiritilmagan') +
            (cancelled.length ? `\n⚠️ Bekor: ${cancelled.map((c) => `${dmy(c.date)} ${c.time.slice(0, 5)}`).join(', ')}` : ''),
        );
      }
      lines.push(`👤 <b>${esc(k.fullName)}</b>\n${parts.join('\n') || 'Guruhga biriktirilmagan'}`);
    }
    await this.send(chatId, lines.join('\n\n'), MENU);
  }

  private async showContact(chatId: string, kids: Awaited<ReturnType<ParentBot['children']>>) {
    const branchIds = [...new Set(kids.map((k) => k.branchId))];
    const rows = await this.db
      .select({ club: clubs.name, name: branches.name, phone: branches.phone, address: branches.address })
      .from(branches)
      .innerJoin(clubs, eq(clubs.id, branches.clubId))
      .where(inArray(branches.id, branchIds));
    const text = rows
      .map((b) => `<b>${esc(b.club)}</b> — ${esc(b.name)}\n${b.phone ? `☎️ ${esc(b.phone)}\n` : ''}${b.address ? `📍 ${esc(b.address)}` : ''}`)
      .join('\n\n');
    await this.send(chatId, text || 'Aloqa ma’lumotlari kiritilmagan.', MENU);
  }
}

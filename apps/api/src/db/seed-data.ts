/**
 * Demo data for the MMA pilot (PRD §17): 2 branches, 3 coaches, 4 groups, 20 athletes.
 * All names and phone numbers are fictional.
 */
import { eq } from 'drizzle-orm';
import type { Db } from './client.js';
import {
  athleteGuardians,
  athletes,
  branches,
  charges,
  clubs,
  coaches,
  groupEnrollments,
  groups,
  guardians,
  memberships,
  paymentAllocations,
  payments,
  plans,
  schedules,
  sports,
  subscriptions,
  users,
} from './schema.js';
import { hashPassword } from '../auth/password.js';
import { computePeriod, computePrice } from '../domain/subscription-engine.js';
import { DEFAULT_CLUB_SETTINGS } from './schema.js';

export const DEMO_PASSWORD = 'demo12345';

export const DEMO_USERS = {
  superadmin: 'superadmin@sport-erp.uz',
  owner: 'owner@demo-mma.uz',
  adminChilonzor: 'admin.chilonzor@demo-mma.uz',
  coach1: 'coach.aziz@demo-mma.uz',
  coach2: 'coach.bekzod@demo-mma.uz',
  coach3: 'coach.dilshod@demo-mma.uz',
} as const;

const FIRST = ['Ali', 'Jasur', 'Sardor', 'Bobur', 'Otabek', 'Diyor', 'Javohir', 'Shohruh', 'Islom', 'Temur',
  'Asadbek', 'Muhammad', 'Abdulloh', 'Behruz', 'Sanjar', 'Nodir', 'Ulugbek', 'Farrux', 'Doniyor', 'Kamron'];
const LAST = ['Karimov', 'Rahimov', 'Toshmatov', 'Yusupov', 'Aliyev', 'Saidov', 'Nazarov', 'Ergashev', 'Qodirov', 'Mirzayev'];

export async function seedDemo(db: Db, opts: { today?: string } = {}) {
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const monthStart = `${today.slice(0, 7)}-01`;
  const pw = await hashPassword(DEMO_PASSWORD);

  return db.transaction(async (tx) => {
    const mkUser = async (email: string, fullName: string, isSuperadmin = false) =>
      (await tx.insert(users).values({ email, fullName, passwordHash: pw, isSuperadmin }).returning())[0];

    await mkUser(DEMO_USERS.superadmin, 'Platforma Admin', true);
    const [club] = await tx
      .insert(clubs)
      .values({ name: 'Demo MMA Klubi', timezone: 'Asia/Tashkent', settings: DEFAULT_CLUB_SETTINGS })
      .returning();
    const clubId = club.id;

    const [chilonzor, yunusobod] = await tx
      .insert(branches)
      .values([
        { clubId, name: 'Chilonzor filiali', address: 'Toshkent, Chilonzor tumani', phone: '+998900000101' },
        { clubId, name: 'Yunusobod filiali', address: 'Toshkent, Yunusobod tumani', phone: '+998900000102' },
      ])
      .returning();

    const owner = await mkUser(DEMO_USERS.owner, 'Klub Egasi');
    const admin = await mkUser(DEMO_USERS.adminChilonzor, 'Chilonzor Administratori');
    const cu1 = await mkUser(DEMO_USERS.coach1, 'Aziz Murodov');
    const cu2 = await mkUser(DEMO_USERS.coach2, 'Bekzod Sobirov');
    const cu3 = await mkUser(DEMO_USERS.coach3, 'Dilshod Hamidov');

    await tx.insert(memberships).values([
      { userId: owner.id, clubId, role: 'owner' },
      { userId: admin.id, clubId, role: 'branch_admin', branchIds: [chilonzor.id] },
      { userId: cu1.id, clubId, role: 'coach', branchIds: [chilonzor.id, yunusobod.id] },
      { userId: cu2.id, clubId, role: 'coach', branchIds: [chilonzor.id] },
      { userId: cu3.id, clubId, role: 'coach', branchIds: [yunusobod.id] },
    ]);

    const [mma, kick, boxing] = await tx
      .insert(sports)
      .values([
        { clubId, name: 'MMA' },
        { clubId, name: 'Kikboksing' },
        { clubId, name: 'Boks' },
      ])
      .returning();
    void boxing;

    const [c1, c2, c3] = await tx
      .insert(coaches)
      .values([
        { clubId, userId: cu1.id, fullName: cu1.fullName, phone: '+998900000201', employment: 'Shtatda' },
        { clubId, userId: cu2.id, fullName: cu2.fullName, phone: '+998900000202', employment: 'Shtatda' },
        { clubId, userId: cu3.id, fullName: cu3.fullName, phone: '+998900000203', employment: 'Shartnoma' },
      ])
      .returning();

    const gs = await tx
      .insert(groups)
      .values([
        { clubId, branchId: chilonzor.id, sportId: mma.id, coachId: c1.id, name: 'MMA Bolalar (8–12)', capacity: 15, ageMin: 8, ageMax: 12 },
        { clubId, branchId: chilonzor.id, sportId: mma.id, coachId: c2.id, name: 'MMA Kattalar', capacity: 20, ageMin: 16 },
        { clubId, branchId: yunusobod.id, sportId: kick.id, coachId: c3.id, name: 'Kikboksing O‘smirlar', capacity: 12, ageMin: 12, ageMax: 17 },
        { clubId, branchId: yunusobod.id, sportId: mma.id, coachId: c1.id, name: 'MMA Yunusobod', capacity: 15, ageMin: 14 },
      ])
      .returning();

    const sched = [
      { g: 0, days: [1, 3, 5], s: '16:00', e: '17:30', room: 'Zal 1' },
      { g: 1, days: [1, 3, 5], s: '19:00', e: '20:30', room: 'Zal 1' },
      { g: 2, days: [2, 4, 6], s: '17:00', e: '18:30', room: 'Asosiy zal' },
      { g: 3, days: [2, 4, 6], s: '19:00', e: '20:30', room: 'Asosiy zal' },
    ];
    await tx.insert(schedules).values(
      sched.flatMap((x) => x.days.map((weekday) => ({ clubId, groupId: gs[x.g].id, weekday, startTime: x.s, endTime: x.e, room: x.room }))),
    );

    const [pMonth, p30, p12, pSingle] = await tx
      .insert(plans)
      .values([
        { clubId, sportId: mma.id, name: 'MMA oylik (kalendar)', billingType: 'calendar_month', price: 400_000 },
        { clubId, sportId: null, name: '30 kunlik abonement', billingType: 'fixed_days', price: 450_000, durationDays: 30 },
        { clubId, sportId: null, name: '12 darslik abonement', billingType: 'session_pack', price: 350_000, sessionLimit: 12, maxValidityDays: 45 },
        { clubId, sportId: null, name: 'Bir martalik dars', kind: 'single', billingType: 'session_pack', price: 50_000, sessionLimit: 1, maxValidityDays: 1 },
      ])
      .returning();
    void pSingle;

    // 20 athletes; group index by position; ages fit the groups.
    const groupFor = (i: number) => (i < 6 ? 0 : i < 11 ? 1 : i < 16 ? 2 : 3);
    const ageFor = [9, 10, 11, 8, 12, 10, 18, 22, 25, 19, 30, 13, 14, 15, 16, 12, 15, 17, 20, 24];
    const year = Number(today.slice(0, 4));
    const athleteRows = [];
    for (let i = 0; i < 20; i++) {
      const g = gs[groupFor(i)];
      const [a] = await tx
        .insert(athletes)
        .values({
          clubId,
          branchId: g.branchId,
          fullName: `${LAST[i % LAST.length]} ${FIRST[i]}`,
          birthDate: `${year - ageFor[i]}-${String((i % 12) + 1).padStart(2, '0')}-15`,
          joinedAt: monthStart,
          status: 'active',
        })
        .returning();
      athleteRows.push(a);
      await tx.insert(groupEnrollments).values({ clubId, athleteId: a.id, groupId: g.id, startedAt: monthStart });
    }

    // Guardians: minors get a parent; athletes 0 and 1 share one parent (siblings).
    const sharedParent = (
      await tx.insert(guardians).values({ clubId, fullName: 'Karimova Nilufar', phone: '+998901110000', telegramConsentAt: new Date() }).returning()
    )[0];
    for (let i = 0; i < 20; i++) {
      if (ageFor[i] >= 18) continue;
      let gId = sharedParent.id;
      if (i > 1) {
        const [g] = await tx
          .insert(guardians)
          .values({ clubId, fullName: `${LAST[i % LAST.length]} (ota-ona)`, phone: `+9989011100${String(i).padStart(2, '0')}` })
          .returning();
        gId = g.id;
      }
      await tx.insert(athleteGuardians).values({ clubId, athleteId: athleteRows[i].id, guardianId: gId, relation: 'parent', isPrimary: true });
    }

    // Subscriptions for the first 14 athletes; a mix of the three models.
    const settings = { calendarProration: 'full' as const };
    for (let i = 0; i < 14; i++) {
      const plan = i % 3 === 0 ? pMonth : i % 3 === 1 ? p30 : p12;
      const startDate = monthStart;
      const period = computePeriod(plan, startDate);
      const price = computePrice({ plan, startDate, settings });
      const a = athleteRows[i];
      const [sub] = await tx
        .insert(subscriptions)
        .values({
          clubId,
          branchId: a.branchId,
          athleteId: a.id,
          planId: plan.id,
          billingType: plan.billingType,
          startDate,
          endDate: period.endDate,
          listPrice: price.listPrice,
          price: price.price,
          sessionLimit: plan.sessionLimit,
          usedSessions: plan.billingType === 'session_pack' ? 3 : 0,
          createdBy: owner.id,
        })
        .returning();
      const [ch] = await tx
        .insert(charges)
        .values({
          clubId,
          branchId: a.branchId,
          athleteId: a.id,
          subscriptionId: sub.id,
          description: `${plan.name} (${startDate}${period.endDate ? ' – ' + period.endDate : ''})`,
          dueDate: startDate,
          amount: price.price,
        })
        .returning();
      // Payments: 0–7 fully paid, athlete 9 (monthly plan) partially (150 000 of 400 000 → 250 000 debt), rest unpaid.
      const paid = i < 8 ? price.price : i === 9 ? 150_000 : 0;
      if (paid > 0) {
        const [p] = await tx
          .insert(payments)
          .values({ clubId, branchId: a.branchId, athleteId: a.id, amount: paid, receivedBy: owner.id, receiptNo: `DEMO-${1000 + i}` })
          .returning();
        await tx.insert(paymentAllocations).values({ paymentId: p.id, chargeId: ch.id, amount: paid });
        await tx
          .update(charges)
          .set({ paidAmount: paid, status: paid >= price.price ? 'paid' : 'partially_paid' })
          .where(eq(charges.id, ch.id));
      }
    }

    return {
      clubId,
      branches: { chilonzor: chilonzor.id, yunusobod: yunusobod.id },
      coaches: [c1.id, c2.id, c3.id],
      groups: gs.map((g) => g.id),
      plans: { month: pMonth.id, days30: p30.id, pack12: p12.id },
      athletes: athleteRows.map((a) => a.id),
      sharedGuardianId: sharedParent.id,
    };
  });
}

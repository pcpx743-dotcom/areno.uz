/**
 * One-time import of a club's Excel payment ledger (converted to JSON) into an EMPTY database.
 *
 * Usage (from apps/api):
 *   CLUB_NAME="Oqtepa FC" OWNER_EMAIL=owner@x.uz OWNER_PASSWORD=... SUPERADMIN_EMAIL=... SUPERADMIN_PASSWORD=... \
 *   npx tsx src/db/import-ledger.ts <ledger.json>
 *
 * Model: each ledger payment = one paid subscription (30 days; single lesson for "1 martalik …"),
 * with its charge, payment (real method) and allocation. Athletes are enrolled in a group per
 * coach × sport. Rows without a usable name are kept under one archived "Noma’lum" athlete so
 * money totals reconcile. Expenses are club-wide.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { count, eq, sql } from 'drizzle-orm';
import { createDb, runMigrations, type Db } from './client.js';
import { loadConfig } from '../config.js';
import {
  athletes,
  auditLogs,
  branches,
  charges,
  clubs,
  coachCompensationRules,
  coaches,
  expenses,
  groupEnrollments,
  groups,
  memberships,
  paymentAllocations,
  payments,
  plans,
  sports,
  subscriptions,
  users,
} from './schema.js';
import { hashPassword } from '../auth/password.js';
import { addDays, todayInTz } from '../domain/dates.js';

interface LedgerPayment {
  row: number;
  date: string;
  name: string | null;
  sport: string;
  coach: string;
  amount: number;
  method: 'cash' | 'click_payme' | 'terminal';
  note: string | null;
}
interface Ledger {
  payments: LedgerPayment[];
  expenses: { date: string; amount: number; method: string; text: string }[];
  yearly: Record<string, number>;
}

const env = (k: string) => {
  const v = process.env[k]?.trim();
  if (!v) throw new Error(`${k} is required`);
  return v;
};

const SINGLE_PREFIX = /^1\s*martalik\s+/i;
const UNKNOWN = 'Noma’lum sportchi (Excel)';
/** Coaches whose pay is 40% of revenue in the ledger's monthly sheet. */
const PERCENT_40 = ['Jasur Alijanov', 'Ramiz Manazarov', 'Firuz Yakubov', 'Abdurauf Bazarbayev'];

async function insertChunks<T>(db: Db, table: Parameters<Db['insert']>[0], rows: T[], size = 400) {
  for (let i = 0; i < rows.length; i += size) await db.insert(table).values(rows.slice(i, i + size) as never);
}

const mode = (xs: number[]) => {
  const c = new Map<number, number>();
  for (const x of xs) c.set(x, (c.get(x) ?? 0) + 1);
  return [...c.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
};

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error('usage: import-ledger.ts <ledger.json>');
  const ledger: Ledger = JSON.parse(readFileSync(file, 'utf-8'));
  const cfg = loadConfig();
  const handle = await createDb(cfg.databaseUrl);
  await runMigrations(handle);
  const db = handle.db;

  const [{ c: existing }] = await db.select({ c: count() }).from(clubs);
  if (existing > 0) throw new Error('Database is not empty — import only into a fresh database.');

  const tz = 'Asia/Tashkent';
  const today = todayInTz(tz);
  const t0 = Date.now();

  // ---- platform + club ----
  const [superadmin] = await db
    .insert(users)
    .values({ email: env('SUPERADMIN_EMAIL'), fullName: 'Platforma administratori', isSuperadmin: true, passwordHash: await hashPassword(env('SUPERADMIN_PASSWORD')) })
    .returning();
  const [club] = await db.insert(clubs).values({ name: env('CLUB_NAME'), timezone: tz }).returning();
  const [branch] = await db.insert(branches).values({ clubId: club.id, name: 'Asosiy filial' }).returning();
  const [owner] = await db
    .insert(users)
    .values({ email: env('OWNER_EMAIL'), fullName: 'Klub egasi', passwordHash: await hashPassword(env('OWNER_PASSWORD')) })
    .returning();
  await db.insert(memberships).values({ userId: owner.id, clubId: club.id, role: 'owner' });

  // ---- sports, coaches, groups, plans ----
  const baseSport = (s: string) => s.replace(SINGLE_PREFIX, '').trim();
  const isSingle = (s: string) => SINGLE_PREFIX.test(s);
  const sportNames = [...new Set(ledger.payments.map((p) => baseSport(p.sport)).filter((s) => s && s !== '-'))].sort();
  const sportRows = await db.insert(sports).values(sportNames.map((name) => ({ clubId: club.id, name }))).returning();
  const sportId = new Map(sportRows.map((s) => [s.name, s.id]));

  const coachNames = [...new Set(ledger.payments.map((p) => p.coach).filter(Boolean))].sort();
  const coachRows = await db.insert(coaches).values(coachNames.map((fullName) => ({ clubId: club.id, fullName }))).returning();
  const coachId = new Map(coachRows.map((c) => [c.fullName, c.id]));

  const groupKey = (p: LedgerPayment) => `${baseSport(p.sport)}|${p.coach}`;
  const groupKeys = [...new Set(ledger.payments.filter((p) => !isSingle(p.sport)).map(groupKey))].sort();
  const groupRows = await db
    .insert(groups)
    .values(
      groupKeys.map((k) => {
        const [sport, coach] = k.split('|');
        return { clubId: club.id, branchId: branch.id, sportId: sportId.get(sport)!, coachId: coachId.get(coach) ?? null, name: `${sport} — ${coach}` };
      }),
    )
    .returning();
  const groupId = new Map(groupRows.map((g, i) => [groupKeys[i], g.id]));

  // one 30-day plan per sport (typical price) + single-lesson plans
  const planBySport = new Map<string, string>();
  for (const s of sportNames) {
    const amounts = ledger.payments.filter((p) => baseSport(p.sport) === s && !isSingle(p.sport)).map((p) => p.amount);
    if (!amounts.length) continue;
    const [pl] = await db
      .insert(plans)
      .values({ clubId: club.id, sportId: sportId.get(s)!, name: `${s} — 1 oy (30 kun)`, billingType: 'fixed_days', durationDays: 30, price: mode(amounts) })
      .returning();
    planBySport.set(s, pl.id);
  }
  const singlePlan = new Map<string, string>();
  for (const s of new Set(ledger.payments.filter((p) => isSingle(p.sport)).map((p) => p.sport))) {
    const amounts = ledger.payments.filter((p) => p.sport === s).map((p) => p.amount);
    const [pl] = await db
      .insert(plans)
      .values({ clubId: club.id, sportId: sportId.get(baseSport(s))!, name: s, kind: 'single', billingType: 'session_pack', sessionLimit: 1, maxValidityDays: 1, price: mode(amounts) })
      .returning();
    singlePlan.set(s, pl.id);
  }
  const planName = new Map<string, string>();
  for (const p of await db.select().from(plans)) planName.set(p.id, p.name);

  // ---- athletes ----
  const byName = new Map<string, LedgerPayment[]>();
  for (const p of ledger.payments) {
    const k = p.name ?? UNKNOWN;
    byName.set(k, [...(byName.get(k) ?? []), p]);
  }
  const athleteRows = [...byName.entries()].map(([name, ps]) => ({
    id: randomUUID(),
    clubId: club.id,
    branchId: branch.id,
    fullName: name,
    joinedAt: ps.map((p) => p.date).sort()[0],
    status: name === UNKNOWN ? ('archived' as const) : ('active' as const),
    note: name === UNKNOWN ? 'Excel jadvalida ismi yozilmagan to‘lovlar' : null,
  }));
  await insertChunks(db, athletes, athleteRows);
  const athleteId = new Map(athleteRows.map((a) => [a.fullName, a.id]));

  // ---- enrollments: athlete × group, from first payment there ----
  const enr = new Map<string, { athleteId: string; groupId: string; startedAt: string }>();
  for (const p of ledger.payments) {
    if (!p.name || isSingle(p.sport)) continue;
    const g = groupId.get(groupKey(p));
    if (!g) continue;
    const k = `${p.name}|${g}`;
    const cur = enr.get(k);
    if (!cur || p.date < cur.startedAt) enr.set(k, { athleteId: athleteId.get(p.name)!, groupId: g, startedAt: p.date });
  }
  await insertChunks(
    db,
    groupEnrollments,
    [...enr.values()].map((e) => ({ ...e, clubId: club.id, status: 'active' as const })),
  );

  // ---- subscriptions, charges, payments, allocations ----
  const subRows = [];
  const chargeRows = [];
  const payRows = [];
  const allocRows = [];
  const sorted = [...ledger.payments].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.row - b.row));
  let seq = 0;
  for (const p of sorted) {
    const single = isSingle(p.sport);
    const planId = single ? singlePlan.get(p.sport)! : planBySport.get(baseSport(p.sport))!;
    const end = single ? p.date : addDays(p.date, 29);
    const subId = randomUUID();
    const chargeId = randomUUID();
    const payId = randomUUID();
    const aId = athleteId.get(p.name ?? UNKNOWN)!;
    subRows.push({
      id: subId,
      clubId: club.id,
      branchId: branch.id,
      athleteId: aId,
      planId,
      billingType: single ? ('session_pack' as const) : ('fixed_days' as const),
      startDate: p.date,
      endDate: end,
      listPrice: p.amount,
      price: p.amount,
      sessionLimit: single ? 1 : null,
      usedSessions: single ? 1 : 0,
      status: end < today || single ? ('expired' as const) : ('active' as const),
      createdBy: owner.id,
    });
    chargeRows.push({
      id: chargeId,
      clubId: club.id,
      branchId: branch.id,
      athleteId: aId,
      subscriptionId: subId,
      description: `${planName.get(planId)} (${p.date}${single ? '' : ' – ' + end})`,
      dueDate: p.date,
      amount: p.amount,
      paidAmount: p.amount,
      status: 'paid' as const,
    });
    payRows.push({
      id: payId,
      clubId: club.id,
      branchId: branch.id,
      athleteId: aId,
      method: p.method,
      amount: p.amount,
      paidAt: new Date(`${p.date}T12:00:00+05:00`),
      receivedBy: null,
      receiptNo: `XL-${String(++seq).padStart(5, '0')}`,
      note: [p.coach && `Trener: ${p.coach}`, p.note].filter(Boolean).join(' · ') || null,
      idempotencyKey: `excel-import:${p.row}`,
    });
    allocRows.push({ paymentId: payId, chargeId, amount: p.amount });
  }
  await insertChunks(db, subscriptions, subRows);
  await insertChunks(db, charges, chargeRows);
  await insertChunks(db, payments, payRows);
  await insertChunks(db, paymentAllocations, allocRows);

  // ---- expenses (club-wide; original text kept) ----
  if (ledger.expenses.length) {
    await db.insert(expenses).values(
      ledger.expenses.map((e) => ({
        clubId: club.id,
        branchId: null,
        category: /oyli|avans/i.test(e.text) ? ('salary' as const) : ('other' as const),
        amount: e.amount,
        incurredAt: e.date,
        note: `${e.text}${e.method ? ` (${e.method})` : ''}`,
        createdBy: owner.id,
        paidBy: owner.id,
      })),
    );
  }

  // ---- coach pay rules visible in the ledger (40% of revenue) ----
  const rules = PERCENT_40.filter((n) => coachId.has(n)).map((n) => ({
    clubId: club.id,
    coachId: coachId.get(n)!,
    model: 'revenue_percent' as const,
    percentBp: 4000,
    validFrom: '2025-07-01',
  }));
  if (rules.length) await db.insert(coachCompensationRules).values(rules);

  await db.insert(auditLogs).values({
    clubId: club.id,
    actorUserId: superadmin.id,
    action: 'excel_import',
    entity: 'clubs',
    entityId: club.id,
    after: { payments: payRows.length, athletes: athleteRows.length, expenses: ledger.expenses.length },
  });

  // ---- reconciliation ----
  const [{ total }] = await db
    .select({ total: sql<number>`coalesce(sum(${payments.amount}), 0)`.mapWith(Number) })
    .from(payments)
    .where(eq(payments.clubId, club.id));
  const expected = ledger.payments.reduce((a, p) => a + p.amount, 0);
  const byMonth = new Map<string, number>();
  for (const p of ledger.payments) byMonth.set(p.date.slice(0, 7), (byMonth.get(p.date.slice(0, 7)) ?? 0) + p.amount);
  const byCoach = new Map<string, number>();
  for (const p of ledger.payments) byCoach.set(p.coach, (byCoach.get(p.coach) ?? 0) + p.amount);
  const byMethod = new Map<string, number>();
  for (const p of ledger.payments) byMethod.set(p.method, (byMethod.get(p.method) ?? 0) + p.amount);

  console.log(
    JSON.stringify(
      {
        seconds: Math.round((Date.now() - t0) / 1000),
        club: club.name,
        athletes: athleteRows.length,
        activeAthletes: athleteRows.filter((a) => a.status === 'active').length,
        coaches: coachRows.length,
        groups: groupRows.length,
        enrollments: enr.size,
        plans: planBySport.size + singlePlan.size,
        payments: payRows.length,
        activeSubscriptions: subRows.filter((s) => s.status === 'active').length,
        expenses: ledger.expenses.length,
        payrollRules: rules.length,
        totalImported: total,
        totalInLedger: expected,
        reconciles: total === expected,
        byMonth: Object.fromEntries([...byMonth.entries()].sort()),
        byCoach: Object.fromEntries(byCoach),
        byMethod: Object.fromEntries(byMethod),
        yearlySheet: ledger.yearly,
      },
      null,
      2,
    ),
  );
  await handle.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

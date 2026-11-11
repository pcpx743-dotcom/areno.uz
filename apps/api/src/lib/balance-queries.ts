import { and, eq, ne, sql, type SQLWrapper } from 'drizzle-orm';
import type { Db, Tx } from '../db/client.js';
import { balanceAdjustments, charges, payments } from '../db/schema.js';
import { computeBalance, type Balance } from '../domain/balance.js';

/** SQL expression: current balance (debt > 0, advance < 0) for the given athlete id column. */
export function balanceSql(athleteId: SQLWrapper) {
  return sql<number>`(
    coalesce((select sum(c.amount) from ${charges} c where c.athlete_id = ${athleteId} and c.status <> 'void'), 0)
    - coalesce((select sum(p.amount) from ${payments} p where p.athlete_id = ${athleteId}), 0)
    - coalesce((select sum(b.amount) from ${balanceAdjustments} b where b.athlete_id = ${athleteId}), 0)
  )`.mapWith(Number);
}

export async function athleteBalance(db: Db | Tx, clubId: string, athleteId: string): Promise<Balance> {
  const total = (col: SQLWrapper) => sql<number>`coalesce(sum(${col}), 0)`.mapWith(Number);
  const [c] = await db
    .select({ v: total(charges.amount) })
    .from(charges)
    .where(and(eq(charges.clubId, clubId), eq(charges.athleteId, athleteId), ne(charges.status, 'void')));
  const [p] = await db
    .select({ v: total(payments.amount) })
    .from(payments)
    .where(and(eq(payments.clubId, clubId), eq(payments.athleteId, athleteId)));
  const [a] = await db
    .select({ v: total(balanceAdjustments.amount) })
    .from(balanceAdjustments)
    .where(and(eq(balanceAdjustments.clubId, clubId), eq(balanceAdjustments.athleteId, athleteId)));
  return computeBalance({ charges: [{ amount: c.v }], payments: [{ amount: p.v }], adjustments: [{ amount: a.v }] });
}

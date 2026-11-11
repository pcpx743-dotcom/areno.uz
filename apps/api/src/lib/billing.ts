/**
 * Billing service (PRD §6): charge recomputation, payment allocation, advances, receipts.
 * All functions run inside the caller's transaction.
 */
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Tx } from '../db/client.js';
import { charges, clubs, paymentAllocations, payments } from '../db/schema.js';
import { allocatePayment } from '../domain/balance.js';

type ChargeStatus = 'open' | 'partially_paid' | 'paid' | 'void';

export function chargeStatusFor(amount: number, paid: number, current: ChargeStatus): ChargeStatus {
  if (current === 'void') return 'void';
  if (paid <= 0) return amount === 0 ? 'paid' : 'open';
  return paid >= amount ? 'paid' : 'partially_paid';
}

/** Recompute paid_amount and status of charges from their allocations. */
export async function recomputeCharges(tx: Tx, chargeIds: string[]) {
  const unique = [...new Set(chargeIds)];
  for (const id of unique) {
    const [c] = await tx.select().from(charges).where(eq(charges.id, id));
    if (!c) continue;
    const [{ paid }] = await tx
      .select({ paid: sql<number>`coalesce(sum(${paymentAllocations.amount}), 0)`.mapWith(Number) })
      .from(paymentAllocations)
      .where(eq(paymentAllocations.chargeId, id));
    await tx
      .update(charges)
      .set({ paidAmount: paid, status: chargeStatusFor(c.amount, paid, c.status) })
      .where(eq(charges.id, id));
  }
}

/** Open charges of an athlete, locked for update, oldest due first. */
export async function lockOpenCharges(tx: Tx, clubId: string, athleteId: string) {
  return tx
    .select()
    .from(charges)
    .where(and(eq(charges.clubId, clubId), eq(charges.athleteId, athleteId), inArray(charges.status, ['open', 'partially_paid'])))
    .orderBy(asc(charges.dueDate), asc(charges.createdAt))
    .for('update');
}

async function addAllocation(tx: Tx, paymentId: string, chargeId: string, amount: number) {
  await tx
    .insert(paymentAllocations)
    .values({ paymentId, chargeId, amount })
    .onConflictDoUpdate({
      target: [paymentAllocations.paymentId, paymentAllocations.chargeId],
      set: { amount: sql`${paymentAllocations.amount} + excluded.amount` },
    });
}

/**
 * Allocate `amount` of a payment to open charges. `priority` charge ids are filled first,
 * then the rest oldest-due first. Returns the unallocated remainder (advance).
 */
export async function allocate(
  tx: Tx,
  clubId: string,
  athleteId: string,
  paymentId: string,
  amount: number,
  priority: string[] = [],
): Promise<{ allocations: { chargeId: string; amount: number }[]; remainder: number }> {
  const open = await lockOpenCharges(tx, clubId, athleteId);
  const first = open.filter((c) => priority.includes(c.id));
  const rest = open.filter((c) => !priority.includes(c.id));
  const a1 = allocatePayment(amount, first);
  const a2 = allocatePayment(a1.remainder, rest);
  const allocations = [...a1.allocations, ...a2.allocations];
  for (const al of allocations) await addAllocation(tx, paymentId, al.chargeId, al.amount);
  await recomputeCharges(
    tx,
    allocations.map((a) => a.chargeId),
  );
  return { allocations, remainder: a2.remainder };
}

/**
 * Apply unallocated money (advance) of an athlete to their open charges.
 * Called after a new charge is created or a payment is reversed.
 */
export async function applyAdvance(tx: Tx, clubId: string, athleteId: string) {
  const reversed = sql`exists (select 1 from ${payments} r where r.reversal_of_id = ${payments.id})`;
  const allocated = sql<number>`coalesce((select sum(pa.amount) from ${paymentAllocations} pa where pa.payment_id = ${payments.id}), 0)`;
  const rows = await tx
    .select({ id: payments.id, amount: payments.amount, allocated: allocated.mapWith(Number) })
    .from(payments)
    .where(
      and(
        eq(payments.clubId, clubId),
        eq(payments.athleteId, athleteId),
        isNull(payments.reversalOfId),
        sql`${payments.amount} > 0`,
        sql`not ${reversed}`,
      ),
    )
    .orderBy(asc(payments.paidAt));
  for (const p of rows) {
    const free = p.amount - p.allocated;
    if (free <= 0) continue;
    const r = await allocate(tx, clubId, athleteId, p.id, free);
    if (r.allocations.length === 0) break; // nothing left to pay
  }
}

/** Next receipt number for the club (atomic). */
export async function nextReceiptNo(tx: Tx, clubId: string): Promise<string> {
  const [r] = await tx
    .update(clubs)
    .set({ receiptSeq: sql`${clubs.receiptSeq} + 1` })
    .where(eq(clubs.id, clubId))
    .returning({ seq: clubs.receiptSeq });
  return `K-${String(r.seq).padStart(6, '0')}`;
}
